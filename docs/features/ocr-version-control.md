# Feature Specification: Shared OCR & Version Control

## 1. Overview & Core Philosophy

This document specifies the architecture for the **Shared Multi-User OCR System** in Mokuro Library. It transitions the system from a single-user linear log to a **Database-Master Hybrid Model** with per-user caching.

### Core Principles

* **Database as Master:** The PostgreSQL/SQLite database is the single authoritative source of truth for all history and state.
* **Per-User Snapshot Caching:** To ensure high performance, every user maintains a private `.mokuro` file (snapshot) on disk. This file is a serialization of their current branch state, updated only during specific "Commit" events (Save/Rebase/Reset).
* **Hybrid Authority:** Users view the Admin's "Official" branch by default. Upon editing, they seamlessly fork into a private **User Branch** (Copy-on-Write).
* **Non-Blocking Rebase:** Synchronization utilizes a **Floating Branch** strategy—manifesting changes in a temporary detached branch before atomically swapping pointers—to prevent database locking.
* **Cascade Cleanup:** Branch cleanup uses database cascade deletes for simplicity. When a branch root is deleted, all descendant patches are automatically removed.

---

## 2. Database Architecture (Prisma Schema)

The schema implements **Optimistic Locking** to handle concurrency.

### 2.1 Branching (`OcrBranch`)

Tracks the current state of a volume for a specific user.

