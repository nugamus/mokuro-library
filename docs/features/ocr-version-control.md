# Feature Specification: OCR Version Control (v3.1)

## 1. Overview

This document specifies the **Shared Multi-User OCR System** for Mokuro Library, implementing a database-master hybrid model with per-user caching.

### Core Principles

* **Database as Master:** PostgreSQL/SQLite is the single source of truth for all history and state.
* **Per-User Snapshot Caching:** Each user maintains a private snapshot file for read performance.
* **Copy-on-Write Branching:** Users view Admin's "Official" branch by default; edits fork into a private branch.
* **Cascade Cleanup:** Deleting a branch root automatically removes all descendant patches.

---

## 2. Database Schema

### 2.1 OcrBranch

Tracks the current state of a volume for a specific user.

```prisma
model OcrBranch {
  id              String   @id @default(ulid())
  volumeId        String
  userId          String

  headPatchId     String              // Current HEAD (latest state)
  headPatch       Patch    @relation("BranchHead", fields: [headPatchId], references: [id])

  rootPatchId     String?             // First private patch (NULL = clean/synced)
  rootPatch       Patch?   @relation("BranchRoot", fields: [rootPatchId], references: [id])

  snapshotPatchId String?             // Patch ID of cached snapshot
  version         Int      @default(0) // Optimistic lock counter

  @@unique([volumeId, userId])
}
```

### 2.2 Patch

Doubly-linked list for admin, singly-linked for users. Cascade delete enables cleanup.

```prisma
model Patch {
  id          String   @id @default(ulid())
  parentId    String?
  parent      Patch?   @relation("HistoryTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Patch[]  @relation("HistoryTree")

  nextPatchId String?  @unique        // Forward pointer (admin only)
  nextPatch   Patch?   @relation("AdminChain", fields: [nextPatchId], references: [id])

  volumeId    String
  userId      String
  operation   String                  // JSON: PatchOperation
  createdAt   DateTime @default(now())
}
```

**Genesis Patch:** `parentId = NULL`, `operation = { op: 'genesis', path: mokuroPath }`

### 2.3 Snapshot Strategy

* **Location:** `cache/snapshots/{branchId}.json`
* **Validity:** `snapshotPatchId === headPatchId` means up-to-date
* **Sync:** Walk patches forward/backward from snapshot to HEAD
* **Regeneration:** On save, rebase, reset, or officialize

### 2.4 Lazy Genesis

Branches and genesis patches are created on-demand when a volume is first accessed.

---

## 3. Data Types

### 3.1 PatchOperation

```typescript
export type PatchOperation =
  | { op: 'genesis'; path: string }
  | { op: 'replace'; path: string; value: PatchValue; old_value: PatchValue }
  | { op: 'add'; path: string; value: PatchValue }
  | { op: 'remove'; path: string; old_value: PatchValue }
  | { op: 'reorder'; path: string; new_order: number[] };
```

### 3.2 Value Types

```typescript
export type Quad = [[number, number], [number, number], [number, number], [number, number]];
export type Rect = [number, number, number, number];

export interface UnifiedLine { text: string; coords: Quad; }
export interface UnifiedBlock { box: Rect; vertical: boolean; font_size?: number; lines: UnifiedLine[]; }

export type PatchValue = string | boolean | number | Rect | Quad | UnifiedBlock | UnifiedLine;
```

---

## 4. Workflows

### 4.1 Editing (Fork-on-Write)

1. User edits trigger patch creation
2. If `rootPatchId === null` (clean), set `rootPatchId = newPatch.id` (fork)
3. Update `headPatchId = newPatch.id`

### 4.2 User Undo/Redo

* **Undo:** Move HEAD to parent; patch remains (dangling) for redo
* **Redo:** Move HEAD to child (if exactly one exists)
* **New edit after undo:** Cascade-deletes dangling patches

### 4.3 Admin Undo

* **No dependents:** Delete abandoned patches
* **One dependent:** "Branch drag" — transfer patches to user's branch
* **Multiple dependents:** Blocked (use revert instead)

### 4.4 Rebase

Synchronizes user branch with updated admin branch.

