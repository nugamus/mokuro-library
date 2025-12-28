# Feature Specification: Shared Library & Local Collaboration

## 1. Overview

**Goal:** Transform Mokuro Library from a single-user silo into a **Hybrid Shared System**.
A designated "Admin" account hosts a central library visible to all users. Users can consume this content while maintaining their own private reading progress, bookmarks, and even their own private OCR edits, without affecting the "Official" version.

**Core Principles:**

* **Hybrid Visibility:** A user's library view is the union of `{My Private Uploads} ∪ {Admin's Public Uploads}`.
* **Decoupled State:** "Read Status" and "Bookmarks" are strictly private. One user marking a volume as "Read" does not affect others.
* **Non-Destructive Editing:** Users view the Admin's OCR text by default. If they make an edit, they seamlessly "fork" into a private branch. The original Admin text remains untouched.
* **Self-Cleaning History:** The branching model is designed such that "Resetting" a branch automatically cascade-deletes purely private history, preventing database bloat without complex garbage collection scripts.

---

## 2. User Experience (UX)

### 2.1 The "Admin" Library

* **Concept:** Content uploaded by the system administrator (e.g., `id: "admin"`).
* **Visibility:** Automatically appears in every user's library.
* **Distinction:** Admin content gets a visual badge (e.g., "Official" or "Shared") to distinguish it from the user's private uploads.
* **Collisions:** If a user also has a private upload with the same name (e.g., "Naruto"), **both** appear in the library view (one private, one shared).

### 2.2 Reading & Progress

* **Private Tracking:** All progress (Page 10/200), status (Reading/Completed), and bookmarks are stored per-user in the `UserSeriesSettings` table.
* **Behavior:** Even if 5 users read the same Admin volume, their progress is completely isolated.

### 2.3 OCR Editing (The "Copy-on-Write" Model)

* **Default View:** Users see the Admin's "Official" OCR text.
* **Editing:** When a normal user edits text (fixes a typo, resizes a box):
1. The system creates a private "Copy" of the OCR history for them.
2. Their edit is applied to *their* copy.
3. They now see "My Version" of the text.
4. The Admin's version remains unchanged for everyone else.


* **Resetting:** Users can click **"Reset to Official"** to discard their private edits and revert to the live Admin version.

---

## 3. Database Architecture

### 3.1 Metadata Decoupling (`UserSeriesSettings`)

Removes user-specific fields from the shared `Series` table.

```prisma
model UserSeriesSettings {
  userId    String
  seriesId  String

  // Private State
  bookmarked Boolean  @default(false)
  status     Int      @default(0) // 0=Unread, 1=Reading, 2=Completed
  
  // Sorting: "Recently Read" is now per-user
  lastReadAt DateTime @default(dbgenerated("'1970-01-01...'"))

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  series    Series   @relation(fields: [seriesId], references: [id], onDelete: Cascade)

  @@id([userId, seriesId])
  @@index([userId, status])      // Efficient "My Reading List" queries
}

```

### 3.2 OCR Branching (`OcrBranch`)

Tracks the "Version" of text a user is looking at.

* **Logic:** A Branch is defined by its `head` (current state) and its `root` (divergence point).
* **Optimization:** `rootPatchId` points to the **First Private Patch** (the first child of the shared history). If `rootPatchId` is NULL, the branch is "Clean" (synced with upstream).

```prisma
model OcrBranch {
  id          String   @id @default(uuid())

  volumeId    String
  userId      String   // The owner of this branch (User or Admin)

  // --- The Pointers ---
  // Where is this branch right now? (Latest Edit)
  headPatchId String?
  
  // The First Patch that belongs ONLY to this branch.
  // If NULL, the branch is "Clean" (Synced with upstream).
  // If SET, the branch is "Dirty" (Diverged).
  rootPatchId String?  

  // Metadata
  name        String   @default("main")
  updatedAt   DateTime @updatedAt
  
  // Musubi Integration (Future Proofing)
  upstreamSource String @default("local") // "local", "musubi:verified"

  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  headPatch   Patch?   @relation("BranchHead", fields: [headPatchId], references: [id])
  rootPatch   Patch?   @relation("BranchRoot", fields: [rootPatchId], references: [id])

  @@unique([volumeId, userId]) // Limit: 1 active branch per user for MVP
}

