import { ExtendedPrismaClient } from '../lib/prisma';

/**
 * Recalculates the "Read Status" for a user on a specific series.
 * * Logic:
 * - 0 (Unread): No volumes started or completed.
 * - 1 (Reading): At least one volume completed OR in progress.
 * - 2 (Completed): All volumes in the series are marked as completed.
 * @param prisma The Prisma Client instance
 * @param userId The ID of the user whose status needs updating
 * @param seriesId The ID of the series to check
 */
export async function updateSeriesStatus(
  prisma: ExtendedPrismaClient,
  userId: string,
  seriesId: string
) {
  if (!userId || !seriesId) return;

  try {
    // 1. Get counts in parallel
    const [totalVolumes, completedVolumes, inProgressVolumes] = await Promise.all([
      // Count all volumes in this series
      prisma.volume.count({
        where: { seriesId }
      }),

      // Count volumes this user has finished
      prisma.userProgress.count({
        where: { userId, volume: { seriesId }, completed: true }
      }),

      // Count volumes this user has started but not finished (page > 1)
      prisma.userProgress.count({
        where: { userId, volume: { seriesId }, completed: false, page: { gt: 1 } }
      })
    ]);

    // 2. Determine Status
    let newStatus = 0; // Default: Unread

    if (totalVolumes > 0 && completedVolumes === totalVolumes) {
      newStatus = 2; // Completed
    } else if (completedVolumes > 0 || inProgressVolumes > 0) {
      newStatus = 1; // Reading
    }

    // 3. Upsert UserSeriesSettings
    // We use upsert because the user might not have interacted with this series before
    await prisma.userSeriesSettings.upsert({
      where: {
        userId_seriesId: { userId, seriesId }
      },
      create: {
        userId,
        seriesId,
        status: newStatus
        // Note: We don't touch 'bookmarked' or 'organized' here, they default to false/false
      },
      update: {
        status: newStatus
      }
    });

  } catch (error) {
    console.error(`Failed to update series status for user ${userId} series ${seriesId}:`, error);
    // We swallow the error here because status updates are often side effects 
    // and shouldn't crash the main request (like an upload or delete).
  }
}
