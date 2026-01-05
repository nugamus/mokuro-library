import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { libraryCache } from './caches/libraryCache';

function extractTags(userId: string, data: any, hints: string[]): string[] {
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
      if (pathParts.length === 0 || pathParts[0] === '.') {
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

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  const adapter = new PrismaBetterSqlite3(
    { url: databaseUrl },
    { timestampFormat: 'iso8601' }
  );

  let basePrisma = new PrismaClient({ adapter });

  let extendedPrisma = basePrisma.$extends({
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
            const userId = (args as any).where?.userId || (args as any).data?.userId || (args as any).where?.ownerId;

            // The ID of the primary record being mutated
            const id = (args as any).where?.id || (args as any).data?.id || (result as any)?.id;
            const tagsToClear = new Set<string>();
            const uid = userId?.toLowerCase();

            if (id) tagsToClear.add(`${m}:${id}`);
            else if (uid) tagsToClear.add(`${uid}:${m}`);
            else tagsToClear.add(`${m}`);
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
