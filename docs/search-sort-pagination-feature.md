# Feature Spec: Library Search, Sort, & Pagination

## 1. Overview
**Goal:** To transform the library view from a simple list into a robust, scalable browsing interface capable of handling thousands of series efficiently.
**Core Philosophy:** "Server-Side Source of Truth." The database performs the heavy lifting (filtering, sorting, slicing), ensuring the frontend remains lightweight and responsive regardless of library size.

## 2. User Stories
* **As a user,** I want to search for "Naruto" and see results appear as I type, without manually clicking a search button.
* **As a user,** I want to sort my library by "Recently Read" so I can jump back into active series quickly.
* **As a user,** I want to sort by "Date Added" to see my newest uploads.
* **As a user,** I want to sort by "Recently Updated" to see series that have new volumes added.
* **As a user,** I want to control how many items appear on screen (20, 50, 100) to match my screen size and bandwidth.
* **As a user,** I want the URL to reflect my current view (`?q=naruto&page=2`) so I can bookmark or share specific search results.

## 3. Data Semantics & Definitions

To ensure consistent sorting, we strictly define the meaning of our timestamp and naming fields.

### 3.1. Series Logic
* **`title` (Display Title):** The user-configurable name.
    * *Sorting Behavior:* Used for **"A-Z"** sorts. If `null`, the `folderName` is used as the fallback.
* **`folderName` (Disk ID):** The immutable directory name.
    * *Sorting Behavior:* Fallback for A-Z sorts.
* **`createdAt` (Date Added):** The timestamp when the Series was **first created**.
    * *Sorting Behavior:* Used for **"Date Added"** (Oldest/Newest) sort. This value is immutable.
* **`updatedAt` (Last Activity):** The timestamp when the Series was last modified.
    * *Trigger Logic:* Updates on rename, cover change, **AND** when a new Volume is uploaded to this series.
    * *Sorting Behavior:* Used for **"Recently Updated"** sort (e.g., bubbling a series to the top when a new chapter is added).

### 3.2. User Progress Logic
* **`lastReadAt` (Recently Read):** A timestamp on `UserProgress` updated every time a user opens a volume or turns a page.
    * *Sorting Behavior:* Used for **"Recently Read"** sort. This effectively orders series by "When did I last touch any volume in this series?".

## 4. Technical Architecture

### 4.1. Database Schema (`schema.prisma`)
We add the necessary timestamps and indices to support the definitions above.

```prisma
model Series {
  // ... existing fields
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Indices for performance
  @@index([title])
  @@index([updatedAt])
  @@index([createdAt])
}

model UserProgress {
  // ... existing fields
  
  // Tracks when the user last interacted with this volume.
  lastReadAt  DateTime @default(now()) @updatedAt
  
  @@index([userId, lastReadAt]) // Critical for "Recently Read" sort
}
```

### 4.2. API Specification (`GET /api/library`)
The library endpoint will be refactored to accept query parameters.

**Request:**
`GET /api/library?page=1&limit=20&q=searchterm&sort=recent&order=desc`

| Param | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | `int` | `1` | The current page number. |
| `limit` | `int` | `20` | Items per page (Page Size). |
| `q` | `string` | `""` | Search query (matches `title` or `folderName`). |
| `sort` | `enum` | `title` | `title` (A-Z), `created` (Date Added), `updated` (Recently Updated), `recent` (Last Read). |
| `order` | `enum` | `asc` | `asc` (Ascending) or `desc` (Descending). |

**Response:**
We switch from returning a raw Array `[]` to a paginated Object `{}`.

```json
{
  "data": [ ...series objects... ],
  "meta": {
    "total": 150,       // Total items matching query
    "page": 1,          // Current page
    "limit": 20,        // Current limit
    "totalPages": 8     // ceil(total / limit)
  }
}
```

### 4.3. Frontend Logic
To make "Live Search" feel responsive while using a backend API, we implement **Debounced URL Synchronization**.

1.  **State Source:** The URL (`$page.url.searchParams`) is the single source of truth.
2.  **Action:** When the user types in the search bar:
    * Wait 300ms (Debounce).
    * Update URL to `?q=newterm&page=1` (using `replaceState` to avoid cluttering history).
3.  **Reaction:** A Svelte `$effect` detects the URL change -> calls `fetchLibraryData()` -> updates the UI.

## 5. Implementation Plan

1.  **Database:** Apply migration for `createdAt`, `updatedAt`, and `lastReadAt`.
2.  **Backend:**
    * Update `POST /upload` to "touch" `Series.updatedAt` when adding a volume.
    * Refactor `GET /api/library` to handle pagination/sort/search.
3.  **Frontend Service:** Update `api.ts` to handle the new `{ data, meta }` response.
4.  **Frontend UI:**
    * Build `<PaginationControls />` (Next/Prev, Page Size dropdown).
    * Build `<LibraryToolbar />` (Search input, Sort dropdown).
    * Update the main grid to render from `response.data`.
