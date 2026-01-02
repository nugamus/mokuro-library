import { FastifyInstance } from 'fastify';
import {
  VolumeResponse,
} from '../../types/library';
import {
  ApplyPatchResponse,
  UndoResponse,
  RedoResponse,
  PatchOperation
} from '../../types/history';
import { IAPIAccessStrategy } from './IAPIAccessStrategy';
import {
  ensureAdminBranch,
  syncSnapshot
} from '../../utils/ocrHelpers';
import { PatchInverter } from '../PatchInverter';

/**
 * Strategy for the Administrator.
 * Acts as the 'Master' branch authority. Logic here assumes direct access to 
 * the 'official' timeline without private forking.
 */
export class AdminAPIAccessStrategy implements IAPIAccessStrategy {
  constructor(private fastify: FastifyInstance) { }

  /**
   * Retrieves a volume for the Admin.
   * Divergence: 
   * 1. Returns the authoritative 'Master' branch state.
   * 2. hasAhead/hasBehind are always false (Admin is the definition of current).
   */
  async getVolume(volumeId: string): Promise<VolumeResponse> {
    const volume = await this.fastify.prisma.volume.findUnique({
      where: { id: volumeId, series: { ownerId: 'admin' } },
      include: {
        // Admin sees their own progress, or could see global stats (implementation choice)
        // Here we just fetch admin's personal progress for consistency.
        progress: {
          where: { userId: 'admin' },
          select: { page: true, completed: true, timeRead: true, charsRead: true }
        }
      }
    });

    if (!volume) {
      throw new Error('Volume not found');
    }

    // 1. Ensure the Master Branch exists
    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);

    // 2. Sync and Load Snapshot
    const { data: mokuroData } = await syncSnapshot(this.fastify, adminBranch);

