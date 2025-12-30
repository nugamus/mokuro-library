import { PatchOperation } from '../types/history';

export class PatchInverter {
  static invert(patch: PatchOperation): PatchOperation {
    if (patch.path === 'genesis') return { op: 'replace', path: 'genesis' };
    const { op, path, value, old_value, new_order } = patch;

    // 1. Invert Replace (Swap values)
    if (op === 'replace') {
      if (old_value === undefined) throw new Error("Cannot invert replace without old_value");
      return { ...patch, value: old_value, old_value: value };
    }

    // 2. Invert Add (Become Remove)
    if (op === 'add') {
      return {
        ...patch,
        op: 'remove',
        old_value: value,
        value: undefined
      };
    }

    // 3. Invert Remove (Become Add)
    if (op === 'remove') {
      if (old_value === undefined) throw new Error("Cannot invert remove without old_value");
      return {
        ...patch,
        op: 'add',
        value: old_value,
        old_value: undefined
      };
    }

    // 4. Invert Reorder (Lines OR Blocks)
    if (op === 'reorder_lines' || op === 'reorder_blocks') {
      // Inverse Permutation: If Order[i] = j, then Inverse[j] = i
      if (!new_order) throw new Error(`Missing new_order for ${op}`);

      const inverseOrder = new Array(new_order.length);
      for (let i = 0; i < new_order.length; i++) {
        inverseOrder[new_order[i]] = i;
      }
      return { ...patch, new_order: inverseOrder };
    }

    throw new Error(`Unknown op ${op}`);
  }
}
