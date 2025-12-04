# Mokuro OCR Editor: Box and Text Editing Flows

This document outlines the detailed technical flow for implementing drag, resize, text editing, and context menu functionality within the Mokuro OCR editor, including the "Smart Resize Mode" feature.

## 1. Overview: Editor Modes & State

Three primary boolean states control the editor's behavior.

* **`isEditMode`**: (Default: `false`) Allows text editing within lines.
    * Toggled by the "Text Edit Mode" button.
    * Mutually exclusive with `isBoxEditMode`.
* **`isBoxEditMode`**: (Default: `false`) Allows dragging and resizing of blocks and lines.
    * Toggled by the "Box Edit Mode" button.
    * Mutually exclusive with `isEditMode`.
* **`isSmartResizeMode`**: (Default: `false`) A new mode that automatically adjusts font size to fit text within its bounding box when text or box dimensions are changed.
    * Toggled by the "Smart Resize" button.
    * This mode can be active at the same time as `isEditMode` or `isBoxEditMode`.

---

## 2. Core Logic for Smart Resize Mode

This function is the core of the "Smart Resize" feature and is called by other flows when `isSmartResizeMode` is `true`.

### 2.1. `smartResizeFont` Function Definition

* **Function Signature**: `smartResizeFont(block: MokuroBlock, lineIndex: number, lineElement: HTMLElement)`
* **Action**:
    1.  It receives the Svelte state for the `block` and the actual `lineElement` from the DOM.
    2.  It reads the line's bounding box coordinates from `block.lines_coords[lineIndex]`.
    3.  **Primary Axis Calculation**:
        * If the block is **horizontal** (`!block.vertical`):
            * It gets the target width: `targetWidth = coords[1][0] - coords[0][0]`.
            * It runs a calculation (e.g., binary search) to find the largest `fontSize` (in pixels) that results in `lineElement.scrollWidth <= targetWidth`.
        * If the block is **vertical** (`block.vertical`):
            * It gets the target height: `targetHeight = coords[3][1] - coords[0][1]`.
            * It runs a calculation to find the largest `fontSize` (in pixels) that results in `lineElement.scrollHeight <= targetHeight`.
    4.  **State Update**: It updates the Svelte state: `block.font_size = newFontSize;`
    5.  **Persistence**: It calls **`onOcrChange()`** to mark the data as dirty.

### 2.2. Important Note on Block vs. Line Sizing

The `.mokuro` file format defines `font_size` as a **per-block** property, which is shared by all lines within that block.

This Smart Resize feature is triggered by operations on a **single line** (e.g., resizing or editing that specific line).

Therefore, the new font size will be calculated based *only* on the text and dimensions of that line of interest. This new `font_size` will then be applied to the entire block, affecting all other lines within it, regardless of their content or size.

### 2.3. Trigger: Double-Click (Default Mode)

This flow allows the user to manually trigger the `smartResizeFont` function on a specific line, provided no other editing mode is active.

1.  The user activates `isSmartResizeMode`.
2.  Both `isEditMode` and `isBoxEditMode` must be `false`.
3.  The user double-clicks an inner line element (`div.group/line`).
4.  An `ondblclick` event handler attached to the line element fires.
5.  Inside this handler, a check confirms the state: `if (isSmartResizeMode && !isEditMode && !isBoxEditMode)`.
6.  If `true`, the handler retrieves the `lineElement` (e.g., `event.currentTarget`).
7.  It calls `smartResizeFont(block, lineIndex, lineElement)`.

---

## 3. Flow: Dragging Boxes (Box Edit Mode)

When `isBoxEditMode` is `true`, two distinct drag interactions are possible.

### 3.1. Dragging the Entire Block (Outer Container)
* The `onmousedown` event on the outer `div.group/block` initiates the drag (`handleBlockDragStart`).
* **Visual Drag:** CSS `transform: translate()` is used for smooth, jank-free visual movement.
* **Data Update (`onDragEnd`):**
    1.  The CSS `transform` is reset.
    2.  The **total accumulated image delta** is applied **once** to all four coordinates in the **`block.box`** array.
    3.  The same delta is applied to all eight coordinates in the **`block.lines_coords`** array for every associated line (since line coordinates are absolute, they must be moved with the block).
    4.  `onOcrChange()` is called.

### 3.2. Dragging an Individual Line (Inner Div)
* The `onmousedown` event on the inner line `div.group/line` initiates the drag (`handleLineDragStart`).
* It calls `event.stopPropagation()` to prevent the outer block drag.
* **Visual Drag:** CSS `transform` is used on the line's element.
* **Data Update (`onDragEnd`):**
    1.  The CSS `transform` is reset.
    2.  The **total accumulated image delta** is applied **once** only to the eight coordinates in `block.lines_coords[i]` for that specific line.
    3.  `onOcrChange()` is called.

