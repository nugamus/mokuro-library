# Technical Documentation: Volume Reader Architecture

## 1. Overview
The Volume Reader is a complex interactive page that supports three distinct layout modes (Single, Double, Vertical), deep zooming capabilities, and live OCR editing. To manage this complexity, the architecture is decoupled into:
* **State:** A reactive class (`ReaderState`) acting as the "Brain."
* **Actions:** Reusable behaviors (Panzoom) extracted into Svelte Actions.
* **Views:** Dumb components responsible only for rendering specific layouts.
* **Controller:** The top-level page orchestrating data fetching and component switching.

## 2. File Structure & Responsibilities

### 2.1. State Management
**File:** `src/lib/states/ReaderState.svelte.ts`

This class encapsulates all layout logic for the reader. It is the single source of truth.

* **State (`$state`):**
    * `pageIndex`: Current 0-based index of the primary visible page.
    * `layoutMode`: `'single' | 'double' | 'vertical'`.
    * `readingDirection`: `'ltr' | 'rtl'`.
    * `doublePageOffset`: `'even' | 'odd'`.
    * `mokuroData`: The full volume metadata (pages array, dimensions).
* **Derived Logic (`$derived`):**
    * `visiblePages`: Returns the array of `MokuroPage` objects to render (e.g., returns `[p2, p1]` for RTL double mode).
    * `hasNext` / `hasPrev`: Boolean flags for UI button states.
* **Methods:**
    * `nextPage()` / `prevPage()`: Logic to advance index by 1 or 2 depending on layout.
    * `setPage(index)`: Jumps to specific page (used by slider/vertical scroll).
    * `toggleLayout(mode)`: Switches modes and handles index realignment.

### 2.2. Actions
**File:** `src/lib/actions/panzoom.ts`

Wraps the imperative `@panzoom/panzoom` library into a declarative Svelte Action.

* **Export:** `export function panzoom(node: HTMLElement, options: PanzoomOptions)`
* **Responsibilities:**
    * Initializes `Panzoom(node, ...)` on mount.
    * **Event Handling:** Centralizes the complex `wheel` event logic (Ctrl+Wheel to zoom).
    * **Cleanup:** Automatically calls `pz.destroy()` on unmount.

### 2.3. View Components
These components receive the `ReaderState` instance as a prop. They do *not* manage navigation state themselves.

**A. Single Page Reader**
**File:** `src/lib/components/readers/SinglePageReader.svelte`
* **Layout:** Simple container holding one `<CachedImage>` and `<OcrOverlay>`.
* **Behavior:** Applies `use:panzoom` to the image container.

**B. Double Page Reader**
**File:** `src/lib/components/readers/DoublePageReader.svelte`
* **Layout:** Flex container holding two pages.
* **Logic:** Uses CSS `flex-direction: row-reverse` to handle RTL reading, keeping the DOM order logical.
* **Behavior:** Applies `use:panzoom` to the parent container.

**C. Vertical (Webtoon) Reader**
**File:** `src/lib/components/readers/VerticalReader.svelte`
* **Critical DOM Structure:** This component MUST maintain the following nesting to support the "Native Scroll + CSS Zoom" hybrid behavior:
```html
    <div class="scroller overflow-y-auto h-full w-full">
        <div class="wrapper w-full">
            <div class="content mx-auto max-w-4xl" use:panzoom={{ ... }}>
                  {#each pages...}
            </div>
        </div>
    </div>
```
* **Zoom Logic:**
    * Intercepts `Ctrl + Wheel`.
    * Calculates new scale using `pz.getScale()`.
    * Updates `Layer 2 (Wrapper)` height: `originalHeight * newScale`.
    * Adjusts `Layer 1 (Scroller)` scrollTop to keep the view centered relative to the mouse.
* **Virtualization:**
    * Implements `IntersectionObserver` logic (Render/Destroy/Progress) on Layer 1.

### 2.4. Utility Logic
**File:** `src/lib/utils/ocrMath.ts`

Pure functions extracted from `OcrOverlay.svelte`.
* `smartResizeFont(block, element)`
* `getRelativeCoords(event, element)`
* `ligaturize(text)`

### 2.5. The Controller (The Orchestrator)
**File:** `src/routes/volume/[id]/+page.svelte`

This file acts as the glue code.

* **Responsibility:**
    1.  **Initialize:** `const reader = new ReaderState()`.
    2.  **Fetch:** Calls API and runs `reader.load(data)`.
    3.  **Persist:** Uses `$effect` to watch `reader.pageIndex` -> `saveProgress()`.
    4.  **Render:** Switches between View Components based on `reader.layoutMode`.
    5.  **Inputs:** Global keyboard shortcuts call `reader.nextPage()`.

## 3. Visual Component Hierarchy

```text
+page.svelte (Controller)
├── ReaderSettings (UI Overlay)
├── ReaderState (Logic Class)
│
└── [Switch: reader.layoutMode]
    ├── SinglePageReader.svelte
    │   └── div (use:panzoom)
    │       ├── CachedImage
    │       └── OcrOverlay
    │
    ├── DoublePageReader.svelte
    │   └── div (use:panzoom)
    │       ├── div (Page Left)
    │       └── div (Page Right)
    │
    └── VerticalReader.svelte
        └── div.scroller (overflow-y: scroll)
            └── div.wrapper (Height Adjuster)
                └── div.content (use:panzoom, disableYAxis)
                    ├── IntersectionObserver (Virtualization)
                    └── Each Page...
```
