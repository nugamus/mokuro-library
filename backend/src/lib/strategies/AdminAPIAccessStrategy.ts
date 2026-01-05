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
  loadSnapshot,
  saveSnapshot,
  syncSnapshot
} from '../../utils/ocrHelpers';
import { PatchInverter } from '../PatchInverter';
import fs from 'fs';
import path from 'path';
import { MokuroData } from '../../types/mokuro';
import { OcrBranch } from '../../generated/prisma/client';
import {
  validateAndPlanSubmission,
  executeMovePlan,
  revertMoves
} from '../../utils/submissionHelper';
import { HttpError } from '../../types/error';

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

    const cacheKey = `volume:${volumeId}`;
    const volume = await this.fastify.prisma.findCached(
      'admin',
      cacheKey,
      ["volume:.:shared", "userprogress:progress:private"],
      async () => {
        return await this.fastify.prisma.volume.findUnique({
          where: { id: volumeId, series: { ownerId: 'admin' } },
          include: {
            // Admin sees their own progress, or could see global stats (implementation choice)
            // Here we just fetch admin's personal progress for consistency.
            progress: {
              where: { userId: 'admin' },
              select: {
                id: true,
                page: true,
                completed: true,
                timeRead: true,
                charsRead: true,
                lastReadAt: true,
                userId: true,
                volumeId: true
              }
            }
          }
        });
      }
    );

    if (!volume) {
      throw new HttpError(404, 'Volume not found');
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
    if (!volume) throw new HttpError(404, 'Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);

    // 2. Optimistic Locking
    if (adminBranch.version !== version) {
      throw new HttpError(409, 'Version mismatch. Please refresh.');
    }

    const headPatchId = adminBranch.headPatchId;
    const snapshotPatchId = adminBranch.snapshotPatchId; // Non-nullable per schema

    const patch = await this.fastify.prisma.patch.findUnique({
      where: { id: headPatchId },
      select: { nextPatchId: true }
    });
    if (!patch) throw new HttpError(500, 'Branch HEAD patch not found.');

    // 3. Snapshot Integrity Check
    // If the snapshot is chronologically ahead of the current HEAD (due to previous undos),
    // we must sync the file back to the current HEAD state before writing new changes.
    if (snapshotPatchId > headPatchId) {
      this.fastify.log.info(`[AdminStrategy] Snapshot ahead of HEAD. Syncing back before write.`);
      await syncSnapshot(this.fastify, adminBranch);
    }

    // 4. Transactional Write
    const result = await this.fastify.prisma.$transaction(async (tx: any) => {

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
    if (!volume) throw new HttpError(404, 'Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);

    // 2. Optimistic Locking
    if (adminBranch.version !== version) {
      throw new HttpError(409, 'Version mismatch. Please refresh.');
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

    if (!currentPatch) throw new HttpError(500, 'HEAD patch not found.');
    if (!currentPatch.parentId) throw new HttpError(400, 'Cannot undo: Reached start of history.');

    const newHeadId = currentPatch.parentId;
    const inversePatch = PatchInverter.invert(JSON.parse(currentPatch.operation) as PatchOperation);

    // 3. Dependency Check ("In the Way")
    // Check for direct Head dependents or Root dependents (forks)
    const danglingChild = currentPatch.children.find((p) => p.id === currentPatch.nextPatchId);
    const rootDependents = currentPatch.children
      .map((p) => p.asRootOf[0])
      .filter(Boolean);
    const headDependents = await this.fastify.prisma.ocrBranch.findMany({
      where: { headPatchId: currentHeadId, rootPatchId: null, userId: { not: 'admin' } },
      select: { id: true }
    });


    let dependentId: string | undefined;
    if (headDependents.length + rootDependents.length > 1) {
      throw new HttpError(409, 'Cannot undo: too many dependents, history solidified.');
    }
    if (headDependents.length === 1) {
      dependentId = headDependents[0].id;
    }
    if (rootDependents.length === 1) {
      dependentId = rootDependents[0].id;
    }

    // 4. Transactional Updates (Database Only)
    const patchClone = await this.fastify.prisma.$transaction(async (tx) => {
      // Move Admin Pointer Back
      await tx.ocrBranch.update({
        where: { id: adminBranch.id },
        data: {
          headPatchId: newHeadId,
          version: { increment: 1 }
        }
      });

      let patchClone;
      if (dependentId) {
        // let the user branch claim the original patch
        await tx.ocrBranch.update({
          where: { id: dependentId },
          data: { rootPatchId: currentHeadId }
        });

        // break doubly linked list relation for new root
        await tx.patch.update({
          where: { id: currentPatch.id },
          data: {
            nextPatchId: null
          }
        })

        // Since the dangling patches are effectively trash,
        // we don't have to worry about strict time-id ordering here
        // only snapshotPatchId has to be valid time-wise
        patchClone = await tx.patch.create({
          data: {
            volumeId,
            userId: 'admin',
            parentId: newHeadId,
            nextPatchId: danglingChild?.id,
            operation: currentPatch.operation,
          }
        });


        // point new HEAD's nextPatchId to clone
        await tx.patch.update({
          where: { id: newHeadId },
          data: { nextPatchId: patchClone.id }
        });

        // point old
        if (danglingChild) {
          await tx.patch.update({
            where: { id: danglingChild.id },
            data: { parentId: patchClone.id }
          })
        }
      }

      return patchClone;
    });

    if (patchClone && adminBranch.snapshotPatchId === currentHeadId) {
      try {
        let data = await loadSnapshot(this.fastify, adminBranch);
        data.patch_id = patchClone.id;
        await saveSnapshot(this.fastify, adminBranch.id, data, patchClone.id);
      } catch (e) {
        this.fastify.log.warn(`Snapshot adjustment failed, future sync might take longer. ${e}`)
      }
    }

    return {
      success: true,
      newHeadId: newHeadId,
      newVersion: adminBranch.version + 1,
      patch: inversePatch
    };
  }

  async redo(volumeId: string, version: number): Promise<RedoResponse> {
    throw new HttpError(405, 'Redo is not available for the Admin timeline. Admin edits are destructive.');
  }

  async reset(volumeId: string): Promise<void> {
    throw new HttpError(405, 'Reset is not applicable to the Admin. The Admin is the source of truth.');
  }

  /**
   * Force regenerate snapshot for the admin branch.
   */
  async createSnapshot(volumeId: string): Promise<{ data: MokuroData, branch: OcrBranch }> {
    const volume = await this.fastify.prisma.volume.findFirst({
      where: {
        id: volumeId,
        series: { ownerId: 'admin' }
      },
      select: { mokuroPath: true }
    });
    if (!volume) throw new Error('Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    return await syncSnapshot(this.fastify, adminBranch);
  }

  async submitVolumes(volumeIds: string[], targetSeriesId?: string): Promise<void> {
    throw new HttpError(400, 'Admins cannot submit volumes.');
  }

  /**
   * Accepts a submission, moving files and transferring ownership.
   * Performs a full check pass before executing any file operations.
   */
  async acceptSubmission(submissionId: string): Promise<void> {
    const submission = await this.fastify.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        volumes: { include: { series: true } },
        sourceSeries: true,
        targetSeries: true
      }
    });

    if (!submission) throw new HttpError(404, 'Submission not found');
    if (submission.status !== 'pending') throw new HttpError(400, 'Submission is not pending');
    if (submission.volumes.length === 0) throw new HttpError(400, 'Submission has no volumes');

    // 1. VALIDATION & PLANNING
    const plan = await validateAndPlanSubmission(
      this.fastify,
      submission.targetSeriesId,
      submission.sourceSeries,
      submission.volumes
    );

    const projectRoot = this.fastify.projectRoot;

    // Track IO operations for Rollback
    let newCoverPathAbs: string | null = null;
    let coverCopied = false;

    // 2. IO EXECUTION (Files First)
    try {
      // A. Copy Series Cover (if new)
      if (plan.newSeriesData && plan.newSeriesData.coverPath) {
        const oldCoverAbs = path.join(projectRoot, plan.newSeriesData.coverPath);
        const newCoverRel = path.join('uploads', 'admin', plan.targetSeriesFolder, path.basename(plan.newSeriesData.coverPath)).replace(/\\/g, '/');
        newCoverPathAbs = path.join(projectRoot, newCoverRel);

        await fs.promises.mkdir(path.dirname(newCoverPathAbs), { recursive: true });
        await fs.promises.copyFile(oldCoverAbs, newCoverPathAbs);
        coverCopied = true;

        // Update plan with the resolved path for DB
        plan.newSeriesData.coverPath = newCoverRel;
      }

      // B. Move Volumes (Rename)
      // This helper handles its own internal partial rollback if it fails
      await executeMovePlan(this.fastify, plan.volumeMoves);

    } catch (ioError) {
      this.fastify.log.error(`IO Failure during submission accept. Rolling back... ${ioError}`);

      // Rollback Cover
      if (coverCopied && newCoverPathAbs) {
        try { await fs.promises.unlink(newCoverPathAbs); } catch (e) { /* ignore */ }
      }

      // Volumes are auto-rolled back by executeMovePlan if it throws,
      // but if Cover copy threw, volumes wouldn't have moved yet.
      throw ioError;
    }

    // 3. DB EXECUTION (Transaction)
    try {
      await this.fastify.prisma.$transaction(async (tx) => {
        let finalTargetSeriesId = plan.targetSeriesId;

        // A. Create Series (Inside Transaction)
        if (!finalTargetSeriesId && plan.newSeriesData) {
          const newSeries = await tx.series.create({
            data: {
              ownerId: 'admin',
              folderName: plan.newSeriesData.folderName,
              title: plan.newSeriesData.title,
              description: plan.newSeriesData.description,
              sortTitle: plan.newSeriesData.sortTitle,
              coverPath: plan.newSeriesData.coverPath // Path verified by IO step above
            }
          });
          finalTargetSeriesId = newSeries.id;
        }

        if (!finalTargetSeriesId) throw new HttpError(500, "Logic Error: Failed to determine target series ID");

        // B. Update Volumes
        for (const move of plan.volumeMoves) {
          await tx.volume.update({
            where: { id: move.volumeId },
            data: {
              seriesId: finalTargetSeriesId,
              filePath: move.newPathRel,
              mokuroPath: move.newMokuroRel
            }
          });

          // Update Genesis Patch Path
          const genesisPatch = await tx.patch.findFirst({
            where: { volumeId: move.volumeId, parentId: null }
          });

          if (genesisPatch) {
            const op = JSON.parse(genesisPatch.operation);
            if (op.op === 'genesis') {
              op.path = move.newMokuroRel;
              await tx.patch.update({
                where: { id: genesisPatch.id },
                data: { operation: JSON.stringify(op) }
              });
            }
          }
        }

        // C. Update Submission
        await tx.submission.update({
          where: { id: submissionId },
          data: {
            status: 'accepted',
            reviewedAt: new Date(),
            targetSeriesId: finalTargetSeriesId
          }
        });
      });

    } catch (dbError) {
      // 4. POST-DB ROLLBACK
      // The DB failed, so we must manually revert the files on disk to match the pre-transaction state.
      this.fastify.log.error(`DB Transaction failed. Reverting file system... Error: ${dbError}`);

      // Revert Volumes
      await revertMoves(this.fastify, plan.volumeMoves);

      // Revert Cover
      if (coverCopied && newCoverPathAbs) {
        try { await fs.promises.unlink(newCoverPathAbs); } catch (e) {
          this.fastify.log.error(`Failed to delete orphaned cover: ${newCoverPathAbs}`);
        }
      }

      throw dbError;
    }
  }

  async rejectSubmission(submissionId: string, reason?: string): Promise<void> {
    await this.fastify.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewNote: reason
      }
    });
  }

  async merge(volumeId: string, sourceUserId: string): Promise<void> {
    throw new Error('Pending Implementation: Fast-forward merge');
  }

  async revert(volumeId: string, patchId: string): Promise<void> {
    throw new Error('Pending Implementation: Revert');
  }
}
