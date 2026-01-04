/**
 * Smart API cache with stale-while-revalidate pattern
 * Serves cached data instantly while fetching fresh data in background
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  promise?: Promise<T>;
}

class APICache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxAge = 5 * 60 * 1000; // 5 minutes default
  private staleTime = 30 * 1000; // 30 seconds - serve stale while revalidating

  /**
   * Get cached data or fetch fresh
   * Returns cached data immediately if available, fetches in background if stale
   */
  async get<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: {
      maxAge?: number;
      staleTime?: number;
      skipCache?: boolean;
    }
  ): Promise<T> {
    const maxAge = options?.maxAge ?? this.maxAge;
    const staleTime = options?.staleTime ?? this.staleTime;

    // Force refresh if skipCache
    if (options?.skipCache) {
      const data = await fetcher();
      this.set(key, data);
      return data;
    }

    const cached = this.cache.get(key);
    const now = Date.now();

    // No cache - fetch fresh
    if (!cached) {
      const promise = fetcher();
      this.cache.set(key, { data: null as any, timestamp: now, promise });

      const data = await promise;
      this.set(key, data);
      return data;
    }

    // Check if already fetching
    if (cached.promise) {
      return cached.promise;
    }

    const age = now - cached.timestamp;

    // Fresh data - return immediately
    if (age < staleTime) {
      return cached.data;
    }

    // Stale but not expired - return cached, revalidate in background
    if (age < maxAge) {
      // Don't revalidate if already revalidating
      if (!cached.promise) {
        const promise = fetcher();
        cached.promise = promise;

        promise
          .then((data) => {
            this.set(key, data);
          })
          .catch((err) => {
            console.error('Background revalidation failed:', err);
            delete cached.promise;
          });
      }

      return cached.data;
    }

    // Expired - fetch fresh
    const data = await fetcher();
    this.set(key, data);
    return data;
  }

  /**
   * Set cache entry
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      promise: undefined
    });
  }

  /**
   * Prefetch data (fetch and cache without returning)
   */
  async prefetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
    const cached = this.cache.get(key);
    const now = Date.now();

    // Skip if fresh data exists
    if (cached && now - cached.timestamp < this.staleTime) {
      return;
    }

    // Skip if already prefetching
    if (cached?.promise) {
      return;
    }

    try {
      const promise = fetcher();
      this.cache.set(key, {
        data: cached?.data ?? (null as any),
        timestamp: now,
        promise
      });
      const data = await promise;
      this.set(key, data);
    } catch (err) {
      console.error('Prefetch failed:', err);
      const current = this.cache.get(key);
      if (current?.promise) {
        delete current.promise;
      }
    }
  }

  /**
   * Invalidate cache entries by prefix
   */
  invalidate(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  invalidateExact(entry: string): void {
    this.cache.delete(entry);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Invalidate cache when user makes changes
   */
  invalidateLibraryCache(): void {
    this.invalidate('GET:/api/library');
  }

  invalidateStatsCache(): void {
    this.invalidateExact('GET:/api/stats');
  }

  invalidateContributionsCache(): void {
    this.invalidate('GET:/api/contributions');
  }

  invalidateSeriesCache(seriesId?: string): void {
    if (seriesId) this.invalidateExact(`GET:/api/library/series/${seriesId}`);
    else this.invalidate(`GET:/api/library/series`);
  }

  invalidateVolumeCache(volumeId?: string): void {
    if (volumeId) this.invalidateExact(`GET:/api/library/volume/${volumeId}`);
    else this.invalidate(`GET:/api/library/volume`);
  }
}

export const apiCache = new APICache();
