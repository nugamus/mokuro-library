import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ensureAdminBranch, ensureUserBranch, syncSnapshot } from '../utils/ocrHelpers';
import { PatchInverter } from '../lib/PatchInverter';
import { ApplyPatchResponse, UndoResponse, RedoResponse, PatchOperation } from '../types/history';

// --- Zod Schemas ---

const patchOperationSchema = z.object({
  op: z.enum(['replace', 'add', 'remove', 'reorder_lines', 'reorder_blocks']),
  path: z.string().regex(/^\/pages\/\d+\/.*/, "Path must start with /pages/{n}/"),
  value: z.any().optional(),
  old_value: z.any().optional(),
  new_order: z.array(z.number()).optional(),
}).superRefine((data, ctx) => {
  // Conditional Validation Logic (Spec 3.3)
  if ((data.op === 'add' || data.op === 'replace') && data.value === undefined) {
    ctx.addIssue({ code: 'custom', message: "Value is required for add/replace", path: ['value'] });
  }
  if ((data.op === 'remove' || data.op === 'replace') && data.old_value === undefined) {
    ctx.addIssue({ code: 'custom', message: "Old_value is required for remove/replace", path: ['old_value'] });
  }
  if ((data.op === 'reorder_lines' || data.op === 'reorder_blocks') && !data.new_order) {
    ctx.addIssue({ code: 'custom', message: "New_order is required for reorder operations", path: ['new_order'] });
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
        // This is our safety check for potential data loss
        const isSnapshotAhead = snapshotPatchId && snapshotPatchId > headPatchId;

        const ensureSnapshotSafe = async () => {
          if (isSnapshotAhead) {
            fastify.log.info(`[Patch] Snapshot ahead of HEAD (${snapshotPatchId} > ${headPatchId}). Syncing back before write.`);
            // Sync snapshot back to HEAD
            await syncSnapshot(fastify, volume.mokuroPath, userBranch);
          }
        };

        // --- THE FULL CHECK LOGIC ---

        // CASE 1: Root is NULL (Clean state -> Fork)
        if (!rootPatchId) {
          await ensureSnapshotSafe();
          // New patch will become ROOT and HEAD
        }

        // CASE 2: Root > Head (User undid past their own root -> Re-fork)
        else if (rootPatchId > headPatchId) {
          await ensureSnapshotSafe();
          // The old private branch (starting at Root) is abandoned. Delete it.
          await fastify.prisma.patch.delete({ where: { id: rootPatchId } });
          // New patch will become ROOT and HEAD
        }

        // CASE 3: Head has children (User undid within branch -> Wipe Future)
        else {
          const children = await fastify.prisma.patch.findMany({
            where: { parentId: headPatchId },
            select: { id: true }
          });
          if (children.length > 1) fastify.log.warn(`User branch shouldn't have multiple leaves: ${userBranch.id}`);

          // If children exist, user undid and is now editing -> wipe future
          if (children.length > 0) {
            await ensureSnapshotSafe();
            // Delete each child (cascade handles grandchildren)
            for (const child of children) {
              await fastify.prisma.patch.delete({ where: { id: child.id } });
            }
          }
        }

        // 4. Create the New Patch
        const newPatch = await fastify.prisma.patch.create({
          data: {
            volumeId,
            userId,
            parentId: headPatchId,
            operation: JSON.stringify(operation),
          }
        });

        // 5. Update Branch Pointers
        // If Root is NULL or we just deleted the old Root, the new patch is the new Root.
        // Otherwise, keep existing Root.
        const shouldSetNewRoot = !rootPatchId || (rootPatchId > headPatchId);
        const finalRootId = shouldSetNewRoot ? newPatch.id : rootPatchId;

        const updatedBranch = await fastify.prisma.ocrBranch.update({
          where: { id: userBranch.id },
          data: {
            headPatchId: newPatch.id,
            rootPatchId: finalRootId,
            version: { increment: 1 }
          }
        });

        const response: ApplyPatchResponse = {
          success: true,
          newHeadId: newPatch.id,
          newVersion: updatedBranch.version,
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
        if (operation.path === 'genesis') {
          return reply.status(400).send({ message: 'Cannot undo genesis.' });
        }

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
};

export default ocrRoutes;
