# Feature Specification: OCR History & Version Control

## 1. Overview

This document specifies the architecture for the **Shared Multi-User OCR System** in Mokuro Library. It transitions from a single-user linear log to a **Git-like Branching Model**, allowing users to maintain private edits on top of a shared "Official" library without data duplication.

### Core Philosophy

* **Hybrid Authority:** A designated **Admin Branch** acts as the "Official" source of truth. Users view this by default but seamlessly "fork" into a private **User Branch** upon editing.
* **Live Draft:** Edits are persisted immediately to the database (as atomic Patches) to ensure zero data loss. The physical `.mokuro` file on disk is only updated when the Admin explicitly clicks "Save".
* **Atomic Granularity:** History is stored as individual `Patch` rows in a linked list. This simplifies conflict resolution and allows for precise "Time Travel" (Undo/Redo).
* **Self-Cleaning:** The branching model allows for "Reset" operations that atomically wipe private history via database cascades, preventing storage bloat.

---

## 2. Architecture

The system utilizes a **Branch + Patch Linked List** model.

### 2.1 The Branch (`OcrBranch`)

Decouples the state from the `Volume`. Instead of the Volume having one `headPatchId`, distinct Branches exist for different users.

* **Head Pointer:** Points to the latest `Patch` in the timeline.
* **Root Pointer (The Fork Point):** Points to the **First Private Patch** in the chain.
* **Clean State (`root == NULL`):** The branch is synced with the upstream (Admin) history. The user has no private changes.
* **Dirty State (`root != NULL`):** The branch has diverged. The `root` marks the start of the private timeline.



### 2.2 The Patch (`Patch`)

Represents an atomic, reversible operation. Patches form a doubly-linked list via `parentId`.

* **Unified Operations:** To ensure data integrity, operations on complex entities (like Blocks) are **Unified**. A single patch updates both the text and the bounding box coordinates simultaneously, preventing "ghost text" misalignment.
* **Storage:** Stored as uncompressed JSON payloads (`PatchOperation`) in the database.

---

## 3. Data Types & Interfaces

The system relies on strict TypeScript definitions to ensure frontend/backend compatibility.

### 3.1 Primitive Types (`mokuro.ts`)

```typescript
// A "Quad" representing the 4 corners of a text line [x,y]
export type Quad = [
  [number, number],
  [number, number],
  [number, number],
  [number, number]
];

// A "Rect" representing the bounding box (min_x, min_y, max_x, max_y)
export type Rect = [number, number, number, number];

```

### 3.2 Unified Value Types (`history.ts`)

To prevent desynchronization between text and geometry, we use **Unified** types. We do *not* allow patching `lines` and `lines_coords` separately.

```typescript
// UnifiedLine: Atomic unit of text + position
export interface UnifiedLine {
  text: string;
  coords: Quad;
}

// UnifiedBlock: Represents a full block structure
export interface UnifiedBlock {
  box: Rect;
  vertical: boolean;
  font_size?: number;
  lines: UnifiedLine[]; // Replaces separate string[] and Quad[] arrays from native format
}

// FineValue: For simple property replacements on leaf nodes
export type FineValue = 
  | string  // Text content
  | boolean // Vertical flag
  | number  // Font size
  | Rect    // Box coordinates
  | Quad;   // Line coordinates

export type PatchValue = FineValue | UnifiedBlock | UnifiedLine;

```

### 3.3 The Patch Operation (`history.ts`)

Each database row stores one `PatchOperation` serialized as JSON.

```typescript
export type OpType = 'replace' | 'add' | 'remove' | 'reorder_lines' | 'reorder_blocks';

export interface PatchOperation {
  id: string;           // UUID
  op: OpType;
  path: string;         // JSON Pointer (RFC 6901 style)
  
  // The new value to apply (Required for 'add'/'replace')
  value?: PatchValue;   
  
  // The previous value (Required for 'remove'/'replace' to enable Undo)
  old_value?: PatchValue; 
  
  // Specific to reorder operations
  new_order?: number[]; 
}

```

---

## 4. Path Specification & Operations

The system uses a strict subset of JSON Pointers to target specific entities within the `MokuroData` structure.

**Root Context:** `MokuroData` object.

### 4.1 Block Operations

Targeting blocks within a page.

| Operation | Path Schema | Value Type | Description |
| --- | --- | --- | --- |
| **Add Block** | `/pages/{p}/blocks/-` | `UnifiedBlock` | Append a new block to page `{p}`. |
| **Insert Block** | `/pages/{p}/blocks/{b}` | `UnifiedBlock` | Insert block at index `{b}`. |
| **Remove Block** | `/pages/{p}/blocks/{b}` | `N/A` | Remove block at index `{b}`. `old_value` required. |
| **Reorder Blocks** | `/pages/{p}/blocks` | `N/A` | Reorder blocks on page `{p}` using `new_order` indices. |
| **Resize Box** | `/pages/{p}/blocks/{b}/box` | `Rect` | Update bounding box coordinates. |
| **Set Vertical** | `/pages/{p}/blocks/{b}/vertical` | `boolean` | Toggle vertical/horizontal text flow. |
| **Set Font Size** | `/pages/{p}/blocks/{b}/font_size` | `number` | Update font size metadata. |

