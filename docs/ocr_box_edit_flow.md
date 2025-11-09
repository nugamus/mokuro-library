# OCR Box Editing Flow Documentation

This document outlines the detailed technical flow for implementing drag, resize, and context menu functionality within the Mokuro OCR editor, along with the necessary DOM and state manipulation techniques required for stability in a reactive Svelte environment.

1.  **User Enters Mode:**
    * The user clicks the **Box Edit Mode** toggle in the header, setting `isBoxEditMode = true` and `isEditMode = false` (modes are mutually exclusive).

2.  **Viewport Locks:**
    * An `$effect` in `volume/[id]/+page.svelte` detects the state change.
    * It calls `panzoomInstance.reset()` and `panzoomInstance.setOptions({ disablePan: true, disableZoom: true })` to establish a fixed coordinate system.

---

## Explanation of Flow for dragging boxes


4.  **User Drags Box (Interaction Logic)**
    * When `isBoxEditMode` is `true`, two distinct drag interactions are possible:

    4.1.  **Dragging the Entire Block (Outer Container):**
    * The `onmousedown` event on the outer `div.group/block` initiates the drag (`handleBlockDragStart`).
    * **Visual Drag:** CSS `transform: translate()` is used for smooth, jank-free visual movement.
    * **Data Update (`onDragEnd`):**
        1.  The CSS `transform` is reset.
        2.  The **total accumulated image delta** is applied **once** to all four coordinates in the **`block.box`** array.
        3.  The same delta is applied to all eight coordinates in the **`block.lines_coords`** array for every associated line (since line coordinates are absolute, they must be moved with the block).
        4.  `onOcrChange()` is called.

    4.2.  **Dragging an Individual Line (Inner Div):**
    * The `onmousedown` event on the inner line `div.group/line` initiates the drag (`handleLineDragStart`).
    * It calls `event.stopPropagation()` to prevent the outer block drag (3.1).
    * **Visual Drag:** CSS `transform` is used on the line's element.
    * **Data Update (`onDragEnd`):**
        1.  The CSS `transform` is reset.
        2.  The **total accumulated image delta** is applied **once** only to the eight coordinates in `block.lines_coords[i]` for that specific line.
        3.  `onOcrChange()` is called.

---

## Explanation of Flow for resizing boxes

1.  **UI Elements (Resize Handles):**
    * **Outer Block:** 8 blue handles are children of `div.group/block`. Visibility is toggled via `group-hover/block:opacity-100` OR when interacting with the focused block's slider (`isSliderInteracting` or `isSliderHovered`).
    * **Inner Line:** 8 yellow handles are children of `div.group/line`. Visibility is toggled via `group-hover/line:opacity-100`.
    * **Accessibility:** All handles have `role="button"`.

2.  **Outer Block Resize Logic (`handleResizeStart`):**
    * Triggered by `onmousedown` on the blue handles.
    * The logic directly modifies the coordinates in the **`block.box`** array based on the handle type (e.g., `top-left` modifies `x_min` and `y_min`).
    * The inner `lines_coords` are **not** modified, as they maintain their independent absolute coordinates.

3.  **Inner Line Resize Logic (`handleLineResizeStart`):**
    * Triggered by `onmousedown` on the yellow handles.
    * The logic directly modifies the 4 sets of `[x, y]` pairs (8 total coordinates) in the **`block.lines_coords[i]`** array based on the handle type.
    * The outer `block.box` remains unmodified.

4.  **Completion:** Both resizing actions update state in real-time (no transform needed) and call `onOcrChange()` on `mouseup` to trigger persistence mechanisms.

---

## Explanation of Flow for Creating, Deleting, and Text Editing

1.  **Context Menu Activation:**
    * **Flow: Create Block (Right-click on Empty Overlay)**
        * An `oncontextmenu` handler is attached to the `overlayRootElement` (the top-level `div` in `OcrOverlay.svelte`).
        * It only fires if `isBoxEditMode` is `true`.
        * It must check `e.target === e.currentTarget` to ensure the click was on the empty background, not an existing block.
        * It calls `contextMenu.open` with an "Add Block" option.
        * The `createNewBlock` action will:
            1.  Calculate the `[x, y]` click position in absolute image coordinates.
            2.  Create a new `MokuroBlock` object.
            3.  Define a default `block.box` (e.g., 100x100) centered at the click.
            4.  Define a default first line (`lines: ['New Text']`) and `lines_coords` (e.g., 80x20) positioned inside the new `block.box`.
            5.  Push this new `MokuroBlock` object to the `page.blocks` array (which is a reference to `mokuroData.pages[i].blocks`).
            6.  Call `onOcrChange()` and `handleSave()` to persist this structural change.
    * **Flow: Create Line (Right-click on Block)**
        * The `oncontextmenu` handler on the *outer block* (`div.group/block`) fires only if `isBoxEditMode` is `true`.
        * It calls `openBlockContextMenu(event, block)`.
        * This function shows the menu with one option: `[{ label: "Add Line", action: ... }]`.
        * The `createNewLine` action adds a new line/line_coords entry to the *cloned* block, replaces the block in the parent array, and calls `onOcrChange()` and `handleSave()`.
    * **Flow: Line Context Menu (Right-click on Line)**
        * The `oncontextmenu` handler on the *inner line* (`div.group/line`) calls `openLineContextMenu(event, block, lineIndex)`.
        * It builds an `options` array based on the current mode:
            * If `isEditMode` is true: Shows text options (Cut, Copy, Paste, Toggle Vertical, Set Font Size).
            * If `isBoxEditMode` or `isEditMode` is true: Shows the "Delete Line" option.
        * It calls `contextMenu.open(event.clientX, event.clientY, options)`.