    return {
      id: volume.id,
      title: volume.title ?? volume.folderName,
      seriesId: volume.seriesId,
      pageCount: volume.pageCount,
      coverImageName: volume.coverImageName,
      progress: volume.progress,
      mokuroData: mokuroData,
      versionInfo: {
        branchId: adminBranch.id,
        headPatchId: adminBranch.headPatchId,
        // Admin is never ahead/behind themselves
        hasAhead: false,
        hasBehind: false,
      }
    };
  }

  /**
     * Applies a patch directly to the Master Branch.
     * Divergence:
     * 1. No "Forking" check - Admin is always the root authority.
     * 2. "Wipe Future": If Admin edits from the past (after undo), the old future is deleted.
     * This maintains a strict single authoritative timeline.
     */
  async applyPatch(
    volumeId: string,
    op: PatchOperation,
    version: number
  ): Promise<ApplyPatchResponse> {
    // 1. Authorization & Setup
    const volume = await this.fastify.prisma.volume.findUnique({
      where: { id: volumeId, series: { ownerId: 'admin' } },
    });
    if (!volume) throw new Error('Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);

    // 2. Optimistic Locking
    if (adminBranch.version !== version) {
      throw new Error('Version mismatch. Please refresh.');
    }

    const headPatchId = adminBranch.headPatchId;
    const snapshotPatchId = adminBranch.snapshotPatchId; // Non-nullable per schema

    const patch = await this.fastify.prisma.patch.findUnique({
      where: { id: headPatchId },
      select: { nextPatchId: true }
    });
    if (!patch) throw Error(`Brand HEAD not found.`);

    // 3. Snapshot Integrity Check
    // If the snapshot is chronologically ahead of the current HEAD (due to previous undos),
    // we must sync the file back to the current HEAD state before writing new changes.
    if (snapshotPatchId > headPatchId) {
      this.fastify.log.info(`[AdminStrategy] Snapshot ahead of HEAD. Syncing back before write.`);
      await syncSnapshot(this.fastify, adminBranch);
    }

    // 4. Transactional Write
    const result = await this.fastify.prisma.$transaction(async (tx) => {

      // Cascade delete will remove all subsequent history
      // We delete nextPatch, not children
      if (patch.nextPatchId) await tx.patch.delete({ where: { id: patch.nextPatchId } });

      // Create the New Patch
      const newPatch = await tx.patch.create({
        data: {
          volumeId,
          userId: 'admin',
          parentId: headPatchId,
          operation: JSON.stringify(op),
        }
      });

      // Maintain 2 way relations
      await tx.patch.update({
        where: { id: headPatchId },
        data: { nextPatchId: newPatch.id }
      });

      // Update Branch Pointers
      const updatedBranch = await tx.ocrBranch.update({
        where: { id: adminBranch.id },
        data: {
          headPatchId: newPatch.id,
          // Root never changes for Admin (it's always Genesis)
          version: { increment: 1 }
        }
      });

      return { newPatch, updatedBranch };
    });

    return {
      success: true,
      newHeadId: result.newPatch.id,
      newVersion: result.updatedBranch.version,
      patch: op
    };
  }

  /**
     * Reverts the Master Branch HEAD.
     * Divergence: Implements "Branch Drag".
     * 1. Checks if any User branches depend on the current Admin HEAD.
     * 2. If Yes: "Drags" the patch into their private history (sets their root to this patch).
     * 3. If No: Hard deletes the patch (rewriting history).
     */
  async undo(volumeId: string, version: number): Promise<UndoResponse> {
    // 1. Authorization & Setup
    const volume = await this.fastify.prisma.volume.findUnique({
      where: { id: volumeId, series: { ownerId: 'admin' } },
    });
    if (!volume) throw new Error('Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);

    // 2. Optimistic Locking
    if (adminBranch.version !== version) {
      throw new Error('Version mismatch. Please refresh.');
    }

    const currentHeadId = adminBranch.headPatchId;
    const currentPatch = await this.fastify.prisma.patch.findUnique({
      where: { id: currentHeadId },
      include: {
        children: {
          select: {
            id: true,
            asRootOf: { select: { id: true } }
          }
        }
      }
    });

    if (!currentPatch) throw Error(`HEAD patch not found.`);
    if (!currentPatch.parentId) throw new Error('Cannot undo: Reached start of history.');

    const parentId = currentPatch.parentId;
    const inversePatch = PatchInverter.invert(JSON.parse(currentPatch.operation) as PatchOperation);

    // 3. Dependency Check ("In the Way")
    // Check for direct Head dependents or Root dependents (forks)
    const rootDependents = currentPatch.children.map(p => p.asRootOf[0]);
    const headDependents = await this.fastify.prisma.ocrBranch.findMany({
      where: { headPatchId: currentHeadId, rootPatchId: null, userId: { not: 'admin' } },
      select: { id: true }
    });


    let dependentId: string | undefined;
    if (headDependents.length + rootDependents.length > 1) throw Error(`Cannot undo: too many dependents, history solidified.`);
    if (headDependents.length === 1) {
      dependentId = headDependents[0].id;
    }
    if (rootDependents.length === 1) {
      dependentId = headDependents[0].id;
    }

    // TODO: optimize, for now sync to preserve data integrity
    await syncSnapshot(this.fastify, adminBranch, parentId);

    // 4. Transactional Updates (Database Only)
    await this.fastify.prisma.$transaction(async (tx) => {
      // Move Admin Pointer Back
      await tx.ocrBranch.update({
        where: { id: adminBranch.id },
        data: {
          headPatchId: parentId,
          version: { increment: 1 }
        }
      });

      // break doubly linked list relationship
      await tx.patch.update({
        where: { id: parentId },
        data: { nextPatchId: null }
      });

      if (dependentId) {
        // let the user branch claim the patch if exists
        await tx.ocrBranch.update({
          where: { id: dependentId },
          data: { rootPatchId: currentHeadId }
        });
      } else {
        // delete if no one claims it
        await tx.patch.delete({
          where: { id: currentHeadId }
        });
      }
    });

    return {
      success: true,
      newHeadId: parentId,
      newVersion: adminBranch.version + 1,
      patch: inversePatch
    };
  }
  async redo(volumeId: string, version: number): Promise<RedoResponse> {
    throw new Error('Redo is not available for the Admin timeline. Admin edits are destructive.');
  }

  async reset(volumeId: string): Promise<void> {
    throw new Error('Reset is not applicable to the Admin. The Admin is the source of truth.');
  }

  async submitVolumes(volumeIds: string[], targetSeriesId?: string): Promise<void> { throw new Error('Pending'); }
  async acceptSubmission(submissionId: string): Promise<void> { throw new Error('Pending'); }
  async rejectSubmission(submissionId: string, reason?: string): Promise<void> { throw new Error('Pending'); }
}
