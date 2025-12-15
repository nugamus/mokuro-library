# Feature Specification: OCR History & Version Control

## 1. Overview

This document specifies the architecture for a persistent, server-side Undo/Redo system for the Mokuro Reader. The system is architected for a single-user environment, prioritizing **Data Safety**, **Storage Efficiency**, and **Atomic Granularity**.

### Core Philosophy

  * **Backend Authority:** The Backend database is the source of truth for the "Live" state. The Frontend acts as a view/cache layer.
  * **Draft vs. Published:**
      * **Live Draft:** Edits are persisted immediately to the database (History Log) to ensure zero data loss on crash. The physical file is *not* touched.
      * **Published:** The `.mokuro` file on disk is updated only when the user explicitly clicks "Save". Readers always see the stable, published version.
  * **Space Efficiency (Compression):** History is stored in **Compressed Chunks** (GZIP) rather than individual rows, reducing storage overhead by .50x.
  * **Atomic Granularity:** Users operate on atomic steps (Undo 1 edit), even though storage is chunked.
  * **Compute-on-Demand:** Inverse patches are calculated at runtime during Undo operations.

## 2. Architecture

The system utilizes a **Snapshot + Archive** model with a "Virtual Head".

  * **The Snapshot ($V_{disk}$):** The `.mokuro` file on disk. Represents the last explicitly saved state.
  * **The Archive:** The `HistoryChunk` table. A compressed log of all operations.
  * **The Virtual Head ($V_{head}$):** The active state presented to the Editor. It is dynamically constructed by loading $V_{disk}$ and replaying all subsequent patches from the Archive.

### 2.1 Database Schema (Prisma)

We introduce a "History Chunk" model and a pointer in the Volume table.

```prisma
model Volume {
  id          String   @id @default(uuid())
  // ... existing fields ...

  // The "Live" Pointer.
  // Updates on every POST /patch.
  // If null, Head == Disk Version (Clean state).
  headPatchId String?

  history     HistoryChunk[]
}

model HistoryChunk {
  // Unique ID of this Chunk
  id          String   @id @default(uuid())

  volumeId    String
  volume      Volume   @relation(fields: [volumeId], references: [id], onDelete: Cascade)

  // Linked List of CHUNKS (Coarse Grain)
  previousChunkId String?

  // Metadata for efficient seeking
  // The UUID of the FIRST patch in this compressed blob
  startPatchId String
  // The UUID of the LAST patch in this compressed blob
  endPatchId   String

  // The Payload: GZIP Compressed JSON Array of PatchOperation[]
  // Type: Bytes (Blob)
  payload     Bytes

  createdAt   DateTime @default(now())

  // Indexes:
  // 1. [volumeId, endPatchId]: Fast lookup for "Which chunk contains my Target?"
  @@index([volumeId, endPatchId])
}
```

## 3. Data Structures

To ensure data integrity, we differentiate between **Fine** (Property) and **Coarse** (Structural) updates.

### 3.1 Value Types

```typescript
// --- 1. Fine Values (Leaf Properties) ---
// Used exclusively for REPLACE operations.
export type FineValue =
  | string                                // Text content, Titles
  | [[number,number], [number,number], [number,number], [number,number]] // Line Coords (Quad)
  | [number, number, number, number]      // Block Box (Rect)
  | boolean | number;                     // Primitives

// --- 2. Coarse Values (Structural Objects) ---
// Used exclusively for ADD and REMOVE operations.
// "Unified" objects merge split data structures (lines + coords) to guarantee atomic integrity.

export interface UnifiedLine {
  text: string;
  coords: [[number,number], [number,number], [number,number], [number,number]];
}

export interface UnifiedBlock {
  box: [number, number, number, number];
  vertical: boolean;
  font_size?: number;
  lines: UnifiedLine[];
}

export type PatchValue = FineValue | UnifiedBlock | UnifiedLine;
```

### 3.2 The Patch Operation

This object structure exists *inside* the compressed payload array.

```typescript
export interface PatchOperation {
  // UUID (Mandatory). Identifies this specific atomic step.
  id: string;

  op: 'replace' | 'add' | 'remove' | 'reorder_lines';
  path: string; // JSON Pointer

  value?: PatchValue;
  old_value?: PatchValue; // REQUIRED for Inversion
  new_order?: number[];   // Exclusive for reorder_lines
}
```