```prisma
model OcrBranch {
  id          String   @id @default(ulid())

  volumeId    String
  userId      String   // Owner of this branch

  // --- Pointers ---
  // The current state of this branch (Latest Edit)
  // Always points to some patch (admin HEAD for clean branch, user's HEAD for dirty)
  headPatchId String
  headPatch   Patch    @relation("BranchHead", fields: [headPatchId], references: [id])

  // The start of the private timeline.
  // IF NULL: Branch is synonymous with its parent (Clean).
  // IF SET: Branch has private edits starting at this patch (Dirty).
  rootPatchId String?
  rootPatch   Patch?   @relation("BranchRoot", fields: [rootPatchId], references: [id])

  // --- Snapshot Cache ---
  // The patch ID that the cached snapshot represents.
  // IF NULL: No snapshot exists, reconstruct from .mokuro file + patches.
  // IF SET: Snapshot file exists at cache/snapshots/{branchId}.json
  // Stale check: snapshotPatchId !== headPatchId means snapshot is outdated.
  snapshotPatchId String?

  // --- Concurrency ---
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

A doubly-linked list of atomic operations for the admin branch, singly-linked for user branches. Cascade delete enables automatic cleanup.

```prisma
model Patch {
  id          String   @id @default(ulid())

  // --- The Tree ---
  parentId    String?
  // CASCADE: Deleting a parent automatically deletes all children.
  // This simplifies branch cleanup and undo operations.
  parent      Patch?   @relation("HistoryTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Patch[]  @relation("HistoryTree")

  // Forward pointer for admin branch only (NULL for user patches)
  // Enables O(1) forward traversal when user redoes through admin history
  nextPatchId String?  @unique
  nextPatch   Patch?   @relation("AdminChain", fields: [nextPatchId], references: [id])
  prevPatch   Patch?   @relation("AdminChain")

  // --- Metadata ---
  volumeId    String
  userId      String   // Attribution
  createdAt   DateTime @default(now())

  // --- Payload ---
  // JSON String adhering to PatchOperation interface
  // Genesis patch: "{}" (empty/noop, means "load from .mokuro file")
  // Regular patch: { op, path, value, old_value, ... }
  operation   String

  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  asHeadOf    OcrBranch[] @relation("BranchHead")
  asRootOf    OcrBranch[] @relation("BranchRoot")

  @@index([volumeId])
  @@index([parentId])
}
```

**Linking strategy:**
- **Admin patches:** Have both `parentId` (backward) and `nextPatchId` (forward), forming a doubly-linked list
- **User patches:** Have only `parentId` (backward); use `branch.rootPatchId` for forward navigation at branch point

**Genesis Patch Convention:**
- `parentId = NULL` indicates genesis (root of the tree)
- `operation = { op: 'genesis', path: mokuroPath }` — stores path to original `.mokuro` file
- No file content duplication in the database
- Detection: `patch.parentId === null` or `JSON.parse(patch.operation).op === 'genesis'`

### 2.3 Snapshot Strategy

Snapshots are cached JSON files that store the computed state at a specific patch. They are disposable and can be regenerated.

**Storage Location:** `cache/snapshots/{branchId}.json`

The path is derived from `branchId`, so `OcrBranch` only stores `snapshotPatchId` to track validity.

**Read Logic:**
```
if (branch.snapshotPatchId === branch.headPatchId):
  return readFile(cache/snapshots/{branchId}.json)  // Exact match
else if (branch.snapshotPatchId !== null):
  state = readFile(cache/snapshots/{branchId}.json)
  state = applyPatches(state, from: snapshotPatchId, to: headPatchId)
  return state
else:
  state = readFile(volume.mokuroPath)  // Original file
  state = applyPatches(state, from: genesis, to: headPatchId)
  return state
```

**Write Logic:**
- Update snapshot after applying patches
- Or when patch count from snapshot to HEAD exceeds threshold (e.g., 20)
- Set `branch.snapshotPatchId = branch.headPatchId` after write

**Invalidation:**
- `snapshotPatchId !== headPatchId` → snapshot is stale (walk delta or rebuild)
- Cache clear: `rm -rf cache/snapshots/` is safe (will regenerate on next read)

### 2.4 Lazy Genesis (Bootstrap)

Genesis patches and branches are created on-demand when a volume is first accessed, not during migration.

**On `GET /volume/:id`:**

```
1. Check: Does Admin Branch exist for this volume?
   
   IF NO (First Access):
     - Create Genesis Patch: { op: 'genesis', path: volume.mokuroPath }
     - Create Admin Branch: { headPatchId: genesisPatchId, rootPatchId: null }
   
   IF YES:
     - Use existing admin branch

2. Check: Does User Branch exist?
   
   IF NO (User's First Visit):
     - Create User Branch: { headPatchId: adminBranch.headPatchId, rootPatchId: null }
     - User starts "clean" (synced with admin)
   
   IF YES:
     - Use existing user branch

3. Serve Data:
   
   IF branch is clean (rootPatchId === null):
     - Optimization: Read directly from .mokuro file (matches admin state)
   
   IF branch is dirty (rootPatchId !== null):
     - Reconstruct state using snapshot strategy (Section 2.3)
```

**Race Condition Handling:**

Use a database transaction with double-check pattern:
```typescript
try {
  await prisma.$transaction(async (tx) => {
    // Double-check inside transaction
    const existing = await tx.ocrBranch.findUnique({ where: { volumeId_userId: { volumeId, userId: 'admin' } } });
    if (existing) return existing;
    
    // Create genesis + branch
    await tx.patch.create({ data: { id: genesisPatchId, ... } });
    await tx.ocrBranch.create({ data: { id: branchId, headPatchId: genesisPatchId, ... } });
  });
} catch (e) {
  // Race condition: another request won, re-fetch
  return await prisma.ocrBranch.findUnique({ ... });
}
```

**Benefits:**
- No upfront migration cost
- Processes volumes only when accessed
- Backwards compatible with existing `.mokuro` files

### 2.5 ID Generation

All IDs use ULID for chronological sortability and better index performance. ULIDs are generated automatically via Prisma schema defaults.

```prisma
model Patch {
  id String @id @default(ulid())
  // ...
}

model OcrBranch {
  id String @id @default(ulid())
  // ...
}
```

Prisma generates ULIDs client-side when no `id` is provided in `create()` calls.

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
  lines: UnifiedLine[];
}

// FineValue: Allowed for 'replace' operations on leaf nodes
export type FineValue = string | boolean | number | Rect | Quad;

export type PatchValue = FineValue | UnifiedBlock | UnifiedLine;
```

### 3.2 The Patch Operation

```typescript
export type OpType = 'genesis' | 'replace' | 'add' | 'remove' | 'reorder';

export type PatchOperation =
  | {
      op: 'genesis';
      path: string;  // mokuroPath — path to the original .mokuro file
    }
  | {
      op: 'replace';
      path: string;
      value: PatchValue;
      old_value: PatchValue;
    }
  | {
      op: 'add';
      path: string;
      value: PatchValue;
    }
  | {
      op: 'remove';
      path: string;
      old_value: PatchValue;
    }
  | {
      op: 'reorder';
      path: string;
      new_order: number[];  // Valid permutation [0..n-1]
    };
```

**Genesis Patch:** The first patch in any history tree. Contains `op: 'genesis'` and `path` pointing to the original `.mokuro` file location. Created automatically during lazy initialization.
```

### 3.3 Patch Validation (Zod Schema)

All patches must be validated at the API boundary using Zod. Invalid patches are rejected.

```typescript
const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('genesis'),
    path: z.string().min(1)
  }),
  z.object({
    op: z.literal('replace'),
    path: z.string().regex(/^\/pages\/\d+\/.+/),
    value: z.any(),
    old_value: z.any()
  }),
  z.object({
    op: z.literal('add'),
    path: z.string().regex(/^\/pages\/\d+\/.+/),
    value: z.any()
  }),
  z.object({
    op: z.literal('remove'),
    path: z.string().regex(/^\/pages\/\d+\/.+/),
    old_value: z.any()
  }),
  z.object({
    op: z.literal('reorder'),
    path: z.string().regex(/^\/pages\/\d+\/.+/),
    new_order: z.array(z.number().int().nonnegative())
  }).superRefine((data, ctx) => {
    const sorted = [...data.new_order].sort((a, b) => a - b);
    const isValidPermutation = sorted.every((v, i) => v === i);
    if (!isValidPermutation) {
      ctx.addIssue({ code: 'custom', message: "new_order must be a valid permutation" });
    }
  })
]);
```

**Validation Rules:**

| Check | Requirement |
|-------|-------------|
| Operation type | Must be one of: `genesis`, `replace`, `add`, `remove`, `reorder` |
| Path format | Must start with `/pages/{n}/` for non-genesis operations |
| `value` field | Required for `add` and `replace` operations |
| `old_value` field | Required for `remove` and `replace` operations (enables undo) |
| `new_order` field | Required for `reorder` operations; must be valid permutation [0..n-1] |
| Value types | Must match expected type for the target path (see Section 4) |

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

### 5.2 User Undo/Redo (HEAD Crawl)

Users can undo by moving their branch HEAD pointer backwards. Undone patches remain in the database (dangling) until a new edit is made.

**Undo:** Move HEAD to parent. Undone patch stays (redo possible).

**Redo:** Move HEAD back to child (if exactly one exists).

**New edit after undo:** Deletes dangling patches (cascade), redo no longer possible.

**Scenario A: Undo and redo within branch**
```
User branch: A3 → U1 → U2 → U3 (HEAD, root = U1)

