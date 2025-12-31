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

    // --- 3. No Hit: Passthrough ---
    if (relation === 'no_hit') {
      return { success: true, op: userOp, effect, hadConflict: false };
    }

    // --- 4. Patch Shift: Auto-transform path ---
    if (relation === 'sibling_hit') {
      const newOp = this.applyPathTransform(userOp, effect);
      return { success: true, op: newOp, effect, hadConflict: false };
    }

    // --- 5. Determine Conflict ---
    const conflictReason = this.determineConflictReason(userOp, effect, relation);

    // --- 6. Auto-resolve ---
    const autoResolved = this.tryAutoResolve(userPatch, effect, conflictReason);
    if (autoResolved) return autoResolved;

    // --- 7. Require User Resolution ---
    if (!resolution) {
      return {
        success: false,
        conflict: {
          reason: conflictReason,
          userPatch: userPatch,
          adminPatch: adminPatch
        }
      };
    }

    // --- 8. Apply Resolution ---
    return this.resolveConflict(userPatch, effect, conflictReason, resolution);
  }

  private static checkIntersection(
    userPath: string,
    effect: Effect
  ): 'no_hit' | 'sibling_hit' | 'direct_hit' | 'ancestor_hit' | 'descendant_hit' {

    if (effect.type === 'identity') return 'no_hit';

    // For shift effects, compute the affected item path
    // If permutation exists, inverse map the index first
    let affectedPath: string;
    if (effect.type === 'shift_down' || effect.type === 'shift_up') {
      let index = effect.index;
      if (effect.permutation) {
        index = Permutation.mapIndex(Permutation.invert(effect.permutation), index);
      }
      affectedPath = `${effect.path === '/' ? '' : effect.path}/${index}`;
    } else {
      affectedPath = effect.path;
    }

    // Direct hit: same path
    if (userPath === affectedPath) return 'direct_hit';

    // Ancestor hit: user path is inside affected path
    if (PathUtils.isDescendant(userPath, affectedPath)) return 'ancestor_hit';

    // Descendant hit: affected path is inside user path
    if (PathUtils.isDescendant(affectedPath, userPath)) return 'descendant_hit';

    // Sibling hit: user is in same array (for shift/permute effects)
    if (effect.type === 'shift_up' || effect.type === 'shift_down' || effect.type === 'permute') {
      const arrayPath = effect.path;
      if (PathUtils.isDescendant(userPath, arrayPath)) {
        const relative = PathUtils.getRelativeSegments(userPath, arrayPath);
        const userIndex = parseInt(relative[0], 10);
        if (isNaN(userIndex)) {
          throw new Error(`Unexpected non-numeric path segment in ${userPath}`);
        }
        return 'sibling_hit';
      }
    }

    return 'no_hit';
  }

  private static determineConflictReason(
    userOp: PatchOperation,
    effect: Effect,
    relation: 'direct_hit' | 'ancestor_hit' | 'descendant_hit'
  ): ConflictReason {
    // ancestor_hit: user op targets something inside effect's path
    if (relation === 'ancestor_hit') {
      if (effect.type === 'shift_down') {
        if (userOp.op === 'add') return 'effect_shift';
        return 'dead_zone';
      }
      if (effect.type === 'content') {
        if (userOp.op === 'add') return 'effect_shift';
      }
    }

    // descendant_hit: effect targets something inside user op's path
    if (relation === 'descendant_hit') {
      if (effect.type === 'content' && userOp.op === 'remove') {
        return 'reverse_dead_zone';
      }
    }

    if (relation === 'direct_hit') {
      if (effect.type === 'shift_down' && userOp.op === 'remove') return 'double_delete';
      if (effect.type === 'permute' && userOp.op.startsWith('reorder')) return 'reorder_collision';
      if (effect.type === 'content') return 'content_conflict';
      if ((effect.type === 'shift_up' || effect.type === 'shift_down') && userOp.op.startsWith('reorder')) {
        return 'reorder_length_mismatch';
      }
    }

    return 'content_conflict';
  }

  /**
   * Auto-resolves conflicts that don't require user input.
   * Returns null if conflict requires user resolution.
   */
  private static tryAutoResolve(
    userPatch: ExtendedPatch,
    effect: Effect,
    reason: ConflictReason
  ): TransformResult | null {
    const userOp = userPatch.operation;

    // Effect Shift: User's add shifts the effect
    if (reason === 'effect_shift') {
      if (effect.type === 'shift_down') {
        // User inserted at deleted index, shift dead zone index up
        const newEffect = structuredClone(effect);
        newEffect.index = effect.index + 1;
        return {
          success: true,
          op: userOp,  // Keep insert as-is
          effect: newEffect,
          hadConflict: true
        };
      }
      if (effect.type === 'content') {
        // User inserted at ancestor of content path, shift content path
        const newEffect = structuredClone(effect);
        newEffect.path = this.shiftPath(effect.path, userOp.path);
        return {
          success: true,
          op: userOp,  // Keep insert as-is
          effect: newEffect,
          hadConflict: true
        };
      }
    }

    // Double Delete: Both deleted same item
    // Skip user patch, effect nullified (already deleted)
    if (reason === 'double_delete') {
      return {
        success: true,
        op: null,
        effect: { type: 'identity', path: '/' },
        hadConflict: true
      };
    }

    // Reorder + Length Change: Admin added/removed, user reordered
    // Skip user patch, accumulate permutation onto effect
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

    return null;  // Requires user resolution
  }

  /**
   * Shifts a path when an insert happens at an ancestor index.
   * E.g., insert at /pages/0/blocks/1, content path /pages/0/blocks/2/lines/0 -> /pages/0/blocks/3/lines/0
   */
  private static shiftPath(effectPath: string, insertPath: string): string {
    const effectSegments = PathUtils.parse(effectPath);
    const insertSegments = PathUtils.parse(insertPath);

    // Find the index being inserted at (last segment of insertPath)
    const insertIndex = parseInt(insertSegments[insertSegments.length - 1], 10);
    if (isNaN(insertIndex)) return effectPath;

    // The parent path of the insert
    const insertParentSegments = insertSegments.slice(0, -1);

    // Check if effect path is under the same parent
    if (effectSegments.length <= insertParentSegments.length) return effectPath;

    // Check prefix matches
    for (let i = 0; i < insertParentSegments.length; i++) {
      if (effectSegments[i] !== insertParentSegments[i]) return effectPath;
    }

    // Get the index in effect path at the same level as insert
    const effectIndex = parseInt(effectSegments[insertParentSegments.length], 10);
    if (isNaN(effectIndex)) return effectPath;

    // Shift if effect index >= insert index
    if (effectIndex >= insertIndex) {
      effectSegments[insertParentSegments.length] = (effectIndex + 1).toString();
    }

    return PathUtils.compile(effectSegments);
  }

  private static applyPathTransform(userOp: PatchOperation, effect: Effect): PatchOperation {
    const newOp = structuredClone(userOp);
    if (effect.type === 'shift_up' || effect.type === 'shift_down' || effect.type === 'permute') {
      if (PathUtils.isDescendant(userOp.path, effect.path)) {
        const segments = PathUtils.getRelativeSegments(userOp.path, effect.path);
        let index = parseInt(segments[0], 10);
        if (isNaN(index)) {
          throw new Error(`Unexpected non-numeric path segment in ${userOp.path}`);
        }

        let newIndex = index;

        // Apply accumulated permutation first (if exists on shift effects)
        if (effect.permutation) {
          newIndex = Permutation.mapIndex(effect.permutation, index);
          if (newIndex === -1) throw new Error(`Invalid permutation ${effect.permutation} applied to ${index}`);

        }

        // Then apply shift (using newIndex, not index)
        if (effect.type === 'shift_up') {
          if (newIndex >= effect.index) newIndex = newIndex + 1;
        } else if (effect.type === 'shift_down') {
          if (newIndex > effect.index) newIndex = newIndex - 1;
        }

        if (newIndex !== index) {
          segments[0] = newIndex.toString();
          const prefix = effect.path === '/' ? '' : effect.path;
          newOp.path = prefix + '/' + segments.join('/');
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
        userPatch,
        adminPatch: { id: 'unknown', parentId: null, operation: {} as any }
      }
    });

    // --- keep_admin ---
    if (resolution === 'keep_admin') {
      // Dead Zone: discard user's edit, effect continues
      if (reason === 'dead_zone' && effect.type === 'shift_down') {
        return {
          success: true,
          op: null,
          effect: effect,
          hadConflict: true
        };
      }

      // Reverse Dead Zone: keep user's delete, effect absorbed
      if (reason === 'reverse_dead_zone') {
        // User deleted the item, admin's content edit is lost
        // Need to transform user's remove path and create shift_up effect
        const newOp = this.applyPathTransform(userOp, effect);
        return {
          success: true,
          op: newOp,
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // Reorder Collision: discard user's reorder, accumulate A⁻¹ * U
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

      // Content Conflict: discard user's edit, effect continues
      if (reason === 'content_conflict') {
        return {
          success: true,
          op: null,
          effect: effect,
          hadConflict: true
        };
      }

      return invalidResult();
    }

    // --- keep_mine ---
    if (resolution === 'keep_mine') {
      // Dead Zone: resurrect deleted content with user's edit applied
      if (reason === 'dead_zone' && effect.type === 'shift_down') {
        const restoredBlock = structuredClone(effect.deletedValue);
        const deletedItemPath = `${effect.path === '/' ? '' : effect.path}/${effect.index}`;

        // Apply user's edit to restored block
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

      // Reverse Dead Zone: undo user's delete, effect becomes shift_up
      if (reason === 'reverse_dead_zone' && effect.type === 'content') {
        // User's delete is discarded, we need to re-add the item
        // The shift_up effect will propagate to subsequent patches
        const removeIndex = parseInt(PathUtils.parse(userOp.path).pop() || '', 10);
        const parentPath = PathUtils.compile(PathUtils.parse(userOp.path).slice(0, -1));

        return {
          success: true,
          op: null,  // Discard user's remove
          effect: {
            type: 'shift_up',
            path: parentPath,
            index: removeIndex
          },
          hadConflict: true
        };
      }

      // Content Conflict: update old_value to admin's value
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

      // Reorder Collision: transform to A⁻¹ * U
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

      return invalidResult();
    }

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
