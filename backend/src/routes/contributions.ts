import { FastifyPluginAsync } from 'fastify';

const contributionsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * GET /api/contributions/summary
   * Returns counts of volumes with local edits (ahead) or behind admin.
   */
  fastify.get('/summary', async (request, reply) => {
    const userId = request.user.id;

    const userBranches = await fastify.prisma.ocrBranch.findMany({
      where: {
        userId,
        volume: {
          series: {
            OR: [{ ownerId: userId }, { ownerId: 'admin' }]
          }
        }
      },
      select: {
        volumeId: true,
        headPatchId: true,
        rootPatchId: true
      }
    });

    if (userBranches.length === 0) {
      return reply.send({ ahead: 0, behind: 0 });
    }

    const volumeIds = Array.from(new Set(userBranches.map((branch) => branch.volumeId)));

    const adminBranches = await fastify.prisma.ocrBranch.findMany({
      where: {
        userId: 'admin',
        volumeId: { in: volumeIds }
      },
      select: {
        volumeId: true,
        headPatchId: true
      }
    });

    const adminByVolume = new Map(adminBranches.map((branch: any) => [branch.volumeId, branch.headPatchId]));

    const rootPatchIds = userBranches
      .map((branch: any) => branch.rootPatchId)
      .filter((id: any): id is string => Boolean(id));

    const rootPatches = rootPatchIds.length
      ? await fastify.prisma.patch.findMany({
          where: { id: { in: rootPatchIds } },
          select: { id: true, parentId: true }
        })
      : [];

    const rootParentById = new Map(rootPatches.map((patch) => [patch.id, patch.parentId]));

    let ahead = 0;
    let behind = 0;

    for (const branch of userBranches) {
      const adminHead = adminByVolume.get(branch.volumeId);
      if (!adminHead) continue;

      const hasAhead = branch.rootPatchId !== null;
      let hasBehind = false;

      if (!hasAhead) {
        hasBehind = branch.headPatchId !== adminHead;
      } else if (branch.rootPatchId) {
        const rootParent = rootParentById.get(branch.rootPatchId) ?? null;
        hasBehind = rootParent !== adminHead;
      }

      if (hasAhead) ahead += 1;
      if (hasBehind) behind += 1;
    }

    return reply.send({ ahead, behind });
  });
};

export default contributionsRoutes;