User undoes once: HEAD moves to U2, U3 dangles
User redoes: HEAD moves back to U3

Result: Branch unchanged
```

**Scenario B: Undo and new edit within branch**
```
User branch: A3 → U1 → U2 → U3 (HEAD, root = U1)

User undoes once: HEAD moves to U2, U3 dangles
User makes new edit: U4

Result:
- Delete U3 (cascade handles any children)
- Branch: A3 → U1 → U2 → U4 (HEAD, root = U1 unchanged)
```

**Scenario C: Undo past branch root, then new edit**
```
User branch: A3 → U1 → U2 (HEAD, root = U1)

User undoes twice: HEAD moves to A3 (past root U1), U1 and U2 dangle
User makes new edit: U3

Result:
- Delete U1 (old root) → cascades to U2
- New branch: A3 → U3 (HEAD, root = U3)
```

**Scenario D: Undo past branch root, then redo back**
```
User branch: A3 → U1 → U2 (HEAD, root = U1)

User undoes twice: HEAD moves to A3 (past root U1)
User redoes: HEAD moves to U1 (branch root guides which child to follow)
User redoes again: HEAD moves to U2

Result: Branch unchanged, back to original state
```

**Note on redo navigation:** When user redoes, the system determines which child to follow:
1. If `HEAD == branch.rootPatchId.parent`: Follow `rootPatchId` (entering user's branch)
2. If HEAD is within user's branch: Follow the single dangling child
3. If HEAD is on admin branch (before branch point): Follow `nextPatchId` (admin's forward pointer)

### 5.3 Admin Undo & Revert

**Admin Undo:** Admin can crawl HEAD backwards (undo) with the following rules:

**Case 1: No branch points in undo range**
- Admin can freely undo
- Abandoned patches are deleted (cascade)
- **Clear `nextPatchId`:** The new HEAD patch has `nextPatchId` set to NULL

**Case 2: Exactly one user branch in undo range**
- Admin can undo with "branch drag"
- The abandoned patches are transferred to the user's branch
- User's `rootPatchId` is reassigned to the earliest abandoned patch
- **Clear `nextPatchId`:** Transferred patches have `nextPatchId` set to NULL (user branches are singly-linked)
- User's branch now "owns" those patches
- No conflicts, no rebase needed, no data loss

```
Before:
Admin: A1 → A2 → A3 → A4 (HEAD)
       (A1.next=A2, A2.next=A3, A3.next=A4)
