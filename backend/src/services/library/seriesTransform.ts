import { Prisma, UserSeriesSettings } from '../../generated/prisma/client';

type SeriesBase = Prisma.SeriesGetPayload<null>;

export type SeriesWithOptionalSettings = SeriesBase & {
  userSettings?: UserSeriesSettings[];

  // We might still have volumes if this is used by getSeries (single view),
  // so we allow it but don't require it for the transform.
  volumes?: any[];
};

export function transformSeries(
  series: SeriesWithOptionalSettings,
  userId: string,
  settings?: UserSeriesSettings
) {
  // If we came from the 'recent' sort, settings are passed directly.
  // If we came from standard sort, settings are in series.userSettings[0].
  const userStats = settings || series.userSettings?.[0];

  // Remove internal relations we don't want to send raw
  // (We use destructuring to separate relations from scalar fields)
  const { userSettings, volumes, ...cleanSeries } = series;

  return {
    ...cleanSeries,
    // 1. Flattened User State (Defaults if no interaction yet)
    bookmarked: userStats?.bookmarked ?? false,
    status: userStats?.status ?? 0,
    organized: userStats?.organized ?? false,
    lastReadAt: userStats?.lastReadAt ?? new Date(0), // Epoch if never read

    // 2. Progress Stats (From Cached DB Fields)
    totalPageCount: cleanSeries.totalPageCount ?? 0,
    totalVolumeCount: cleanSeries.totalVolumeCount ?? 0,
    readPageCount: userStats?.readPageCount ?? 0,
    completedVolumeCount: userStats?.completedVolumeCount ?? 0,

    // 3. Computed "Official" Indicator
    isOfficial: series.ownerId === 'admin',

    // 4. Permissions Flag
    canEdit: series.ownerId === userId
  };
}