### 4.2 Line Operations

Targeting lines within a block. Note that `lines` and `lines_coords` are modified atomically via `UnifiedLine` or specific sub-paths.

| Operation | Path Schema | Value Type | Description |
| --- | --- | --- | --- |
| **Add Line** | `/pages/{p}/blocks/{b}/lines/-` | `UnifiedLine` | Append line to block `{b}`. Updates both text and coords arrays. |
| **Insert Line** | `/pages/{p}/blocks/{b}/lines/{l}` | `UnifiedLine` | Insert line at index `{l}`. |
| **Remove Line** | `/pages/{p}/blocks/{b}/lines/{l}` | `N/A` | Remove line at index `{l}`. `old_value` required. |
| **Reorder Lines** | `/pages/{p}/blocks/{b}/lines` | `N/A` | Reorder lines in block `{b}` using `new_order`. |
| **Edit Text** | `/pages/{p}/blocks/{b}/lines/{l}/text` | `string` | Update text content only. |
| **Edit Coords** | `/pages/{p}/blocks/{b}/lines/{l}/coords` | `Quad` | Update line coordinates only. |

**Forbidden Paths:**
Direct modification of `/pages/{p}/blocks/{b}/lines_coords/...` is **strictly forbidden**. All coordinate changes must go through the `/lines/...` paths to ensure data consistency.

---

## 5. Database Schema (Prisma)

```prisma
model OcrBranch {
  id          String   @id @default(uuid())

  volumeId    String
  userId      String   // Owner of this branch

  // --- Pointers ---
  // The current state of this branch
  headPatchId String?
  headPatch   Patch?   @relation("BranchHead", fields: [headPatchId], references: [id])

  // The start of the private timeline.
  // IF NULL: Branch is synonymous with its parent (Clean).
  // IF SET: Branch has private edits starting at this patch (Dirty).
  rootPatchId String?
  rootPatch   Patch?   @relation("BranchRoot", fields: [rootPatchId], references: [id])

  // Future-proofing for Federation
  upstreamSource String @default("local") 

  updatedAt   DateTime @updatedAt
  
  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([volumeId, userId])
}

model Patch {
  id          String   @id @default(uuid())

  // --- The Tree ---
  parentId    String?
  // CRITICAL: Cascade delete allows efficient "Reset" logic
  parent      Patch?   @relation("HistoryTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Patch[]  @relation("HistoryTree")

  // --- Metadata ---
  volumeId    String
  userId      String   // Attribution: Who made THIS specific edit
  createdAt   DateTime @default(now())

  // --- Payload ---
  // JSON String adhering to PatchOperation interface
  operation   String   

  // Relations
  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  asHeadOf    OcrBranch[] @relation("BranchHead")
  asRootOf    OcrBranch[] @relation("BranchRoot")

  @@index([volumeId])
  @@index([parentId])
}

```

---

## 6. Key Workflows

### 6.1 Reading (The Clean State)

When a user opens a volume, the system ensures an `OcrBranch` exists.

* **If New:** Create Branch with `headPatchId = AdminBranch.headPatchId` and `rootPatchId = NULL`.
* **Effect:** The user sees the Official text. No storage cost for patches.

### 6.2 Editing (The Fork Trigger)

User makes an edit (e.g., fixes a typo).

1. **Check Root:** Is `ActiveBranch.rootPatchId` NULL?
2. **Create Patch:** Insert new `Patch` pointing to current `headPatchId`.
3. **Lock Root:** If Root was NULL, update `ActiveBranch.rootPatchId = NewPatch.id`.
4. **Advance Head:** Update `ActiveBranch.headPatchId = NewPatch.id`.
5. **Effect:** The branch is now "Dirty". It effectively tracks a private timeline `AdminHead -> NewPatch`.

### 6.3 Resetting (Self-Cleaning)

User wants to revert to the Official version.

1. **Identify Target:** Get `AdminBranch.headPatchId`.
2. **Identify Waste:** Get `ActiveBranch.rootPatchId`.
3. **Update Pointers:** Set `ActiveBranch.head = AdminHead`, `root = NULL`.
4. **Cleanup:** Delete the patch referenced by the *old* `rootPatchId`.
* **Result:** The database cascades this delete, wiping the entire private linked list from Root to Head. Zero orphans.



### 6.4 Fast-Forward (Admin Merge)

Admin wants to accept a User's fix.

1. **Identify Fix:** User's `headPatchId`.
2. **Check Lineage:** Verify User's patch descends from Admin's current Head.
3. **Update:** Set `AdminBranch.headPatchId = UserPatch.id`.
4. **Result:** The "Private" edit is now the "Official" edit.

