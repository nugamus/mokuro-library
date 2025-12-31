import { PatchOperation } from './history';

// --- 0. Extended Patch (Database + Content) ---

export interface ExtendedPatch {
  id: string;
  parentId: string | null;
  operation: PatchOperation;
}

// --- 1. Effects (The Wave) ---

export type EffectType =
  | 'identity'
  | 'shift_down'
  | 'shift_up'
  | 'permute'
  | 'content';

export interface BaseEffect {
  type: EffectType;
  path: string;
}

export interface IdentityEffect extends BaseEffect {
  type: 'identity';
}

export interface ShiftDownEffect extends BaseEffect {
  type: 'shift_down';
  index: number;
  deletedValue: any;
  permutation?: number[];  // Accumulated from skipped reorders
}

export interface ShiftUpEffect extends BaseEffect {
  type: 'shift_up';
  index: number;
  permutation?: number[];  // Accumulated from skipped reorders
}

export interface PermuteEffect extends BaseEffect {
  type: 'permute';
  permutation: number[];  // Stored as A⁻¹
}

export interface ContentEffect extends BaseEffect {
  type: 'content';
  newValue: any;
}

export type Effect =
  | IdentityEffect
  | ShiftDownEffect
  | ShiftUpEffect
  | PermuteEffect
  | ContentEffect;

// --- 2. Conflicts & Resolutions ---

export type ConflictReason =
  | 'dead_zone'
  | 'double_delete'
  | 'reorder_collision'
  | 'content_conflict'
  | 'reorder_length_mismatch';

export interface Conflict {
  reason: ConflictReason;
  path: string;
  userPatch: ExtendedPatch;
  adminPatch: ExtendedPatch;
}

export type ResolutionType = 'keep_admin' | 'keep_mine' | 'resurrect';

export interface Resolution {
  adminPatchId: string;
  patchId: string;
  resolution: ResolutionType;
}

// --- 3. Engine Output ---

export type TransformResult = {
  success: true;
  op: PatchOperation | null;
  effect: Effect;
  hadConflict: boolean;
} | {
  success: false;
  conflict: Conflict;
};

export type RebaseResult = {
  status: 'complete';
  finalPatches?: PatchOperation[];
} | {
  status: 'paused';
  rebaseId: string;
  conflict: Conflict;
};
