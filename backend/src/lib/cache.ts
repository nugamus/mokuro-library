import { LRUCache } from 'lru-cache';

type CacheValue = string | number | boolean | bigint | symbol | object;

const queryCache = new LRUCache<string, CacheValue>({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
});

export async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = queryCache.get(key) as T | undefined;
  if (cached !== undefined) return cached;

  const result = await queryFn();
  if (result !== null && result !== undefined) {
    queryCache.set(key, result as CacheValue, ttl ? { ttl } : undefined);
  }
  return result;
}

export function invalidateCache(key: string) {
  queryCache.delete(key);
}

export function invalidateCacheByPrefix(prefix: string) {
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) {
      queryCache.delete(key);
    }
  }
}
