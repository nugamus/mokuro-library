import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ensureAdminBranch, ensureUserBranch } from '../utils/ocrHelpers';
import { RebaseEngine } from '../lib/rebase/RebaseEngine';

// --- Zod Schemas ---

const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('genesis'),
    path: z.string().regex(/^.+/, "Path must not be empty"),
  }),
  z.object({
    op: z.literal('replace'),
    path: z.string().regex(/^\/pages\/\d+\/.+/, "Path must start with /pages/{n}/ and have content"),
    value: z.any(),
    old_value: z.any()
  }),
  z.object({
    op: z.literal('add'),
    path: z.string().regex(/^\/pages\/\d+\/.+/, "Path must start with /pages/{n}/ and have content"),
    value: z.any()
  }),
  z.object({
    op: z.literal('remove'),
    path: z.string().regex(/^\/pages\/\d+\/.+/, "Path must start with /pages/{n}/ and have content"),
    old_value: z.any()
  }),
  z.object({
    op: z.literal('reorder'),
    path: z.string().regex(/^\/pages\/\d+\/.+/, "Path must start with /pages/{n}/ and have content"),
    new_order: z.array(z.number().int().nonnegative())
  }).superRefine((data, ctx) => {
    const sorted = [...data.new_order].sort((a, b) => a - b);
    const isValidPermutation = sorted.every((v, i) => v === i);
    if (!isValidPermutation) {
      ctx.addIssue({ code: 'custom', message: "new_order must be a valid permutation (0 to n-1)", path: ['new_order'] });
    }
  })
]);

const patchBodySchema = z.object({
  operation: patchOperationSchema,
  branchVersion: z.number().int().nonnegative(),
});

const ocrRoutes: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * POST /api/library/volumes/:id/patch
   */
  fastify.post<{ Params: { id: string }, Body: z.infer<typeof patchBodySchema> }>(
    '/volume/:id/patch',
    async (request, reply) => {
      const { id } = request.params;
      const parseResult = patchBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: 'Invalid patch', errors: parseResult.error });
      }
      const { operation, branchVersion } = parseResult.data;

      try {
        const result = await request.accessStrategy.applyPatch(id, operation, branchVersion);
        return result;
      } catch (err: any) {
        if (err.message === 'Volume not found') {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message.includes('Version mismatch') || err.message.includes('Conflict')) {
          return reply.code(409).send({ error: err.message });
        }
        return reply.code(400).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/library/volumes/:id/undo
   */
  fastify.post<{ Params: { id: string }, Body: { branchVersion: number } }>(
    '/volume/:id/undo',
    async (request, reply) => {
      const { id } = request.params;
      const { branchVersion } = request.body;

      try {
        const result = await request.accessStrategy.undo(id, branchVersion);
        return result;
      } catch (err: any) {
        if (err.message === 'Volume not found') {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message.includes('Version mismatch')) {
          return reply.code(409).send({ error: err.message });
        }
        if (err.message.includes('Cannot undo')) {
          return reply.code(400).send({ error: err.message });
        }
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/library/volumes/:id/redo
   */
  fastify.post<{ Params: { id: string }, Body: { branchVersion: number } }>(
    '/volume/:id/redo',
    async (request, reply) => {
      const { id } = request.params;
      const { branchVersion } = request.body;

      try {
        const result = await request.accessStrategy.redo(id, branchVersion);
        return result;
      } catch (err: any) {
        if (err.message.includes('not available')) {
          return reply.code(405).send({ error: err.message });
        }
        if (err.message === 'Volume not found') {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message.includes('Version mismatch')) {
          return reply.code(409).send({ error: err.message });
        }
        if (err.message.includes('Cannot redo') || err.message.includes('Nothing to redo')) {
          return reply.code(400).send({ error: err.message });
        }
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/library/volumes/:id/reset
   */
  fastify.post<{ Params: { id: string } }>(
    '/volume/:id/reset',
    async (request, reply) => {
      const { id } = request.params;

      try {
        await request.accessStrategy.reset(id);
        return { success: true };
      } catch (err: any) {
        if (err.message.includes('not applicable')) {
          return reply.code(405).send({ error: err.message });
        }
        if (err.message === 'Volume not found' || err.message.includes('access denied')) {
          return reply.code(404).send({ error: err.message });
        }
        if (err.message.includes('access denied')) {
          return reply.code(403).send({ error: err.message });
        }
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/library/volumes/:id/rebase/start
   */
  fastify.post<{ Params: { id: string } }>(
    '/volume/:id/rebase/start',
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.id;

      try {
        const volume = await fastify.prisma.volume.findUnique({ where: { id } });
        if (!volume) return reply.status(404).send({ message: 'Volume not found' });

        const adminBranch = await ensureAdminBranch(fastify, id, volume.mokuroPath);
        await ensureUserBranch(fastify, id, userId, adminBranch);

        const engine = new RebaseEngine(fastify);
        const result = await engine.start(id, userId);

        if (result.status === 'complete') {
          const updatedBranch = await fastify.prisma.ocrBranch.findUnique({
            where: { volumeId_userId: { volumeId: id, userId } }
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
   * POST /api/library/volumes/:id/rebase/continue
   */
  fastify.post<{ Params: { id: string }, Body: { rebaseId: string, resolution: 'keep_admin' | 'keep_mine' } }>(
    '/volume/:id/rebase/continue',
    async (request, reply) => {
      const { id } = request.params;
      const { rebaseId, resolution } = request.body;
      const userId = request.user.id;

      try {
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
        const result = await engine.continue(rebaseId, resolution);

        if (result.status === 'complete') {
          const updatedBranch = await fastify.prisma.ocrBranch.findUnique({
            where: { volumeId_userId: { volumeId: id, userId } }
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
   * POST /api/library/volumes/:id/rebase/abort
   */
  fastify.post<{ Params: { id: string }, Body: { rebaseId: string } }>(
    '/volume/:id/rebase/abort',
    async (request, reply) => {
      const { id } = request.params;
      const { rebaseId } = request.body;
      const userId = request.user.id;

      try {
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
