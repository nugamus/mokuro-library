# Specification: Smart Font Resize Mode

This document outlines the flow for a new **Smart Resize Mode** that automatically adjusts font size to fit text within its bounding box. This feature modifies the existing flows from [`docs/ocr_box_edit_flow.md`](ocr_box_edit_flow).

## 1. New UI and State

1.  **New State**: A new global boolean state, `isSmartResizeMode`, is introduced. It defaults to `false`.
2.  **New UI**: A new toggle button, "Smart Resize," is added to the reader header, alongside the "Text Edit Mode" and "Box Edit Mode" buttons.
    * Clicking this button toggles `isSmartResizeMode` between `true` and `false`.
    * This mode can be active at the same time as `isEditMode` or `isBoxEditMode`.

## 2. Core Logic: `smartResizeFont` Function

This function is the core of the feature. It will be called by other flows.

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
    5.  **Persistence**: It calls **`onOcrChange()`** to mark the data as dirty. It **must not** call `handleSave()`.

## 3. Integration with `isBoxEditMode`

This flow is triggered when a user resizes a line *while* `isSmartResizeMode` is active.

1.  The user enters `isBoxEditMode`.
2.  The user activates `isSmartResizeMode` (if not already active).
3.  The user drags a resize handle on an **inner line** (triggering `handleLineResizeStart`).
4.  The user releases the mouse (`onmouseup`).
5.  On `mouseup`, the existing logic fires. **After** that logic, a new check is added:
    * `if (isSmartResizeMode)`:
        * Get the `lineElement` from the DOM.
        * Call `smartResizeFont(block, lineIndex, lineElement)`.

## 4. Integration with `isEditMode`

This flow is triggered when a user edits text *while* `isSmartResizeMode` is active.

1.  The user enters `isEditMode`.
2.  The user activates `isSmartResizeMode` (if not already active).
3.  The user focuses a line's `contenteditable` `div`.
4.  The user types, changing the text content.
5.  The user blurs the element (clicks away, presses Tab, etc.).
6.  The existing `onblur` handler for the line (mentioned in `docs/ocr_box_edit_flow.md`) fires. **Inside** this handler, a new check is added:
    * `if (isSmartResizeMode)`:
        * Get the `lineElement` from the DOM (e.g., `event.currentTarget`).
        * Call `smartResizeFont(block, lineIndex, lineElement)`.

---

## **Important Note on Block vs. Line Sizing**

The `.mokuro` file format defines `font_size` as a **per-block** property, which is shared by all lines within that block.

This Smart Resize feature is triggered by operations on a **single line** (e.g., resizing or editing that specific line).

Therefore, the new font size will be calculated based *only* on the text and dimensions of that line of interest. This new `font_size` will then be applied to the entire block, affecting all other lines within it, regardless of their content or size.