## 4. Path Specification (RFC 6901)

The `path` string is a JSON Pointer starting from the root of the `.mokuro` object.

### 4.1 Virtual vs. Physical Paths

Because the "Unified" data model differs from the raw storage on disk (where lines and coords are split), the Backend interprets specific paths "Virtually."

| Path Segment | Storage Reality | Behavior |
| :--- | :--- | :--- |
| `.../blocks/0` | `pages[i].blocks[0]` | **Physical.** Targets the raw Block object. |
| `.../lines/0` | **Split Arrays** | **Virtual.** Targets the *concept* of a line. Operations here affect **both** `lines[0]` and `lines_coords[0]` simultaneously. |
| `.../lines/0/text` | `block.lines[0]` | **Physical.** Targets only the string in the `lines` array. |

### 4.2 Valid Path Reference

**A. Block-Level**

  * `/pages/0/blocks/-`: **Op: `add`**. Append new block.
  * `/pages/0/blocks/1`: **Op: `remove`**. Delete Block 1.
  * `/pages/0/blocks/1/box`: **Op: `replace`**. Update bounding box.

**B. Line-Level (Unified)**

  * `/pages/0/blocks/1/lines/-`: **Op: `add`**. Append new line (Text + Coords).
  * `/pages/0/blocks/1/lines/0`: **Op: `remove`**. Delete Line 0 (Removes from both arrays).
  * `/pages/0/blocks/1/lines`: **Op: `reorder_lines`**. Permute lines.

**C. Property-Level (Optimization)**

  * `/pages/0/blocks/1/lines/0/text`: **Op: `replace`**. Fix typo (Text only).
  * `/pages/0/blocks/1/lines/0/coords`: **Op: `replace`**. Tweak geometry (Quad only).

## 5. API Specification

### 5.1 GET `/api/library/volume/:id/:version_id?` (The Full Load)

**Purpose:** Initial load or hard refresh. Returns the **Complete JSON State**.

  * **Parameters:**
      * `version_id` (Optional): Specific target. Defaults to `Volume.headPatchId`.
  * **Backend Logic:**
    1.  **Resolve Target:** Determine Target ID ($T$). If null/omitted, use $V_{disk}$.
    2.  **Load Base:** Read `.mokuro` file ($V_{disk}$).
    3.  **Fast-Forward:**
          * If $T == V_{disk}$: Return file.
          * Else: Fetch compressed chunks from DB where `start > V_disk` AND `end <= T`.
          * Decompress and apply patches sequentially to the in-memory object.
    4.  **Resolve Pointers:**
          * `prev`: The parent ID of patch $T$.
          * `next`: The ID of the patch immediately following $T$ in the chunk/DB.
    5.  **Return:**
        ```json
        {
          "version_id": "uuid-T",
          "prev_version_id": "uuid-prev",
          "next_version_id": "uuid-next",
          "data": { ... } // Full State
        }
        ```

### 5.2 POST `/api/library/volume/:id/patch` (Batch Saver)

**Purpose:** Persists edits to the database buffer. **No disk write.**

  * **Request Body:** `{ operations: [...], parent_id: "..." }`
  * **Backend Logic:**
    1.  **Branch Check:** If `parent_id` is not the latest in Buffer/DB, truncate future chunks (Branching logic).
    2.  **Buffer:** Assign UUIDs to operations. Append to `activeChunk` (In-Memory Buffer).
    3.  **Pointer Update:** `UPDATE Volume SET headPatchId = new_patch_id`.
    4.  **Flush Condition:** If `activeChunk.length >= 50` (or time limit), GZIP and INSERT.
    5.  **Return:** `{ success: true, new_version_id: "..." }`

### 5.3 POST `/api/library/volume/:id/undo` (Fast Path)

