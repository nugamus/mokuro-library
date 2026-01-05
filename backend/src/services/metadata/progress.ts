import type { FastifyInstance } from 'fastify';
import { Prisma } from '../../generated/prisma/client';
import { libraryCache } from '../../lib/caches/libraryCache';
import { updateSeriesStatus } from '../../utils/seriesStatus';

export type ProgressBody = {
  page?: number;
  timeRead?: number;
  charsRead?: number;
  completed?: boolean;
};

export const progressBodySchema = {
  type: 'object',
  properties: {
    page: { type: 'integer', minimum: 1 },
    timeRead: { type: 'integer', minimum: 0 },
    charsRead: { type: 'integer', minimum: 0 },
    completed: { type: 'boolean' },
  },
};

export async function getVolumeProgress(
  fastify: FastifyInstance,
  volumeId: string,
  userId: string
) {
  const progress = await fastify.prisma.userProgress.findUnique({
    where: {
      userId_volumeId: {
        userId,
        volumeId,
      },
    },
    select: {
      page: true,
      timeRead: true,
      charsRead: true,
      completed: true,
    },
  });

  if (!progress) {
    return {
      page: 1,
      timeRead: 0,
      charsRead: 0,
      completed: false,
    };
  }

  return progress;
}

export async function updateVolumeProgress(
  fastify: FastifyInstance,
  volumeId: string,
  userId: string,
  data: ProgressBody
) {
  const upsertedProgress = await fastify.prisma.userProgress.upsert({
    where: { userId_volumeId: { userId, volumeId } },
    update: { ...data },
    create: { userId, volumeId, ...data },
  });

  const volume = await fastify.prisma.volume.findUnique({
    where: { id: volumeId },
    select: { seriesId: true }
  });

  if (volume) {
    const seriesId = volume.seriesId;

    if (data.completed !== undefined) {
      await updateSeriesStatus(fastify.prisma, userId, seriesId);

      await fastify.prisma.userSeriesSettings.upsert({
        where: { userId_seriesId: { userId, seriesId } },
        create: { userId, seriesId, lastReadAt: new Date(), status: data.completed ? 1 : 0 },
        update: { lastReadAt: new Date() }
      });
    } else if (data.page !== undefined) {
      const currentSettings = await fastify.prisma.userSeriesSettings.findUnique({
        where: { userId_seriesId: { userId, seriesId } },
        select: { status: true }
      });

      const shouldBumpStatus = !currentSettings || currentSettings.status === 0;

      await fastify.prisma.userSeriesSettings.upsert({
        where: { userId_seriesId: { userId, seriesId } },
        create: {
          userId,
          seriesId,
          lastReadAt: new Date(),
          status: 1
        },
        update: {
          lastReadAt: new Date(),
          ...(shouldBumpStatus ? { status: 1 } : {})
        }
      });
    }
  }

  return { ...upsertedProgress, seriesId: volume?.seriesId };
}

export async function resetVolumeProgress(
  fastify: FastifyInstance,
  volumeId: string,
  userId: string
) {
  await fastify.prisma.userProgress.delete({
    where: { userId_volumeId: { userId, volumeId } },
  });

  const volume = await fastify.prisma.volume.findUnique({
    where: { id: volumeId },
    select: { seriesId: true }
  });
  if (volume) await updateSeriesStatus(fastify.prisma, userId, volume.seriesId);

  return { message: 'Progress reset successfully.' };
}
