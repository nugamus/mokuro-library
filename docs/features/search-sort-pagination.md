# Feature Spec: Library Search, Sort, Pagination & Filtering

## 1. Overview
**Goal:** To transform the library view from a simple list into a robust, scalable browsing interface capable of handling thousands of series efficiently.

**Philosophy:** "Server-Side Source of Truth." The database performs the heavy lifting (filtering, sorting, slicing), ensuring the frontend remains lightweight and responsive regardless of library size.

## 2. User Stories
* **As a user,** I want to search for "Naruto" and see results appear as I type, without manually clicking a search button.
* **As a user,** I want to sort my library by "Recently Read" so I can jump back into active series quickly.
* **As a user,** I want to sort by "Date Added" to see my newest uploads.
* **As a user,** I want to filter my view to only show "Bookmarked" series to access my favorites.
* **As a user,** I want to filter by status (e.g., "Unread" or "In Progress") to manage my reading backlog.
* **As a user,** I want to control how many items appear on screen (20, 50, 100) to match my screen size and bandwidth.
* **As a user,** I want the URL to reflect my current view (`?q=naruto&status=unread&page=2`) so I can bookmark or share specific search results.

## 3. Data Semantics & Definitions

To ensure performant SQL sorting without complex runtime logic, we explicitly define our data fields.

### 3.1. Naming Logic
* **`folderName` (Disk ID):** The immutable directory name on the filesystem. Used as the unique identifier for file operations.
* **`title` (Display Override):** A nullable string.
    * If `null`: The user has not set a custom title. UI displays `folderName`.
    * If set: The UI displays this string.
* **`sortTitle` (The Sorting Key):** A denormalized, required column.
    * **Logic:** Always equals `COALESCE(title, folderName)`.
    * **Purpose:** Allows standard SQL `ORDER BY sortTitle ASC` to work correctly, mixing custom titles and folder names alphabetically without performance penalties. Automatically updated whenever `title` changes.

### 3.2. Timestamp Logic
We use the **Prisma Driver Adapter (`@prisma/adapter-better-sqlite3`)**, which stores dates as ISO-8601 strings (`TEXT`) in SQLite.

* **`createdAt` (Date Added):**
    * **Default:** `'1970-01-01T00:00:00.000Z'` (Epoch). This ensures legacy/migrated data sits at the bottom of "Newest" lists.
    * **New Uploads:** Explicitly set to `new Date()` by the application.
* **`updatedAt` (Last Activity):**
    * **Trigger:** Updates on rename, cover change, or when a new Volume is uploaded to the series.
    * **Default:** Epoch (1970).
* **`lastReadAt` (Recently Read):**
    * **Location:** Denormalized onto the `Series` model (to avoid joining thousands of progress rows).
    * **Trigger:** Updated whenever a user reads a page in *any* volume belonging to the series.
    * **Default:** Epoch (1970). Unread books appear at the bottom.

### 3.3. Status & Organization Logic
To allow O(1) filtering on large libraries, we store status directly on the Series model rather than calculating it on every request.

* **`bookmarked`:**
    * **Type:** `Boolean`.
    * **Default:** `false`.
    * **Logic:** Manual toggle by the user.
* **`status`:**
    * **Type:** `Int` (Enum).
    * **Values:**
        * `0`: **Unread** (No progress on any volume).
        * `1`: **In Progress** (At least one page turned, or one volume read, but not all volumes completed).
        * `2`: **Read** (Every single volume in the series is marked Completed).
    * **Optimization:** This field is **managed by application triggers**.
        * When a volume is uploaded, deleted, or read, a helper function (`updateSeriesStatus`) recalculates this integer and updates the Series record.
        * This allows the `GET /library` endpoint to simply run `WHERE status = x` instead of performing complex joins and aggregations.

## 4. Technical Architecture

### 4.1. Database Schema (`schema.prisma`)

```prisma
model Series {
  // ... ID and Relations ...

  title       String?   // Mutable (Display)
  folderName  String    // Immutable (Disk)
  description String?   // Optional metadata
  
  // The effective title for sorting (Managed by App Logic)
  sortTitle   String    @default("")

  // --- Filtering Fields ---
  bookmarked  Boolean   @default(false)
  status      Int       @default(0) // 0=Unread, 1=InProgress, 2=Read

  // Timestamps (Stored as ISO Strings via Driver Adapter)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt @default(now())
  
  // Denormalized for performance
  lastReadAt  DateTime  @default(dbgenerated("'1970-01-01T00:00:00.000Z'"))

  // Indices for instant pagination & filtering
  @@index([sortTitle])
  @@index([createdAt])
  @@index([updatedAt])
  @@index([lastReadAt])
  @@index([status])      // Added for status filtering
  @@index([bookmarked])  // Added for bookmark filtering
}
```


### 4.2. API Specification (`GET /api/library`)

**Request:**
`GET /api/library?page=1&limit=20&q=naruto&sort=recent&order=desc&status=unread&bookmarked=true`

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| `page` | `int` | `1` | The current page number. |
| `limit` | `int` | `20` | Items per page. |
| `q` | `string` | `""` | Search query. Filters against `title` OR `folderName`. |
| `sort` | `enum` | `title` | `title` (A-Z via `sortTitle`), `created`, `updated`, `recent` (via `lastReadAt`). |
| `order` | `enum` | `asc` | `asc` or `desc`. |
| `status` | `enum` | `all` | `all`, `unread` (0), `in_progress` (1), `read` (2). |
| `bookmarked` | `boolean` | `false` | If `true`, restricts results to bookmarked items. |

**Response:**
Returns a standard paginated object.

```json
{
  "data": [ ...Series Objects... ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20,
    "totalPages": 8
  }
}
```

### 4.3. Frontend Logic (Svelte 5)

The frontend uses Svelte 5 Runes for fine-grained reactivity, abandoning the legacy `$app/stores`.

* **State Source:** The URL (`$page.url.searchParams`) via `$app/state`.
* **Reactivity:** An `$effect` monitors the URL state. Any change (typing in search, clicking next page, toggling a filter) triggers `fetchLibrary()`.
* **Debounce:** The search input updates the URL after a 300ms delay to prevent API spam. Filters update immediately.
* **Components:**
* `<LibraryToolbar />`: Handles Search input, Sort buttons, and Filter dropdowns.
* `<PaginationControls />`: Handles Page navigation and "Items per page" selection.


```

```