User: A2 → U1 → U2 (root = U1)

Admin undoes to A1, dragging User's branch:

After:
Admin: A1 (HEAD, A1.nextPatchId = NULL)
User: A1 → A2 → A3 → A4 → U1 → U2 (root = A2)
      (A2.next=NULL, A3.next=NULL, A4.next=NULL — now singly-linked)
```

**Case 3: Multiple user branches in undo range**
- Admin cannot undo (blocked)
- Cannot determine which branch should own the abandoned patches
- Admin must use revert instead, or wait for users to reset/rebase

**Use cases enabled by branch drag:**
- Admin accidentally merged (fast-forwarded) a user's changes and wants to undo
- Admin wants to partially accept changes (undo some, keep others with user)

**Admin Revert:** When admin cannot undo (blocked by multiple branches) or wants to preserve history, they can use **revert** instead. Revert creates an inverse patch as a new child of HEAD. See Section 6.2 for API details.

### 5.4 The Rebase Engine

**Goal:** Move User Branch onto new Admin Head without locking the database.

**Mental Model:** Walk the entire user branch forward one admin patch at a time. Each admin patch may produce a transformation that propagates through all subsequent user patches—unless a conflict resolution cancels it.

#### Phase 1: Preparation

1. **Fetch Chains:** 
   - Admin Chain: Patches from user's base to current Admin HEAD
   - User Chain: User's patches (root to HEAD)

2. **Build Walk Queue:** List of admin patches to walk past, in order.

#### Phase 2: Walk Branch Forward (One Admin Patch at a Time)

For each admin patch `A`:

1. **Compute Effect:** Determine how `A` affects indices/structure
   - Insert at index `i`: All user patches targeting index ≥ `i` get +1
   - Delete at index `i`: All user patches targeting index > `i` get -1; index = `i` is dead zone
   - Reorder with permutation `P`: Paths are remapped according to `P`

2. **Check Each User Patch for Conflicts:**
   - If user patch targets dead zone → Conflict
   - If user patch is reorder on array admin modified → Conflict
   - If both reordered same array → Conflict

3. **Resolve Conflicts:** (See Section 5.5)

4. **Propagate Effect:** Transform all non-conflicting user patches

#### Phase 3: Manifestation (Floating Branch)

1. **Create Floating Branch:** Insert new `OcrBranch` with `isFloating = true`
2. **Write Transformed Patches:** Insert patches sequentially (not one giant transaction)

#### Phase 4: Atomic Swap

```sql
UPDATE OcrBranch 
SET headPatchId = :floatingHeadId,
    rootPatchId = :floatingRootId,
    version = version + 1