---

## 4. Flow: Resizing Boxes (Box Edit Mode)

This flow details the standard resize logic and its integration with Smart Resize Mode.

### 4.1. UI Elements (Resize Handles)
* **Outer Block:** 8 blue handles are children of `div.group/block`. Visibility is toggled via `group-hover/block:opacity-100` OR when interacting with the focused block's slider (`isSliderInteracting` or `isSliderHovered`).
* **Inner Line:** 8 yellow handles are children of `div.group/line`. Visibility is toggled via `group-hover/line:opacity-100`.
* **Accessibility:** All handles have `role="button"`.

### 4.2. Outer Block Resize Logic (`handleResizeStart`)
* Triggered by `onmousedown` on the blue handles.
* The logic directly modifies the coordinates in the **`block.box`** array based on the handle type (e.g., `top-left` modifies `x_min` and `y_min`).
* The inner `lines_coords` are **not** modified, as they maintain their independent absolute coordinates.
* On `mouseup`, `onOcrChange()` is called.

### 4.3. Inner Line Resize Logic (`handleLineResizeStart`)
* Triggered by `onmousedown` on the yellow handles.
* The logic directly modifies the 4 sets of `[x, y]` pairs (8 total coordinates) in the **`block.lines_coords[i]`** array based on the handle type.
* The outer `block.box` remains unmodified.
* On `mouseup`, `onOcrChange()` is called. (This is also the trigger for the integration below).

### 4.4. Integration: Resizing with `isSmartResizeMode`
This flow is triggered when a user resizes a line *while* `isSmartResizeMode` is active.

1.  The user enters `isBoxEditMode` and activates `isSmartResizeMode`.
2.  The user drags a resize handle on an **inner line** (triggering `handleLineResizeStart`).
3.  The user releases the mouse (`onmouseup`).
4.  On `mouseup`, the existing logic from 4.3 fires, and `onOcrChange()` is called.
5.  **After** that logic, a new check is added:
    * `if (isSmartResizeMode)`:
        * Get the `lineElement` from the DOM.
        * Call `smartResizeFont(block, lineIndex, lineElement)`.

---

## 5. Flow: Text Editing (Edit Mode)

This flow details text content manipulation and its integration with Smart Resize Mode.

### 5.1. DOM Stability (Double-Wrap)
* The text content is contained in a nested inner `div` (`contenteditable="true"`), separate from the outer `div` that handles drag/resize events. This isolates the structural bindings from the browser's rich-text engine.

### 5.2. Font Size Slider (Toolbar)
* The font slider is visible in the header only when `isEditMode` is true and a line is focused (`focusedBlock !== null`).
* **Focus Fix:** The slider container uses `onpointerdown`/`onpointerup` to set `isSliderInteracting`. The line element's `onblur` handler checks `!isSliderInteracting` before calling the de-focus callback (`onLineFocus(null)`), preventing the slider interaction from unintentionally blurring the text field.

### 5.3. Integration: Text Editing with `isSmartResizeMode`
This flow is triggered when a user edits text *while* `isSmartResizeMode` is active.

1.  The user enters `isEditMode` and activates `isSmartResizeMode`.
2.  The user focuses a line's `contenteditable` `div`.
3.  The user types, changing the text content.
4.  The user blurs the element (clicks away, presses Tab, etc.).
5.  The existing `onblur` handler for the line fires. **Inside** this handler, a new check is added:
    * `if (isSmartResizeMode)`:
        * Get the `lineElement` from the DOM (e.g., `event.currentTarget`).
        * Call `smartResizeFont(block, lineIndex, lineElement)`.

---

## 6. Flow: Line Splintering using Enter Key (Edit Mode)

This flow describes what happens when a user presses the `Enter` key inside a text line.

* **1. Action:** The user, in `Text Edit Mode`, places their text cursor (caret) somewhere in the middle of a text line.
* **2. Action:** The user presses the `Enter` key.
* **3. System Response:**
    * The system prevents the default browser action (e.g., inserting a `<br>` tag).
    * The current line is "split" at the cursor's position. The text *before* the cursor remains in the current line.
    * A new text line is created *after* the current line, containing the text *after* the cursor.
* **4. Placement:**
    * If the block is **horizontal**, the new line is placed directly *below* the current line, with a small gap.
    * If the block is **vertical**, the new line is placed *next to* the current line (respecting `readingDirection`, with a small gap).
* **5. Focus:** The user's focus is immediately and automatically moved to the beginning of the newly created line.

---

## 7. Flow: Line Navigation using Arrow Keys (Edit Mode)

This flow describes how the user can move focus between adjacent text lines using the arrow keys.

* **1. Action:** The user, in `Text Edit Mode`, has a text line focused.
* **2. Action:** The user presses an arrow key.
* **3. System Response:**
    * The system determines if the key corresponds to a "line navigation" or "cursor movement" action based on the block's orientation.
