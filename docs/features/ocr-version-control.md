# Feature Spec: OCR Version Control (History & Diffing)

## 1. Overview

**Goal:** Implement a robust undo/redo system for OCR edits that tracks changes over time without bloating storage.
**Philosophy:** "Current State First." The system always prioritizes the immediate availability of the latest version. History is stored as a sequence of "Reverse Patches" — instructions on how to revert the current file back to a previous state.

## 2. Technical Architecture

### 2.1. Diffing & Patching Engine

We use a modular stack to handle **RFC 6902 (JSON Patch)** operations. This decouples the diff logic from the domain schema and simplifies the "undo" logic.

  * **Diff Generation:** [`generate-json-patch`](https://www.npmjs.com/package/generate-json-patch)
      * Used to calculate the *Forward Patch* (Current State -. New State).
  * **Patch Inversion:** [`immutable-json-patch`](https://www.npmjs.com/package/immutable-json-patch)
      * Used to mathematically invert the forward patch into a *Reverse Patch* (New State -. Current State).

**Backend Logic:**

1.  **Load** `CurrentState` (from disk).
2.  **Receive** `NewState` (from client).
3.  **Calculate Forward:** `const forwardPatch = generate(CurrentState, NewState)`.
4.  **Calculate Reverse:** `const reversePatch = revertJSONPatch(CurrentState, forwardPatch)`.
5.  **Save:** Append `reversePatch` to history; overwrite `.mokuro` with `NewState`.

### 2.2. Storage Model (Tiered)

History is stored in the same directory as the `.mokuro` file to keep volumes portable.

**File 1: Hot History (`.mokuro.history`)**

  * **Format:** JSON Lines (`.jsonl`).
  * **Content:** Uncompressed, human-readable text.
  * **Purpose:** Fast access for recent "Undo" operations.
  * **Limit:** .1 MB (defined as `MAX_HOT_HISTORY_SIZE`).
  * **Structure per Line:**
    ```json
    {
      "id": "uuid-v4",
      "timestamp": "2023-10-27T10:00:00Z",
      "userId": "cuid_of_editor",
      "type": "TEXT" | "GEOMETRY" | "STRUCTURE" | "REVERT",
      "patch": [ ...RFC 6902 Operations... ]
    }
    ```

**File 2: Cold History (`.mokuro.history.gz`)**

  * **Format:** Gzipped JSON Lines.
  * **Content:** Compressed historical data.
  * **Purpose:** Archival storage to satisfy space quotas.
  * **Rotation Logic:** When "Hot History" exceeds 1MB, the oldest 50% of entries are moved here and compressed.

## 3. Data Flow & Batching Strategy

To prevent history pollution (e.g., one entry per keystroke), the system employs a two-layer batching strategy.

### 3.1. Frontend Transactions

Components report atomic changes via a Transaction API (`startTransaction` / `commitTransaction`) in `OcrState` to ensure the application state is synced with the DOM.

  * **Text Edit:** Transaction commits on `blur` (focus lost) or `Cmd+Enter`.
  * **Geometry:** Transaction commits on `mouseup` (drag end).

### 3.2. Backend Coalescing (Smart Merge)

The backend implements a logic to group sequential text edits into a single "Drafting Session."

**Logic:** When a new `PATCH` request arrives:

1.  **Peek** at the most recent entry in `.mokuro.history`.
2.  **Check Conditions:**
      * **Same User:** The editor is the same.
      * **Same Type:** Both the last entry and the new entry are `TEXT` operations.
      * **Recent:** The last entry was created less than **5 minutes** ago.
3.  **Action:**
      * **If Match:** **Merge** the new reverse patch into the existing history entry. This extends the previous undo step to cover the new changes.
      * **If No Match:** Create a new, distinct history entry.

**Result:** A user can type, pause, and type again for 4 minutes, and it will be recorded as one undo step. However, if they resize a box (Geometry) or split a line (Structure), that action forces a new commit, ensuring text edits are strictly batched *between* non-text operations.

## 4. API Specification

### 4.1. Save OCR (`PUT /api/library/volume/:id/ocr`)

  * **Payload Update:**
    ```json
    {
      "pages": [ ... ],
      "meta": { "operationType": "TEXT" | "GEOMETRY" | "STRUCTURE" }
    }
    ```
  * **Behavior:**
    1.  Reads existing file (`OldState`).
    2.  Generates `ForwardPatch` then `ReversePatch`.
    3.  Runs **Coalescing Logic** to decide whether to append a new line or update the last line in `.mokuro.history`.
    4.  Triggers **Rotation Algorithm** (Async) if file size . Limit.
    5.  Saves `NewState` to `.mokuro` file.

### 4.2. Get History (`GET /api/library/volume/:id/history`)

  * **Query Params:** `?include_archived=true` (optional).
  * **Returns:** A list of history metadata (excluding the heavy patch arrays unless requested).
  * **Response:** `[{ id, timestamp, user, type, summary: "Edited 2 blocks" }, ...]`

### 4.3. Revert State (`POST /api/library/volume/:id/history/revert`)

  * **Body:** `{ historyId: "uuid" }`
  * **Logic:**
    1.  Finds the target `historyId`.
    2.  Collects **ALL** reverse patches from "Now" back to "Target History ID".
    3.  Sequentially applies these patches to the current `.mokuro` file.
    4.  **Crucial:** This action *itself* creates a new history entry (type: `REVERT`), ensuring we never lose the ability to "Undo the Undo."

## 5. User Interface

  * **History Panel:** A new modal accessible via a "Clock" icon on the Reader Overlay.
  * **Timeline:** Displays a list of commits with human-readable timestamps (e.g., "Edited Text - 2 mins ago").
  * **Dirty Indicator:** The "Unsaved Changes" flag remains aggressive (triggering on every keystroke) to warn users against closing the tab, independent of the history commit status.

## 6. Implementation Plan

1.  **Backend Dependencies:** Install `generate-json-patch`, `immutable-json-patch`, and `uuid`.
2.  **Utils Module:** Create `src/utils/historyManager.ts` to encapsulate:
      * `appendHistory(volumePath, reversePatch, metadata)`
      * `rotateHistory(volumePath)`
      * `coalescePatch(lastEntry, newPatch)`
3.  **Controller Update:** Modify `library.ts` to generate diffs and call the history manager before saving.
4.  **Frontend State:** Update `OcrState.svelte.ts` to track transaction boundaries (`focus`/`blur`) and send `operationType` flags during save.
