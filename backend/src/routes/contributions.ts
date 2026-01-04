import { FastifyPluginAsync } from 'fastify';

// Define types for request bodies/queries
interface SubmissionBody {
  volumeIds: string[];
  targetSeriesId?: string;
}

interface SubmissionQuery {
  status?: 'pending' | 'accepted' | 'rejected';
}

interface RejectBody {
  reason?: string;
}

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

  /**
     * POST /api/contributions/submissions
     * Submit volumes to the shared library.
     */
  fastify.post<{ Body: SubmissionBody }>(
    '/submissions',
    async (request, reply) => {
      const { volumeIds, targetSeriesId } = request.body;

      if (!volumeIds || volumeIds.length === 0) {
        return reply.status(400).send({ error: 'No volumes specified' });
      }

      try {
        // Delegate to the injected strategy (UserStrategy handles validation, AdminStrategy throws 400)
        await request.accessStrategy.submitVolumes(volumeIds, targetSeriesId);
        return reply.send({ success: true, message: 'Submission created' });
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ error: e.message });
        throw e;
      }
    }
  );

  /**
   * GET /api/contributions/submissions
   * List submissions.
   * - Regular Users: See their own history.
   * - Admins: See pending queue (default) or filtered list.
   */
  fastify.get<{ Querystring: SubmissionQuery }>(
    '/submissions',
    async (request, reply) => {
      const userId = request.user.id;
      const isAdmin = userId === 'admin';
      const statusFilter = request.query.status;

      const whereClause: any = {};

      if (!isAdmin) {
        // Users only see their own
        whereClause.userId = userId;
        if (statusFilter) whereClause.status = statusFilter;
      } else {
        // Admins default to 'pending' if no filter is set
        whereClause.status = statusFilter || 'pending';
      }

      const submissions = await fastify.prisma.submission.findMany({
        where: whereClause,
        include: {
          sourceSeries: { select: { title: true, folderName: true } },
          targetSeries: { select: { title: true, folderName: true } },
          user: { select: { username: true } },
          _count: { select: { volumes: true } }
        },
        orderBy: { submittedAt: 'desc' }
      });

      return reply.send(submissions);
    }
  );

  /**
   * POST /api/contributions/submissions/:id/accept
   * Admin-only: Accept submission, move files, update DB.
   */
  fastify.post<{ Params: { id: string } }>(
    '/submissions/:id/accept',
    async (request, reply) => {
      const submissionId = request.params.id;

      try {
        // AdminStrategy executes the move; UserStrategy throws 403
        await request.accessStrategy.acceptSubmission(submissionId);
        return reply.send({ success: true, message: 'Submission accepted and volumes moved.' });
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ error: e.message });
        fastify.log.error(e);
        return reply.status(500).send({ error: e.message });
      }
    }
  );

  /**
   * POST /api/contributions/submissions/:id/reject
   * Admin-only: Reject submission.
   */
  fastify.post<{ Params: { id: string }; Body: RejectBody }>(
    '/submissions/:id/reject',
    async (request, reply) => {
      const submissionId = request.params.id;
      const { reason } = request.body;

      try {
        // AdminStrategy updates status; UserStrategy throws 403
        await request.accessStrategy.rejectSubmission(submissionId, reason);
        return reply.send({ success: true, message: 'Submission rejected.' });
      } catch (e: any) {
        if (e.statusCode) return reply.status(e.statusCode).send({ error: e.message });
        throw e;
      }
    }
  );
};

export default contributionsRoutes;
