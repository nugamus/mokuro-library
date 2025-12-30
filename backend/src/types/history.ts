import { Quad, Rect } from './mokuro';

// --- 1. Value Types ---

// Fine Values: Used for 'replace' operations on leaf nodes.
export type FineValue =
  | string  // For text content
  | boolean // For 'vertical' flag
  | number  // For 'font_size'
  | Rect    // For block 'box'
  | Quad;   // For line 'coords'

// --- 2. Coarse / Unified Values ---

// UnifiedLine: Merges the split arrays (lines + lines_coords) into one atomic unit.
export interface UnifiedLine {
  text: string;
  coords: Quad;
}

// UnifiedBlock: Represents a full block structure.
export interface UnifiedBlock {
  box: Rect;
  vertical: boolean;
  font_size?: number;
  lines: UnifiedLine[];
}

export type PatchValue = FineValue | UnifiedBlock | UnifiedLine;

// --- 3. The Patch Operation ---
export type OpType = 'replace' | 'add' | 'remove' | 'reorder_lines' | 'reorder_blocks';

export type PatchOperation = {
  op: OpType;
  path: string; // JSON Pointer
  value?: PatchValue;
  old_value?: PatchValue;
  new_order?: number[];
}

// --- 4. Network Payload Types ---

export interface ApplyPatchRequest {
  operations: Omit<PatchOperation, 'id'>[];
  parent_id: string;
}

export interface ApplyPatchResponse {
  success: boolean;
  new_version_id: string;
}

export interface UndoResponse {
  success: boolean;
  new_version_id: string;
  prev_version_id: string | null;
  next_version_id: string | null;
  inverse_patch: PatchOperation;
}

export interface RedoResponse {
  success: boolean;
  new_version_id: string;
  prev_version_id: string | null;
  next_version_id: string | null;
  patch: PatchOperation;
}

export interface VolumeStateResponse {
  version_id: string;
  prev_version_id: string | null;
  next_version_id: string | null;
  data: import('./mokuro').MokuroData; // Lazy import or explicit import at top
}
