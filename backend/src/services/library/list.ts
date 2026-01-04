import type { FastifyInstance } from 'fastify';
import type { LibraryQuery } from '../../types/library';
import { Prisma } from '../../generated/prisma/client';
import { libraryCache } from '../../lib/caches/libraryCache';
import { transformSeries } from './seriesTransform';

export async function getLibraryList(
  fastify: FastifyInstance,
  userId: string,
  query: LibraryQuery
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  const q = query.q?.trim() ?? '';
  const sort = query.sort ?? 'title';
  const order = query.order ?? 'asc';
  const status = query.status ?? 'all';
  const bookmarked = query.bookmarked === 'true';
  const filter_missing = query.filter_missing ?? 'none';
  const is_organized = query.is_organized;

  const seriesWhere: Prisma.SeriesWhereInput = {
    AND: [
      { OR: [{ ownerId: userId }, { ownerId: 'admin' }] }
    ]
  };
  const andConditions = (seriesWhere.AND as Prisma.SeriesWhereInput[]);

  if (q) {
    andConditions.push({
      OR: [
        { sortTitle: { contains: q } },
        { japaneseTitle: { contains: q } },
        { romajiTitle: { contains: q } },
        { synonyms: { contains: q } }
      ]
    });
  }

  if (filter_missing !== 'none') {
    if (filter_missing === 'cover') andConditions.push({ coverPath: null });
    else if (filter_missing === 'description') {
      andConditions.push({ OR: [{ description: null }, { description: '' }] });
    } else if (filter_missing === 'title') {
      andConditions.push({ OR: [{ japaneseTitle: null }, { romajiTitle: null }] });
    } else if (filter_missing === 'any') {
      andConditions.push({ OR: [{ coverPath: null }, { description: null }, { japaneseTitle: null }] });
    }
  }

  const addUserFilter = (filter: Prisma.UserSeriesSettingsWhereInput) => {
    andConditions.push({ userSettings: { some: { userId: userId, ...filter } } });
  };

  if (bookmarked) addUserFilter({ bookmarked: true });
  if (is_organized === 'true') addUserFilter({ organized: true });
  else if (is_organized === 'false') {
    andConditions.push({
      OR: [
        { userSettings: { none: { userId } } },
        { userSettings: { some: { userId, organized: false } } }
      ]
    });
  }

  if (status === 'reading') addUserFilter({ status: 1 });
  else if (status === 'read') addUserFilter({ status: 2 });
  else if (status === 'unread') {
    andConditions.push({
      OR: [
        { userSettings: { none: { userId } } },
        { userSettings: { some: { userId, status: 0 } } }
      ]
    });
  }

  const cacheKey = `library:${userId}:${JSON.stringify({
    page,
    limit,
    q,
    sort,
    order,
    status,
    bookmarked,
    filter_missing,
    is_organized
  })}`;

  return libraryCache.cachedQuery(cacheKey, async () => {
    if (sort === 'recent') {
      const [total, settings] = await fastify.prisma.$transaction([
        fastify.prisma.userSeriesSettings.count({
          where: { userId, series: seriesWhere }
        }),
        fastify.prisma.userSeriesSettings.findMany({
          where: { userId, series: seriesWhere },
          orderBy: { lastReadAt: order },
          take: limit,
          skip: (page - 1) * limit,
          include: {
            series: {
              include: {
                volumes: {
                  orderBy: { sortTitle: 'asc' },
                  select: {
                    pageCount: true,
                    progress: { where: { userId }, select: { completed: true, page: true } }
                  }
                }
              }
            }
          }
        })
      ]);

      const data = settings.map((setting: any) => transformSeries(setting.series, userId, setting));

      return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
      };
    }

    let orderBy: Prisma.SeriesOrderByWithRelationInput;
    if (sort === 'created') orderBy = { createdAt: order };
    else if (sort === 'updated') orderBy = { updatedAt: order };
    else orderBy = { sortTitle: order };

    const [total, seriesList] = await fastify.prisma.$transaction([
      fastify.prisma.series.count({ where: seriesWhere }),
      fastify.prisma.series.findMany({
        where: seriesWhere,
        orderBy,
        take: limit,
        skip: (page - 1) * limit,
        include: {
          userSettings: { where: { userId } },
          volumes: {
            orderBy: { sortTitle: 'asc' },
            select: {
              pageCount: true,
              progress: { where: { userId }, select: { completed: true, page: true } }
            }
          }
        }
      })
    ]);

    const data = seriesList.map((series: any) => transformSeries(series, userId));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
    };
  });
}
