# Feature Specification: Shared Library & Local Collaboration

## 1. Overview

**Goal:** Transform Mokuro Library from a single-user silo into a **Hybrid Shared System**.
A designated "Admin" account hosts a central library visible to all users. Users can consume this content while maintaining their own private reading progress, bookmarks, and even their own private OCR edits, without affecting the "Official" version.

**Core Principles:**

* **Hybrid Visibility:** A user's library view is the union of `{My Private Uploads} ∪ {Admin's Public Uploads}`.
* **Decoupled State:** "Read Status" and "Bookmarks" are strictly private. One user marking a volume as "Read" does not affect others.
* **Non-Destructive Editing:** Users view the Admin's OCR text by default. If they make an edit, they seamlessly "fork" into a private branch. The original Admin text remains untouched.
* **Self-Cleaning History:** The branching model uses cascade deletes—"Resetting" a branch automatically removes the entire private history without complex garbage collection.

**Related Document:** For detailed OCR versioning, conflict resolution, and rebase algorithms, see the [version control doc](./ocr-version-control.md).

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

### 2.4 Branch Status Indicators

Users need clear feedback about their branch state:

| Status | Indicator | Meaning |
|--------|-----------|---------|
| Clean | ✓ Synced | User sees official version, no private edits |
| Has Ahead | ✏️ Modified | User has unpublished edits |
| Has Behind | ⚠️ Updates Available | Admin made changes since user's last sync |
| Both | ⚠️ Modified + Updates | User has edits AND admin moved forward |

**UI Actions by State:**

| State | Available Actions |
|-------|-------------------|
| Clean | (none needed) |
| Has Ahead only | "Reset to Official" |
| Has Behind only | "Update to Latest" (auto-applies, no conflicts possible) |
| Both | "Update to Latest" (triggers rebase, may have conflicts) |

### 2.5 User Permissions on Shared Content

Users have limited permissions on admin-owned (shared) content:

| Action | Allowed? | Notes |
|--------|----------|-------|
| View/Read | ✅ | Shared content appears in user's library |
| Track reading progress | ✅ | Per-user `UserSeriesSettings` / `UserProgress` |
| Edit OCR | ✅ | Creates private branch (copy-on-write) |
| Download/Export | ✅ | Can export shared content |
| Edit metadata | ❌ | Admin only (title, description, cover) |
| Scrape metadata | ❌ | Admin only |
| Delete series/volume | ❌ | Admin only |

**Implementation Note:** Export queries must include both user-owned and admin-owned content:
```
where: { id: { in: ids }, ownerId: { in: [userId, 'admin'] } }
```

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

Tracks the "Version" of text a user is looking at. See `ocr-version-control-v3.md` for full schema with optimistic locking and rebase support.

**Simplified view:**

```prisma
model OcrBranch {
  id          String   @id  // ULID

  volumeId    String
  userId      String   // The owner of this branch (User or Admin)

  // --- The Pointers ---
  headPatchId String   // Current state (always points to some patch)
  rootPatchId String?  // First private patch (NULL = clean/synced)

  // --- Snapshot Cache ---
  snapshotPatchId String?  // Patch ID of cached snapshot (NULL = no cache)
  // Snapshot file: cache/snapshots/{branchId}.json

  // --- Concurrency ---
  version     Int      @default(0)  // Optimistic locking

  // --- Metadata ---
  updatedAt   DateTime @updatedAt

  @@unique([volumeId, userId]) // 1 branch per user per volume
}
```

**Key concepts:**
- `rootPatchId = NULL` → Branch is "Clean" (synced with admin)
- `rootPatchId != NULL` → Branch is "Dirty" (has private edits)
- `snapshotPatchId` → Points to the patch ID the cached snapshot represents; `NULL` means no cache

### 3.3 Genesis Patch Convention

The genesis patch is a "dummy" patch that anchors the patch tree without duplicating file content.

- `parentId = NULL` → This is the genesis patch
- `operation = "{}"` → Empty/noop, means "state = read from `.mokuro` file"
- Created lazily on first volume access (see `ocr-version-control-v3.md` Section 2.4)

### 3.4 Submissions (`Submission`)

Tracks volume submissions from users to the shared library.

```prisma
model Submission {
  id              String   @id @default(cuid())
  
  userId          String
  status          String   @default("pending")  // 'pending' | 'accepted' | 'rejected'
  
  // Target: NULL = create new series, set = existing admin series
  targetSeriesId  String?
  
  // Source series (for cloning metadata when creating new series)
  sourceSeriesId  String?
  
  submittedAt     DateTime @default(now())
  reviewedAt      DateTime?
  reviewNote      String?
  
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  targetSeries    Series?  @relation("SubmissionTarget", fields: [targetSeriesId], references: [id], onDelete: SetNull)
  sourceSeries    Series?  @relation("SubmissionSource", fields: [sourceSeriesId], references: [id], onDelete: SetNull)
  
  // Volumes in this submission
  volumes         Volume[]
}