```

### 3.3 Self-Cleaning Patches (`Patch`)

Uses a linked list of atomic operations.
**Crucial:** `onDelete: Cascade` on the `parent` relation ensures that deleting a `root` patch wipes the entire private timeline.

```prisma
model Patch {
  id          String   @id @default(uuid())

  // The Tree (Linked List)
  parentId    String?
  // CRITICAL: Cascade delete allows efficient "Reset" logic
  parent      Patch?   @relation("HistoryTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Patch[]  @relation("HistoryTree")

  // Context
  volumeId    String
  userId      String   // Attribution
  createdAt   DateTime @default(now())

  // The Payload (Strict JSON Patch / Unified Ops)
  operation   String   // JSON string

  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)
  
  // Reverse lookups
  asHeadOf    OcrBranch[] @relation("BranchHead")
  asRootOf    OcrBranch[] @relation("BranchRoot")

  @@index([volumeId])
}

```

---

## 4. Key Workflows

### 4.1 "My Library" Query

How to fetch the library list for the logged-in user:

1. **Query:** `Series` where `ownerId = Me` **OR** `ownerId = Admin`.
2. **Join:** Include `UserSeriesSettings` where `userId = Me`.
3. **Merge Strategy:**
* If settings exist, use that `status`/`bookmark`.
* If not, default to `Unread` / `false`.



### 4.2 Editing (The Fork Logic)

Ensures users start fresh but diverge instantly.

**Scenario:** User A views a Volume owned by Admin.

1. **Check:** User A has an `OcrBranch` (created on first view) where `rootPatchId` is `NULL`.
2. **Action:** User A fixes a typo.
3. **Backend:**
* Create New Patch `P_new` (Parent = `CurrentHead`).
* **Lock Root:** Since `rootPatchId` was NULL, set `rootPatchId = P_new.id`.
* **Advance:** Set `headPatchId = P_new.id`.


4. **Result:** Branch is now "Dirty".

### 4.3 Reset to Official (Self-Cleaning)

User A wants to revert their changes.

1. **Action:** Click "Reset to Official".
2. **Identify Target:** Admin Branch Head (`H_admin`).
3. **Identify Waste:** User Branch Root (`R_user`).
4. **Update Pointers:** Set User Branch `head = H_admin`, `root = NULL`.
5. **Cleanup:** **Delete Patch `R_user**`.
* *Effect:* Because `R_user` is deleted, **all** its children (the entire private history) are cascade-deleted by the database engine. Zero orphans left behind.



### 4.4 Admin Fast-Forward (Merge)

Admin wants to incorporate a User's fix.

1. **Scenario:** User fixed a typo (`AdminHead -> UserFix`).
2. **Action:** Admin views User's branch and clicks "Merge/Fast-Forward".
3. **Check:** Does `UserFix.parentId === AdminHead`?
* **Yes:** Safe to FF.


4. **Update:** Set Admin Branch `head = UserFix.id`.
5. **Result:** The "Private" patch is now the "Official" patch.

---

## 5. Implementation Requirements

### 5.1 Patch System Enhancements

To support this architecture and future federation, the existing patch system must be updated.

1. **Missing Operation:** `reorder_blocks` must be implemented in `PatchApplicator` and `PatchInverter`.
* *Current Status:* Missing (detected in code review).
* *Requirement:* Implement `reorderSingle` helper to permute the `blocks` array.


2. **Path Strictness:** Maintain the "Unified Block" approach (updating `box` and `lines` atomically) but ensure internal logic treats them as distinct operations where possible to ease future Musubi integration.
3. **Guard Rails:** `PatchApplicator` must explicitly forbid direct modification of `lines_coords` to enforce the Unified Block model integrity.

### 5.2 Conflict Handling

* **Database:** `Series.folderName` + `Series.ownerId` uniqueness handles metadata collisions.
* **Files:** User uploads go to `./data/uploads/{userId}/{seriesName}`, preventing disk collisions.
* **Display:** Frontend must group or badge duplicate series titles (e.g., "Naruto [Official]" vs "Naruto [My Upload]").