**Process:**
1. Fetch admin chain (new patches since fork) and user chain
2. For each admin patch, compute effect and check user patches for conflicts
3. Auto-resolve or pause for user input
4. Write transformed patches, atomic swap pointers

**Conflict Resolution:** See Appendix B for detailed conflict tables.

### 4.5 Reset

Discards user's private edits:
1. Delete `rootPatchId` (cascades to all private patches)
2. Set `headPatchId = adminBranch.headPatchId`, `rootPatchId = null`
3. Copy admin snapshot to user

### 4.6 Officialize (Admin Fast-Forward)

Admin incorporates user's patches:
1. Verify user branch is direct descendant of admin HEAD
2. Update admin `headPatchId` to user's HEAD
3. Set `nextPatchId` on merged patches (doubly-link admin chain)
4. Reset user branch to clean state

### 4.7 Patch Compression

Reduces redundant patches by leveraging the rebase transform machinery. Useful after officialize to compact admin history.

**Key Insight:** In compression (unlike rebase), patches are from the same timeline — paths are already correct relative to each other. Only `replace` patches can be compressed; structural patches (`add`, `remove`, `reorder`) pass through unchanged but transform effect paths as they propagate.

**Algorithm:**

```
input:  [P1, P2, P3, ..., Pn]
compressed_structural = []
compressed_content = []

for i = 0 to n-1:
  if patches[i].op !== 'replace':
    compressed_structural.push(patches[i])
    continue

  effect = fromOperation(patches[i])

  // Flip old/new so keep_mine engraves the original old_value into hits
  originalOld = effect.oldValue
  originalNew = effect.newValue
  effect.oldValue = originalNew
  effect.newValue = originalOld

  for j = i+1 to n-1:
    result = transform(patches[j], effect, patches[i], 'keep_mine')
    patches[j] = result.op
    effect = result.effect

  if effect != identity:
    cPatch = toOperation(effect)
    cPatch.old_value = originalOld
    cPatch.value = originalNew
    compressed_content.push(cPatch)

return [...compressed_structural, ...compressed_content]
```

**Behavior:**

- Only `replace` patches become effect sources
- Structural patches pass through to `compressed_structural` verbatim
- Structural patches transform effect paths as effects propagate through them
- Content conflicts resolve with `keep_mine` (absorb into later patch)
- Surviving effects rematerialize into `compressed_content`
- Final output: structural patches first, then compressed content patches

**Runtime:** O(n²) — single forward pass, guaranteed termination.

**Examples:**

Sequential edits to same field:
```
P1: replace /blocks/0/text "a" → "b"
P2: replace /blocks/0/text "b" → "c"
P3: replace /blocks/0/text "c" → "d"
```
Compresses to:
```
P': replace /blocks/0/text "a" → "d"
```

