import { PatchOperation, UnifiedLine, UnifiedBlock } from '../types/history';
import { MokuroData, Quad, Rect, MokuroBlock } from '../types/mokuro';

export class PatchApplicator {

  /**
   * Applies a patch operation to the MokuroData object (mutates in place).
   * Patches are assumed to be valid (validated at insertion time).
   * 
   * @param data - The MokuroData object to modify
   * @param patch - The patch operation to apply
   * @throws Error if path/op is unsupported
   */
  static apply(data: MokuroData, patch: PatchOperation): void {
    // Genesis/No-op: skip
    if (patch.path === 'genesis') {
      return;
    }

    const parts = patch.path.split("/").filter(x => x);
    const op = patch.op;

    // Block Operations (/pages/p/blocks/...)
    if (parts[2] === 'blocks') {
      const pageIndex = parseInt(parts[1]);
      const page = data.pages[pageIndex];

      // Reorder Blocks (/pages/0/blocks)
      if (parts.length === 3 && op === 'reorder_blocks') {
        this.reorderArray(page.blocks, patch.new_order!);
        return;
      }

      const blockIndexRaw = parts[3];
      const property = parts[4];

      // Block Add/Remove (/pages/0/blocks/- or /pages/0/blocks/1)
      if (parts.length === 4) {
        if (op === 'add') {
          const nativeBlock = this.unifiedToNativeBlock(patch.value as UnifiedBlock);
          if (blockIndexRaw === '-') {
            page.blocks.push(nativeBlock);
          } else {
            page.blocks.splice(parseInt(blockIndexRaw), 0, nativeBlock);
          }
          return;
        }

        if (op === 'remove') {
          page.blocks.splice(parseInt(blockIndexRaw), 1);
          return;
        }
      }

      const block = page.blocks[parseInt(blockIndexRaw)];

      // Line Operations (/pages/0/blocks/1/lines/...)
      if (property === 'lines') {
        const lineIndexRaw = parts[5];

        // Reorder Lines
        if (!lineIndexRaw && op === 'reorder_lines') {
          this.reorderParallel(block.lines, block.lines_coords, patch.new_order!);
          return;
        }

        if (lineIndexRaw) {
          // Add/Remove Line
          if (op === 'add') {
            const val = patch.value as UnifiedLine;
            if (lineIndexRaw === '-') {
              block.lines.push(val.text);
              block.lines_coords.push(val.coords);
            } else {
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

          // Line Properties (Text/Coords)
          const subProp = parts[6];
          if (op === 'replace') {
            const idx = parseInt(lineIndexRaw);
            if (subProp === 'text') {
              block.lines[idx] = patch.value as string;
              return;
            }
            if (subProp === 'coords') {
              block.lines_coords[idx] = patch.value as Quad;
              return;
            }
          }
        }
      }

      // Block Properties (box, vertical, font_size)
      if (op === 'replace') {
        if (property === 'box') {
          block.box = patch.value as Rect;
          return;
        }
        if (property === 'vertical') {
          block.vertical = patch.value as boolean;
          return;
        }
        if (property === 'font_size') {
          block.font_size = patch.value as number;
          return;
        }
      }
    }

    throw new Error(`Unsupported path or op: ${patch.op} ${patch.path}`);
  }

  /**
   * Applies multiple patches in sequence.
   */
  static applyAll(data: MokuroData, patches: PatchOperation[]): void {
    for (const patch of patches) {
      this.apply(data, patch);
    }
  }

  // --- Conversion Helpers ---

  /** Convert UnifiedBlock to native storage format */
  private static unifiedToNativeBlock(u: UnifiedBlock): MokuroBlock {
    return {
      box: u.box,
      vertical: u.vertical,
      font_size: u.font_size,
      lines: u.lines.map(l => l.text),
      lines_coords: u.lines.map(l => l.coords)
    };
  }

  // --- Reorder Helpers ---

  /** Permute a single array in place */
  private static reorderArray<T>(arr: T[], order: number[]): void {
    const temp = [...arr];
    for (let i = 0; i < order.length; i++) {
      arr[i] = temp[order[i]];
    }
  }

  /** Permute two arrays simultaneously (for lines + lines_coords) */
  private static reorderParallel<T, U>(arr1: T[], arr2: U[], order: number[]): void {
    const temp1 = [...arr1];
    const temp2 = [...arr2];
    for (let i = 0; i < order.length; i++) {
      arr1[i] = temp1[order[i]];
      arr2[i] = temp2[order[i]];
    }
  }
}
