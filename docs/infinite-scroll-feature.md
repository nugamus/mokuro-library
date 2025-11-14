# Feature Flow: Infinite Scrolling (Webtoon Mode)

This document outlines the technical flow and caveats for implementing an "infinite scrolling" or "vertical" layout mode, similar to what is used for webtoons. This feature is listed as a "Nice-to-Have" in the project specification.

## 1. Overview & Goal

The goal is to add a new layout mode that stacks all pages of a volume into a single, vertical, scrollable container. This is an alternative to the current paginated layouts (`single` and `double`).

This mode is mutually exclusive with the `double` page layout and its associated settings (`doublePageOffset`, `readingDirection`).

## 2. State & UI Changes

### `frontend/src/lib/authStore.ts`

* The `ReaderSettingsData` type in `authStore.ts` must be updated.
* The `layoutMode` will be extended to support a new value:
    * `layoutMode: 'single' | 'double' | 'vertical';`

### `frontend/src/lib/components/ReaderSettings.svelte`

* Change the current page mode toggle button to a 3-segmented layout.
* Add a new `layoutMode = 'vertical'`.
* **Crucially**, when `layoutMode !== 'Double'`, the toggles for "Reading Direction" and "Dual-Page Offset" must be **hidden or disabled**, as they are incompatible.

### `frontend/src/routes/volume/[id]/+page.svelte`

* The `layoutMode` state will now support `'vertical'`.
* `toggleDoubleLayout` will be refactored to `setLayout(mode: 'Single' | 'Double' | 'Vertical')`

## 3. Core Implementation Flow: Virtualized Scrolling

A naive implementation that renders all pages in a `for` loop will fail. Rendering 100+ `<OcrOverlay>` components, each with its own panzoom instance and potentially hundreds of DOM nodes, will be a critical performance bottleneck.

The only viable solution is **virtualized scrolling**.

### 3.1. New Component: `VirtualPage.svelte`

A new component will be created to manage the loading/unloading of a single page.

* **Props:** `page: MokuroPage`, `volumeId: string`, `panzoomInstance: PanzoomObject | null`, and all the OCR-related props (`isEditMode`, `isBoxEditMode`, etc.).
* **Internal State:** `let isInView = $state(false);`
* **Logic:**
    1.  The component's root will be a `div` that acts as a placeholder, respecting the page's `aspect-ratio` to prevent layout shift.
    2.  It will use an **Intersection Observer** on this root `div`.
    3.  When the observer fires (`on:intersect`), it will set `isInView = true`.
    4.  When the element leaves the viewport, it will set `isInView = false`.
    5.  The actual page content (`<img>` and `<OcrOverlay>`) will be wrapped in an `{#if isInView}` block.
* **Cleanup:** It is *critical* that the `OcrOverlay` and any associated panzoom logic are fully destroyed (`onDestroy`) when `isInView` becomes `false` to free up memory.

### 3.2. Updating `+page.svelte` Layout

* The main `<div>` wrapper in `+page.svelte` will be modified.
* When `layoutMode === 'vertical'`, it will render a single, tall `div` with `overflow-y: scroll`.
* Inside this `div`, it will loop over the *entire* `mokuroData.pages` array, not the `currentPages` derived state.

```svelte
{#if layoutMode === 'vertical'}
  <main 
    class="flex-1 overflow-y-auto" 
    bind:this={mainElement}
    on:scroll={handleVerticalScroll}
  >
    <div class="relative mx-auto w-full max-w-4xl">
      {#each mokuroData.pages as page (page.img_path)}
        <VirtualPage
          {page}
          volumeId={params.id}
          {panzoomInstance}
          {isEditMode}
          {isBoxEditMode}
          {isSmartResizeMode}
          {showTriggerOutline}
          {isSliderHovered}
          {onOcrChange}
          {onLineFocus}
        />
      {/each}
    </div>
  </main>
{:else}
  {/if}
```

## 4. Flow: Progress Tracking & Navigation

The concept of a single `currentPageIndex` becomes obsolete for navigation but remains essential for progress tracking.

### 4.1. Tracking Current Page

  * We must add a *second* **Intersection Observer** to the main scroll container (`mainElement`).
  * This observer will monitor all `VirtualPage` components.
  * As the user scrolls, the observer's callback will fire with a list of visible pages.
  * Find the page with the largest `intersectionRatio` (or the one closest to the top of the viewport) and set `currentPageIndex` to *that page's index*.
  * The `handleVerticalScroll` function will be debounced to avoid excessive state updates.

### 4.2. Saving Progress

  * The `saveProgress` will work as-is. It will simply save the `currentPageIndex` that is being updated by the Intersection Observer.

### 4.3. Loading Progress

  * When the volume first loads, if `layoutMode === 'vertical'` and we have a saved `initialPage > 0`, we cannot just set the state.
  * We must use an `$effect` that waits for the `VirtualPage` components to render and then calls `element.scrollIntoView()` on the correct page's placeholder `div` to "jump" to the saved position.

### 4.4. UI Navigation

  * The on-screen navigation buttons (`prevPage`, `nextPage`)must be **hidden** when `layoutMode === 'vertical'`.
  * Keyboard navigation (`ArrowLeft`, `ArrowRight`) must also be **disabled**.

## 5. Caveats & Technical Conflicts

1.  **Panzoom vs. Scrolling:** Zooming in this mode will only be possible via pinch-to-zoom (on mobile) or a modifier key (e.g., Ctrl + Wheel).

2.  **Performance:** Care is needed about cleanup in `VirtualPage.svelte`. Every `OcrOverlay` that scrolls out of view *must* be fully destroyed to prevent memory leaks.

3.  **State Focus:** Logic for `focusedBlock` and `isSliderHovered` needs to be robust. If a user focuses a line and then scrolls it out of view, the `onblur` event must fire correctly to clear the focus state. The Intersection Observer's "exit" event on `VirtualPage` could be used to force-blur any focused elements within it.

4.  **Layout Shift:** The `VirtualPage` placeholders *must* have their `aspect-ratio` set correctly from `page.img_width` and `page.img_height` to prevent the scrollbar from "jumping" as pages load in and out.

5.  **Image Caching & Pre-loading:** The current implementation (and especially a new virtualized scroller) will frequently load and unload images, potentially spamming the server with file requests and causing re-loading flashes.
    * **Solution:** A client-side cache should be implemented using the **`Cache` API**. This is a stretch feature that would benefit all layout modes, not just vertical.
    * **Flow:** When a page component is about to load its image:
        1.  It should first check a dedicated cache (e.g., `caches.open('mokuro-images')`) for the image URL.
        2.  **If cached:** Retrieve the `Response` object, get its `blob()`, and set the `<img>` src to `URL.createObjectURL(blob)`. This provides an instant, memory-based load.
        3.  **If not cached:** `fetch` the image from the API. As the response is received, `put` a clone of it into the cache for next time, then set the `<img>` src.
    * **Pre-loading (Enhancement):** The system can be made even faster. When a user lands on a page, the app could proactively and silently fetch and cache the images for the *next few pages* (e.g., `currentPageIndex + 1`, `+ 2`), ensuring they are already in the cache when the user navigates to them.
