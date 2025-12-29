// backend/src/lib/PatchApplicator.ts
import { PatchOperation, UnifiedLine, UnifiedBlock } from '../types/history';

export class PatchApplicator {

  static apply(data: any, patch: PatchOperation): void {
    const parts = patch.path.split('/').filter(x => x);
    const op = patch.op;

    // --- 1. Identify Context ---
    // We look at the last few segments to determine what we are editing.

    // CASE: Block Operations (/pages/p/blocks/...)
    if (parts[2] === 'blocks') {
      const pageIndex = parseInt(parts[1]);
      const blockIndexRaw = parts[3];
      const property = parts[4]; // 'lines', 'box', 'vertical', etc.

      const page = data.pages[pageIndex];

      // A. Block Add/Remove (/pages/0/blocks/- or /pages/0/blocks/1)
      if (parts.length === 4) {
        if (op === 'add') {
          const val = patch.value as UnifiedBlock;
          const nativeBlock = this.unifiedToNativeBlock(val);

          if (blockIndexRaw === '-') {
            page.blocks.push(nativeBlock);
          } else {
            // Splicing Insertion for Blocks
            const idx = parseInt(blockIndexRaw);
            page.blocks.splice(idx, 0, nativeBlock);
          }
          return;
        }
        if (op === 'remove') {
          const idx = parseInt(blockIndexRaw);
          page.blocks.splice(idx, 1);
          return;
        }
      }

      const block = page.blocks[parseInt(blockIndexRaw)];

      // B. Line Operations (/pages/0/blocks/1/lines/...)
      if (property === 'lines') {
        const lineIndexRaw = parts[5];

        // B1. Reorder Lines
        if (!lineIndexRaw && op === 'reorder_lines') {
          if (!patch.new_order) throw new Error("Missing new_order");
          this.reorderParallel(block.lines, block.lines_coords, patch.new_order);
          return;
        }

        // B2. Add/Remove Line (The Splicing Logic)
        if (lineIndexRaw) {
          if (op === 'add') {
            const val = patch.value as UnifiedLine;
            if (lineIndexRaw === '-') {
              block.lines.push(val.text);
              block.lines_coords.push(val.coords);
            } else {
              // *** SPLICING INSERTION ***
              // This inserts the new line AT the specified index
              const idx = parseInt(lineIndexRaw);
              block.lines.splice(idx, 0, val.text);
              block.lines_coords.splice(idx, 0, val.coords);
            }
            return;
          }

          if (op === 'remove') {
            const idx = parseInt(lineIndexRaw);
            block.lines.splice(idx, 1);
            block.lines_coords.splice(idx, 1);
            return;
          }
        }

        // B3. Line Properties (Text/Coords)
        const subProp = parts[6]; // 'text' or 'coords'
        if (op === 'replace' && subProp) {
          const idx = parseInt(lineIndexRaw);
          if (subProp === 'text') block.lines[idx] = patch.value as string;
          if (subProp === 'coords') block.lines_coords[idx] = patch.value as any;
          return;
        }
      }

      // C. Block Properties (box, vertical)
      if (op === 'replace') {
        if (property === 'box') block.box = patch.value;
        if (property === 'vertical') block.vertical = patch.value;
        if (property === 'font_size') block.font_size = patch.value;
        return;
      }
    }

    throw new Error(`Unsupported path or op: ${patch.op} ${patch.path}`);
  }

  // Helper: Convert UnifiedBlock (from Patch) to Storage Format
  private static unifiedToNativeBlock(u: UnifiedBlock): any {
    return {
      box: u.box,
      vertical: u.vertical,
      font_size: u.font_size,
      lines: u.lines.map(l => l.text),
      lines_coords: u.lines.map(l => l.coords)
    };
  }

  // Helper: Permute two arrays simultaneously
  private static reorderParallel(arr1: any[], arr2: any[], order: number[]) {
    const temp1 = [...arr1];
    const temp2 = [...arr2];
    for (let i = 0; i < order.length; i++) {
      const sourceIdx = order[i];
      arr1[i] = temp1[sourceIdx];
      arr2[i] = temp2[sourceIdx];
    }
  }
}