WHERE id = :userBranchId AND version = :currentVersion
```

**Outcomes:**
- **Success:** Delete old branch root (cascades to old history). Delete floating branch record. Update user's snapshot file.
- **Failure (Optimistic Lock):** User made an edit during rebase. Abort. Delete floating branch. Return "Retry" signal.

### 5.5 Conflict Resolution

#### Unified Model

Every conflict has an **incoming effect** from an admin patch. There are always two resolution paths:

| Resolution | What Happens | Effect |
|------------|--------------|--------|
| **Skip / Keep Admin** | Delete user patch | Effect propagates forward (breaks through) |
| **Keep Mine** | Transform user patch to absorb effect | Propagation stops (absorbed) |

Some conflicts only allow Skip (no valid transformation exists).

#### Transform to Absorb (by conflict type)

| Conflict | Incoming Effect | Transform to Absorb |
|----------|-----------------|---------------------|
| Dead Zone | Delete shift (-1) | Resurrect: convert to insert (+1 cancels -1) |
| Double Delete | Delete shift (-1) | N/A (always skip, operation was redundant) |
| Reorder + Length Change | Shift | N/A (permutation invalid for new length) |
| Competing Reorders | `A⁻¹` | Transform to `A⁻¹ * U` |
| Content Conflict | Value change | Update `old_value` to admin's `value` |

#### Intersection Types

When comparing user operation path against effect path, we determine the relationship:

| Intersection | Meaning |
|--------------|---------|
| `no_hit` | No overlap, passthrough |
| `sibling_hit` | User operates in same array as effect (path transform) |
| `direct_hit` | User path === affected path |
| `ancestor_hit` | User path inside affected path |
| `descendant_hit` | Affected path inside user path |

Note: For `shift_up` effects, there is no existing item at the gap, so only `sibling_hit` and `descendant_hit` are possible.

#### Conflict Types

| Conflict Type | Resolution | Description |
|---------------|------------|-------------|
| `shift_down_into_add` | Auto | User adding at exact index admin deleted, bump effect index |
| `effect_shift` | Auto | User's add/reorder at ancestor shifts the effect path |
| `double_delete` | Auto | Both deleted same item, effect nullified |
| `dead_zone` | User choice | Admin deleted item, user edited inside |
| `reverse_dead_zone` | User choice | Admin edited inside, user deleted container |
| `reorder_collision` | User choice | Both reordered same array |
| `content_conflict` | User choice | Both edited same field |

#### Conflict Tables by Intersection Type

**direct_hit** (userPath === affectedPath):

| effect.type | userOp.op | Conflict | Resolution | Patch Mutation | Residual Effect |
|-------------|-----------|----------|------------|----------------|-----------------|
| `shift_down` | `add` | `shift_down_into_add` | Auto | Keep patch (apply permutation if present) | `shift_down[N+1]` |
| `shift_down` | `remove` | `double_delete` | Auto | Discard patch | Identity |
| `permute` | `reorder` | `reorder_collision` | `keep_admin` | Discard patch | `A⁻¹ * U` accumulated |
| | | | `keep_mine` | Transform `new_order` to `A⁻¹ * U` | Identity |
| `content` | `replace` | `content_conflict` | `keep_admin` | Discard patch | `content` continues |
| | | | `keep_mine` | Update `old_value` | Identity |

**ancestor_hit** (userPath inside affectedPath):

| effect.type | userOp.op | Conflict | Resolution | Patch Mutation | Residual Effect |
|-------------|-----------|----------|------------|----------------|-----------------|
| `shift_down` | `add` | `dead_zone` | `keep_admin` | Discard patch | `shift_down` continues |
| | | | `keep_mine` | Transform to `add` with restored content + edit | Identity |
| `shift_down` | `remove` | `dead_zone` | `keep_admin` | Discard patch | `shift_down` continues |
| | | | `keep_mine` | Transform to `add` with restored content - removed item | Identity |
| `shift_down` | `replace` | `dead_zone` | `keep_admin` | Discard patch | `shift_down` continues |
| | | | `keep_mine` | Transform to `add` with restored content + edit | Identity |
| `shift_down` | `reorder` | `dead_zone` | `keep_admin` | Discard patch | `shift_down` continues |
| | | | `keep_mine` | Transform to `add` with restored content + reorder | Identity |

**descendant_hit** (affectedPath inside userPath):

| effect.type | userOp.op | Conflict | Resolution | Patch Mutation | Residual Effect |
|-------------|-----------|----------|------------|----------------|-----------------|
| `shift_down` | `add` | `effect_shift` | Auto | Keep patch | Shift effect path |
| `shift_up` | `add` | `effect_shift` | Auto | Keep patch | Shift effect path |
| `permute` | `add` | `effect_shift` | Auto | Keep patch | Shift effect path |
| `content` | `add` | `effect_shift` | Auto | Keep patch | Shift effect path |
| `shift_down` | `remove` | `reverse_dead_zone` | `keep_admin` | Discard patch | `shift_up[N]` |
| | | | `keep_mine` | Keep patch | Identity |
| `shift_up` | `remove` | `reverse_dead_zone` | `keep_admin` | Discard patch | `shift_up[N]` |
| | | | `keep_mine` | Keep patch | Identity |
| `permute` | `remove` | `reverse_dead_zone` | `keep_admin` | Discard patch | `shift_up[N]` |
| | | | `keep_mine` | Keep patch | Identity |
| `content` | `remove` | `reverse_dead_zone` | `keep_admin` | Discard patch | `shift_up[N]` |
| | | | `keep_mine` | Keep patch | Identity |
| `shift_down` | `reorder` | `effect_shift` | Auto | Keep patch | Permute effect path |
| `shift_up` | `reorder` | `effect_shift` | Auto | Keep patch | Permute effect path |
| `permute` | `reorder` | `effect_shift` | Auto | Keep patch | Compose permutations |
| `content` | `reorder` | `effect_shift` | Auto | Keep patch | Permute effect path |

**sibling_hit** (user in same array, handled separately):

| effect.type | userOp.op | Handling |
|-------------|-----------|----------|
| `shift_up` | any | Path transform: index >= effect.index gets +1 |
| `shift_down` | any | Path transform: index > effect.index gets -1 |
| `permute` | any | Path transform: index mapped through permutation |
| `shift_*` | `reorder` | Discard patch, accumulate permutation onto effect |
| `permute` | `reorder` | N/A (would be direct_hit via `/-1` trick) |

#### Resolution Types

| Resolution | Meaning |
|------------|---------|
| **Auto** | No user input needed, resolved automatically |
| **keep_admin** | Prefer admin's change, discard or transform user's patch |
| **keep_mine** | Prefer user's intent, transform to apply user's change |

#### Permutation Math

For reorder conflicts, we use permutation composition.

**Notation:**
- `A` = Admin's reorder permutation
- `U` = User's original reorder permutation  
- `A_inv` = Inverse of admin's permutation
- `*` = Composition: `(P * Q)[i] = Q[P[i]]`

**Keep Mine:** User wants their intended final order. Transform user's patch to `U' = A_inv * U`.