2.  **DOM Stability (Double-Wrap):**
    * The text content is contained in a nested inner `div` (`contenteditable="true"`), separate from the outer `div` that handles drag/resize events. This isolates the structural bindings from the browser's rich-text engine.

3.  **Font Size Slider (Toolbar):**
    * The font slider is visible in the header only when `isEditMode` is true and a line is focused (`focusedBlock !== null`).
    * **Focus Fix:** The slider container uses `onpointerdown`/`onpointerup` to set `isSliderInteracting`. The line element's `onblur` handler checks `!isSliderInteracting` before calling the de-focus callback (`onLineFocus(null)`), preventing the slider interaction from unintentionally blurring the text field.

4.  **Action Functions (`OcrOverlay.svelte`):**
    * **`deleteLine(block, lineIndex)`:**
        * **CRITICAL:** This function now checks `if (block.lines.length === 1)`.
        * If `true` (it's the last line), it calls a new `deleteBlock(block)` function.
        * If `false`, it proceeds with the existing logic: clone the block, `splice` the line/line_coords from the *cloned* block, replace the block, and save.
    * **`deleteBlock(block)`:**
        * Finds the index of the `block` in the `page.blocks` array.
        * Calls `page.blocks.splice(index, 1)` to remove the entire block.
        * Calls `onOcrChange()` and `handleSave()` to persist this structural change.

---

## Explanation of Flow for Re-ordering Lines (Modal)

This flow allows a user to change the sequential order of lines within a block via a dedicated modal.

* **Rationale:** Text selection and copying rely on the `block.lines` array order. When a user creates a new line to insert "missing" text, it is appended to the end of the array, which is semantically incorrect. This modal provides a robust UI to correct the line order.
* **Modes:** This functionality can be triggered from either **Text Edit Mode** (`isEditMode`) or **Box Edit Mode** (`isBoxEditMode`).

1.  **Component Interaction:**
    * A new Svelte component, `LineOrderModal.svelte`, will be created.
    * This component will be managed by a new global store, `lineOrderStore`, similar to `confirmationStore`, or passed as a prop from `volume/[id]/+page.svelte`.
    * The store will hold `{ isOpen: boolean, block: MokuroBlock | null, onSave: () => void }`.

2.  **Context Menu Activation:**
    * The user right-clicks on an **inner line** (`div.group/line`).
    * This triggers `openLineContextMenu(event, block, lineIndex)`.
    * A new `MenuOption` will be added to the `options` array: `{ label: "Re-order Lines...", action: () => openLineOrderModal(block) }`.
    * This option should *not* be disabled, as it opens the modal for the entire block.

3.  **Modal Flow:**
    * The `openLineOrderModal(block)` function sets the `lineOrderStore`'s state:
        * `isOpen = true`
        * `block = block`
        * `onSave = onOcrChange` (passing the callback from `OcrOverlay.svelte`).
    * The `LineOrderModal.svelte` component renders. It contains an `#each` loop over the `$lineOrderStore.block.lines` array.
    * Each list item displays the `line` text and two arrow buttons ("Up" and "Down").

4.  **Action Functions (Inside Modal):**
    * An array swap utility `swap(arr, i, j)` will be used.
    * **`handleMoveUp(lineIndex)`:**
        1.  If `lineIndex === 0`, it returns.
        2.  It calls `swap($lineOrderStore.block.lines, lineIndex, lineIndex - 1)`.
        3.  It calls `swap($lineOrderStore.block.lines_coords, lineIndex, lineIndex - 1)`.
        4.  Svelte's reactivity updates the modal's list in place.
    * **`handleMoveDown(lineIndex)`:**
        1.  If `lineIndex === $lineOrderStore.block.lines.length - 1`, it returns.
        2.  It calls `swap($lineOrderStore.block.lines, lineIndex, lineIndex + 1)`.
        3.  It calls `swap($lineOrderStore.block.lines_coords, lineIndex, lineIndex + 1)`.
        4.  Svelte's reactivity updates the modal's list in place.
    * **`handleSave()` / `handleClose()`:**
        1.  The modal closes (`$lineOrderStore.isOpen = false`).
        2.  The `onSave` callback (which is `onOcrChange`) is triggered.
        3.  This marks the `volume/[id]/+page.svelte`/+page.svelte] as having unsaved changes, prompting the "Save" button to appear.

5.  **UI Update:**
    * The modal's internal list re-renders instantly on swap.
    * When the modal is closed, the changes are already applied to the `block` object. The `onOcrChange()` call ensures the main `OcrOverlay.svelte` (if it re-renders) and the save mechanism are aware of the new state.
