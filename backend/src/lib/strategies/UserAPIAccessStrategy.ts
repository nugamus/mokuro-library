import { FastifyInstance } from 'fastify';
import { VolumeResponse } from '../../types/library';
import {
  ApplyPatchResponse,
  UndoResponse,
  RedoResponse,
  PatchOperation
} from '../../types/history';
import { IAPIAccessStrategy } from './IAPIAccessStrategy';
import {
  ensureAdminBranch,
  ensureUserBranch,
  inheritAdminSnapshot,
  syncSnapshot
} from '../../utils/ocrHelpers';
import { PatchInverter } from '../PatchInverter';
import { MokuroData } from '../../types/mokuro';
import { OcrBranch } from '../../generated/prisma/client';
import { validateAndPlanSubmission } from '../../utils/submissionHelper';
import { HttpError } from '../../types/error';

/**
 * Strategy for standard users.
 * Implements private branching, hybrid library visibility, and "Fork-on-Write" OCR.
 */
export class UserAPIAccessStrategy implements IAPIAccessStrategy {
  /**
   * Storing the FastifyInstance as a field allows the strategy to access
   * prisma, logging, and the project root consistently.
   */
  constructor(
    private fastify: FastifyInstance,
    private userId: string
  ) { }

  /**
   * Retrieves a volume with user-specific divergent state.
   * This is a "Hybrid" read: it merges official data with private edits.
   */
  async getVolume(volumeId: string): Promise<VolumeResponse> {
    // 1. Fetch volume with ownership check (Private OR Admin-owned)
    const cacheKey = `volume:${volumeId}`;
    const volume = await this.fastify.prisma.findCached(
      this.userId,
      cacheKey,
      ["volume:.:shared", "userprogress:progress:private"],
      async () => {
        return await this.fastify.prisma.volume.findFirst({
          where: {
            id: volumeId,
            series: { OR: [{ ownerId: this.userId }, { ownerId: 'admin' }] }
          },
          include: {
            progress: {
              where: { userId: this.userId },
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
      throw new HttpError(404, 'Volume not found or access denied');
    }

    // 2. Ensure both branches exist
    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    const userBranch = await ensureUserBranch(this.fastify, volumeId, this.userId, adminBranch);

    // 3. Compute Divergence Status (hasAhead / hasBehind)
    // hasAhead: User has private patches (Dirty branch)
    const hasAhead = userBranch.rootPatchId !== null;
    let hasBehind = false;

    if (!hasAhead) {
      // Clean: Behind if admin moved past the shared HEAD
      hasBehind = userBranch.headPatchId !== adminBranch.headPatchId;
    } else {
      // Dirty: Behind if admin moved past the point where the user forked (root's parent)
      const rootPatch = await this.fastify.prisma.patch.findUnique({
        where: { id: userBranch.rootPatchId! },
        select: { parentId: true }
      });
      if (rootPatch) {
        hasBehind = rootPatch.parentId !== adminBranch.headPatchId;
      }
    }

    // 4. Get Computed Document State (Syncs database history to JSON snapshot)
    const mokuroData = (await syncSnapshot(this.fastify, userBranch)).data;

    return {
      id: volume.id,
      title: volume.title ?? volume.folderName,
      seriesId: volume.seriesId,
      pageCount: volume.pageCount,
      coverImageName: volume.coverImageName,
      progress: volume.progress,
      mokuroData: mokuroData,
      versionInfo: {
        branchId: userBranch.id,
        headPatchId: userBranch.headPatchId,
        branchVersion: userBranch.version,
        hasAhead,
        hasBehind,
      }
    };
  }

  /**
     * Processes a new atomic edit operation for a user.
     * Implements the "Fork-on-Write" strategy.
     */
  async applyPatch(
    volumeId: string,
    op: PatchOperation,
    version: number
  ): Promise<ApplyPatchResponse> {
    const userId = this.userId;

    // 1. Setup Branches
    const volume = await this.fastify.prisma.volume.findFirst({
      where: {
        id: volumeId,
        series: { OR: [{ ownerId: userId }, { ownerId: 'admin' }] }
      },
      include: {
        progress: {
          where: { userId },
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
    if (!volume) throw new HttpError(404, 'Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    const userBranch = await ensureUserBranch(this.fastify, volumeId, userId, adminBranch);

    // 2. Optimistic Lock
    if (userBranch.version !== version) {
      throw new HttpError(409, 'Version mismatch. Please refresh.');
    }

    const headPatch = userBranch.headPatch;
    const rootPatch = userBranch.rootPatch;
    const snapshotPatch = userBranch.snapshotPatch;

    // 3. Snapshot Sync (outside transaction)
    // If the snapshot is in the "future" (ahead of HEAD), sync it back before writing.
    const isSnapshotAhead = snapshotPatch && snapshotPatch.createdAt > headPatch.createdAt;
    if (isSnapshotAhead) {
      this.fastify.log.info(`[Strategy] Snapshot ahead of HEAD (${snapshotPatch.createdAt} > ${headPatch.createdAt}). Syncing back before write.`);
      await syncSnapshot(this.fastify, userBranch);
    }

    // 4. Transactional Write
    const result = await this.fastify.prisma.$transaction(async (tx) => {
      // CASE 1: Root is NULL (Clean state -> Fork)
      // No deletion needed

      // CASE 2: Root > Head (User undid past their own root -> Re-fork)
      // We delete the old root, which cascades and deletes the now-abandoned branch history.
      if (rootPatch && rootPatch.createdAt > headPatch.createdAt) {
        await tx.patch.delete({ where: { id: rootPatch.id } });
      }

      // CASE 3: Head has children (User undid within branch -> Wipe Future)
      // If we are adding a new patch from a middle point, we must prune the 'Redo' path.
      else if (rootPatch) {
        const children = await tx.patch.findMany({
          where: { parentId: headPatch.id },
          select: { id: true }
        });
        if (children.length > 1) this.fastify.log.warn(`User branch shouldn't have multiple leaves: ${userBranch.id}`);
        for (const child of children) {
          await tx.patch.delete({ where: { id: child.id } });
        }
      }

      // Create the New Patch
      // The parentId is always the current head (which is the admin head if the branch is clean).
      const newPatch = await tx.patch.create({
        data: {
          volumeId,
          userId,
          parentId: headPatch.id,
          operation: JSON.stringify(op),
        }
      });

      // Update Branch Pointers
      // Determine if we need to set a new branch root (first fork or after a re-fork).
      const shouldSetNewRoot = !rootPatch || (rootPatch.createdAt > headPatch.createdAt);
      const finalRootId = shouldSetNewRoot ? newPatch.id : rootPatch.id;

      const updatedBranch = await tx.ocrBranch.update({
        where: { id: userBranch.id },
        data: {
          headPatchId: newPatch.id,
          rootPatchId: finalRootId,
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
   * Reverts the most recent patch in the user's branch history.
   * Follows the head-crawl logic where the pointer moves to the parent.
   */
  async undo(volumeId: string, version: number): Promise<UndoResponse> {
    const userId = this.userId;

    // 1. Setup and Authorization
    const volume = await this.fastify.prisma.volume.findFirst({
      where: {
        id: volumeId,
        series: { OR: [{ ownerId: this.userId }, { ownerId: 'admin' }] }
      },
      select: { mokuroPath: true }
    });
    if (!volume) throw new HttpError(404, 'Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    const userBranch = await ensureUserBranch(this.fastify, volumeId, userId, adminBranch);

    // 2. Optimistic Lock Check
    if (userBranch.version !== version) {
      throw new HttpError(409, 'Version mismatch. Please refresh.');
    }

    // 3. Retrieve Current Patch for Inversion
    const currentHeadId = userBranch.headPatchId;
    const currentPatch = await this.fastify.prisma.patch.findUnique({
      where: { id: currentHeadId }
    });

    // 4. Boundary Check
    // If no parent exists, the user is at the Genesis patch or the branch start.
    if (!currentPatch) throw new HttpError(500, 'HEAD patch not found.');
    if (!currentPatch.parentId) throw new HttpError(400, 'Cannot undo: Reached start of history.');


    // 5. Invert the Operation
    // This allows the frontend to undo the change in its local state immediately.
    const operation = JSON.parse(currentPatch.operation) as PatchOperation;
    const inversePatch = PatchInverter.invert(operation);
    const newHeadId = currentPatch.parentId;

    // 6. Update Branch Pointer
    const updatedBranch = await this.fastify.prisma.ocrBranch.update({
      where: { id: userBranch.id },
      data: {
        headPatchId: newHeadId,
        version: { increment: 1 }
      }
    });

    return {
      success: true,
      newHeadId: newHeadId,
      newVersion: updatedBranch.version,
      patch: inversePatch
    };
  }

  /**
   * Re-applies a previously undone patch in the user's branch history.
   * Implements the selection logic to find the next patch in the timeline.
   */
  async redo(volumeId: string, version: number): Promise<RedoResponse> {
    const userId = this.userId;

    // 1. Setup and Authorization
    const volume = await this.fastify.prisma.volume.findFirst({
      where: {
        id: volumeId,
        series: { OR: [{ ownerId: this.userId }, { ownerId: 'admin' }] }
      },
      select: { mokuroPath: true }
    });
    if (!volume) throw new HttpError(404, 'Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    const userBranch = await ensureUserBranch(this.fastify, volumeId, userId, adminBranch);

    // 2. Optimistic Lock Check
    if (userBranch.version !== version) {
      throw new HttpError(409, 'Version mismatch. Please refresh.');
    }

    const currentHeadId = userBranch.headPatchId;
    const rootPatchId = userBranch.rootPatchId;

    // 3. Find Candidate "Next" Patches
    const [rootPatch, currentPatch, children] = await Promise.all([
      // Check if the user is at the fork point and about to redo into their own branch root
      rootPatchId
        ? this.fastify.prisma.patch.findUnique({
          where: { id: rootPatchId },
          select: { id: true, parentId: true, operation: true }
        })
        : null,
      // Check if the current patch has an explicit forward link (used in official/admin history)
      this.fastify.prisma.patch.findUnique({
        where: { id: currentHeadId },
        select: { nextPatch: { select: { id: true, operation: true } } }
      }),
      // Find all patches that list the current HEAD as their parent
      this.fastify.prisma.patch.findMany({
        where: { parentId: currentHeadId },
        select: { id: true, operation: true }
      })
    ]);
    if (!currentPatch) throw new HttpError(500, 'HEAD patch not found.');

    // 4. Selection Logic (Prioritized)
    let nextPatch = null;

    if (rootPatch?.parentId === currentHeadId) {
      // Redo back into the start of the user's private branch
      nextPatch = rootPatch;
    } else if (currentPatch.nextPatch) {
      // Follow the explicit doubly-linked list (Official history)
      if (rootPatch && rootPatch.id <= currentHeadId) throw new HttpError(500, 'Branch HEAD in invalid location.');
      nextPatch = currentPatch.nextPatch;
    } else if (children.length === 1) {
      // Follow the only available child path
      nextPatch = children[0];
    } else if (children.length > 1) {
      // Block redo if the history has branched significantly
      throw new HttpError(500, 'Cannot redo: multiple children paths available.');
    }

    if (!nextPatch) {
      throw new HttpError(400, 'Nothing to redo');
    }

    // 5. Update Branch Pointer
    const operation = JSON.parse(nextPatch.operation) as PatchOperation;

    const updatedBranch = await this.fastify.prisma.ocrBranch.update({
      where: { id: userBranch.id },
      data: {
        headPatchId: nextPatch.id,
        version: { increment: 1 }
      }
    });

    return {
      success: true,
      newHeadId: nextPatch.id,
      newVersion: updatedBranch.version,
      patch: operation
    };
  }

  /**
   * Discards the user's private history and resets to the Admin Master HEAD.
   * Ensures the snapshot is never null by copying the Admin's state.
   */
  async reset(volumeId: string): Promise<void> {
    const volume = await this.fastify.prisma.volume.findFirst({
      where: {
        id: volumeId,
        series: { OR: [{ ownerId: this.userId }, { ownerId: 'admin' }] }
      },
      select: { mokuroPath: true }
    });
    if (!volume) throw new HttpError(404, 'Volume not found or access denied');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    const userBranch = await ensureUserBranch(this.fastify, volumeId, this.userId, adminBranch);

    if (userBranch.headPatch.id === adminBranch.headPatch.id) return;

    // 1. Database State Transition
    const newUserBranch = await this.fastify.prisma.$transaction(async (tx) => {
      // Cascade delete the private patch tree
      if (userBranch.rootPatchId !== null) await tx.patch.delete({ where: { id: userBranch.rootPatchId } });

      return await tx.ocrBranch.update({
        where: { id: userBranch.id },
        data: {
          headPatchId: adminBranch.headPatchId,
          rootPatchId: null,
          snapshotPatchId: null,
          version: { increment: 1 }
        },
        include: {
          headPatch: { select: { id: true, createdAt: true } },
          rootPatch: { select: { id: true, createdAt: true } },
          snapshotPatch: { select: { id: true, createdAt: true } }
        }
      });
    });

    // 2. Physical File Sync (Post-Transaction)
    // Since the DB is committed, we now align the disk state.
    await inheritAdminSnapshot(this.fastify, newUserBranch, adminBranch);
  }

  /**
     * Force regenerate snapshot for the user's branch.
     */
  async createSnapshot(volumeId: string): Promise<{ data: MokuroData, branch: OcrBranch }> {
    const volume = await this.fastify.prisma.volume.findFirst({
      where: {
        id: volumeId,
        series: { OR: [{ ownerId: this.userId }, { ownerId: 'admin' }] }
      },
      select: { mokuroPath: true }
    });
    if (!volume) throw new HttpError(404, 'Volume not found');

    const adminBranch = await ensureAdminBranch(this.fastify, volumeId, volume.mokuroPath);
    const userBranch = await ensureUserBranch(this.fastify, volumeId, this.userId, adminBranch);

    return await syncSnapshot(this.fastify, userBranch);
  }

  /**
   * Submits volumes to the shared library.
   */
  async submitVolumes(volumeIds: string[], targetSeriesId?: string): Promise<void> {
    const userId = this.userId;

    // 1. Validation: Ensure user owns all volumes
    const volumes = await this.fastify.prisma.volume.findMany({
      where: {
        id: { in: volumeIds },
        series: { ownerId: userId }
      },
      include: { series: true }
    });

    if (volumes.length !== volumeIds.length) {
      throw new HttpError(400, 'One or more volumes not found or not owned by you.');
    }

    // 2. Validation: Ensure they belong to the same source series
    const sourceSeries = volumes[0].series;
    const allSameSeries = volumes.every(v => v.seriesId === sourceSeries.id);
    if (!allSameSeries) {
      throw new HttpError(400, 'All volumes in a submission must come from the same series.');
    }

    // 3. COLLISION CHECK (Dry Run)
    // We run the planner to check for conflicts, but discard the plan for now.
    await validateAndPlanSubmission(
      this.fastify,
      targetSeriesId,
      sourceSeries,
      volumes
    );

    // 4. Create Submission (Safe to proceed)
    await this.fastify.prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          userId,
          status: 'pending',
          targetSeriesId: targetSeriesId || null,
          sourceSeriesId: sourceSeries.id,
          submittedAt: new Date()
        }
      });

      await tx.volume.updateMany({
        where: { id: { in: volumeIds } },
        data: { submissionId: submission.id }
      });
    });
  }

  async acceptSubmission(submissionId: string): Promise<void> {
    throw new HttpError(403, 'Forbidden: Only admins can accept submissions.');
  }

  async rejectSubmission(submissionId: string, reason?: string): Promise<void> {
    await this.fastify.prisma.submission.update({
      where: { id: submissionId, userId: this.userId },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewNote: reason
      }
    });
  }

  async officialize(volumeId: string, sourceUserId: string): Promise<void> {
    throw new HttpError(403, 'Forbidden: Only admins can merge branches.');
  }

  async revert(volumeId: string, patchId: string): Promise<void> {
    throw new HttpError(403, 'Forbidden: Only admins can revert changes.');
  }
}