**Example:**
```
Base: [B0, B1, B2]
A = [1, 2, 0]     → Admin result: [B1, B2, B0]
U = [2, 0, 1]     → User intended: [B2, B0, B1]

A_inv = [2, 0, 1]

U' = A_inv * U
   = [2, 0, 1] * [2, 0, 1]
   
[0]: U[A_inv[0]] = U[2] = 1
[1]: U[A_inv[1]] = U[0] = 2
[2]: U[A_inv[2]] = U[1] = 0

U' = [1, 2, 0]

Verify: Apply [1, 2, 0] to [B1, B2, B0]:
  new[0] = [B1,B2,B0][1] = B2
  new[1] = [B1,B2,B0][2] = B0
  new[2] = [B1,B2,B0][0] = B1
Result: [B2, B0, B1] ✓ (matches user's intent)
```

**Keep Admin:** Skip user's reorder. Propagate `A_inv * U` to subsequent patches so they account for the missing reorder.

### 5.6 Per-User Snapshot Strategy

While the database is the master, reading full history trees for every page load is inefficient. We use per-user file snapshots for read performance.

* **Storage Location:** `/data/users/{userId}/snapshots/{volumeId}.mokuro`
* **Role:** Performance Cache.

**Snapshot Structure:**
- `state`: Full `MokuroData` JSON
- `patchId`: The patch ID this snapshot was generated at

**Read Strategy (Load Volume):**
1. **Check Cache:** Does the user's snapshot file exist?
2. **Load File:** If yes, load snapshot from disk.
3. **Check Delta:** Query DB for patches between `snapshot.patchId` and `branch.headPatchId`.
4. **Apply Delta:** Walk forward from snapshot, applying each patch in order.
5. **Serve:** Return final state to client.

**Write Strategy (Update Snapshot):**
1. Load current snapshot (or genesis state if none exists).
2. Apply patches from `snapshot.patchId` to target `patchId`.
3. Save new snapshot with updated `state` and `patchId`.

Snapshots are regenerated **ONLY** during these events:
- **Explicit Save:** User clicks "Save Snapshot" or "Export".
- **Rebase Success:** After a rebase swap.
- **Reset:** After resetting to Admin branch.
- **Merge:** If the Admin accepts a user's merge request.

**Note:** Snapshot regeneration always walks forward from the existing snapshot—never from genesis. This ensures O(delta) cost rather than O(full history).

---

## 6. API Specification

All volume-related endpoints are under `/api/library/volumes/`. The same endpoints serve both admin and regular users via the **Strategy Pattern** — behavior differs based on the authenticated user.

### 6.1 Patching & Editing

**POST** `/api/library/volumes/:id/patch`

* **Body:** `{ operation: PatchOperation, branchVersion: number }`
* **Behavior:** Validates op, creates `Patch`, updates `OcrBranch` head, increments version.
* **Response:**
```json
{
  "success": true,
  "newHeadId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "newVersion": 43,
  "patch": { "op": "replace", "path": "/pages/0/blocks/1/lines/0/text", "value": "...", "old_value": "..." }
}
```
The `patch` field echoes back the operation for client-side consistency.
* **Errors:**
  - `400`: Validation failed
  - `404`: Volume not found
  - `409`: Version mismatch (concurrent edit)

**POST** `/api/library/volumes/:id/undo`