Mixed structural and content:
```
P1: replace /blocks/1/text "a" → "b"
P2: remove /blocks/0
P3: replace /blocks/0/text "b" → "c"  (same block, shifted)
```
Compresses to:
```
structural: [P2: remove /blocks/0]
content:    [P': replace /blocks/0/text "a" → "c"]
```
(P1's effect path shifted by P2, then absorbed by P3)

Independent edits (no compression):
```
P1: replace /blocks/0/text "a" → "b"
P2: replace /blocks/1/text "x" → "y"
```
Compresses to:
```
P1: replace /blocks/0/text "a" → "b"
P2: replace /blocks/1/text "x" → "y"
```
(unchanged — no conflicts to absorb)

---

## 5. API Specification

### 5.1 API Tree

```
/api/library/volume/:id
├── /patch                            POST    - Apply edit patch
├── /undo                             POST    - Undo last patch
├── /redo                             POST    - Redo undone patch
├── /reset                            POST    - Reset to admin state (user only)
├── /officialize                      POST    - Fast-forward admin to user (admin only)
├── /rebase
│   ├── /start                        POST    - Start rebase session
│   ├── /continue                     POST    - Continue with resolution
│   └── /abort                        POST    - Abort rebase session
├── /status                           GET     - Get sync status
├── /history                          GET     - Get patch history
└── /snapshot                         POST    - Force snapshot rebuild
```

### 5.2 Patching & Editing

**POST** `/api/library/volume/:id/patch`

* **Body:** `{ operation: PatchOperation, branchVersion: number }`
* **Response:** `{ success, newHeadId, newVersion, patch }`
* **Errors:** `400` (validation), `404` (not found), `409` (version mismatch)

**POST** `/api/library/volume/:id/undo`

* **Body:** `{ branchVersion: number }`
* **Response:** `{ success, newHeadId, newVersion, patch }` (patch is inverse)
* **Errors:** `400` (at genesis), `404`, `409`

**POST** `/api/library/volume/:id/redo`

* **Body:** `{ branchVersion: number }`
* **Response:** `{ success, newHeadId, newVersion, patch }`
* **Errors:** `400` (nothing to redo), `404`, `405` (admin), `409`

### 5.3 Synchronization

**POST** `/api/library/volume/:id/rebase/start`

* **Body:** `{ }` (empty)
* **Response:** `{ status: 'complete', newHeadId }` or `{ status: 'paused', rebaseId, conflict }`

**POST** `/api/library/volume/:id/rebase/continue`

* **Body:** `{ rebaseId, resolution: 'keep_admin' | 'keep_mine' }`
* **Response:** Same as start

**POST** `/api/library/volume/:id/rebase/abort`

* **Body:** `{ rebaseId }`
* **Response:** `{ status: 'aborted' }`

**POST** `/api/library/volume/:id/reset`

* **Body:** `{ }`
* **Response:** `{ success: true }`
* **Errors:** `404`, `405` (admin cannot reset)

### 5.4 Officialize

**POST** `/api/library/volume/:id/officialize`

* **Body:** `{ sourceBranchUserId: string }`
* **Response:** `{ success, newHeadId }`
* **Errors:** `400` (cannot fast-forward), `403` (non-admin), `404`

### 5.5 Status & History

**GET** `/api/library/volume/:id/status`

* **Response:** `{ hasAhead, hasBehind, version, headPatchId }`

**GET** `/api/library/volume/:id/history`

* **Query:** `limit`, `offset`
* **Response:** `{ patches: [...], total }`

### 5.6 Strategy Pattern

| Endpoint | User | Admin |
|----------|------|-------|
| `patch` | Fork-on-write | Direct edit |
| `undo` | HEAD crawl | Branch drag or blocked |
| `redo` | Follow child | Not available (405) |
| `reset` | Discard edits | Not applicable (405) |
| `rebase` | Sync with admin | Not applicable (405) |
| `officialize` | Not applicable (403) | Fast-forward |

---

## 6. Security & Migration

### 6.1 Security Considerations

* **Ownership checks:** Users can only modify their own branches
* **Admin-only:** Officialize requires admin authentication
* **Optimistic locking:** Prevents concurrent edit conflicts

### 6.2 Migration

Existing `.mokuro` files work without migration. Genesis patches are created lazily on first access.

---

## Appendix A: Path Specification

### A.1 Block Operations

| Operation | Path | Value Type |
|-----------|------|------------|
| Add Block | `/pages/{p}/blocks/{b}` | `UnifiedBlock` |
| Remove Block | `/pages/{p}/blocks/{b}` | N/A (`old_value` required) |
| Reorder Blocks | `/pages/{p}/blocks` | N/A (`new_order` required) |
| Resize Box | `/pages/{p}/blocks/{b}/box` | `Rect` |
| Set Vertical | `/pages/{p}/blocks/{b}/vertical` | `boolean` |
| Set Font Size | `/pages/{p}/blocks/{b}/font_size` | `number` |

### A.2 Line Operations

| Operation | Path | Value Type |
|-----------|------|------------|
| Add Line | `/pages/{p}/blocks/{b}/lines/{l}` | `UnifiedLine` |
| Remove Line | `/pages/{p}/blocks/{b}/lines/{l}` | N/A (`old_value` required) |
| Reorder Lines | `/pages/{p}/blocks/{b}/lines` | N/A (`new_order` required) |
| Edit Text | `/pages/{p}/blocks/{b}/lines/{l}/text` | `string` |
| Edit Coords | `/pages/{p}/blocks/{b}/lines/{l}/coords` | `Quad` |

**Note:** To append, use `{b}` or `{l}` equal to `array.length`. Direct modification of `lines_coords` array is forbidden. Use `/lines/{l}/coords` path.

---

## Appendix B: Conflict Resolution

### B.1 Intersection Types

| Type | Meaning | What transforms |
|------|---------|-----------------|
| `no_hit` | No overlap | Passthrough |
| `direct_hit` | Exact path match | Conflict resolution |
| `ancestor_hit` | User path inside affected path | Conflict resolution |
| `descendant_hit` | Affected path inside user path | Conflict resolution |
| `collateral_ancestor_hit` | Structural effect, patch inside affected array | Patch path |
| `collateral_descendant_hit` | Any effect, structural patch in array containing effect | Effect path |
| `sibling_hit` | Both structural, same array level | Both interact |

### B.2 Conflict Types

| Conflict | Resolution | Description |
|----------|------------|-------------|
| `shift_down_into_add` | Auto | User adding at deleted index |
| `effect_shift` | Auto | User add/reorder shifts effect path |
| `double_delete` | Auto | Both deleted same item |
| `dead_zone` | User choice | Admin deleted, user edited inside |
| `reverse_dead_zone` | User choice | Admin edited inside, user deleted |
| `reorder_collision` | User choice | Both reordered same array |
| `content_conflict` | User choice | Both edited same field |

### B.3 Auto-Transform Tables (No Conflict)

**collateral_ancestor_hit** (structural effect, patch inside array):

| effect.type | userOp.op | Handling |
|-------------|-----------|----------|
| `shift_up` | any | Patch path: index >= effect.index gets +1 |
| `shift_down` | any | Patch path: index > effect.index gets -1 |
| `permute` | any | Patch path: map index through permutation |

**collateral_descendant_hit** (any effect, structural patch):

| effect.type | userOp.op | Handling |
|-------------|-----------|----------|
| any | `add` | Effect path: index >= add.index gets +1 |
| any | `remove` | Effect path: index > remove.index gets -1 |
| any | `reorder` | Effect path: map index through permutation |

**sibling_hit** (both structural, same level):

| effect.type | userOp.op | Handling |
|-------------|-----------|----------|
| `shift_up` | `add` | Shift add index, adjust effect index |
| `shift_up` | `remove` | Shift remove index, adjust effect index |
| `shift_up` | `reorder` | Expand reorder permutation, map effect index |
| `shift_down` | `add` | Shift add index, adjust effect index |
| `shift_down` | `remove` | Shift remove index, adjust effect index |
| `shift_down` | `reorder` | Map effect index, shrink reorder permutation |
| `permute` | `add` | Expand permutation, map add index |
| `permute` | `remove` | Map remove index, shrink permutation |

### B.4 Conflict Tables

**direct_hit:**

| effect.type | userOp.op | Conflict | Resolution |
|-------------|-----------|----------|------------|
| `shift_down` | `add` | `shift_down_into_add` | Auto: keep patch, bump effect index |
| `shift_down` | `remove` | `double_delete` | Auto: discard patch, effect → identity |
| `permute` | `reorder` | `reorder_collision` | User: `keep_admin` discards, `keep_mine` transforms |
| `content` | `replace` | `content_conflict` | User: `keep_admin` discards, `keep_mine` updates old_value |

**ancestor_hit:**

| effect.type | userOp.op | Conflict | Resolution |
|-------------|-----------|----------|------------|
| `shift_down` | any | `dead_zone` | User: `keep_admin` discards, `keep_mine` resurrects |

**descendant_hit:**

| effect.type | userOp.op | Conflict | Resolution |
|-------------|-----------|----------|------------|
| any | `add` | `effect_shift` | Auto: shift effect path |
| any | `reorder` | `effect_shift` | Auto: permute effect path |
| any | `remove` | `reverse_dead_zone` | User: `keep_admin` discards + creates shift_up, `keep_mine` keeps + updates old_value |

### B.5 Permutation Math

For reorder conflicts:
- `A` = Admin's permutation, `U` = User's permutation
- **Keep Mine:** Transform to `U' = A⁻¹ * U` where `(P * Q)[i] = Q[P[i]]`
- **Keep Admin:** Skip user's reorder, propagate `A⁻¹ * U` to subsequent patches
