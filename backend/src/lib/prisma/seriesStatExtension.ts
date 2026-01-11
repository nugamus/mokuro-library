import { HttpError } from "../../types/error";
import { Prisma } from "../../generated/prisma/client";
import { DynamicClientExtensionThis, InternalArgs, DefaultArgs } from "@prisma/client/runtime/client";

async function updateSeriesStats(
  prisma: DynamicClientExtensionThis<Prisma.TypeMap<InternalArgs & DefaultArgs, {}>, Prisma.TypeMapCb<{}>, DefaultArgs>,
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

export const statsExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: 'statsExtension',
    query: {
      volume: {
        async create({ args, query }) {
          const result = await query(args);
          // 1. Increment Series Stats on Create
          if (!result.seriesId) throw new HttpError(403, `Create volume query must select seriesId for stat sync.`)
          await client.series.update({
            where: { id: result.seriesId },
            data: {
              totalPageCount: { increment: result.pageCount },
              totalVolumeCount: { increment: 1 },
            },
          });
          await client.userSeriesSettings.updateMany({
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

          const volume = await client.volume.findUnique({
            where: { id: volId },
            include: {
              progress: true // Fetch users who will be affected
            }
          });

          if (!volume) return query(args);

          // Execute the Delete
          const result = await query(args);

          // A. Decrement Series Stats
          const series = await client.series.update({
            where: { id: volume.seriesId },
            data: {
              totalPageCount: { decrement: volume.pageCount },
              totalVolumeCount: { decrement: 1 },
            },
          });

          await client.userSeriesSettings.updateMany({
            where: { seriesId: series.id, completedVolumeCount: series.totalVolumeCount },
            data: { status: 2 }
          });

          // B. Decrement User Stats (Manual Cascade Handling)
          for (const p of volume.progress) {
            // Rule: If they finished the volume, they lose 'pageCount' pages.
            //       If they were reading it, they lose 'p.page' pages.
            const pagesToRemove = p.completed ? volume.pageCount : p.page;
            const volumesToRemove = p.completed ? 1 : 0;

            await updateSeriesStats(client, p.userId, volume.seriesId, -pagesToRemove, -volumesToRemove);
          }

          return result;
        },
        async update({ args, query }) {
          // 1. Pre-fetch Old Data
          const oldVolume = await client.volume.findFirst({
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
          const oldSeries = await client.series.update({
            where: { id: oldVolume.seriesId },
            data: {
              totalPageCount: { decrement: oldVolume.pageCount },
              totalVolumeCount: { decrement: 1 }
            }
          });

          // Auto-Promote users in old series (Standard Delete Logic)
          await client.userSeriesSettings.updateMany({
            where: { seriesId: oldVolume.seriesId, completedVolumeCount: oldSeries.totalVolumeCount },
            data: { status: 2 }
          });

          // Remove User Stats from Old Series
          for (const p of oldVolume.progress) {
            const pages = p.completed ? oldVolume.pageCount : p.page;
            const vol = p.completed ? 1 : 0;
            await updateSeriesStats(client, p.userId, oldVolume.seriesId, -pages, -vol);
          }

          // 4. LOGIC: ADD to New Location
          await client.series.update({
            where: { id: newSeriesId },
            data: {
              totalPageCount: { increment: newPageCount },
              totalVolumeCount: { increment: 1 }
            }
          });

          // Auto-Demote users in new series (Standard Create Logic)
          // "If you were done, you aren't anymore because I just added/moved a book here."
          await client.userSeriesSettings.updateMany({
            where: { seriesId: newSeriesId, status: 2 },
            data: { status: 1 }
          });

          // Add User Stats to New Series
          for (const p of oldVolume.progress) {
            // Note: We use newPageCount here. If they completed it, their read-count scales up/down.
            const pages = p.completed ? newPageCount : p.page;
            const vol = p.completed ? 1 : 0;
            await updateSeriesStats(client, p.userId, newSeriesId, pages, vol);
          }

          return result;
        },
        // --- SAFETY BLOCKS ---
        async updateMany({ args, query }) {
          if (args.data.seriesId) throw new Error("Stats Safety: 'updateMany' cannot be used to update seriesId. Use 'update' in a loop.");
          return await query(args);
        },
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
          const oldProgress = await client.userProgress.findUnique({
            where: { userId_volumeId: { userId, volumeId } }
          });

          // Get Volume Context (for max pages)
          const volume = await client.volume.findUnique({
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
            await updateSeriesStats(client, userId, volume.seriesId, deltaPages, deltaVolumes);
          }

          return result;
        },
        async delete({ args, query }) {
          // Handle Single Progress Reset (Wipe)
          const userId_volumeId = args.where.userId_volumeId;
          if (!userId_volumeId) throw new HttpError(403, `Deleting UserProgress cannot be done through direct id queries.`);

          const { userId, volumeId } = userId_volumeId;
          const oldProgress = await client.userProgress.findUnique({
            where: { userId_volumeId: { userId, volumeId } },
            include: { volume: true }
          });

          const result = await query(args);

          if (oldProgress && oldProgress.volume) {
            const pagesToRemove = oldProgress.completed ? oldProgress.volume.pageCount : oldProgress.page;
            const volumesToRemove = oldProgress.completed ? 1 : 0;
            await updateSeriesStats(client, userId, oldProgress.volume.seriesId, -pagesToRemove, -volumesToRemove);
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
  })
});