* **Body:** `{ branchVersion: number }`
* **Behavior:** Moves HEAD to parent patch, returns inverse operation for client-side rollback.
* **Response:**
```json
{
  "success": true,
  "newHeadId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "newVersion": 44,
  "patch": { "op": "replace", "path": "...", "value": "old", "old_value": "new" }
}
```
* **Errors:**
  - `400`: Cannot undo (at genesis)
  - `404`: Volume not found
  - `409`: Version mismatch

**POST** `/api/library/volumes/:id/redo`

* **Body:** `{ branchVersion: number }`
* **Behavior:** Moves HEAD forward to child patch (if exists).
* **Response:**
```json
{
  "success": true,
  "newHeadId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "newVersion": 45,
  "patch": { "op": "replace", "path": "...", "value": "new", "old_value": "old" }
}
```
* **Errors:**
  - `400`: Nothing to redo / multiple children
  - `404`: Volume not found
  - `405`: Not available (admin timeline is destructive)
  - `409`: Version mismatch

### 6.2 Synchronization (Rebase)

Rebase is a stateful, multi-step operation that pauses when conflicts are encountered, similar to Git.

**POST** `/api/library/volumes/:id/rebase/start`

* **Body:** `{ }` (empty)
* **Response:**
  - No conflicts: `{ status: 'complete', newHeadId: string }`
  - Conflict encountered: `{ status: 'paused', rebaseId: string, conflict: ConflictInfo }`

**POST** `/api/library/volumes/:id/rebase/continue`

* **Body:** `{ rebaseId: string, resolution: 'keep_admin' | 'keep_mine' }`
* **Response:**
  - More conflicts: `{ status: 'paused', conflict: ConflictInfo }`
  - Done: `{ status: 'complete', newHeadId: string }`

**POST** `/api/library/volumes/:id/rebase/abort`

* **Body:** `{ rebaseId: string }`
* **Response:** `{ status: 'aborted' }`

**ConflictInfo:**
```
{
  reason: ConflictReason,
  userPatch: ExtendedPatch,
  adminPatch: ExtendedPatch
}
```

**ConflictReason values:**
- `shift_down_into_add` — Auto-resolved: user adding at deleted index
- `effect_shift` — Auto-resolved: user add/reorder shifts effect path
- `double_delete` — Auto-resolved: both deleted same item
- `dead_zone` — User choice: admin deleted, user edited inside
- `reverse_dead_zone` — User choice: admin edited inside, user deleted
- `reorder_collision` — User choice: both reordered same array
- `content_conflict` — User choice: both edited same field

**Rebase State:** In-progress rebase state is stored in memory cache with DB backup. If a rebase is abandoned (no continue/abort), the session expires after 24 hours.

**POST** `/api/library/volumes/:id/reset`

* **Body:** `{ }`
* **Behavior:**
  1. Delete the current User Branch root (cascade deletes entire private history).
  2. Set `rootPatchId = NULL`, `headPatchId = AdminHead`.
  3. Overwrite user's `.mokuro` snapshot with Admin's current state.
* **Response:** `{ success: true }`
* **Errors:**
  - `404`: Volume not found or access denied
  - `405`: Not applicable (admin cannot reset)

**POST** `/api/library/volumes/:id/revert` (Admin only)

* **Body:** `{ patchId: string, reason?: string }`
* **Behavior:** Creates inverse patch as child of current HEAD.
* **Response:** `{ success: true, revertPatchId: string }`

**POST** `/api/library/volumes/:id/snapshot`

* **Body:** `{ }`
* **Behavior:** Reconstructs full state from DB and writes to user's snapshot file.
* **Response:** `{ success: true, timestamp: string }`

### 6.3 Status

**GET** `/api/library/volumes/:id/status`

