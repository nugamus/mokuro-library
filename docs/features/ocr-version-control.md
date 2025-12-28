# Feature Specification: Shared OCR & Version Control (v2.1)

## 1. Overview & Core Philosophy

This document specifies the architecture for the **Shared Multi-User OCR System** in Mokuro Library. It transitions the system from a single-user linear log to a **Database-Master Hybrid Model** with per-user caching.

### Core Principles

* **Database as Master:** The PostgreSQL database is the single authoritative source of truth for all history and state.
* **Per-User Snapshot Caching:** To ensure high performance, every user maintains a private `.mokuro` file (snapshot) on disk. This file is a serialization of their current branch state, updated only during specific "Commit" events (Save/Rebase/Reset).
* **Hybrid Authority:** Users view the Admin's "Official" branch by default. Upon editing, they seamlessly fork into a private **User Branch** (Copy-on-Write).
* **Granular "Hot 100" History:** To balance database performance with granular Undo/Redo capabilities, the system maintains the most recent 100 edits as individual patches. Edits older than 100 are automatically squashed into a single base state during synchronization.
* **Non-Blocking Rebase:** Synchronization utilizes a **Floating Branch** strategy—manifesting changes in a temporary detached branch before atomically swapping pointers—to prevent database locking.

---

## 2. Database Architecture (Prisma Schema)

The schema implements **Optimistic Locking** to handle concurrency and **Soft Deletes** to prevent accidental data loss.

### 2.1 Branching (`OcrBranch`)

Tracks the current state of a volume for a specific user.

```prisma
model OcrBranch {
  id          String   @id @default(uuid())

  volumeId    String
  userId      String   // Owner of this branch

  // --- Pointers ---
  // The current state of this branch (Latest Edit)
  headPatchId String?
  headPatch   Patch?   @relation("BranchHead", fields: [headPatchId], references: [id])

  // The start of the private timeline.
  // IF NULL: Branch is synonymous with its parent (Clean).
  // IF SET: Branch has private edits starting at this patch (Dirty).
  rootPatchId String?
  rootPatch   Patch?   @relation("BranchRoot", fields: [rootPatchId], references: [id])

  // --- Concurrency & Safety ---
  version     Int      @default(0)     // Optimistic Locking Counter
  isFloating  Boolean  @default(false) // If true, this is a temp branch being built during rebase

  // --- Metadata ---
  updatedAt   DateTime @updatedAt

  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([volumeId, userId]) // Enforces 1 active branch per user
}

```

### 2.2 History (`Patch`)

A doubly-linked list of atomic operations. **Note:** `onDelete: Cascade` is strictly forbidden on the `parent` relation to prevent history destruction.

```prisma
model Patch {
  id          String   @id @default(uuid())

  // --- The Tree ---
  parentId    String?
  // NO CASCADE: Deleting a parent should not auto-delete children.
  // This is handled via explicit "Garbage Collection" logic.
  parent      Patch?   @relation("HistoryTree", fields: [parentId], references: [id])
  children    Patch[]  @relation("HistoryTree")

  // --- Metadata ---
  volumeId    String
  userId      String   // Attribution
  createdAt   DateTime @default(now())

  // --- Payload ---
  // JSON String adhering to PatchOperation interface
  operation   String

  // --- Soft Delete ---
  deletedAt   DateTime?
  deletedBy   String?   // e.g., "rebase_gc", "user_reset"

  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  asHeadOf    OcrBranch[] @relation("BranchHead")
  asRootOf    OcrBranch[] @relation("BranchRoot")

  @@index([volumeId])
  @@index([parentId])
}

```

---

## 3. Data Types & Interfaces

Strict TypeScript definitions ensure frontend/backend compatibility. Input validation (Zod) is mandatory before database insertion.

### 3.1 Unified Value Types (`history.ts`)

To prevent desynchronization between text and geometry, structure changes (add/insert) must use **Unified Types**.

```typescript
// A "Quad" representing the 4 corners of a text line [x,y]
export type Quad = [[number, number], [number, number], [number, number], [number, number]];

// A "Rect" representing the bounding box (min_x, min_y, max_x, max_y)
export type Rect = [number, number, number, number];

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
  lines: UnifiedLine[]; // Replaces separate string[] and Quad[] arrays
}

// FineValue: Allowed ONLY for 'replace' operations on leaf nodes
export type FineValue = string | boolean | number | Rect | Quad;

export type PatchValue = FineValue | UnifiedBlock | UnifiedLine;

```

### 3.2 The Patch Operation

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

The system enforces strict pathing rules. Modifications to structure (`add`/`remove`) must use Unified Types. Modifications to content (`replace`) can be granular.

**Root Context:** `MokuroData` object.

### 4.1 Block Operations

