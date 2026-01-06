import { FastifyPluginAsync } from 'fastify';
import * as similarity from 'string-similarity';

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

interface BulkAcceptBody {
  submissionIds: string[];
}

interface BulkRejectBody {
  submissionIds: string[];
  reason: string;
}

const contributionsRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.addHook('preHandler', fastify.authenticate);

  /**
   * GET /api/contributions/summary
   * Returns counts of volumes with local edits (ahead) or behind admin,
   * plus pending submissions count (admin only).
   */
  fastify.get('/summary', async (request, reply) => {
    const userId = request.user.id;
    const isAdmin = userId === 'admin';

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

    // Calculate pending submissions count (admin sees all pending, users see 0)
    const pendingSubmissionsCount = isAdmin
      ? await fastify.prisma.submission.count({ where: { status: 'pending' } })
      : 0;

    if (userBranches.length === 0) {
      return reply.send({ ahead: 0, behind: 0, pendingSubmissionsCount });
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

    return reply.send({ ahead, behind, pendingSubmissionsCount });
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
   * GET /api/contributions/submissions/:id
   * Get a single submission by its ID, including full volume details.
   * Auth: User must own submission OR be admin.
   */
  fastify.get<{ Params: { id: string } }>(
    '/submissions/:id',
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.id;

      const submission = await fastify.prisma.submission.findUnique({
        where: { id },
        include: {
          user: { select: { username: true } },
          sourceSeries: { select: { id: true, title: true } },
          targetSeries: { select: { id: true, title: true } },
          volumes: {
            include: {
              volume: {
                select: {
                  id: true,
                  title: true,
                  number: true,
                  pages: true,
                  coverFile: true,
                  seriesId: true,
                },
              },
            },
          },
          comments: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                }
              }
            },
            orderBy: {
              createdAt: 'asc'
            }
          }
        },
      });

      if (!submission) {
        return reply.status(404).send({ error: 'Submission not found' });
      }

      // Check authorization: must be owner or admin
      if (submission.userId !== userId && userId !== 'admin') {
        return reply.status(403).send({ error: 'Not authorized to view this submission' });
      }

      // We need to shape the volumes a bit to be more convenient for the frontend
      const reshapedSubmission = {
        ...submission,
        volumes: submission.volumes.map(sv => sv.volume),
      };

      return reply.send(reshapedSubmission);
    },
  );

  /**
   * POST /api/contributions/submissions/:id/comments
   * Adds a comment to a submission.
   * Auth: User must be admin or owner of the submission.
   */
  fastify.post<{ Params: { id: string }; Body: { content: string } }>(
    '/submissions/:id/comments',
    async (request, reply) => {
      const { id: submissionId } = request.params;
      const { content } = request.body;
      const userId = request.user.id;

      if (!content || content.trim().length === 0) {
        return reply.status(400).send({ error: 'Comment content cannot be empty' });
      }

      // First, verify the user has permission to comment.
      const submission = await fastify.prisma.submission.findUnique({
        where: { id: submissionId },
        select: { userId: true },
      });

      if (!submission) {
        return reply.status(404).send({ error: 'Submission not found' });
      }

      if (submission.userId !== userId && userId !== 'admin') {
        return reply.status(403).send({ error: 'You are not authorized to comment on this submission' });
      }

      try {
        const newComment = await fastify.prisma.submissionComment.create({
          data: {
            submissionId,
            userId,
            content: content.trim(),
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        });

        return reply.status(201).send(newComment);
      } catch (e: any) {
        fastify.log.error(e, `Failed to add comment to submission ${submissionId}`);
        return reply.status(500).send({ error: 'Failed to add comment.' });
      }
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

  /**
   * DELETE /api/contributions/submissions/:id
   * Cancel/delete a pending submission.
   * Auth: User must own submission OR be admin.
   */
  fastify.delete<{ Params: { id: string } }>(
    '/submissions/:id',
    async (request, reply) => {
      const submissionId = request.params.id;
      const userId = request.user.id;

      try {
        // Fetch the submission to validate ownership and status
        const submission = await fastify.prisma.submission.findUnique({
          where: { id: submissionId }
        });

        if (!submission) {
          return reply.status(404).send({ error: 'Submission not found' });
        }

        // Check authorization: must be owner or admin
        if (submission.userId !== userId && userId !== 'admin') {
          return reply.status(403).send({ error: 'Not authorized to delete this submission' });
        }

        // Only allow deletion if status is pending
        if (submission.status !== 'pending') {
          return reply.status(400).send({ error: 'Only pending submissions can be cancelled' });
        }

        // Delete the submission (cascade will delete SubmissionVolume records)
        await fastify.prisma.submission.delete({
          where: { id: submissionId }
        });

        return reply.send({ success: true, message: 'Submission cancelled' });
      } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({ error: e.message });
      }
    }
  );

  /**
   * POST /api/contributions/submissions/bulk-accept
   * Bulk accept multiple submissions.
   * Admin-only: Process multiple submissions sequentially.
   */
  fastify.post<{ Body: BulkAcceptBody }>(
    '/submissions/bulk-accept',
    async (request, reply) => {
      const { submissionIds } = request.body;

      if (!submissionIds || submissionIds.length === 0) {
        return reply.status(400).send({ error: 'No submission IDs provided' });
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as Array<{ id: string; error: string }>
      };

      // Process each submission sequentially
      for (const submissionId of submissionIds) {
        try {
          await request.accessStrategy.acceptSubmission(submissionId);
          results.success += 1;
        } catch (e: any) {
          results.failed += 1;
          results.errors.push({
            id: submissionId,
            error: e.message || 'Unknown error'
          });
          fastify.log.error(`Failed to accept submission ${submissionId}:`, e);
        }
      }

      return reply.send(results);
    }
  );

  /**
   * POST /api/contributions/submissions/bulk-reject
   * Bulk reject multiple submissions with a shared reason.
   * Admin-only: Apply same reason to all selected submissions.
   */
  fastify.post<{ Body: BulkRejectBody }>(
    '/submissions/bulk-reject',
    async (request, reply) => {
      const { submissionIds, reason } = request.body;

      if (!submissionIds || submissionIds.length === 0) {
        return reply.status(400).send({ error: 'No submission IDs provided' });
      }

      if (!reason || reason.trim() === '') {
        return reply.status(400).send({ error: 'Rejection reason is required' });
      }

      const results = {
        success: 0,
        failed: 0,
        errors: [] as Array<{ id: string; error: string }>
      };

      // Process each submission sequentially
      for (const submissionId of submissionIds) {
        try {
          await request.accessStrategy.rejectSubmission(submissionId, reason);
          results.success += 1;
        } catch (e: any) {
          results.failed += 1;
          results.errors.push({
            id: submissionId,
            error: e.message || 'Unknown error'
          });
          fastify.log.error(`Failed to reject submission ${submissionId}:`, e);
        }
      }

      return reply.send(results);
    }
  );

  /**
   * POST /api/contributions/check-duplicates
   * Checks a list of volume IDs for potential duplicates in the admin library.
   */
  fastify.post<{ Body: { volumeIds: string[] } }>(
    '/check-duplicates',
    async (request, reply) => {
      const { volumeIds } = request.body;
      const userId = request.user.id;

      if (!volumeIds || volumeIds.length === 0) {
        return reply.status(400).send({ error: 'No volume IDs provided' });
      }

      try {
        // 1. Get the details of the user's volumes being submitted
        const userVolumes = await fastify.prisma.volume.findMany({
          where: {
            id: { in: volumeIds },
            ownerId: userId,
          },
          select: {
            id: true,
            title: true,
            series: { select: { title: true } },
          },
        });

        // 2. Get all admin volumes to compare against
        const adminVolumes = await fastify.prisma.volume.findMany({
          where: { ownerId: 'admin' },
          select: {
            id: true,
            title: true,
            series: { select: { title: true } },
          },
        });

        const duplicates = [];

        for (const userVolume of userVolumes) {
          const userSeriesTitle = userVolume.series.title ?? '';
          const userVolumeTitle = userVolume.title ?? '';

          for (const adminVolume of adminVolumes) {
            const adminSeriesTitle = adminVolume.series.title ?? '';
            const adminVolumeTitle = adminVolume.title ?? '';

            // Compare series and volume titles
            const seriesSimilarity = similarity.compareTwoStrings(userSeriesTitle.toLowerCase(), adminSeriesTitle.toLowerCase());
            const volumeSimilarity = similarity.compareTwoStrings(userVolumeTitle.toLowerCase(), adminVolumeTitle.toLowerCase());

            // Define a threshold for what constitutes a potential duplicate
            const confidence = (seriesSimilarity * 0.4) + (volumeSimilarity * 0.6);
            if (confidence > 0.85) {
              duplicates.push({
                submittedVolumeId: userVolume.id,
                submittedVolumeTitle: userVolume.title,
                submittedSeriesTitle: userVolume.series.title,
                existingAdminVolumeId: adminVolume.id,
                existingAdminVolumeTitle: adminVolume.title,
                existingAdminSeriesTitle: adminVolume.series.title,
                confidence,
              });
            }
          }
        }

        // Sort by confidence descending
        duplicates.sort((a, b) => b.confidence - a.confidence);

        return reply.send({ duplicates });

      } catch (e: any) {
        fastify.log.error(e, 'Failed to check for duplicates');
        return reply.status(500).send({ error: 'An error occurred while checking for duplicates.' });
      }
    }
  );

  /**
   * GET /api/contributions/stats
   * Gathers statistics about all submissions for the admin dashboard.
   */
  fastify.get('/stats', async (request, reply) => {
    if (request.user.id !== 'admin') {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [totalCounts, recentSubmissions, reviewedSubmissions] = await fastify.prisma.$transaction([
        fastify.prisma.submission.groupBy({
          by: ['status'],
          _count: {
            id: true,
          },
        }),
        fastify.prisma.submission.count({
          where: {
            submittedAt: {
              gte: sevenDaysAgo,
            },
          },
        }),
        fastify.prisma.submission.findMany({
          where: {
            status: { in: ['accepted', 'rejected'] },
            reviewedAt: { not: null },
          },
          select: {
            submittedAt: true,
            reviewedAt: true,
          },
        }),
      ]);

      const stats = {
        pending: totalCounts.find(c => c.status === 'pending')?._count.id || 0,
        accepted: totalCounts.find(c => c.status === 'accepted')?._count.id || 0,
        rejected: totalCounts.find(c => c.status === 'rejected')?._count.id || 0,
        last7Days: recentSubmissions,
        averageReviewTime: 0,
      };

      if (reviewedSubmissions.length > 0) {
        const totalReviewTime = reviewedSubmissions.reduce((acc, s) => {
          // 'reviewedAt' can be null, so we need a type guard, but the query filters for not null.
          const reviewTime = (s.reviewedAt as Date).getTime() - s.submittedAt.getTime();
          return acc + reviewTime;
        }, 0);
        const avgMilliseconds = totalReviewTime / reviewedSubmissions.length;
        // Convert to hours for easier display
        stats.averageReviewTime = Math.round(avgMilliseconds / (1000 * 60 * 60));
      }

      return reply.send(stats);

    } catch (e: any) {
      fastify.log.error(e, 'Failed to get submission stats');
      return reply.status(500).send({ error: 'An error occurred while fetching statistics.' });
    }
  });
};

export default contributionsRoutes;
