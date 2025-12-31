import { PatchOperation } from '../../types/history';
import {
  Effect,
  TransformResult,
  ResolutionType,
  ConflictReason,
  ExtendedPatch
} from '../../types/rebase';
import { PathUtils, Permutation } from './rebaseUtils';

export class PatchTransformer {

  /**
   * The Unified Transform Function.
   */
  static transform(
    userPatch: ExtendedPatch,
    effect: Effect,
    adminPatch: ExtendedPatch,
    resolution?: ResolutionType
  ): TransformResult {

    const userOp = userPatch.operation;

    // --- 1. Fast Path: Identity ---
    if (effect.type === 'identity') {
      return { success: true, op: userOp, effect, hadConflict: false };
    }

    // --- 2. Intersection Check ---
    const relation = this.checkIntersection(userOp.path, effect);

    if (relation === 'independent') {
      const newOp = this.applyPathTransform(userOp, effect);
      return { success: true, op: newOp, effect, hadConflict: false };
    }

    // --- 3. Conflict Detected ---
    const conflictReason = this.determineConflictReason(userOp, effect, relation);

    if (!resolution) {
      return {
        success: false,
        conflict: {
          reason: conflictReason,
          path: userOp.path,
          userPatch: userPatch,
          adminPatch: adminPatch
        }
      };
    }

    // --- 4. Apply Resolution ---
    return this.resolveConflict(userPatch, effect, conflictReason, resolution);
  }

  private static checkIntersection(userPath: string, effect: Effect): 'independent' | 'direct_hit' | 'ancestor_hit' | 'descendant_hit' {
    if (effect.type === 'identity') return 'independent';

    if (userPath === effect.path) return 'direct_hit';

    if (PathUtils.isDescendant(userPath, effect.path)) {
      if (effect.type === 'shift_down' || effect.type === 'shift_up') {
        const relative = PathUtils.getRelativeSegments(userPath, effect.path);
        const userIndex = parseInt(relative[0], 10);
        if (isNaN(userIndex)) return 'independent';
        if (effect.type === 'shift_down' && userIndex === effect.index) return 'ancestor_hit';
        return 'independent';
      }
      return 'ancestor_hit';
    }

    if (PathUtils.isDescendant(effect.path, userPath)) return 'descendant_hit';

    return 'independent';
  }

  private static determineConflictReason(
    userOp: PatchOperation,
    effect: Effect,
    relation: 'direct_hit' | 'ancestor_hit' | 'descendant_hit'
  ): ConflictReason {
    if (relation === 'ancestor_hit' && effect.type === 'shift_down') return 'dead_zone';

    if (relation === 'direct_hit') {
      if (effect.type === 'shift_down' && userOp.op === 'remove') return 'double_delete';
      if (effect.type === 'permute' && (userOp.op.startsWith('reorder'))) return 'reorder_collision';
      if (effect.type === 'content') return 'content_conflict';
      if ((effect.type === 'shift_up' || effect.type === 'shift_down') && userOp.op.startsWith('reorder')) {
        return 'reorder_length_mismatch';
      }
    }

    return 'content_conflict';
  }

  private static applyPathTransform(userOp: PatchOperation, effect: Effect): PatchOperation {
    const newOp = structuredClone(userOp);

    if (effect.type === 'shift_up' || effect.type === 'shift_down' || effect.type === 'permute') {
      if (PathUtils.isDescendant(userOp.path, effect.path)) {
        const segments = PathUtils.getRelativeSegments(userOp.path, effect.path);
        let index = parseInt(segments[0], 10);

        if (!isNaN(index)) {
          // Apply accumulated permutation first (if exists on shift effects)
          if ((effect.type === 'shift_up' || effect.type === 'shift_down') && effect.permutation) {
            index = Permutation.mapIndex(effect.permutation, index);
            if (index === -1) {
              // Index was eliminated by permutation — shouldn't happen in valid permutations
              return newOp;
            }
          }

          // Then apply shift
          let newIndex = index;
          if (effect.type === 'shift_up') {
            if (index >= effect.index) newIndex = index + 1;
          } else if (effect.type === 'shift_down') {
            if (index > effect.index) newIndex = index - 1;
          } else if (effect.type === 'permute') {
            newIndex = Permutation.mapIndex(effect.permutation, index);
          }

          if (newIndex !== index && newIndex !== -1) {
            segments[0] = newIndex.toString();
            const prefix = effect.path === '/' ? '' : effect.path;
            newOp.path = prefix + '/' + segments.join('/');
          }
        }
      }
    }
    return newOp;
  }