| Operation | Path Schema | Value Type | Description |
| --- | --- | --- | --- |
| **Add Block** | `/pages/{p}/blocks/-` | `UnifiedBlock` | Append new block. **Must** include box and lines. |
| **Insert Block** | `/pages/{p}/blocks/{b}` | `UnifiedBlock` | Insert block at index `{b}`. |
| **Remove Block** | `/pages/{p}/blocks/{b}` | `N/A` | Remove block. `old_value` required. |
| **Reorder Blocks** | `/pages/{p}/blocks` | `N/A` | Reorder blocks on page `{p}` using `new_order`. |
| **Resize Box** | `/pages/{p}/blocks/{b}/box` | `Rect` | Update bounding box coordinates. |
| **Set Vertical** | `/pages/{p}/blocks/{b}/vertical` | `boolean` | Toggle vertical/horizontal text flow. |
| **Set Font Size** | `/pages/{p}/blocks/{b}/font_size` | `number` | Update font size metadata. |

### 4.2 Line Operations

| Operation | Path Schema | Value Type | Description |
| --- | --- | --- | --- |
| **Add Line** | `/pages/{p}/blocks/{b}/lines/-` | `UnifiedLine` | Append line. **Must** include text and coords. |
| **Insert Line** | `/pages/{p}/blocks/{b}/lines/{l}` | `UnifiedLine` | Insert line at index `{l}`. |
| **Remove Line** | `/pages/{p}/blocks/{b}/lines/{l}` | `N/A` | Remove line. `old_value` required. |
| **Reorder Lines** | `/pages/{p}/blocks/{b}/lines` | `N/A` | Reorder lines in block `{b}` using `new_order`. |
| **Edit Text** | `/pages/{p}/blocks/{b}/lines/{l}/text` | `string` | **Granular:** Update text content only. |
| **Edit Coords** | `/pages/{p}/blocks/{b}/lines/{l}/coords` | `Quad` | **Granular:** Update line coordinates only. |

**Validation Rule:** Direct modification of `lines_coords` array via path `/pages/{p}/blocks/{b}/lines_coords` is **FORBIDDEN**. Granular edits must use the virtual `/lines/{l}/coords` path, which the `PatchApplicator` maps to the correct underlying array index.

---

## 5. Workflows & Algorithms

### 5.1 Editing (The Commit Strategy)

To prevent database bloat while maintaining interaction history.

1. **Trigger:** `onBlur` (Focus Lost) or explicit "Save" button. This prevents "per-keystroke" spam.
2. **Validation:** Input is validated against Zod schema to ensure payload integrity.
3. **Fork Logic:**
* If `UserBranch.rootPatchId` is `NULL` (Clean State), the system creates a new root patch pointing to the current `AdminHead`.
* The `OcrBranch` is updated: `rootPatchId` = New Patch, `headPatchId` = New Patch.
* **Effect:** The user is now on a divergent private timeline.


4. **Optimistic Update:** UI updates immediately; backend confirms asynchronously.

### 5.2 The "Hot 100" Rebase Engine

**Goal:** Move User Branch `D` onto new Upstream Head `U` without locking the database, keeping recent history granular.

**Policy: The Sliding Window**

* **Hot Zone (Last 100):** Patches are kept as individual rows. This preserves granular Undo/Redo for the user's active session history.
* **Cold Zone (>100):** Older patches are compiled (squashed) into a single "Base State" patch to optimize storage and reconstruction speed.

**Algorithm:**

**Phase 1: Computation (In-Memory)**

1. **Fetch Chains:** Load User Chain (`Root`→`Head`) and Upstream Chain (`Root.parent`→`AdminHead`).
2. **Compile Transformation:**
* Identify User Patches  (The "Hot" set).
* Identify User Patches  (The "Cold" set).
* Calculate a **Single Squash Patch** representing the state of the Cold set applied to the new Admin Head.


3. **Conflict Detection:** Iterate through the "Hot" patches against the Upstream changes.
* **Rule 1 (Deletion):** If User edits a block that was deleted by Admin, **Skip** the patch.
* **Rule 2 (Reorder):** If User reorders an array, and Admin changed that array's **length** (add/remove items), **Skip** the patch. (Content changes do not invalidate reorder).


4. **Inverse Walk (Adjustment):**
* If Patch  is skipped (e.g., intended to insert at Index 5, but blocked by conflict), record an "Inverse Walk" offset.
* For all subsequent patches , if they target indices *after* the skipped index, their target path is decremented/adjusted to align with the reality that the user's insertion never happened.



**Phase 2: Manifestation (Floating Branch)**

1. **Create Branch:** Insert new `OcrBranch` with `isFloating = true`.
2. **Write Squash:** Insert the Single Squash Patch (Parent = `AdminHead`).
3. **Write Hot Patches:** Insert the transformed Hot Patches sequentially on top of the Squash Patch.
* *Note:* These insertions occur in standard transactions, not one giant atomic block, preventing table locks.