* **Response:**
```json
{
  "hasAhead": true,     // User has patches admin doesn't have
  "hasBehind": false,   // Admin has patches user doesn't have
  "version": 42,
  "headPatchId": "01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

| `hasAhead` | `hasBehind` | Meaning |
|------------|-------------|---------|
| false | false | Clean, synced with admin |
| true | false | User has unpublished edits |
| false | true | User should update (no edits to preserve) |
| true | true | User has edits AND needs rebase |

### 6.4 History

**GET** `/api/library/volumes/:id/history`

* **Query:** `{ branchId?: string, limit?: number, offset?: number }`
* **Response:**
```json
{
  "patches": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "userId": "user123",
      "operation": { "op": "replace", "path": "...", "value": "..." },
      "createdAt": "2025-01-15T10:30:00Z"
    }
  ],
  "total": 42
}
```

### 6.5 Merge (Admin Fast-Forward)

**POST** `/api/library/volumes/:id/merge`

* **Body:** `{ sourceBranchUserId: string }`
* **Behavior:** 
  1. Check if source branch HEAD is a direct descendant of Admin HEAD (fast-forward possible)
  2. If yes, update Admin HEAD to source branch HEAD
  3. **Link admin chain:** Set `nextPatchId` on merged patches to form doubly-linked admin branch
* **Response:** 
  - `200 OK`: `{ success: true, newHeadId: string }`
  - `400`: `{ error: "Cannot fast-forward. Rebase required." }`

**nextPatchId maintenance on merge:**
```
Before:
Admin: A1 → A2 (HEAD, A1.nextPatchId = A2)
User:  A2 → U1 → U2 (HEAD)

After merge:
Admin: A1 → A2 → U1 → U2 (HEAD)

Updates:
- A2.nextPatchId = U1.id
- U1.nextPatchId = U2.id
- U2.nextPatchId = NULL (new HEAD)
```

### 6.6 Strategy Pattern (Admin vs User)

The same API endpoints serve both admin and regular users. Behavior differs based on authentication:

| Endpoint | User Behavior | Admin Behavior |
|----------|---------------|----------------|
| `patch` | Fork-on-write to private branch | Direct edit to master branch |
| `undo` | HEAD crawl (non-destructive) | Branch drag or blocked |
| `redo` | Follow child patch | Not available (405) |
| `reset` | Discard private edits, sync to admin | Not applicable (405) |
| `rebase` | Sync private branch with admin | Not applicable |

**Implementation:**
```typescript
// Strategy factory in request lifecycle
fastify.decorateRequest('accessStrategy', null);
fastify.addHook('preHandler', (request) => {
  request.accessStrategy = APIAccessStrategyFactory.getStrategy(
    fastify, 
    request.user.id
  );
});
```

---

## 7. Migration Strategy (Legacy to DB)

How to transition existing libraries to this system.

1. **Initial Ingestion:**
   * On startup/scan, check for `volume.mokuro` in the shared folder.
   * If Database is empty for this volume:
     1. Parse the legacy `.mokuro` file.
     2. Create **Genesis Patch** with `op: "replace"`, `path: "/"`, `value: <full MokuroData>`, `parentId: NULL`. (See Section 3.3 for genesis patch exception.)
     3. Set Admin Branch HEAD to Genesis Patch.

2. **Legacy Protection:**
   * If a user modifies the file on disk externally (bypassing the app), the system detects timestamp mismatch.
   * **Policy:** Database wins. External changes are rejected unless imported via a specific "Import from Disk" Admin tool (which creates a new Genesis Patch on the Admin Branch).

---

## 8. Concurrent Edit Handling

### 8.1 Optimistic Locking

Each `OcrBranch` has a `version` counter. Every mutation must include the expected version.

```typescript
async function addPatch(branchId: string, patch: Patch, expectedVersion: number) {
  const result = await prisma.ocrBranch.updateMany({
    where: { 
      id: branchId,
      version: expectedVersion
    },
    data: { 
      headPatchId: patch.id,
      version: { increment: 1 }
    }
  });
  
  if (result.count === 0) {
    throw new ConflictError('Branch was modified. Please refresh and retry.');
  }
}
```

### 8.2 Client Retry Logic

When a `409 Conflict` is returned:

1. Client fetches latest branch state
2. Client rebases local pending changes onto new HEAD
3. Client retries the operation with new version

---

## 9. Summary of Design Decisions

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Delete Strategy | Cascade | Simpler than soft delete + GC for this use case |
| ID Format | ULID | Chronological sortability, better index performance |
| Conflict Resolution | Skip + Notify, with Resurrect/Keep-Mine options | Unified "delete patch, propagate effect" model |
| Reorder Conflicts | Permutation composition | Mathematical correctness, handles all cases |
| Validation | At insertion, fail hard | Prevent corrupt data from entering system |
| Health Checks | None | Cascade delete prevents orphans; cycles impossible with append-only model |
| Admin Undo | HEAD crawl with branch drag | Can undo past single branch point by transferring patches to user; blocked if multiple branches |
| User Undo | HEAD crawl | Simple pointer movement with cascade cleanup |
| Status Model | `hasAhead` / `hasBehind` | Simple, covers all meaningful states |
