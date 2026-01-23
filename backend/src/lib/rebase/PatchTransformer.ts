import { CoarseValue, PatchOperation } from '../../types/history';
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
import { EffectUtilities } from './Effect';
import { PatchApplicator } from '../PatchApplicator';
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

    // --- 4a. Collateral Ancestor Hit: Structural effect, patch inside affected array ---
    if (relation === 'collateral_ancestor_hit') {
      const { op: newOp, effect: newEffect } = this.handleCollateralAncestorHit(userOp, effect as ShiftUpEffect | ShiftDownEffect | PermuteEffect);
      return { success: true, op: newOp, effect: newEffect, hadConflict: false };
    }

    // --- 4b. Collateral Descendant Hit: Content effect, structural patch shifts effect path ---
    if (relation === 'collateral_descendant_hit') {
      const { op: newOp, effect: newEffect } = this.handleCollateralDescendantHit(userOp, effect);
      return { success: true, op: newOp, effect: newEffect, hadConflict: false };
    }

    // --- 4c. Sibling Hit: Both structural, same array level ---
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
  ): 'no_hit' | 'collateral_ancestor_hit' | 'collateral_descendant_hit' | 'sibling_hit' | 'direct_hit' | 'ancestor_hit' | 'descendant_hit' {

    if (effect.type === 'identity') return 'no_hit';

    // For shift effects, compute the affected item path
    // If permutation exists, inverse map the index first
    let affectedPath: string;
    if (effect.type === 'shift_down' || effect.type === 'shift_up') {
      let index = effect.index;
      affectedPath = `${effect.path}/${index}`;
    } else if (effect.type === 'permute') {
      affectedPath = `${effect.path}/-1`;
    } else {
      affectedPath = effect.path;
    }

    const userPath = userOp.op === 'reorder' ? `${userOp.path}/-1` : userOp.path;

    // shift_up can only hit gaps (i.e. sibling_hit or descendant_hit)
    if (effect.type !== 'shift_up') {
      // Direct hit: same path
      if (userPath === affectedPath) return 'direct_hit';

      // Ancestor hit: user path is inside affected path
      if (PathUtils.isDescendant(userPath, affectedPath)) return 'ancestor_hit';
    }

    // Descendant hit: affected path is inside user path
    if (PathUtils.isDescendant(affectedPath, userPath)) return 'descendant_hit';


    // Structural effect
    if (effect.type === 'shift_up' || effect.type === 'shift_down' || effect.type === 'permute') {
      const arrayPath = effect.path;
      if (PathUtils.isDescendant(userPath, arrayPath)) {
        const relative = PathUtils.getRelativeSegments(userPath, arrayPath);
        const userIndex = parseInt(relative[0], 10);
        if (isNaN(userIndex)) {
          throw new Error(`Unexpected non-numeric path segment in ${userPath}`);
        }

        if (relative.length === 1 && (userOp.op === 'add' || userOp.op === 'remove' || userOp.op === 'reorder')) return 'sibling_hit';
        return 'collateral_ancestor_hit';
      }
    }

    // Structural Patch
    if (userOp.op === 'add' || userOp.op === 'remove' || userOp.op === 'reorder') {
      const arrayPath = PathUtils.compile(PathUtils.parse(userPath).slice(0, -1));
      if (PathUtils.isDescendant(affectedPath, arrayPath)) {
        const relative = PathUtils.getRelativeSegments(affectedPath, arrayPath);
        const effectIndex = parseInt(relative[0], 10);
        if (isNaN(effectIndex)) {
          throw new Error(`Unexpected non-numeric path segment in ${affectedPath}`);
        }
        return 'collateral_descendant_hit';
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
   * Shifts a path down when a remove happens.
   * E.g., remove at /blocks/1, effect path /blocks/2/text -> /blocks/1/text
   */
  private static shiftPathDown(effectPath: string, removePath: string): string {
    const removeSegments = PathUtils.parse(removePath);
    const removeIndex = parseInt(removeSegments[removeSegments.length - 1], 10);
    const removeParentPath = PathUtils.compile(removeSegments.slice(0, -1));

    if (!PathUtils.isDescendant(effectPath, removeParentPath)) {
      throw new Error(`Effect path ${effectPath} is not descendant of remove parent ${removeParentPath}`);
    }

    const relative = PathUtils.getRelativeSegments(effectPath, removeParentPath);
    const effectIndex = parseInt(relative[0], 10);

    if (effectIndex > removeIndex) {
      relative[0] = (effectIndex - 1).toString();
    }

    return removeParentPath === ''
      ? '/' + relative.join('/')
      : removeParentPath + '/' + relative.join('/');
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

  /**
   * Handles collateral_ancestor_hit: structural effect affects an array,
   * patch operates inside that array (but not at the same level).
   * Transforms the patch's path.
   */
  private static handleCollateralAncestorHit(
    userOp: PatchOperation,
    effect: ShiftUpEffect | ShiftDownEffect | PermuteEffect
  ): { op: PatchOperation | null; effect: Effect } {
    const newOp = structuredClone(userOp);
    const newEffect = structuredClone(effect);

    if (PathUtils.isDescendant(userOp.path, effect.path)) {
      const segments = PathUtils.getRelativeSegments(userOp.path, effect.path);
      const index = parseInt(segments[0], 10);
      if (isNaN(index)) {
        throw new Error(`Unexpected non-numeric path segment in ${userOp.path}`);
      }

      let newIndex = index;

      // Then apply shift
      if (effect.type === 'shift_up') {
        if (newIndex >= effect.index) newIndex = newIndex + 1;
      } else if (effect.type === 'shift_down') {
        if (newIndex > effect.index) newIndex = newIndex - 1;
      } else if (effect.type === 'permute') {
        newIndex = Permutation.mapIndex(effect.permutation, newIndex);
      }

      if (newIndex !== index) {
        segments[0] = newIndex.toString();
        const prefix = effect.path === '/' ? '' : effect.path;
        newOp.path = prefix + '/' + segments.join('/');
      }
    }

    return { op: newOp, effect: newEffect };
  }

  /**
   * Handles collateral_descendant_hit: content/structural effect,
   * structural patch operates on an array that contains the effect path.
   * Transforms the effect's path.
   */
  private static handleCollateralDescendantHit(
    userOp: PatchOperation,
    effect: Effect
  ): { op: PatchOperation; effect: Effect } {
    const newEffect = structuredClone(effect);

    const userPath = userOp.path;
    const userSegments = PathUtils.parse(userPath);
    const userIndex = parseInt(userSegments[userSegments.length - 1], 10);
    const arrayPath = PathUtils.compile(userSegments.slice(0, -1));

    const relative = PathUtils.getRelativeSegments(newEffect.path, arrayPath);
    const effectIndex = parseInt(relative[0], 10);

    let newIndex = effectIndex;

    if (userOp.op === 'add') {
      if (effectIndex >= userIndex) newIndex = effectIndex + 1;
    } else if (userOp.op === 'remove') {
      if (effectIndex > userIndex) newIndex = effectIndex - 1;
    } else if (userOp.op === 'reorder' && userOp.new_order) {
      newIndex = Permutation.mapIndex(userOp.new_order, effectIndex);
    }

    if (newIndex !== effectIndex) {
      relative[0] = newIndex.toString();
      newEffect.path = arrayPath === ''
        ? '/' + relative.join('/')
        : arrayPath + '/' + relative.join('/');
    }

    return { op: userOp, effect: newEffect };
  }

  /**
   * Handles sibling_hit: both effect and patch are structural,
   * operating on the same array at the same level.
   */
  private static handleSiblingHit(
    userOp: PatchOperation,
    effect: ShiftUpEffect | ShiftDownEffect | PermuteEffect
  ): { op: PatchOperation | null; effect: Effect } {
    const newOp = structuredClone(userOp);
    const newEffect = structuredClone(effect);

    // --- User reorder + shift effect = discard reorder, accumulate permutation ---
    if (userOp.op === 'reorder') {
      if (newEffect.type === 'shift_up' && effect.type === 'shift_up') {
        // Expand user's reorder to account for the added element
        newOp.new_order = Permutation.expandPermutation(userOp.new_order, effect.index);
        newEffect.index = Permutation.mapIndex(newOp.new_order, effect.index);
        return { op: newOp, effect: newEffect };
      }
      if (newEffect.type === 'shift_down' && effect.type === 'shift_down') {
        // Shrink user's reorder to account for the removed element
        newEffect.index = Permutation.mapIndex(userOp.new_order, effect.index);
        newOp.new_order = Permutation.shrinkPermutation(userOp.new_order, effect.index);
        return { op: newOp, effect: newEffect };
      }
      throw new Error(`Unexpected reorder in sibling_hit with permute effect (should be direct_hit).`);
    }

    const userSegments = PathUtils.parse(userOp.path);
    const userIndex = parseInt(userSegments[userSegments.length - 1], 10);
    if (isNaN(userIndex)) throw new Error(`Unexpected non-numeric path segment in ${userOp.path}`);

    // --- User add/remove + shift/permute effect ---
    if (userOp.op === 'add') {
      // Transform user's add path
      let newIndex = userIndex;

      if (effect.type === 'shift_up') {
        if (newIndex >= effect.index) newIndex = newIndex + 1;
      } else if (effect.type === 'shift_down') {
        if (newIndex > effect.index) newIndex = newIndex - 1;
        // Equality would imply a direct_hit per checkIntersection.
        if (newIndex === effect.index) throw new Error(`Unexpected index equivalence: should be caught by direct_hit`);
      } else if (effect.type === 'permute' && newEffect.type === 'permute') {
        const expanded = Permutation.expandPermutation(effect.permutation, userIndex)
        newIndex = Permutation.mapIndex(expanded, userIndex);
        newEffect.permutation = expanded;
      }


      if (newIndex !== userIndex) {
        userSegments[userSegments.length - 1] = newIndex.toString();
        newOp.path = PathUtils.compile(userSegments);
      }

      // User's add also affects the effect
      if (newEffect.type === 'shift_up' || newEffect.type === 'shift_down') {
        if (newIndex < newEffect.index) {
          newEffect.index = newEffect.index + 1;
        }
      }

      return { op: newOp, effect: newEffect };
    }

    if (userOp.op === 'remove') {
      // Transform user's remove path
      let newIndex = userIndex;

      if (effect.type === 'shift_up') {
        if (newIndex >= effect.index) newIndex = newIndex + 1;
      } else if (effect.type === 'shift_down') {
        if (newIndex > effect.index) newIndex = newIndex - 1;
        // Equality would imply a direct_hit per checkIntersection.
        if (newIndex === effect.index) throw new Error(`Unexpected index equivalence: should be caught by direct_hit`);
      } else if (effect.type === 'permute' && newEffect.type === 'permute') {
        const shrunk = Permutation.shrinkPermutation(effect.permutation, userIndex)
        newIndex = Permutation.mapIndex(effect.permutation, userIndex);
        newEffect.permutation = shrunk;
      }


      if (newIndex !== userIndex) {
        userSegments[userSegments.length - 1] = newIndex.toString();
        newOp.path = PathUtils.compile(userSegments);
      }

      // User's remove also affects the effect
      if (newEffect.type === 'shift_up' || newEffect.type === 'shift_down') {
        if (newIndex < newEffect.index) {
          newEffect.index = newEffect.index - 1;
        }
      }

      return { op: newOp, effect: newEffect };
    }

    throw new Error(`Unexpected sibling_hit: userOp=${userOp.op}, effect=${effect.type}`);
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
        if (userOp.op !== 'remove') throw new Error(`reverse_dead_zone can only occur if userOp type is 'remove'`);

        const segments = PathUtils.parse(userOp.path);
        const removeIndex = parseInt(segments.pop() || '', 10);
        const parentPath = PathUtils.compile(segments);

        return {
          success: true,
          op: null,  // Discard user's remove
          effect: {
            type: 'shift_up',
            path: parentPath,
            index: removeIndex,
            newValue: userOp.old_value
          },
          hadConflict: true
        };
      }

      // reorder_collision: discard user's reorder, accumulate A⁻¹ * U
      if (reason === 'reorder_collision' && effect.type === 'permute' && userOp.op === 'reorder') {
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

      // Reverse Dead Zone: keep user's delete, update old_value to reflect effect, effect absorbed
      if (reason === 'reverse_dead_zone') {
        if (userOp.op !== 'remove') throw new Error(`reverse_dead_zone can only occur if userOp type is 'remove'`);
        const newOp = structuredClone(userOp);
        const effectOp = EffectUtilities.toOperation(effect);

        if (effectOp) {
          const relativeSegments = PathUtils.getRelativeSegments(effectOp.path, userOp.path);
          if (relativeSegments.length > 0) {
            // Effect is inside the removed item - apply the change to old_value
            this.applyLocalChange(newOp.old_value, relativeSegments, effectOp);
          }
        }


        return {
          success: true,
          op: newOp,
          effect: { type: 'identity', path: '/' },
          hadConflict: true
        };
      }

      // reorder_collision: transform user's reorder to A⁻¹ * U, effect absorbed
      if (reason === 'reorder_collision' && effect.type === 'permute' && userOp.op === 'reorder') {
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
      if (reason === 'content_conflict' && effect.type === 'content' && userOp.op === 'replace') {
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

  private static applyLocalChange(root: CoarseValue, segments: string[], op: PatchOperation): void {
    if (segments.length === 0) return;

    const targetKey = segments[segments.length - 1];
    const parentSegments = segments.slice(0, -1);

    const asObject = (value: unknown): Record<string, unknown> | null =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

    let ptr: unknown = root;
    for (const seg of parentSegments) {
      if (Array.isArray(ptr)) {
        const idx = parseInt(seg, 10);
        if (isNaN(idx)) throw new Error(`Invalid array index segment: ${seg}`);
        if (ptr[idx] === undefined) throw new Error(`Missing array element at index ${idx}`);
        ptr = ptr[idx];
        continue;
      }

      const obj = asObject(ptr);
      if (!obj) throw new Error(`Cannot traverse non-object path segment: ${seg}`);
      if (obj[seg] === undefined) throw new Error(`Missing object key: ${seg}`);
      ptr = obj[seg];
    }

    if (Array.isArray(ptr)) {
      if (op.op === 'replace') {
        throw new Error(`Cannot replace array elements directly`);
      }
      if (op.op === 'add') {
        PatchApplicator.insertAt(ptr, targetKey, op.value, 'array');
        return;
      }
      if (op.op === 'remove') {
        PatchApplicator.removeAt(ptr, targetKey, 'array');
        return;
      }
    }

    const obj = asObject(ptr);
    if (!obj) throw new Error(`Cannot apply op to non-object target: ${targetKey}`);

    if (op.op === 'replace') {
      obj[targetKey] = op.value;
      return;
    }
    if (op.op === 'add') {
      throw new Error(`Cannot add on object target: ${targetKey}`);
    }
    if (op.op === 'remove') {
      throw new Error(`Cannot remove on object target: ${targetKey}`);
    }
    if (op.op === 'reorder') {
      const arr = obj[targetKey];
      if (!Array.isArray(arr)) {
        throw new Error(`Cannot reorder on non-array target: ${targetKey}`);
      }
      if (arr.length !== op.new_order.length) {
        throw new Error(`Reorder length mismatch: new_order has ${op.new_order.length} elements, but array has ${arr.length} items`);
      }
      PatchApplicator.reorderArray(arr, op.new_order);
      return;
    }
  }
}
