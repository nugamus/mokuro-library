/**
 * Cache Invalidation Helpers
 *
 * Centralized cache invalidation utilities to reduce duplication and ensure
 * consistent cache management across the application.
 */

import { invalidateCacheByPrefix } from '../lib/cache.js';

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
export function invalidateLibraryCache(userId: string): void {
  invalidateCacheByPrefix(`library:${userId}`);
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
export function invalidateSeriesCache(userId: string, seriesId?: string): void {
  if (seriesId) {
    invalidateCacheByPrefix(`series:${userId}:${seriesId}`);
  } else {
    invalidateCacheByPrefix(`series:${userId}`);
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
export function invalidateVolumeCache(userId: string, volumeId?: string): void {
  if (volumeId) {
    invalidateCacheByPrefix(`volume:${userId}:${volumeId}`);
  } else {
    invalidateCacheByPrefix(`volume:${userId}`);
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
export function invalidateUserContentCache(
  userId: string,
  options?: {
    seriesId?: string;
    volumeId?: string;
  }
): void {
  invalidateLibraryCache(userId);
  invalidateSeriesCache(userId, options?.seriesId);
  invalidateVolumeCache(userId, options?.volumeId);
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
export function invalidateMetadataCache(userId: string, seriesId: string): void {
  invalidateSeriesCache(userId, seriesId);
  invalidateLibraryCache(userId);
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
export function invalidateOcrCache(userId: string, volumeId: string): void {
  invalidateVolumeCache(userId, volumeId);
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
export function invalidateProgressCache(userId: string, volumeId: string): void {
  invalidateVolumeCache(userId, volumeId);
  invalidateLibraryCache(userId);
}
