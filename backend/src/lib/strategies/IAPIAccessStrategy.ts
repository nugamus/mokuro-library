// backend/src/lib/strategies/IAPIAccessStrategy.ts

import { VolumeResponse } from '../../types/library';
import {
  ApplyPatchResponse,
  UndoResponse,
  RedoResponse,
  PatchOperation
} from '../../types/history';
import { MokuroData } from '../../types/mokuro';
import { OcrBranch } from '../../generated/prisma/client';

export interface IAPIAccessStrategy {
  // --- Volume State ---
  /**
   * Admin: Returns Master state (hasAhead/hasBehind = false).
   * User: Returns Private/Hybrid state with status flags.
   */
  getVolume(volumeId: string): Promise<VolumeResponse>;

  // --- OCR Versioning ---
  applyPatch(volumeId: string, op: PatchOperation, version: number): Promise<ApplyPatchResponse>;
  undo(volumeId: string, version: number): Promise<UndoResponse>;

  /**
   * Admin: Throws 400 Bad Request (Redo disabled for Master).
   */
  redo(volumeId: string, version: number): Promise<RedoResponse>;

  /**
   * Admin: Throws 403 Forbidden (Reset disabled for Admin).
   */
  reset(volumeId: string): Promise<void>;

  /**
   * Manual trigger to regenerate the .mokuro cache file.
   */
  createSnapshot(volumeId: string): Promise<{ data: MokuroData, branch: OcrBranch }>;

  // --- Submission Lifecycle ---
  /**
   * User: Submits private volumes to Admin.
   * Admin: Throws 403 (Admin cannot submit to self).
   */
  submitVolumes(volumeIds: string[], targetSeriesId?: string): Promise<void>;

  /**
   * Admin: Executes file move and ownership transfer.
   * User: Throws 403 (Unauthorized moderation).
   */
  acceptSubmission(submissionId: string): Promise<void>;

  rejectSubmission(submissionId: string, reason?: string): Promise<void>;

  // --- Admin Advanced Features ---
  /**
   * Admin: Fast-forward merge a user's branch into master.
   * User: Throws 403.
   */
  merge(volumeId: string, sourceUserId: string): Promise<void>;

  /**
   * Admin: Non-destructive undo (inverse patch).
   * User: Throws 403.
   */
  revert(volumeId: string, patchId: string): Promise<void>;
}