* **4. Interaction Logic:**
    * **Horizontal Block:**
        * `ArrowUp` / `ArrowDown`: Triggers line navigation.
        * `ArrowLeft` / `ArrowRight`: Is ignored by this flow, allowing the browser to move the text cursor normally within the line.
    * **Vertical Block:**
        * `ArrowLeft` / `ArrowRight`: Triggers line navigation (direction respects `readingDirection`).
        * `ArrowUp` / `ArrowDown`: Is ignored by this flow, allowing the browser to move the text cursor normally within the line.
* **5. Focus Change:**
    * If a line navigation is triggered, the system saves the current text cursor's character position (e.g., 5th character).
    * Focus is moved to the adjacent line (e.g., the line above, or the line to the left).
    * The system attempts to place the cursor at the *same character position* in the new line. (If the new line is shorter, the cursor is placed at the end of the line).

---

## 6. Flow: Context Menu Actions (Create, Delete)

This flow manages the creation and deletion of blocks and lines via the right-click context menu.

### 6.1. Context Menu Activation
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
        6.  Call `onOcrChange()` to mark data as dirty.
* **Flow: Create Line (Right-click on Block)**
    * The `oncontextmenu` handler on the *outer block* (`div.group/block`) fires only if `isBoxEditMode` is `true`.
    * It calls `openBlockContextMenu(event, block)`.
    * This function shows the menu with one option: `[{ label: "Add Line", action: ... }]`.
    * The `createNewLine` action adds a new line/line_coords entry to the block, and calls `onOcrChange()`.
* **Flow: Line Context Menu (Right-click on Line)**
    * The `oncontextmenu` handler on the *inner line* (`div.group/line`) calls `openLineContextMenu(event, block, lineIndex)`.
    * It builds an `options` array based on the current mode:
        * If `isEditMode` is true: Shows text options (Cut, Copy, Paste, Toggle Vertical).
        * If `isBoxEditMode` or `isEditMode` is true: Shows the "Delete Line" option.
        * (See section 7.2 for "Re-order Lines..." option)
    * It calls `contextMenu.open(event.clientX, event.clientY, options)`.

### 6.2. Action Functions (`OcrOverlay.svelte`)
* **`deleteLine(block, lineIndex)`:**
    * **CRITICAL:** This function now checks `if (block.lines.length === 1)`.
    * If `true` (it's the last line), it calls a new `deleteBlock(block)` function.
    * If `false`, it proceeds with the existing logic: clone the block, `splice` the line/line_coords from the *cloned* block, replace the block, and save.
* **`deleteBlock(block)`:**
    * Finds the index of the `block` in the `page.blocks` array.
    * Calls `page.blocks.splice(index, 1)` to remove the entire block.
    * Calls `onOcrChange()` and `handleSave()` to persist this structural change.

---

## 7. Flow: Re-ordering Lines (Modal)

This flow allows a user to change the sequential order of lines within a block via a dedicated modal. This is critical as text selection and copying rely on the `block.lines` array order.

* **Modes:** This functionality can be triggered from either **Text Edit Mode** (`isEditMode`) or **Box Edit Mode** (`isBoxEditMode`).

### 7.1. Component Interaction
* A new Svelte component, `LineOrderModal.svelte`, will be created.
* This component will be managed by a new global store, `lineOrderStore`, or passed as a prop from `volume/[id]/+page.svelte`.
* The store will hold `{ isOpen: boolean, block: MokuroBlock | null, onSave: () => void }`.

### 7.2. Context Menu Activation
* The user right-clicks on an **inner line** (`div.group/line`).
* This triggers `openLineContextMenu(event, block, lineIndex)`.
* A new `MenuOption` will be added to the `options` array: `{ label: "Re-order Lines...", action: () => openLineOrderModal(block) }`.
* This option should *not* be disabled, as it opens the modal for the entire block.

### 7.3. Modal Flow
* The `openLineOrderModal(block)` function sets the `lineOrderStore`'s state:
    * `isOpen = true`
    * `block = block`
    * `onSave = onOcrChange` (passing the callback from `OcrOverlay.svelte`).
* The `LineOrderModal.svelte` component renders. It contains an `#each` loop over the `$lineOrderStore.block.lines` array.
* Each list item displays the `line` text and two arrow buttons ("Up" and "Down").

### 7.4. Action Functions (Inside Modal)
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
    3.  This marks the `volume/[id]/+page.svelte` as having unsaved changes, prompting the "Save" button to appear.

### 7.5. UI Update
* The modal's internal list re-renders instantly on swap.
* When the modal is closed, the changes are already applied to the `block` object. The `onOcrChange()` call ensures the main `OcrOverlay.svelte` and the save mechanism are aware of the new state.
