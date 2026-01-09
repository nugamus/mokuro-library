import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { libraryCache } from './caches/libraryCache';
import { HttpError } from '../types/error';

function extractTags(userId: string, data: Record<string, any>, hints: string[]): string[] {
  const tags = new Set<string>();

  for (const hint of hints) {
    const [model, path, shared] = hint.split(':');
    const m = model.toLowerCase();
    const uid = userId.toLowerCase();

    // Always add blanket tag: "user1:series"
    tags.add(`${m}`);
    tags.add(`${uid}:${m}`);
    if (shared === 'shared') tags.add(`admin:${m}`);

    const getValues = (obj: any, pathParts: string[]) => {
      if (!obj) return;
      if (pathParts.length === 0 || pathParts[0] === '') {
        if (obj.id) tags.add(`${m}:${obj.id}`);
        return;
      }

      const [current, ...rest] = pathParts;
      const val = obj[current];

      if (Array.isArray(val)) {
        val.forEach(item => getValues(item, rest));
      } else {
        getValues(val, rest);
      }
    };

    getValues(data, path.split('.'));
  }
  return Array.from(tags);
}

async function updateSeriesStats(
  prisma: PrismaClient,
  userId: string,
  seriesId: string,
  pageDelta: number,
  volumeDelta: number
) {
  // 1. Atomic Update of Counts
  // We use increment/decrement to ensure thread safety during concurrent writes
  const updatedSettings = await prisma.userSeriesSettings.upsert({
    where: { userId_seriesId: { userId, seriesId } },
    create: {
      userId,
      seriesId,
      readPageCount: pageDelta > 0 ? pageDelta : 0,
      completedVolumeCount: volumeDelta > 0 ? volumeDelta : 0,
      status: 0
    },
    update: {
      readPageCount: { increment: pageDelta },
      completedVolumeCount: { increment: volumeDelta }
    }
  });

  // 2. Recalculate "Read Status" based on the new counts
  // We need the Series totals to know if we are "Completed"
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { totalVolumeCount: true }
  });

  if (!series) return;

  let newStatus = 0; // Unread
  // Logic: If you've finished all volumes (and there is at least 1 volume), it's Completed.
  if (updatedSettings.completedVolumeCount >= series.totalVolumeCount && series.totalVolumeCount > 0) {
    newStatus = 2; // Completed
  } else if (updatedSettings.readPageCount > 0) {
    newStatus = 1; // Reading
  }

  // Only update status if it actually changed (DB optimization)
  if (updatedSettings.status !== newStatus) {
    await prisma.userSeriesSettings.update({
      where: { userId_seriesId: { userId, seriesId } },
      data: { status: newStatus }
    });
  }
}

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  const adapter = new PrismaBetterSqlite3(
    { url: databaseUrl },
    { timestampFormat: 'iso8601' }
  );

  const basePrisma = new PrismaClient({ adapter });

  // --- EXTENSION 1: Stats & Counters ---
  const statsClient = basePrisma.$extends({
    name: 'statsExtension',
    query: {
      volume: {
        async create({ args, query }) {
          const result = await query(args);
          // 1. Increment Series Stats on Create
          if (!result.seriesId) throw new HttpError(403, `Create volume query must select seriesId for stat sync.`)
          await basePrisma.series.update({
            where: { id: result.seriesId },
            data: {
              totalPageCount: { increment: result.pageCount },
              totalVolumeCount: { increment: 1 },
            },
          });
          await basePrisma.userSeriesSettings.updateMany({
            where: { seriesId: result.seriesId, status: 2 },
            data: { status: 1 }
          })
          return result;
        },
        async delete({ args, query }) {
          // 2. Handle Volume Deletion
          // NOTE: We must pre-fetch data because 'Cascade' delete happens at DB level
          // and we won't be able to see the connected progress rows after the delete.
          const volId = args.where.id;
          if (!volId) return query(args);

          const volume = await basePrisma.volume.findUnique({
            where: { id: volId },
            include: {
              progress: true // Fetch users who will be affected
            }
          });

          if (!volume) return query(args);

          // Execute the Delete
          const result = await query(args);

          // A. Decrement Series Stats
          const series = await basePrisma.series.update({
            where: { id: volume.seriesId },
            data: {
              totalPageCount: { decrement: volume.pageCount },
              totalVolumeCount: { decrement: 1 },
            },
          });

          await basePrisma.userSeriesSettings.updateMany({
            where: { seriesId: series.id, completedVolumeCount: series.totalVolumeCount },
            data: { status: 2 }
          });

          // B. Decrement User Stats (Manual Cascade Handling)
          for (const p of volume.progress) {
            // Rule: If they finished the volume, they lose 'pageCount' pages.
            //       If they were reading it, they lose 'p.page' pages.
            const pagesToRemove = p.completed ? volume.pageCount : p.page;
            const volumesToRemove = p.completed ? 1 : 0;

            await updateSeriesStats(basePrisma, p.userId, volume.seriesId, -pagesToRemove, -volumesToRemove);
          }

          return result;
        },
        async update({ args, query }) {
          // 1. Pre-fetch Old Data
          const oldVolume = await basePrisma.volume.findFirst({
            where: args.where,
            include: { progress: true }
          });

          if (!oldVolume) return query(args);

          const newSeriesId = (args.data.seriesId as string) || oldVolume.seriesId;
          const newPageCount = (args.data.pageCount as number) ?? oldVolume.pageCount;

          // Optimization: If relevant fields didn't change, skip logic
          if (newSeriesId === oldVolume.seriesId && newPageCount === oldVolume.pageCount) {
            return query(args);
          }

          // 2. Execute Update
          const result = await query(args);

          // 3. LOGIC: REMOVE from Old Location
          const oldSeries = await basePrisma.series.update({
            where: { id: oldVolume.seriesId },
            data: {
              totalPageCount: { decrement: oldVolume.pageCount },
              totalVolumeCount: { decrement: 1 }
            }
          });

          // Auto-Promote users in old series (Standard Delete Logic)
          await basePrisma.userSeriesSettings.updateMany({
            where: { seriesId: oldVolume.seriesId, completedVolumeCount: oldSeries.totalVolumeCount },
            data: { status: 2 }
          });

          // Remove User Stats from Old Series
          for (const p of oldVolume.progress) {
            const pages = p.completed ? oldVolume.pageCount : p.page;
            const vol = p.completed ? 1 : 0;
            await updateSeriesStats(basePrisma, p.userId, oldVolume.seriesId, -pages, -vol);
          }

          // 4. LOGIC: ADD to New Location
          await basePrisma.series.update({
            where: { id: newSeriesId },
            data: {
              totalPageCount: { increment: newPageCount },
              totalVolumeCount: { increment: 1 }
            }
          });

          // Auto-Demote users in new series (Standard Create Logic)
          // "If you were done, you aren't anymore because I just added/moved a book here."
          await basePrisma.userSeriesSettings.updateMany({
            where: { seriesId: newSeriesId, status: 2 },
            data: { status: 1 }
          });

          // Add User Stats to New Series
          for (const p of oldVolume.progress) {
            // Note: We use newPageCount here. If they completed it, their read-count scales up/down.
            const pages = p.completed ? newPageCount : p.page;
            const vol = p.completed ? 1 : 0;
            await updateSeriesStats(basePrisma, p.userId, newSeriesId, pages, vol);
          }

          return result;
        },
        // --- SAFETY BLOCKS ---
        async upsert() { throw new Error("Stats Safety: 'upsert' is disabled for Volume. Use 'create' to ensure stats are tracked."); },
        async createMany() { throw new Error("Stats Safety: 'createMany' is disabled for Volume. Use 'create' in a loop."); },
        async deleteMany() { throw new Error("Stats Safety: 'deleteMany' is disabled for Volume. Use 'delete' in a loop."); }
      },
      userProgress: {
        async upsert({ args, query }) {
          const userId_volumeId = args.where.userId_volumeId;
          if (!userId_volumeId) throw new HttpError(403, `Upserting UserProgress cannot be done through direct id queries.`);

          const { userId, volumeId } = userId_volumeId;

          // Get "Before" State
          const oldProgress = await basePrisma.userProgress.findUnique({
            where: { userId_volumeId: { userId, volumeId } }
          });

          // Get Volume Context (for max pages)
          const volume = await basePrisma.volume.findUnique({
            where: { id: volumeId },
            select: { pageCount: true, seriesId: true }
          });

          if (!volume) throw new HttpError(500, `DB Corruption: Dangling UserProgress found.`);

          // Execute Update
          const result = await query(args);
          if (result.page === undefined) throw new HttpError(403, `Upserting UserProgress needs page field to be selected.`);

          // Calculate Deltas
          const oldCompleted = oldProgress?.completed ?? false;
          // Rule: If completed, pages = max. Else pages = current.
          const oldPages = oldCompleted ? volume.pageCount : (oldProgress?.page ?? 0);

          const newCompleted = result.completed;
          const newPages = newCompleted ? volume.pageCount : result.page;

          const deltaPages = newPages - oldPages;
          const deltaVolumes = (newCompleted ? 1 : 0) - (oldCompleted ? 1 : 0);

          if (deltaPages !== 0 || deltaVolumes !== 0) {
            await updateSeriesStats(basePrisma, userId, volume.seriesId, deltaPages, deltaVolumes);
          }

          return result;
        },
        async delete({ args, query }) {
          // Handle Single Progress Reset (Wipe)
          const userId_volumeId = args.where.userId_volumeId;
          if (!userId_volumeId) throw new HttpError(403, `Deleting UserProgress cannot be done through direct id queries.`);

          const { userId, volumeId } = userId_volumeId;
          const oldProgress = await basePrisma.userProgress.findUnique({
            where: { userId_volumeId: { userId, volumeId } },
            include: { volume: true }
          });

          const result = await query(args);

          if (oldProgress && oldProgress.volume) {
            const pagesToRemove = oldProgress.completed ? oldProgress.volume.pageCount : oldProgress.page;
            const volumesToRemove = oldProgress.completed ? 1 : 0;
            await updateSeriesStats(basePrisma, userId, oldProgress.volume.seriesId, -pagesToRemove, -volumesToRemove);
          }
          return result;
        },
        // --- SAFETY BLOCKS ---
        async create() { throw new Error("Stats Safety: 'create' is disabled for UserProgress. Use 'upsert' to ensure stats are tracked."); },
        async update() { throw new Error("Stats Safety: 'update' is disabled for UserProgress. Use 'upsert' to ensure stats are tracked."); },
        async createMany() { throw new Error("Stats Safety: 'createMany' is disabled for UserProgress."); },
        async deleteMany() { throw new Error("Stats Safety: 'deleteMany' is disabled for UserProgress."); }
      }
    }
  });

  // --- EXTENSION 2: Caching & Invalidation ---
  const extendedPrisma = statsClient.$extends({
    client: {
      async findCached<T>(
        userId: string,
        key: string,
        hints: string[],
        queryFn: () => Promise<T>
      ) {
        const uid = userId.toLowerCase()
        const fullCacheKey = `${uid}:${key}`;
        const result = await queryFn();
        if (!result) return result;

        // Automatically generate granular tags from the result
        const tags = extractTags(uid, result, hints);
        for (let t of tags) console.log(t);

        // return libraryCache.cachedQuery(fullCacheKey, tags, async () => result);
        return (async () => { return { ...(await libraryCache.cachedQuery(fullCacheKey, tags, async () => result)), tags } })()
      },
    },

    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);
          const mutations = ['create', 'update', 'upsert', 'delete', 'updateMany', 'deleteMany'];

          if (mutations.includes(operation)) {
            const m = model.toLowerCase();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userId = (args as any).where?.userId || (args as any).data?.userId || (args as any).where?.ownerId;

            // The ID of the primary record being mutated
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const id = (args as any).where?.id || (args as any).data?.id || (result as any)?.id;
            const tagsToClear = new Set<string>();
            const uid = userId?.toLowerCase();

            if (id) tagsToClear.add(`${m}:${id}`);
            else if (uid) tagsToClear.add(`${uid}:${m}`);
            else tagsToClear.add(`${m}`);

            if (uid && operation === 'create') tagsToClear.add(`${uid}:${m}`);
            libraryCache.invalidateTags(Array.from(tagsToClear));
          }
          return result;
        },
      },
    },
  });
  return extendedPrisma;
}

export const prisma = createPrismaClient();
export type ExtendedPrismaClient = typeof prisma;

declare module 'fastify' {
  interface FastifyInstance {
    prisma: ExtendedPrismaClient;  // Direct reference, same file
  }
}