  private static resolveConflict(
    userPatch: ExtendedPatch,
    effect: Effect,
    reason: ConflictReason,
    resolution: ResolutionType
  ): TransformResult {
    const userOp = userPatch.operation;

    const invalidResult = (): TransformResult => ({
      success: false,
      conflict: {
        reason,
        path: userOp.path,
        userPatch,
        adminPatch: { id: 'unknown', parentId: null, operation: {} as any }
      }
    });

    // --- keep_admin: Delete patch, effect propagates (breaks through) ---
    if (resolution === 'keep_admin') {
      // reorder_collision: accumulate A⁻¹ * U
      if (reason === 'reorder_collision' && effect.type === 'permute' && userOp.new_order) {
        const accumulatedPerm = Permutation.compose(effect.permutation, userOp.new_order);
        const newEffect = structuredClone(effect);
        newEffect.permutation = accumulatedPerm;
        return {
          success: true,
          op: null,
          effect: newEffect,
          hadConflict: true
        };
      }

      // reorder_length_mismatch: accumulate shift * U
      if (reason === 'reorder_length_mismatch' && (effect.type === 'shift_up' || effect.type === 'shift_down') && userOp.new_order) {
        const existingPerm = effect.permutation ?? this.identityPermutation(userOp.new_order.length);
        const accumulatedPerm = Permutation.compose(existingPerm, userOp.new_order);
        const newEffect = structuredClone(effect);
        newEffect.permutation = accumulatedPerm;
        return {
          success: true,
          op: null,
          effect: newEffect,
          hadConflict: true
        };
      }

      // double_delete: both deleted same thing, effect nullified
      if (reason === 'double_delete') {
        return {
          success: true,
          op: null,
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // dead_zone, content_conflict: delete patch, effect continues
      if (reason === 'dead_zone' || reason === 'content_conflict') {
        return {
          success: true,
          op: null,
          effect: effect,
          hadConflict: true
        };
      }

      // Invalid: unknown reason for keep_admin
      return invalidResult();
    }

    // --- keep_mine: Transform patch, effect absorbed ---
    if (resolution === 'keep_mine') {
      // Content conflict: update old_value to admin's value
      if (reason === 'content_conflict' && effect.type === 'content') {
        const newOp = structuredClone(userOp);
        newOp.old_value = effect.newValue;
        return {
          success: true,
          op: newOp,
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // Reorder collision: transform to A⁻¹ * U
      if (reason === 'reorder_collision' && effect.type === 'permute' && userOp.new_order) {
        const newOrder = Permutation.compose(effect.permutation, userOp.new_order);
        const newOp = structuredClone(userOp);
        newOp.new_order = newOrder;
        return {
          success: true,
          op: newOp,
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // Invalid: keep_mine not allowed for this conflict type
      return invalidResult();
    }

    // --- resurrect: Restore deleted block with user's changes ---
    if (resolution === 'resurrect') {
      if (reason === 'dead_zone' && effect.type === 'shift_down') {
        const restoredBlock = structuredClone(effect.deletedValue);
        const deletedItemPath = `${effect.path === '/' ? '' : effect.path}/${effect.index}`;

        // dead_zone guarantees userOp.path is descendant of deletedItemPath
        const relativeSegments = PathUtils.getRelativeSegments(userOp.path, deletedItemPath);
        this.applyLocalChange(restoredBlock, relativeSegments, userOp);

        return {
          success: true,
          op: {
            op: 'add',
            path: deletedItemPath,
            value: restoredBlock
          },
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // Invalid: resurrect only valid for dead_zone
      return invalidResult();
    }

    // Invalid: unknown resolution type
    return invalidResult();
  }

  private static identityPermutation(length: number): number[] {
    return Array.from({ length }, (_, i) => i);
  }

  private static applyLocalChange(root: any, segments: string[], op: PatchOperation): void {
    if (segments.length === 0) return;

    const targetKey = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);

    let ptr = root;
    for (const seg of parentSegments) {
      if (ptr[seg] === undefined) return;
      ptr = ptr[seg];
    }

    if (op.op === 'replace') {
      ptr[targetKey] = op.value;
    } else if (op.op === 'add') {
      if (Array.isArray(ptr)) {
        if (targetKey === '-') {
          ptr.push(op.value);
        } else {
          const idx = parseInt(targetKey, 10);
          if (!isNaN(idx)) ptr.splice(idx, 0, op.value);
        }
      } else {
        ptr[targetKey] = op.value;
      }
    } else if (op.op === 'remove') {
      if (Array.isArray(ptr)) {
        const idx = parseInt(targetKey, 10);
        if (!isNaN(idx)) ptr.splice(idx, 1);
      } else {
        delete ptr[targetKey];
      }
    } else if (op.op.startsWith('reorder') && op.new_order) {
      const arr = ptr[targetKey];
      if (Array.isArray(arr) && arr.length === op.new_order.length) {
        const newArr = new Array(arr.length);
        op.new_order.forEach((oldIdx, newIdx) => {
          newArr[newIdx] = arr[oldIdx];
        });
        ptr[targetKey] = newArr;
      }
    }
  }
}
