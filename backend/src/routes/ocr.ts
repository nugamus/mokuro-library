import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ensureAdminBranch, ensureUserBranch, syncSnapshot } from '../utils/ocrHelpers';
import { PatchInverter } from '../lib/PatchInverter';
import { RebaseEngine } from '../lib/rebase/RebaseEngine';
import { ApplyPatchResponse, UndoResponse, RedoResponse, PatchOperation } from '../types/history';

// --- Zod Schemas ---

const patchOperationSchema = z.object({
  op: z.enum(['replace', 'add', 'remove', 'reorder']),
  path: z.string().regex(/^\/pages\/\d+\/.+/, "Path must start with /pages/{n}/ and have content"),
  value: z.any().optional(),
  old_value: z.any().optional(),
  new_order: z.array(z.number().int().nonnegative()).optional(),
}).superRefine((data, ctx) => {
  // Conditional Validation Logic (Spec 3.3)
  if ((data.op === 'add' || data.op === 'replace') && data.value === undefined) {
    ctx.addIssue({ code: 'custom', message: "Value is required for add/replace", path: ['value'] });
  }
  if ((data.op === 'remove' || data.op === 'replace') && data.old_value === undefined) {
    ctx.addIssue({ code: 'custom', message: "Old_value is required for remove/replace", path: ['old_value'] });
  }
  if (data.op === 'reorder' && !data.new_order) {
    ctx.addIssue({ code: 'custom', message: "New_order is required for reorder operations", path: ['new_order'] });
  }
  // Validate new_order is a valid permutation
  if (data.new_order) {
    const sorted = [...data.new_order].sort((a, b) => a - b);
    const isValidPermutation = sorted.every((v, i) => v === i);
    if (!isValidPermutation) {
      ctx.addIssue({ code: 'custom', message: "new_order must be a valid permutation (0 to n-1)", path: ['new_order'] });
    }
  }
});

const patchBodySchema = z.object({
  operation: patchOperationSchema,
  branchVersion: z.number().int().nonnegative(),
});

// Schema for Undo/Redo which only require the version
const versionBodySchema = z.object({
  branchVersion: z.number().int().nonnegative(),
});

// --- Rebase Schemas ---

const rebaseStartSchema = z.object({
  targetHeadId: z.string().optional(), // Client may send this for consistency checks, though Engine determines it
});

const rebaseContinueSchema = z.object({
  rebaseId: z.string(),
  adminPatchId: z.string(),
  patchId: z.string(),
  resolution: z.enum(['keep_admin', 'keep_mine']),
});

const rebaseAbortSchema = z.object({
  rebaseId: z.string(),
});

const ocrRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * POST /api/library/volumes/:volumeId/patch
   * Applies a new edit patch to the user's branch.
   */
  fastify.post<{ Params: { volumeId: string }, Body: z.infer<typeof patchBodySchema> }>(
    '/volumes/:volumeId/patch',
    async (request, reply) => {
      const { volumeId } = request.params;
      const { operation, branchVersion } = request.body;

      // Manual Zod parse
      const parseResult = patchBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid patch', errors: parseResult.error });
      }

      const userId = request.user.id;

      try {
        // 1. Setup Branches
        const volume = await fastify.prisma.volume.findUnique({ where: { id: volumeId } });
        if (!volume) return reply.status(404).send({ message: 'Volume not found' });

        const adminBranch = await ensureAdminBranch(fastify, volumeId, volume.mokuroPath);
        const userBranch = await ensureUserBranch(fastify, volumeId, userId, adminBranch);

        // 2. Optimistic Lock
        if (userBranch.version !== branchVersion) {
          return reply.status(409).send({ message: 'Version mismatch. Please refresh.' });
        }

        // 3. Prepare Logic Variables
        const headPatchId = userBranch.headPatchId;
        const rootPatchId = userBranch.rootPatchId;
        const snapshotPatchId = userBranch.snapshotPatchId;

        // Check if snapshot is "in the future" (ahead of HEAD)
        const isSnapshotAhead = snapshotPatchId && snapshotPatchId > headPatchId;

        // Sync snapshot before transaction if needed (file I/O outside transaction)
        if (isSnapshotAhead) {
          fastify.log.info(`[Patch] Snapshot ahead of HEAD (${snapshotPatchId} > ${headPatchId}). Syncing back before write.`);
          await syncSnapshot(fastify, volume.mokuroPath, userBranch);
        }

        // 4. Execute all DB operations in a transaction
        const result = await fastify.prisma.$transaction(async (tx) => {
          // CASE 1: Root is NULL (Clean state -> Fork)
          // No deletion needed

          // CASE 2: Root > Head (User undid past their own root -> Re-fork)
          if (rootPatchId && rootPatchId > headPatchId) {
            await tx.patch.delete({ where: { id: rootPatchId } });
          }

          // CASE 3: Head has children (User undid within branch -> Wipe Future)
          else if (rootPatchId) {
            const children = await tx.patch.findMany({
              where: { parentId: headPatchId },
              select: { id: true }
            });
            if (children.length > 1) fastify.log.warn(`User branch shouldn't have multiple leaves: ${userBranch.id}`);

            for (const child of children) {
              await tx.patch.delete({ where: { id: child.id } });
            }
          }

          // Create the New Patch
          const newPatch = await tx.patch.create({
            data: {
              volumeId,
              userId,
              parentId: headPatchId,
              operation: JSON.stringify(operation),
            }
          });

          // Update Branch Pointers
          const shouldSetNewRoot = !rootPatchId || (rootPatchId > headPatchId);
          const finalRootId = shouldSetNewRoot ? newPatch.id : rootPatchId;

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

        const response: ApplyPatchResponse = {
          success: true,
          newHeadId: result.newPatch.id,
          newVersion: result.updatedBranch.version,
          patch: operation
        };

        return reply.send(response);

      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ message: 'Failed to apply patch' });
      }
    }
  );

  /**
   * POST /api/library/volumes/:volumeId/undo
   */
  fastify.post<{ Params: { volumeId: string }, Body: z.infer<typeof versionBodySchema> }>(
    '/volumes/:volumeId/undo',
    async (request, reply) => {
      const { volumeId } = request.params;
      // Validate Body for Version
      const parseResult = versionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid request body', errors: parseResult.error });
      }
      const { branchVersion } = request.body;
      const userId = request.user.id;

      try {
        const volume = await fastify.prisma.volume.findUnique({ where: { id: volumeId } });
        if (!volume) return reply.status(404).send({ message: 'Volume not found' });

        const adminBranch = await ensureAdminBranch(fastify, volumeId, volume.mokuroPath);
        const userBranch = await ensureUserBranch(fastify, volumeId, userId, adminBranch);

        // Optimistic Lock
        if (userBranch.version !== branchVersion) {
          return reply.status(409).send({ message: 'Version mismatch. Please refresh.' });
        }

        const currentHeadId = userBranch.headPatchId;

        const currentPatch = await fastify.prisma.patch.findUnique({ where: { id: currentHeadId } });

        if (!currentPatch || !currentPatch.parentId) {
          return reply.status(400).send({ message: 'Cannot undo: Reached start of history.' });
        }

        const operation = JSON.parse(currentPatch.operation) as PatchOperation;
        const inversePatch = PatchInverter.invert(operation);
        const newHeadId = currentPatch.parentId;

        const updatedBranch = await fastify.prisma.ocrBranch.update({
          where: { id: userBranch.id },
          data: {
            headPatchId: newHeadId,
            version: { increment: 1 }
          }
        });

        const response: UndoResponse = {
          success: true,
          newHeadId: newHeadId,
          newVersion: updatedBranch.version,
          patch: inversePatch
        };

        return reply.send(response);

      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ message: error.message || 'Failed to undo' });
      }
    }
  );

  /**
   * POST /api/library/volumes/:volumeId/redo
   */
  fastify.post<{ Params: { volumeId: string }, Body: z.infer<typeof versionBodySchema> }>(
    '/volumes/:volumeId/redo',
    async (request, reply) => {
      const { volumeId } = request.params;
      const parseResult = versionBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid request body', errors: parseResult.error });
      }
      const { branchVersion } = request.body;
      const userId = request.user.id;

      try {
        const volume = await fastify.prisma.volume.findUnique({ where: { id: volumeId } });
        if (!volume) return reply.status(404).send({ message: 'Volume not found' });

        const adminBranch = await ensureAdminBranch(fastify, volumeId, volume.mokuroPath);
        const userBranch = await ensureUserBranch(fastify, volumeId, userId, adminBranch);

        if (userBranch.version !== branchVersion) {
          return reply.status(409).send({ message: 'Version mismatch. Please refresh.' });
        }

        const currentHeadId = userBranch.headPatchId;
        const rootPatchId = userBranch.rootPatchId;

        const [rootPatch, currentPatch, children] = await Promise.all([
          rootPatchId
            ? fastify.prisma.patch.findUnique({
              where: { id: rootPatchId },
              select: { id: true, parentId: true, operation: true }
            })
            : null,
          fastify.prisma.patch.findUnique({
            where: { id: currentHeadId },
            select: { nextPatchId: true, nextPatch: { select: { id: true, operation: true } } }
          }),
          fastify.prisma.patch.findMany({
            where: { parentId: currentHeadId },
            select: { id: true, operation: true }
          })
        ]);

        // Then same logic, no awaits
        let nextPatch = null;

        if (rootPatch?.parentId === currentHeadId) {
          nextPatch = rootPatch;
        } else if (currentPatch?.nextPatch) {
          nextPatch = currentPatch.nextPatch;
        } else if (children.length === 1) {
          nextPatch = children[0];
        } else if (children.length > 1) {
          return reply.status(400).send({ message: 'Cannot redo: multiple children.' });
        }

        if (!nextPatch) {
          return reply.status(400).send({ message: 'Nothing to redo.' });
        }

        const operation = JSON.parse(nextPatch.operation) as PatchOperation;

        const updatedBranch = await fastify.prisma.ocrBranch.update({
          where: { id: userBranch.id },
          data: {
            headPatchId: nextPatch.id,
            version: { increment: 1 }
          }
        });

        const response: RedoResponse = {
          success: true,
          newHeadId: nextPatch.id,
          newVersion: updatedBranch.version,
          patch: operation
        };

        return reply.send(response);

      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ message: error.message || 'Failed to redo' });
      }
    }
  );

  /**
   * POST /api/library/volumes/:volumeId/rebase/start
   */
  fastify.post<{ Params: { volumeId: string }, Body: z.infer<typeof rebaseStartSchema> }>(
    '/volumes/:volumeId/rebase/start',
    async (request, reply) => {
      const { volumeId } = request.params;
      const parseResult = rebaseStartSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid request body', errors: parseResult.error });
      }

      const userId = request.user.id;

      try {
        const volume = await fastify.prisma.volume.findUnique({ where: { id: volumeId } });
        if (!volume) return reply.status(404).send({ message: 'Volume not found' });

        const adminBranch = await ensureAdminBranch(fastify, volumeId, volume.mokuroPath);
        // Ensure user branch exists before rebasing
        await ensureUserBranch(fastify, volumeId, userId, adminBranch);

        const engine = new RebaseEngine(fastify);
        const result = await engine.start(volumeId, userId);

        if (result.status === 'complete') {
          // Fetch the updated branch to get the new HEAD
          const updatedBranch = await fastify.prisma.ocrBranch.findUnique({
            where: { volumeId_userId: { volumeId, userId } }
          });
          return reply.send({
            status: 'complete',
            newHeadId: updatedBranch?.headPatchId
          });
        } else {
          return reply.send(result);
        }

      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ message: error.message || 'Failed to start rebase' });
      }
    }
  );

  /**
   * POST /api/library/volumes/:volumeId/rebase/continue
   */
  fastify.post<{ Params: { volumeId: string }, Body: z.infer<typeof rebaseContinueSchema> }>(
    '/volumes/:volumeId/rebase/continue',
    async (request, reply) => {
      const { volumeId } = request.params;
      const parseResult = rebaseContinueSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid request body', errors: parseResult.error });
      }
      const { rebaseId, adminPatchId, patchId, resolution } = request.body;
      const userId = request.user.id;

      try {
        // Verify session belongs to this user
        const session = await fastify.prisma.rebaseSession.findUnique({
          where: { id: rebaseId },
          include: { branch: true }
        });
        if (!session) {
          return reply.status(404).send({ message: 'Rebase session not found' });
        }
        if (session.branch.userId !== userId) {
          return reply.status(403).send({ message: 'Not authorized to continue this rebase session' });
        }

        const engine = new RebaseEngine(fastify);
        const result = await engine.continue(rebaseId, {
          adminPatchId,
          patchId,
          resolution
        });

        if (result.status === 'complete') {
          // Fetch the updated branch to get the new HEAD
          const updatedBranch = await fastify.prisma.ocrBranch.findUnique({
            where: { volumeId_userId: { volumeId, userId } }
          });
          return reply.send({
            status: 'complete',
            newHeadId: updatedBranch?.headPatchId
          });
        } else {
          return reply.send(result);
        }

      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ message: error.message || 'Failed to continue rebase' });
      }
    }
  );

  /**
   * POST /api/library/volumes/:volumeId/rebase/abort
   */
  fastify.post<{ Params: { volumeId: string }, Body: z.infer<typeof rebaseAbortSchema> }>(
    '/volumes/:volumeId/rebase/abort',
    async (request, reply) => {
      const { volumeId } = request.params;
      const parseResult = rebaseAbortSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid request body', errors: parseResult.error });
      }
      const { rebaseId } = request.body;
      const userId = request.user.id;

      try {
        // Verify session belongs to this user
        const session = await fastify.prisma.rebaseSession.findUnique({
          where: { id: rebaseId },
          include: { branch: true }
        });
        if (!session) {
          return reply.status(404).send({ message: 'Rebase session not found' });
        }
        if (session.branch.userId !== userId) {
          return reply.status(403).send({ message: 'Not authorized to abort this rebase session' });
        }

        const engine = new RebaseEngine(fastify);
        await engine.abort(rebaseId);
        return reply.send({ status: 'aborted' });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({ message: error.message || 'Failed to abort rebase' });
      }
    }
  );
};

export default ocrRoutes;
