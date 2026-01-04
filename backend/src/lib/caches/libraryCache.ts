import { LRUCache } from 'lru-cache';

type CacheValue = string | number | boolean | bigint | symbol | object;

class LibraryCache {
  private static instance: LibraryCache;
  private queryCache: LRUCache<string, CacheValue>;

  constructor() {
    this.queryCache = new LRUCache<string, CacheValue>({
      max: 1000,
      ttl: 1000 * 60 * 5, // 5 minutes
    });

  }

  public static getInstance(): LibraryCache {
    if (!LibraryCache.instance) {
      LibraryCache.instance = new LibraryCache();
    }
    return LibraryCache.instance;
  }

  public async cachedQuery<T>(
    key: string,
    queryFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.queryCache.get(key) as T | undefined;
    if (cached !== undefined) return cached;

    const result = await queryFn();
    if (result !== null && result !== undefined) {
      this.queryCache.set(key, result as CacheValue, ttl ? { ttl } : undefined);
    }
    return result;
  }

  public invalidateCache(key: string) {
    this.queryCache.delete(key);
  }

  public invalidateCacheByPrefix(prefix: string) {
    for (const key of this.queryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.queryCache.delete(key);
      }
    }
  }

  /**
   * Invalidates all library-related cache entries for a user
   *
   * @param userId - The user whose library cache should be invalidated
   *
   * @example
   * ```typescript
   * invalidateLibraryCache(userId);
   * ```
   */
  public invalidateLibraryCache(userId: string): void {
    this.invalidateCacheByPrefix(`library:${userId}`);
  }

  /**
   * Invalidates series-related cache entries
   *
   * @param userId - The user ID
   * @param seriesId - Optional specific series ID to invalidate
   *
   * @example
   * ```typescript
   * // Invalidate all series for a user
   * invalidateSeriesCache(userId);
   *
   * // Invalidate specific series
   * invalidateSeriesCache(userId, seriesId);
   * ```
   */
  public invalidateSeriesCache(userId: string, seriesId?: string): void {
    if (seriesId) {
      this.invalidateCacheByPrefix(`series:${userId}:${seriesId}`);
    } else {
      this.invalidateCacheByPrefix(`series:${userId}`);
    }
  }

  /**
   * Invalidates volume-related cache entries
   *
   * @param userId - The user ID
   * @param volumeId - Optional specific volume ID to invalidate
   *
   * @example
   * ```typescript
   * // Invalidate all volumes for a user
   * invalidateVolumeCache(userId);
   *
   * // Invalidate specific volume
   * invalidateVolumeCache(userId, volumeId);
   * ```
   */
  public invalidateVolumeCache(userId: string, volumeId?: string): void {
    if (volumeId) {
      this.invalidateCacheByPrefix(`volume:${userId}:${volumeId}`);
    } else {
      this.invalidateCacheByPrefix(`volume:${userId}`);
    }
  }

  /**
   * Invalidates all content caches for a user (library, series, volumes)
   *
   * Use this when making changes that affect multiple cache levels,
   * such as uploading new content, deleting series, or updating metadata.
   *
   * @param userId - The user ID
   * @param options - Optional specific IDs to invalidate
   * @param options.seriesId - Specific series to invalidate
   * @param options.volumeId - Specific volume to invalidate
   *
   * @example
   * ```typescript
   * // Invalidate all user content after upload
   * invalidateUserContentCache(userId);
   *
   * // Invalidate specific series and its volumes
   * invalidateUserContentCache(userId, { seriesId });
   *
   * // Invalidate specific volume
   * invalidateUserContentCache(userId, { volumeId });
   * ```
   */
  public invalidateUserContentCache(
    userId: string,
    options?: {
      seriesId?: string;
      volumeId?: string;
    }
  ): void {
    this.invalidateLibraryCache(userId);
    this.invalidateSeriesCache(userId, options?.seriesId);
    this.invalidateVolumeCache(userId, options?.volumeId);
  }

  /**
   * Invalidates metadata-related caches
   *
   * @param userId - The user ID
   * @param seriesId - The series ID
   *
   * @example
   * ```typescript
   * invalidateMetadataCache(userId, seriesId);
   * ```
   */
  public invalidateMetadataCache(userId: string, seriesId: string): void {
    this.invalidateSeriesCache(userId, seriesId);
    this.invalidateLibraryCache(userId);
  }

  /**
   * Invalidates OCR-related caches for a volume
   *
   * @param userId - The user ID
   * @param volumeId - The volume ID
   *
   * @example
   * ```typescript
   * invalidateOcrCache(userId, volumeId);
   * ```
   */
  public invalidateOcrCache(userId: string, volumeId: string): void {
    this.invalidateVolumeCache(userId, volumeId);
  }

  /**
   * Invalidates progress-related caches
   *
   * @param userId - The user ID
   * @param volumeId - The volume ID
   *
   * @example
   * ```typescript
   * invalidateProgressCache(userId, volumeId);
   * ```
   */
  public invalidateProgressCache(userId: string, volumeId: string): void {
    this.invalidateVolumeCache(userId, volumeId);
    this.invalidateLibraryCache(userId);
  }
}

export const libraryCache = LibraryCache.getInstance();
