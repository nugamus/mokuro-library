import { PatchOperation } from '../../types/history';
import { Effect } from '../../types/rebase';
import { PathUtils, Permutation } from './rebaseUtils';

export class EffectFactory {
  /**
   * Converts an Admin Patch Operation into a mathematical Effect (The Wave).
   * For permutations, stores A⁻¹ so transformers can accumulate without extra inversion.
   */
  static fromOperation(op: PatchOperation): Effect {
    const { op: opType, path, value, old_value, new_order } = op;

    // 1. Add -> Shift Up
    if (opType === 'add') {
      const parts = PathUtils.parse(path);
      const lastSegment = parts[parts.length - 1];
      const index = parseInt(lastSegment, 10);

      if (!isNaN(index)) {
        // e.g. /blocks/5 -> Shift items >= 5 up by 1
        // The path stored in effect is the *parent* array path
        const parentPath = PathUtils.compile(parts.slice(0, -1));
        return {
          type: 'shift_up',
          path: parentPath,
          index: index
        };
      }
    }

    // 2. Remove -> Shift Down (Dead Zone)
    if (opType === 'remove') {
      const parts = PathUtils.parse(path);
      const lastSegment = parts[parts.length - 1];
      const index = parseInt(lastSegment, 10);

      if (!isNaN(index)) {
        const parentPath = PathUtils.compile(parts.slice(0, -1));
        return {
          type: 'shift_down',
          path: parentPath,
          index: index,
          deletedValue: old_value // Critical for resurrection
        };
      }
    }

    // 3. Reorder -> Permute (store as A⁻¹)
    if ((opType === 'reorder_lines' || opType === 'reorder_blocks') && new_order) {
      return {
        type: 'permute',
        path: path,
        permutation: Permutation.invert(new_order)  // Store A⁻¹
      };
    }

    // 4. Replace -> Content Change
    if (opType === 'replace') {
      return {
        type: 'content',
        path: path,
        newValue: value
      };
    }

    // Fallback / Unknown / Irrelevant -> Identity
    return {
      type: 'identity',
      path: '/'
    };
  }
}
