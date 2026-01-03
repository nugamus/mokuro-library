import { Prisma, UserSeriesSettings } from '../../generated/prisma/client';

type SeriesWithVolumes = Prisma.SeriesGetPayload<{
  include: {
    volumes: {
      select: {
        pageCount: true;
        progress: {
          select: {
            completed: true;
            page: true;
          };
        };
      };
    };
  };
}>;

export type SeriesWithOptionalSettings = SeriesWithVolumes & {
  userSettings?: UserSeriesSettings[];
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
  const { userSettings, ...cleanSeries } = series;

  return {
    ...cleanSeries,
    // 1. Flattened User State (Defaults if no interaction yet)
    bookmarked: userStats?.bookmarked ?? false,
    status: userStats?.status ?? 0,
    organized: userStats?.organized ?? false,
    lastReadAt: userStats?.lastReadAt ?? new Date(0), // Epoch if never read

    // 2. Computed "Official" Indicator
    isOfficial: series.ownerId === 'admin',

    // 3. Permissions Flag (Optional, helps frontend disable delete buttons)
    canEdit: series.ownerId === userId
  };
}