**Phase 3: Atomic Swap**

1. **Execute Swap:**
```sql
UPDATE OcrBranch 
SET headPatchId = :floatingHeadId,
    rootPatchId = :floatingRootId,
    version = version + 1
WHERE id = :userBranchId AND version = :currentVersion

```


2. **Outcome:**
* **Success:** The User Branch now points to the new valid history. The old history chain is orphaned (marked for GC). The Floating Branch record is deleted. **Triggers Snapshot Update (See 5.3).**
* **Failure (Optimistic Lock):** User made an edit during the calculation. Abort rebase. The Floating Branch is orphaned (marked for GC). Client receives "Retry" signal.



### 5.3 Per-User Snapshot Strategy

While the database is the master, reading full history trees for every page load is inefficient. We use per-user file snapshots for read performance.

* **Storage Location:** `/data/users/{userId}/snapshots/{volumeId}.mokuro`
* **Role:** Performance Cache.
* **Read Strategy (Load Volume):**
1. **Check Cache:** Does the user's snapshot file exist?
2. **Load File:** If yes, load JSON content from disk.
3. **Check Delta:** Query DB: "Are there any patches for this branch created *after* the snapshot's timestamp?"
4. **Apply Delta:** If yes, apply those few patches in-memory.
5. **Serve:** Return final JSON to client.


* **Write Strategy (Update Snapshot):**
The snapshot file is regenerated/overwritten **ONLY** during these events:
1. **Explicit Save:** User clicks "Save Snapshot" or "Export".
2. **Rebase Success:** After a rebase swap, the new state is written to disk.
3. **Reset:** After resetting to Admin branch, the Admin's state is written to the user's snapshot file.
4. **Merge:** If the Admin accepts a user's merge request.



### 5.4 Garbage Collection (The Cleanup Crew)

A Cron Job (e.g., daily) maintains hygiene using the Soft Delete signals.

1. **Identify Floating Debris:** Delete `OcrBranch` rows where `isFloating=true` AND `updatedAt < 1 hour ago`. (Cleaning up failed/stalled rebases).
2. **Identify Dead History:**
* Find `Patch` rows where `deletedAt` is NOT NULL.
* **Verification:** Ensure no active `OcrBranch` (User or Admin) traces back to this patch.
* **Action:** Hard Delete.



---

## 6. API Specification

### 6.1 Patching & Editing

**POST** `/api/volumes/:volumeId/patch`

* **Body:** `{ operation: PatchOperation, branchVersion: number }`
* **Behavior:** Validates op, creates `Patch`, updates `OcrBranch` head, increments version.
* **Response:** `{ success: true, newHeadId: string, newVersion: number }`

### 6.2 Synchronization

**POST** `/api/volumes/:volumeId/rebase`

* **Body:** `{ targetHeadId: string }` (Usually Admin Head)
* **Behavior:** Triggers the **Hot 100** Floating Branch workflow. On success, updates the User's snapshot file.
* **Response:**
* `200 OK`: `{ success: true, skippedPatches: Array<string> }`
* `409 Conflict`: `{ error: "Branch modified during rebase. Please retry." }`



**POST** `/api/volumes/:volumeId/reset`

* **Body:** `{ }`
* **Behavior:**
1. Soft-deletes the current User Branch `rootPatchId` (and implicitly the tree).
2. Sets `rootPatchId = NULL`, `headPatchId = AdminHead`.
3. **Snapshot:** Overwrites user's `.mokuro` file with Admin's current state.


* **Response:** `{ success: true }`

**POST** `/api/volumes/:volumeId/snapshot`

* **Body:** `{ }`
* **Behavior:** Reconstructs full state from DB and writes to user's snapshot file.
* **Response:** `{ success: true, timestamp: string }`

### 6.3 Status

**GET** `/api/volumes/:volumeId/status`

* **Response:**
```json
{
  "isDirty": true,        // User has private edits
  "isStale": false,       // Admin has moved ahead of User's base
  "version": 42,          // Current optimistic lock version
  "headPatchId": "..."
}

```



---

## 7. Migration Strategy (Legacy to DB)

How to transition existing libraries to this system.

1. **Initial Ingestion:**
* On startup/scan, check for `volume.mokuro` in the shared folder.
* If Database is empty for this volume:
1. Parse the legacy `.mokuro` file.
2. Create **Genesis Patch** (Patch 0) with `op: "replace", path: "/", value: full_json`.
3. Set Admin Branch Head to Genesis Patch.




2. **Legacy Protection:**
* If a user modifies the file on disk externally (bypassing the app), the system detects timestamp mismatch.
* **Policy:** Database wins. External changes are rejected unless imported via a specific "Import from Disk" Admin tool (which creates a new Patch on the Admin Branch).
