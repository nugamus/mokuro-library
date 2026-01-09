import { describe, expect, it } from 'vitest';
import type { Series, Volume } from '$lib/types';
import type { ActivityEntry } from '../lib/types';
import {
  buildActivityGraph,
  buildSeriesContributions,
  filterSeriesByStatus,
  getVolumesNeedingRebase
} from '../lib/utils';

const createVolume = (id: string): Volume => ({
  id,
  seriesId: 'series-1',
  title: id,
  sortTitle: id,
  folderName: id,
  pageCount: 10,
  coverImageName: null,
  createdAt: '2025-01-01T00:00:00Z',
  progress: []
});

const createSeries = (volumes: Volume[]): Series => ({
  id: 'series-1',
  title: 'Series One',
  sortTitle: 'Series One',
  japaneseTitle: null,
  romajiTitle: null,
  synonyms: null,
  folderName: 'series-one',
  description: null,
  coverPath: null,
  bookmarked: false,
  organized: false,
  status: 0,
  updatedAt: '2025-01-01T00:00:00Z',
  volumes
});

describe('contributions utils', () => {
  it('builds contribution series and filter counts', () => {
    const volumes = [createVolume('vol-a'), createVolume('vol-b'), createVolume('vol-c')];
    const series = createSeries(volumes);

    const result = buildSeriesContributions([series]);

    expect(result.seriesList).toHaveLength(1);
    expect(result.filterCounts.behind).toBe(1);
    expect(result.filterCounts.ahead).toBe(1);

    const [contributionSeries] = result.seriesList;
    expect(contributionSeries.volumes).toHaveLength(3);
    expect(contributionSeries.volumes[0].hasAhead).toBe(true);
    expect(contributionSeries.volumes[0].hasBehind).toBe(true);
    expect(contributionSeries.volumes[2].hasAhead).toBe(true);
    expect(contributionSeries.volumes[2].hasBehind).toBe(false);
  });

  it('filters series by ahead/behind state', () => {
    const volumes = [createVolume('vol-a')];
    const series = createSeries(volumes);
    const result = buildSeriesContributions([series]);

    const behind = filterSeriesByStatus(result.seriesList, 'behind');
    const ahead = filterSeriesByStatus(result.seriesList, 'ahead');

    expect(behind).toHaveLength(1);
    expect(ahead).toHaveLength(1);
  });

  it('collects volumes needing rebase', () => {
    const volumes = [createVolume('vol-a'), createVolume('vol-b'), createVolume('vol-c')];
    const series = createSeries(volumes);
    const result = buildSeriesContributions([series]);

    const needsRebase = getVolumesNeedingRebase(result.seriesList);

    expect(needsRebase).toHaveLength(2);
    expect(needsRebase.map((volume) => volume.id)).toEqual(['vol-a', 'vol-b']);
  });

  it('builds activity graph buckets', () => {
    const now = new Date();
    const today = now.toISOString();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const activityHistory: ActivityEntry[] = [
      {
        id: 'activity-1',
        volumeId: 'vol-a',
        volumeTitle: 'Vol A',
        seriesTitle: 'Series One',
        seriesId: 'series-1',
        timestamp: today,
        patchCount: 2,
        editType: 'text'
      },
      {
        id: 'activity-2',
        volumeId: 'vol-b',
        volumeTitle: 'Vol B',
        seriesTitle: 'Series One',
        seriesId: 'series-1',
        timestamp: yesterday,
        patchCount: 3,
        editType: 'box'
      }
    ];

    const graph = buildActivityGraph(activityHistory, 2);
    const todayKey = today.split('T')[0];
    const yesterdayKey = yesterday.split('T')[0];

    expect(graph).toHaveLength(2);
    expect(graph.find((day) => day.date === todayKey)?.count).toBe(2);
    expect(graph.find((day) => day.date === yesterdayKey)?.count).toBe(3);
  });
});
