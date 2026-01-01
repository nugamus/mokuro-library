import { PatchOperation } from '../../types/history';
import {
  Effect,
  TransformResult,
  ResolutionType,
  ConflictReason,
  ExtendedPatch,
  ShiftUpEffect,
  ShiftDownEffect,
  PermuteEffect
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
    const relation = this.checkIntersection(userOp, effect);

    // --- 3. No Hit: Passthrough ---
    if (relation === 'no_hit') {
      return { success: true, op: userOp, effect, hadConflict: false };
    }

    // --- 4. Patch Shift: Auto-transform path ---
    if (relation === 'sibling_hit') {
      const { op: newOp, effect: newEffect } = this.handleSiblingHit(userOp, effect as ShiftUpEffect | ShiftDownEffect | PermuteEffect);
      return { success: true, op: newOp, effect: newEffect, hadConflict: false };
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
    userOp: PatchOperation,
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
      affectedPath = `${effect.path}/${index}`;
    } else if (effect.type === 'permute') {
      affectedPath = `${effect.path}/-1`;
    } else {
      affectedPath = effect.path;
    }

    let userPath = userOp.op === 'reorder' ? `${userOp.path}/-1` : userOp.path;

    // shift_up can only hit gaps (i.e. sibling_hit or descendant_hit)
    if (effect.type !== 'shift_up') {
      // Direct hit: same path
      if (userPath === affectedPath) return 'direct_hit';

      // Ancestor hit: user path is inside affected path
      if (PathUtils.isDescendant(userPath, affectedPath)) return 'ancestor_hit';
    }

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

    // --- direct_hit ---
    if (relation === 'direct_hit') {
      const directHitMap: Record<string, ConflictReason> = {
        'shift_down:add': 'shift_down_into_add',
        'shift_down:remove': 'double_delete',
        'permute:reorder': 'reorder_collision',
        'content:replace': 'content_conflict',
      };
      const key = `${effect.type}:${userOp.op}`;
      if (directHitMap[key]) return directHitMap[key];
    }

    // --- ancestor_hit ---
    if (relation === 'ancestor_hit') {
      if (effect.type === 'shift_down') return 'dead_zone';
    }

    // --- descendant_hit ---
    if (relation === 'descendant_hit') {
      if (userOp.op === 'add' || userOp.op === 'reorder') return 'effect_shift';
      if (userOp.op === 'remove') return 'reverse_dead_zone';
    }

    throw new Error(`Unexpected conflict: relation=${relation}, effect=${effect.type}, op=${userOp.op}`);
  }

  private static tryAutoResolve(
    userPatch: ExtendedPatch,
    effect: Effect,
    reason: ConflictReason
  ): TransformResult | null {
    const userOp = userPatch.operation;

    // shift_down_into_add: user adding at deleted index
    // Handle permutation if present, bump effect index
    if (reason === 'shift_down_into_add' && effect.type === 'shift_down') {
      const newOp = structuredClone(userOp);
      const newEffect = structuredClone(effect);

      // If permutation exists, apply it to user's add path
      if (newEffect.permutation) {
        const segments = PathUtils.parse(userOp.path);
        const index = parseInt(segments[segments.length - 1], 10);
        const newIndex = Permutation.mapIndex(newEffect.permutation, index);
        segments[segments.length - 1] = newIndex.toString();
        newOp.path = PathUtils.compile(segments);
      }

      // Bump effect index
      newEffect.index = newEffect.index + 1;

      return {
        success: true,
        op: newOp,
        effect: newEffect,
        hadConflict: true
      };
    }

    // effect_shift: user's add/reorder at ancestor shifts effect path
    if (reason === 'effect_shift') {
      const newEffect = structuredClone(effect);

      if (userOp.op === 'add') {
        newEffect.path = this.shiftPath(newEffect.path, userOp.path);

        return {
          success: true,
          op: userOp,
          effect: newEffect,
          hadConflict: true
        };
      }

      if (userOp.op === 'reorder' && userOp.new_order) {
        newEffect.path = this.permutePath(newEffect.path, userOp.path, userOp.new_order);

        return {
          success: true,
          op: userOp,
          effect: newEffect,
          hadConflict: true
        };
      }
    }

    // double_delete: both deleted same item, effect nullified
    if (reason === 'double_delete') {
      return {
        success: true,
        op: null,
        effect: { type: 'identity', path: '/' },
        hadConflict: true
      };
    }

    return null;
  }

  /**
   * Shifts a path when an insert happens at an ancestor index.
   * E.g., insert at /blocks/1, effect path /blocks/2/lines/0 -> /blocks/3/lines/0
   */
  private static shiftPath(effectPath: string, insertPath: string): string {
    const insertSegments = PathUtils.parse(insertPath);
    const insertIndex = parseInt(insertSegments[insertSegments.length - 1], 10);
    const insertParentPath = PathUtils.compile(insertSegments.slice(0, -1));

    if (!PathUtils.isDescendant(effectPath, insertParentPath)) {
      throw new Error(`Effect path ${effectPath} is not descendant of insert parent ${insertParentPath}`);
    }

    const relative = PathUtils.getRelativeSegments(effectPath, insertParentPath);
    const effectIndex = parseInt(relative[0], 10);

    if (effectIndex >= insertIndex) {
      relative[0] = (effectIndex + 1).toString();
    }

    return insertParentPath === ''
      ? '/' + relative.join('/')
      : insertParentPath + '/' + relative.join('/');
  }

  /**
   * Permutes a path when a reorder happens at an ancestor.
   * E.g., reorder at /blocks with [2,0,1], effect path /blocks/0/text -> /blocks/2/text
   */
  private static permutePath(effectPath: string, reorderPath: string, permutation: number[]): string {
    if (!PathUtils.isDescendant(effectPath, reorderPath)) {
      throw new Error(`Effect path ${effectPath} is not descendant of reorder path ${reorderPath}`);
    }

    const relative = PathUtils.getRelativeSegments(effectPath, reorderPath);
    const effectIndex = parseInt(relative[0], 10);

    const newIndex = Permutation.mapIndex(permutation, effectIndex);
    if (newIndex === -1) {
      throw new Error(`Invalid permutation mapping for index ${effectIndex}`);
    }

    relative[0] = newIndex.toString();

    return reorderPath === ''
      ? '/' + relative.join('/')
      : reorderPath + '/' + relative.join('/');
  }

  private static handleSiblingHit(
    userOp: PatchOperation,
    effect: ShiftUpEffect | ShiftDownEffect | PermuteEffect
  ): { op: PatchOperation | null; effect: Effect } {
    const newOp = structuredClone(userOp);
    const newEffect = structuredClone(effect);

    // reorder + shift = reorder_length_mismatch (auto-resolve)
    // Discard user's reorder, accumulate permutation onto effect
    if (userOp.op === 'reorder') {
      if (!userOp.new_order) throw Error(`Invalid user patch: reorder without new_order provided.`);
      if (newEffect.type === 'shift_up' || newEffect.type === 'shift_down') {
        const existingPerm = newEffect.permutation ?? this.identityPermutation(userOp.new_order.length);
        newEffect.permutation = Permutation.compose(existingPerm, userOp.new_order);
        return { op: null, effect: newEffect };
      }
      throw Error(`Unexpected reorder_collision in sibling_hit.`);
    }

    // Normal path transform for shift/permute effects
    if (PathUtils.isDescendant(userOp.path, effect.path)) {
      const segments = PathUtils.getRelativeSegments(userOp.path, effect.path);
      let index = parseInt(segments[0], 10);
      if (isNaN(index)) {
        throw new Error(`Unexpected non-numeric path segment in ${userOp.path}`);
      }

      let newIndex = index;

      // Apply accumulated permutation first (if exists on shift effects)
      if (newEffect.permutation) {
        newIndex = Permutation.mapIndex(newEffect.permutation, index);
        if (newIndex === -1) {
          throw new Error(`Invalid permutation ${newEffect.permutation} applied to ${index}`);
        }
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

    return { op: newOp, effect: newEffect };
  }

  private static resolveConflict(
    userPatch: ExtendedPatch,
    effect: Effect,
    reason: ConflictReason,
    resolution: ResolutionType
  ): TransformResult {
    const userOp = userPatch.operation;

    // --- keep_admin ---
    if (resolution === 'keep_admin') {
      // dead_zone: discard user's edit, effect continues
      if (reason === 'dead_zone') {
        return {
          success: true,
          op: null,
          effect: effect,
          hadConflict: true
        };
      }

      // Reverse Dead Zone: undo user's delete, effect becomes shift_up
      if (reason === 'reverse_dead_zone') {
        const segments = PathUtils.parse(userOp.path);
        const removeIndex = parseInt(segments.pop() || '', 10);
        const parentPath = PathUtils.compile(segments);

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

      // reorder_collision: discard user's reorder, accumulate A⁻¹ * U
      if (reason === 'reorder_collision' && effect.type === 'permute' && userOp.new_order) {
        const newEffect = structuredClone(effect);
        newEffect.permutation = Permutation.compose(effect.permutation, userOp.new_order);
        return {
          success: true,
          op: null,
          effect: newEffect,
          hadConflict: true
        };
      }

      // content_conflict: discard user's edit, effect continues
      if (reason === 'content_conflict') {
        return {
          success: true,
          op: null,
          effect: effect,
          hadConflict: true
        };
      }
    }

    // --- keep_mine ---
    if (resolution === 'keep_mine') {
      // dead_zone: resurrect deleted content with user's edit applied
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

      // Reverse Dead Zone: keep user's delete, effect absorbed
      if (reason === 'reverse_dead_zone') {
        return {
          success: true,
          op: userOp,  // Keep user's remove
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // reorder_collision: transform user's reorder to A⁻¹ * U, effect absorbed
      if (reason === 'reorder_collision' && effect.type === 'permute' && userOp.new_order) {
        const newOp = structuredClone(userOp);
        newOp.new_order = Permutation.compose(effect.permutation, userOp.new_order);
        return {
          success: true,
          op: newOp,
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // content_conflict: update old_value to admin's value, effect absorbed
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
    }

    // Fallback — should not reach here
    throw new Error(`Unexpected resolution: reason=${reason}, resolution=${resolution}, effect=${effect.type}`);
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