**Purpose:** Navigate backward 1 step.

  * **Request:** `{ current_version_id: "..." }`
  * **Backend Logic:**
    1.  **Identify Target:** The user is currently at `current_version_id` (Patch $P_{curr}$). The goal is to move to $P_{prev}$ (the parent of $P_{curr}$).
    2.  **Locate $P_{curr}$:** Find the patch in the active Buffer or DB Chunk.
    3.  **Compute Inverse:** Calculate `Invert(P_curr)`.
    4.  **Look Ahead/Behind (The Navigation Pointers):**
          * **New ID:** $P_{prev}$.ID (This becomes the current state).
          * **Prev ID:** The parent of $P_{prev}$ (Check if $P_{prev}$ has a parent or if we hit the disk snapshot).
          * **Next ID:** $P_{curr}$.ID (Since we just undid it, we can redo it).
    5.  **Return:**
        ```json
        {
          "success": true,
          "new_version_id": "uuid-prev",      // The state we just landed on
          "prev_version_id": "uuid-prev-prev",// Null if history exhausted (Gray out Undo)
          "next_version_id": "uuid-curr",     // Null if impossible (Enable Redo)
          "inverse_patch": { ... }
        }
        ```

### 5.4 POST `/api/library/volume/:id/redo` (Fast Path)

**Purpose:** Navigate forward 1 step.

  * **Request:** `{ current_version_id: "..." }`
  * **Backend Logic:**
    1.  **Identify Target:** Find the patch $P_{next}$ that immediately follows `current_version_id`.
    2.  **Look Ahead/Behind:**
          * **New ID:** $P_{next}$.ID.
          * **Prev ID:** `current_version_id`.
          * **Next ID:** The patch following $P_{next}$ (Null if $P_{next}$ is Head).
    3.  **Return:**
        ```json
        {
          "success": true,
          "new_version_id": "uuid-next",
          "prev_version_id": "uuid-current",  // Enable Undo
          "next_version_id": "uuid-future",   // Null if Head (Gray out Redo)
          "patch": { ... }
        }
        ```

### 5.5 Summary of UI State Logic

| Action | Response Field | UI Behavior |
| :--- | :--- | :--- |
| **Undo** | `prev_version_id` is `null` | **Disable** "Undo" button (Hit bottom of draft history). |
| **Undo** | `prev_version_id` is UUID | **Enable** "Undo" button. |
| **Redo** | `next_version_id` is `null` | **Disable** "Redo" button (Hit Head). |
| **Redo** | `next_version_id` is UUID | **Enable** "Redo" button. |

This addition makes the frontend logic significantly simpler (purely reactive to the API response) and prevents "off-by-one" errors where the user clicks Undo one too many times.

### 5.6 POST `/api/library/volume/:id/save` (Publish)

**Purpose:** Commit Draft to Disk.

  * **Request Body:** `{ head_version_id: string }`
  * **Backend Logic:**
    1.  Load `.mokuro` file ($V_{disk}$).
    2.  Query DB: Fetch all patches from $V_{disk}$ to `head_version_id`.
    3.  **Replay:** Apply patches to the JSON object.
    4.  **Write Disk:** Atomically write the new `.mokuro` file.
    5.  **Update Pointer:** `UPDATE Volume SET headPatchId = NULL` (Head aligned with Disk).
    6.  **Return:** `{ success: true }`.

## 6. Frontend Requirements (`OcrState`)

### 6.1 Routing Logic

To avoid the "Back Button Trap," the frontend uses `replaceState`.

  * **On Undo/Redo/Patch:**
      * Apply visual change locally.
      * Update URL: `history.replaceState(..., '/reader/vol1/new-uuid')`.
  * **On Refresh:**
      * Route `/reader/vol1/uuid` triggers `GET /api/volume/vol1/uuid`.

### 6.2 Commit Triggers

Patches are generated on meaningful transaction boundaries.

| Action | Trigger | Patch Type |
| :--- | :--- | :--- |
| **Editing Text** | `blur` or `Ctrl+Enter` | `replace` (Fine Value: string) |
| **Resizing Box** | `mouseup` (Drag End) | `replace` (Fine Value: box) |
| **Adding Line** | Immediate | `add` (UnifiedLine) |
| **Reordering** | Modal Save | `reorder_lines` |

**NOTE:** Splitting lines and merging lines will be decomposed to their sub actions for simplicity (Edit Line -> Insert/Delete)

## 7. Implementation Utilities

### 7.1 `ChunkManager`

Manages the Write Buffer and the complexity of splitting compressed chunks.

  * **`flush()`**: Persists buffer to DB.
  * **`truncate(patchId)`**: Handles branching by rewriting the tail chunk.

### 7.2 `PatchApplicator`

Bridges the "Unified" patch format and the "Native" storage format.

  * Handles the split insertion of `UnifiedLine` into `lines[]` and `lines_coords[]`.
  * Handles `reorder_lines` by permuting both arrays.