model Volume {
  // ... existing fields ...
  
  // Tracks last/current submission attempt
  submission   Submission? @relation(fields: [submissionId], references: [id], onDelete: SetNull)
  submissionId String?
}
```

**Submission types:**
- `targetSeriesId` set → Submit volumes to existing shared series
- `targetSeriesId` null → Create new shared series (metadata from `sourceSeriesId`)

**Submission lifecycle:**

| Action | `Submission.status` | `Volume.submissionId` |
|--------|---------------------|----------------------|
| User submits | `pending` | Set to submission ID |
| Admin accepts | `accepted` | Keep (historical link) |
| Admin rejects | `rejected` | Keep (until resubmit) |
| User resubmits | New `pending` | Overwrite with new ID |

**Benefits:**
- Referential integrity (no stale IDs)
- Query volumes by submission status
- Historical record for gamification/stats

### 3.5 Patches (`Patch`)

Uses a linked list of atomic operations with cascade delete. Admin branch is doubly-linked (has forward pointers), user branches are singly-linked.

```prisma
model Patch {
  id          String   @id  // ULID

  parentId    String?
  parent      Patch?   @relation("HistoryTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Patch[]  @relation("HistoryTree")

  // Forward pointer for admin branch only (enables user redo through admin history)
  nextPatchId String?  @unique

  volumeId    String
  userId      String   // Attribution
  createdAt   DateTime @default(now())
  operation   String   // JSON string (PatchOperation)

  @@index([volumeId])
  @@index([parentId])
}
```

**Cascade behavior:** Deleting a patch automatically deletes all its children. This enables simple "Reset" operations.

---

## 4. Key Workflows

### 4.1 "My Library" Query

How to fetch the library list for the logged-in user:

1. **Query:** `Series` where `ownerId = Me` **OR** `ownerId = Admin`.
2. **Join:** Include `UserSeriesSettings` where `userId = Me`.
3. **Merge Strategy:**
   * If settings exist, use that `status`/`bookmark`.
   * If not, default to `Unread` / `false`.
4. **Badge:** Mark Admin-owned series with "Official" badge.

### 4.2 First View (Branch Creation)

When a user first opens a volume:

1. **Check:** Does `OcrBranch` exist for this user + volume?
2. **If No:** Create branch with:
   - `headPatchId` = Admin's current HEAD
   - `rootPatchId` = NULL (clean)
   - `version` = 0
3. **Load:** Fetch OCR data from user's snapshot cache (or reconstruct from patches).

### 4.3 Editing (The Fork Logic)

**Scenario:** User A views a Volume owned by Admin.

1. **Check:** User A has an `OcrBranch` where `rootPatchId` is `NULL` (clean).
2. **Action:** User A fixes a typo.
3. **Backend:**
   * Validate patch operation (Zod schema)
   * Create New Patch `P_new` (Parent = `CurrentHead`)
   * Optimistic lock check: verify `version` matches
   * **Lock Root:** Since `rootPatchId` was NULL, set `rootPatchId = P_new.id`
   * **Advance:** Set `headPatchId = P_new.id`
   * Increment `version`
4. **Result:** Branch is now "Dirty" (`hasAhead = true`).

### 4.4 Undo/Redo (User Only)

Users can undo/redo by moving HEAD. See `ocr-version-control-v3.md` Section 5.2 for details.

- **Undo:** Move HEAD to parent, undone patch remains (dangling)
- **Redo:** Move HEAD to child (follows `rootPatchId` at branch point, `nextPatchId` on admin chain)
- **New edit after undo:** Deletes dangling patches, redo no longer possible

### 4.5 Reset to Official

User wants to discard all private edits.

1. **Action:** Click "Reset to Official".
2. **Identify Target:** Admin Branch Head (`H_admin`).
3. **Identify Waste:** User Branch Root (`R_user`).
4. **Update Pointers:** Set User Branch `head = H_admin`, `root = NULL`.
5. **Cleanup:** Delete Patch `R_user` → cascade deletes entire private history.
6. **Snapshot:** Update user's `.mokuro` cache file with Admin's state.

### 4.6 Update to Latest (Sync/Rebase)

User wants to incorporate Admin's latest changes.

**If user has no private edits (`hasAhead = false`):**
- Simply update `headPatchId` to Admin's HEAD
- Update snapshot cache

**If user has private edits (`hasAhead = true`):**
- Trigger full rebase workflow (see `ocr-version-control-v3.md` Section 5.4)
- May produce conflicts that need resolution

### 4.7 Admin Fast-Forward (Merge)

Admin wants to incorporate a User's fix.

1. **Scenario:** User fixed a typo. User's HEAD is ahead of Admin's HEAD.
2. **Action:** Admin views User's branch and clicks "Merge".
3. **Check:** Is User's root patch a direct child of Admin's HEAD?
   * **Yes:** Safe to fast-forward.
   * **No:** User needs to rebase first.
4. **Update:** Set Admin Branch `head = User's HEAD`.
5. **Result:** The "Private" patches are now "Official".

### 4.8 Admin Undo & Revert

**Undo:** Admin can crawl HEAD backwards like users. If undoing past a user's branch point:
- **Single user branch:** Admin can undo with "branch drag" — abandoned patches transfer to the user's branch
- **Multiple user branches:** Admin is blocked (use revert instead)

Branch drag enables admin to undo accidental merges or partially accept user changes.

**Revert:** When admin can't undo or wants to preserve history, they create an inverse patch instead.

See `ocr-version-control-v3.md` Section 5.3 for details.

### 4.9 Private Library Submission

Users can submit volumes from their private library to the admin's shared library. Submissions are volume-based, allowing flexible contribution to existing or new shared series.

**Private Library Structure:**
- Admin branch exists but stays frozen at genesis (never moves)
- User works on their own branch (standard user behavior with full undo/redo)
- The patch tree is identical to shared library structure

**Submission Flow:**

1. **User selects volumes** from their private library (via selection mode)
2. **Clicks "Submit"** in action bar
3. **Modal appears** with options:
   - **Submit to existing shared series:** Dropdown lists matching admin series
   - **Create new shared series:** Metadata cloned from source private series
4. **Submission created** with selected volume IDs
5. **Admin reviews** in `/api/admin/submissions`
6. **On accept:** Volumes **move** (not copy) to shared library
7. **On reject:** Volumes stay in user's private series

**Metadata Handling:**

| Target | Metadata Source |
|--------|-----------------|
| Existing shared series | Admin's series (unchanged) |
| New shared series | Cloned from user's private series (title, description, cover, etc.) |

**What Gets Moved on Accept:**
- Volume files (`filePath`)
- Volume `.mokuro` files (`mokuroPath`)
- OCR branches (same `volumeId`, just new parent series)
- Cover file (if creating new series)

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| User submits all volumes from a series | Private series becomes empty (user can delete) |
| User submits some volumes | Private series keeps remaining volumes |
| Admin rejects | Volumes stay in user's private series |
| Volume has OCR edits | Branch moves with volume (same volumeId) |
| Folder name conflict | Admin resolves or rejects |

**Conflict Check:**
- `Volume.folderName` must be unique within target series
- If creating new series: `Series.folderName` must not exist for admin

### 4.10 Contribution Page

A dedicated route (`/contributions`) for users who want to contribute OCR fixes. A badge in the sidebar/header provides visibility without being intrusive.

**Hybrid Approach:**
- **Badge/Indicator:** Shown in sidebar or header, displays count of volumes needing rebase
- **Click → Route:** Navigating to `/contributions` opens the full page

**Page Features:**
- List of volumes where user is behind admin (can rebase)
- List of volumes where user is ahead of admin (potential contributions)
- Filters: `behind` | `ahead` | `all`
- Series grouping with volume thumbnails
- One-click rebase actions
- Stats dashboard (edits made, edits merged, activity graph)

**User Stories:**
1. User sees badge "3" in sidebar (3 volumes need rebase)
2. User clicks badge → navigates to `/contributions`
3. User sees "Naruto Vol 34 — behind by 3 patches"
4. User clicks "Rebase", resolves any conflicts
5. Admin can now fast-forward merge the user's edits

**Statistics:**
- Total edits made by user
- Edits merged into official branch
- Volumes edited
- Contribution streak / activity graph

This encourages volunteer contributions while keeping the main reading experience uncluttered.

---

## 5. Implementation Requirements

### 5.1 Patch System

The patch system must support:

1. **Operations:** `replace`, `add`, `remove`, `reorder_lines`, `reorder_blocks`
2. **Validation:** Zod schema validation at insertion (fail hard on invalid)
3. **Inversion:** Every operation must be invertible for undo/revert
4. **Path Rules:** 
   - Structure changes (add/remove) use Unified Types
   - Content changes (replace) can be granular
   - Direct `lines_coords` modification is forbidden

See `ocr-version-control-v3.md` Sections 3-4 for full specification.

### 5.2 Conflict Handling

**Database Level:**
- `Series.folderName` + `Series.ownerId` uniqueness handles metadata collisions

**File System Level:**
- User uploads go to `./data/uploads/{userId}/{seriesName}`, preventing disk collisions

**Display Level:**
- Frontend must badge duplicate series titles (e.g., "Naruto [Official]" vs "Naruto [My Upload]")

**OCR Level:**
- See `ocr-version-control-v3.md` Section 5.5 for conflict resolution during rebase

### 5.3 Caching Strategy

To avoid reconstructing patch history on every load:

- Each user has a snapshot file: `/data/users/{userId}/snapshots/{volumeId}.mokuro`
- Snapshot stores: full state + `patchId` it was generated at
- Snapshot is updated on: Save, Rebase, Reset, Merge
- On load: Read snapshot, apply patches from `snapshot.patchId` to current HEAD

See `ocr-version-control-v3.md` Section 5.6 for details.

---

## 6. API Endpoints (Library-Specific)

### 6.1 Library Listing

**GET** `/api/library`

* **Query:** `{ status?: number, bookmarked?: boolean }`
* **Response:**
```json
{
  "series": [
    {
      "id": "...",
      "title": "Naruto",
      "ownerId": "admin",
      "isOfficial": true,
      "userSettings": {
        "status": 1,
        "bookmarked": true,
        "lastReadAt": "2025-01-15T10:00:00Z"
      },
      "volumes": [...]
    }
  ]
}
```

### 6.2 Update Reading Progress

**POST** `/api/library/series/:seriesId/progress`

* **Body:** `{ status?: number, bookmarked?: boolean, lastReadAt?: string }`
* **Response:** `{ success: true }`

### 6.3 Branch Status

**GET** `/api/library/volumes/:volumeId/status`

* **Response:**
```json
{
  "hasAhead": true,
  "hasBehind": false,
  "version": 5,
  "headPatchId": "01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

### 6.4 Submission (Private → Shared)

**POST** `/api/me/submissions`

* **Body (submit to existing series):**
```json
{
  "volumeIds": ["vol1", "vol2", "vol3"],
  "targetSeriesId": "admin-series-id"
}
```

* **Body (create new series):**
```json
{
  "volumeIds": ["vol1", "vol2", "vol3"],
  "targetSeriesId": null,
  "sourceSeriesId": "user-private-series-id"
}
```

* **Behavior:** 
  1. Create submission record with `pending` status
  2. Set `Volume.submissionId` on all selected volumes (overwrites previous if any)
* **Response:** `{ success: true, submissionId: string }`
* **Errors:**
  - `400`: No volumes selected, or volumes not owned by user
  - `404`: Target series not found (if specified)

**GET** `/api/admin/submissions` (Admin only)

* **Response:**
```json
{
  "submissions": [
    {
      "id": "...",
      "userId": "user123",
      "username": "john",
      "status": "pending",
      "targetSeriesId": "admin-naruto",
      "targetSeriesTitle": "Naruto",
      "sourceSeriesId": null,
      "volumes": [
        { "id": "vol1", "title": "Volume 1", "folderName": "vol1" }
      ],
      "submittedAt": "2025-01-15T10:00:00Z"
    }
  ]
}
```

**POST** `/api/admin/submissions/:submissionId/accept` (Admin only)

* **Body:** `{ }` (no options needed)
* **Behavior:**
  1. If `targetSeriesId` is set:
     - Check for volume folder name conflicts
     - Move volume files to target series folder
     - Update `Volume.seriesId` to target series
  2. If `targetSeriesId` is null (new series):
     - Check for series folder name conflict
     - Create new admin series with metadata from `sourceSeriesId`
     - Move cover file to admin folder
     - Move volume files to admin folder
     - Update `Volume.seriesId` to new series
  3. OCR branches remain attached (same `volumeId`)
  4. Update submission status to `accepted`, set `reviewedAt`
  5. Keep `Volume.submissionId` intact (historical record for stats)
* **Response:** `{ success: true, seriesId: string }`
* **Errors:**
  - `409`: Folder name conflict

**POST** `/api/admin/submissions/:submissionId/reject` (Admin only)

* **Body:** `{ reason?: string }`
* **Behavior:** 
  1. Update status to `rejected`, set `reviewedAt` and `reviewNote`
  2. Keep `Volume.submissionId` intact (user can see rejection reason)
* **Response:** `{ success: true }`

### 6.5 Contribution Page

**GET** `/api/me/contributions`

* **Query:** `{ page?: number, limit?: number, filter?: 'behind' | 'ahead' | 'all' }`
* **Behavior:** Returns paginated list of volumes where user has a branch, with status
* **Response:**
```json
{
  "data": [
    {
      "volumeId": "...",
      "volumeTitle": "Naruto Vol 34",
      "seriesTitle": "Naruto",
      "hasAhead": true,
      "hasBehind": true,
      "userPatchCount": 5,
      "behindByCount": 3
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

**GET** `/api/me/stats`

* **Response:**
```json
{
  "totalEdits": 150,
  "editsMerged": 45,
  "volumesEdited": 23,
  "lastEditAt": "2025-01-15T10:00:00Z"
}
```

For OCR-specific endpoints (patch, rebase, reset, revert, undo, redo), see `ocr-version-control-v3.md` Section 6.

### 6.7 API Structure Overview

```
/api/library/
  ├── /                              GET    - List library (series)
  ├── /series/:seriesId/progress     POST   - Update reading progress
  └── /volumes/:volumeId/
        ├── /                        GET    - Get volume state
        ├── /status                  GET    - Branch status
        ├── /history                 GET    - Patch history
        ├── /patch                   POST   - Apply patch
        ├── /undo                    POST   - Undo
        ├── /redo                    POST   - Redo
        ├── /rebase                  POST   - Start rebase
        ├── /rebase/continue         POST   - Continue rebase
        ├── /rebase/abort            POST   - Abort rebase
        ├── /reset                   POST   - Reset to official
        ├── /snapshot                POST   - Force snapshot
        ├── /merge                   POST   - Admin merge
        └── /revert                  POST   - Admin revert

/api/me/
  ├── /contributions                 GET    - Contribution page data
  ├── /stats                         GET    - User statistics
  └── /submissions                   POST   - Submit volumes

/api/admin/
  ├── /submissions                   GET    - List pending submissions
  ├── /submissions/:id/accept        POST   - Accept submission
  └── /submissions/:id/reject        POST   - Reject submission
```

---

## 7. Summary

| Concern | Solution |
|---------|----------|
| Library visibility | Union of private + admin uploads |
| Reading progress | Per-user `UserSeriesSettings` table |
| OCR editing | Copy-on-Write branching |
| Branch cleanup | Cascade delete on patch parent |
| Conflict resolution | Rebase with skip/resurrect/transform |
| Performance | Per-user snapshot caching |
| Admin mistakes | Undo (limited) or Revert (inverse patch) |
| Private → Shared | Submission queue with accept/reject |
| Contribution UX | Badge → `/contributions` route with stats |

For technical implementation details, refer to `ocr-version-control-v3.md`.