---

## 7. Implementation Requirements

### 7.1 `PatchApplicator`

A static utility that applies a `PatchOperation` to a mutable `MokuroData` object.

* **Logic:** Parses JSON Pointers defined in Section 4.
* **Guard Rails:**
* Must parse `/lines` paths and update `lines` and `lines_coords` arrays in parallel.
* Must throw error on unknown paths or direct `lines_coords` access.

### 7.2 `PatchApplicator` Updates

The `PatchApplicator` utility must be updated to support the full spec:

* **Implement `reorder_blocks`:** Add logic to handle reordering of the `blocks` array.
* **Strict Pathing:** Continue to forbid direct access to `lines_coords`.
* **Unified Handling:** Ensure `add`/`remove` operations on Lines manage the `lines` and `lines_coords` arrays in sync.

### 7.3 `PatchInverter`

Calculates the **Inverse Patch** for Undo operations.

* **Requirement:** Every `PatchOperation` stored in the DB must include `old_value`.
* **Logic:**
* `add` -> `remove` (uses `old_value` if needed for history consistency, though usually `value` becomes `old_value`).
* `remove` -> `add` (uses `old_value` to restore data).
* `replace` -> `replace` (swaps `value` <-> `old_value`).
* `reorder` -> `reorder` (calculates inverse permutation).


### 7.4 Safety Mechanisms

* **Transaction Wrapper:** The Rebase endpoint (`POST /api/library/rebase`) must use `prisma.$transaction`.
* **Dead Zone Logic:** The simulation engine needs a robust way to track "Deleted Indices" to fail fast if a user tries to edit them.


## 8. Specification: Rebase Workflow

Rebasing is the process of moving a Diverged User Branch (`D`) onto a new Upstream Head (`U`). This allows a user to retain their private edits while incorporating the latest official fixes.

### 8.1 The Challenge: Index Shifting

Structural changes upstream (insertions/deletions) invalidate downstream patch indices.

* **Scenario:** Admin adds a new block at `index 0`.
* **User Patch:** Edits `blocks[0]` (intended to be the *old* first block).
* **Requirement:** The Rebase engine must **Transform** user paths (e.g., shift `blocks[0]` -> `blocks[1]`) so they target the correct content in the new structure.

### 8.2 The Rebase Algorithm (Full Simulation)

The system performs a full simulation of upstream changes to construct a "Reality Map" before applying user patches.

**Inputs:**

* `UserChain`: List of patches from `Root` to `UserHead`.
* `UpstreamChain`: List of patches from `Root.parent` to `AdminHead`.

**Phase 1: Analysis (Build Upstream Map)**
Iterate through `UpstreamChain` to track shifts in every array (Pages, Blocks, Lines).

* **Insertion (Shift Up):**
* *Event:* Upstream adds item at index `i`.
* *Effect:* All logical indices `k >= i` are shifted to `k + 1`.
* *Collision Rule:* **Upstream Wins.** If User also inserted at `i`, the Upstream item comes first. The User's insertion is shifted to `i + 1`.


* **Deletion (Shift Down & Invalidate):**
* *Event:* Upstream removes item at index `i`.
* *Effect:* Index `i` becomes a **Dead Zone**.
* *Siblings:* All logical indices `k > i` are shifted down to `k - 1`.


* **Reorder (Permutation):**
* *Event:* Upstream reorders an array.
* *Effect:* Indices are scrambled based on the new permutation.



**Phase 2: Verification (Conflict Detection)**
Iterate through `UserChain` to check for operations that cannot be safely transformed.

* **Dead Zone Conflict:** User patch targets an index `i` that was deleted upstream.
* *Action:* **Reject Rebase**. (Cannot edit what doesn't exist).


* **Structural Conflict (The Reorder Trap):** User patch attempts to `reorder` an array that the Upstream has structurally modified (added/removed items).
* *Reasoning:* The User's permutation vector (`new_order`) relies on the *old* array length and indices. Upstream changes make this vector mathematically invalid.
* *Action:* **Reject Rebase**.


* **Content Conflict:** User and Upstream modified the exact same leaf property (e.g., both changed text of Line 1).
* *Action:* **Reject Rebase**.



**Phase 3: Transformation**
If no conflicts are found, clone and transform the User patches.

* **Path Mapping:** Apply the calculated shifts/permutations to `P.path`.
* *Example:* `/blocks/0/lines/1` becomes `/blocks/1/lines/1`.



**Phase 4: Execution (Atomic Commit)**
**CRITICAL:** This entire phase must run within a **Database Transaction**.

1. **Delete Old History:** Delete the `Root` patch of the User Branch. (Cascade deletion wipes the old private timeline).
2. **Reset Pointer:** Set User Branch `head = AdminHead`, `root = NULL`.
3. **Replay New History:** For each transformed patch `P'`:
    * Insert `P'` (with `parentId` = previous patch).
    * Update Branch `head` and `root` pointers.

