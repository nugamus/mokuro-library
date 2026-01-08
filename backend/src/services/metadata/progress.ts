import type { FastifyInstance } from 'fastify';

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
    await fastify.prisma.userSeriesSettings.upsert({
      where: { userId_seriesId: { userId, seriesId: volume.seriesId } },
      create: {
        userId,
        seriesId: volume.seriesId,
        lastReadAt: new Date()
        // Extension default for status is 0 (Unread), but extension 'upsert' hook
        // might immediately flip it to Reading if progress > 0.
      },
      update: { lastReadAt: new Date() }
    });
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

  return { message: 'Progress reset successfully.' };
}
