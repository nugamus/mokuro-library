import { toastStore } from '$lib/stores/toastStore.svelte.ts';
import { retryWithBackoff } from '$lib/utils/network/retry';
import { apiCache } from '$lib/utils/caching/apiCache';
import { getStoredFingerprint } from './deviceFingerprint';

/**
 * It's the same as RequestInit, but 'body' can be 'any'
 * We will convert 'body' into a valid type inside of apiFetch.
 */
interface ApiFetchOptions extends Omit<RequestInit, 'body' | 'cache'> {
  body?: unknown;
  retry?: boolean;
  showErrorToast?: boolean;
  cache?: boolean; // Enable caching for GET requests
  skipCache?: boolean; // Force fresh fetch
  onStaleRefetch?: (data: unknown) => void;
}

const getCsrfToken = () => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

const isStateChanging = (method?: string) => {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return !safeMethods.has((method || 'GET').toUpperCase());
};

/**
 * A simple wrapper for fetch to interact with our backend API.
 * This automatically handles JSON serialization, error handling,
 * and uses relative paths that work with our Vite proxy.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const {
    retry = false,
    showErrorToast = true,
    cache = false,
    skipCache = false,
    ...fetchOptions
  } = options;

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  const doFetch = async () => {
    // Set default headers
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };

    // Stringify the body if it's an object and method is not GET
    // GET request doesn't have a body by specification
    let body: BodyInit | null | undefined = fetchOptions.body;
    if (
      fetchOptions.body &&
      typeof fetchOptions.body === 'object' &&
      fetchOptions.method !== 'GET' &&
      !(fetchOptions.body instanceof FormData)
    ) {
      body = JSON.stringify(fetchOptions.body);
    }

    // --- Conditionally build headers ---
    const finalHeaders: Record<string, string> = {
      ...defaultHeaders,
      ...(fetchOptions.headers as Record<string, string>)
    };

    if (isStateChanging(fetchOptions.method)) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        finalHeaders['x-csrf-token'] = csrfToken;
      }
    }

    // Add device fingerprint to all requests
    const deviceFingerprint = await getStoredFingerprint();
    finalHeaders['x-device-fingerprint'] = deviceFingerprint;

    if (fetchOptions.body instanceof FormData || fetchOptions.method === 'DELETE') {
      // If body is FormData, delete the 'Content-Type' header
      // so the browser can set it automatically.
      delete finalHeaders['Content-Type'];
    }

    const response = await fetch(path, {
      ...fetchOptions,
      headers: finalHeaders,
      body
    });

    // If not OK, try to parse error message from backend
    if (!response.ok) {
      try {
        const errorData = await response.json();
        const errorMessage = errorData.message || 'An unknown API error occurred.';
        throw new Error(errorMessage);
      } catch (e) {
        const errorMessage = (e as Error).message || `HTTP error! Status: ${response.status}`;
        throw new Error(errorMessage);
      }
    }

    // Handle successful but empty responses (e.g., 200 OK from /logout)
    // If OK but not JSON, return the response object itself (e.g., for file streams)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return response;
    }

    // If we get here, it's a successful JSON response
    return response.json();
  };

  // Use cache for GET requests if enabled
  if (isGet && cache) {
    const cacheKey = `${method}:${path}`;
    const onStaleRefetch = options.onStaleRefetch;
    return apiCache.get(cacheKey, () => doFetch(), { skipCache, onStaleRefetch });
  }

  try {
    if (retry) {
      return await retryWithBackoff(doFetch, {
        retries: 3,
        delay: 1000,
        onRetry: (error, attempt) => {
          console.warn(`API request failed (attempt ${attempt}/3):`, error.message);
        }
      });
    } else {
      return await doFetch();
    }
  } catch (error) {
    if (showErrorToast) {
      toastStore.error((error as Error).message);
    }
    throw error;
  }
}

/**
 * Track if a refresh is in progress to avoid multiple simultaneous refreshes
 */
let refreshInProgress = false;

/**
 * Attempts to refresh the access token using the refresh token.
 */
export const refreshAccessToken = async (): Promise<boolean> => {
  if (refreshInProgress) {
    // Wait for existing refresh to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return true;
  }

  refreshInProgress = true;

  try {
    const deviceFingerprint = await getStoredFingerprint();

    await apiFetch('/api/auth/refresh', {
      method: 'POST',
      body: { deviceFingerprint },
      showErrorToast: false
    });

    return true;
  } catch (e) {
    console.debug('Token refresh failed:', e);
    return false;
  } finally {
    refreshInProgress = false;
  }
};

/**
 * Enhanced apiFetch that automatically retries with token refresh on 401.
 */
export const apiFetchWithRefresh = async <T = unknown>(
  url: string,
  options?: ApiFetchOptions
): Promise<T> => {
  try {
    return await apiFetch<T>(url, options);
  } catch (error) {
    // If 401 and not already a refresh/login request, try to refresh token
    if (
      error instanceof Error &&
      error.message.includes('401') &&
      !url.includes('/api/auth/refresh') &&
      !url.includes('/api/auth/login')
    ) {
      const refreshed = await refreshAccessToken();

      if (refreshed) {
        // Retry original request
        return await apiFetch<T>(url, options);
      }
    }

    throw error;
  }
};

/**
 * Specialized upload function using XMLHttpRequest to support progress tracking.
 * fetch() does not support upload progress, so we must use XHR.
 */
export function apiUpload(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  maxRetries = 2
): Promise<unknown> {
  // Get device fingerprint once at the start (outside the promise executor)
  return (async () => {
    const deviceFingerprint = await getStoredFingerprint();

    return new Promise<unknown>((res, rej) => {
      let attempts = 0;

      const tryUpload = () => {
        attempts++;
        console.log(`Upload attempt ${attempts}/${maxRetries + 1}`);

        const xhr = new XMLHttpRequest();
        let hasStarted = false;

        // Short timeout to detect "stuck" requests that never start
        const stuckTimer = setTimeout(() => {
          console.log(`hasStarted: ${hasStarted}`);
          if (!hasStarted) {
            console.log('Request appears stuck, aborting...');
            xhr.abort();
            if (attempts <= maxRetries) {
              setTimeout(tryUpload, 200);
            } else {
              rej(new Error('Upload failed: request never started after retries'));
            }
          }
        }, 5000);

        xhr.open('POST', path);

        xhr.onreadystatechange = () => {
          // readyState 2 = HEADERS_RECEIVED (server has received the request)
          if (xhr.readyState >= 2 && !hasStarted) {
            hasStarted = true;
            clearTimeout(stuckTimer);
            console.log('Request started successfully');
          }
        };

        const csrfToken = getCsrfToken();
        if (csrfToken) {
          xhr.setRequestHeader('x-csrf-token', csrfToken);
        }

        // Add device fingerprint header
        xhr.setRequestHeader('x-device-fingerprint', deviceFingerprint);

        if (xhr.upload) {
          xhr.upload.onprogress = (event) => {
            hasStarted = true;
            clearTimeout(stuckTimer);
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              onProgress(percent);
            }
          };
        }

        // Longer timeout for the actual upload (adjust based on your file sizes)
        xhr.timeout = 300000; // 5 minutes

        xhr.ontimeout = () => {
          clearTimeout(stuckTimer);
          if (attempts <= maxRetries) {
            console.log('Request timed out, retrying...');
            setTimeout(tryUpload, 200);
          } else {
            rej(new Error('Upload timed out after retries'));
          }
        };

        xhr.onload = () => {
          clearTimeout(stuckTimer);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              res(JSON.parse(xhr.responseText));
            } catch {
              res(xhr.responseText);
            }
          } else {
            // Don't retry on server errors (4xx, 5xx) - only on stuck/timeout
            try {
              const errorData = JSON.parse(xhr.responseText);
              rej(new Error(errorData.message || 'Upload failed'));
            } catch {
              rej(new Error(`Upload failed with status ${xhr.status}`));
            }
          }
        };

        xhr.onerror = () => {
          clearTimeout(stuckTimer);
          if (attempts <= maxRetries) {
            console.log('Network error, retrying...');
            setTimeout(tryUpload, 200);
          } else {
            rej(new Error('Network error during upload'));
          }
        };

        xhr.send(formData);
      };

      tryUpload();
    });
  })();
}

/**
 * Triggers a browser download by navigating to the URL.
 */
export function triggerDownload(path: string) {
  window.location.assign(path);
}

// ==================== AUTHENTICATED IMAGE LOADING ====================

/**
 * Cache for blob URLs to avoid refetching the same image
 * Key: original image URL, Value: { blobUrl, refCount }
 */
const blobUrlCache = new Map<string, { blobUrl: string; refCount: number }>();

/**
 * Fetches an image/file with authentication and returns a blob URL
 * for use in <img> src, CSS backgrounds, etc.
 *
 * This is necessary because browser <img> tags cannot send custom headers
 * (like x-device-fingerprint), so we must fetch via JavaScript and create
 * blob URLs for authenticated image loading.
 *
 * @param path - The API path to the image (e.g., '/api/files/volume/123/image/page1.jpg')
 * @param useCache - Whether to use cached blob URLs (default: true)
 * @returns Promise<string> - A blob: URL that can be used in img.src
 */
export async function fetchAuthenticatedImage(path: string, useCache = true): Promise<string> {
  // Check cache first
  if (useCache && blobUrlCache.has(path)) {
    const cached = blobUrlCache.get(path)!;
    cached.refCount++;
    console.debug(`[AuthImage] Using cached blob for ${path} (refs: ${cached.refCount})`);
    return cached.blobUrl;
  }

  try {
    const response = await apiFetch<Response>(path);

    // apiFetch returns Response for non-JSON content
    if (response instanceof Response) {
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      // Cache the blob URL
      if (useCache) {
        blobUrlCache.set(path, { blobUrl, refCount: 1 });
        console.debug(`[AuthImage] Cached blob for ${path}`);
      }

      return blobUrl;
    }

    throw new Error('Invalid response type for image fetch - expected Response object');
  } catch (error) {
    console.error(`[AuthImage] Failed to fetch ${path}:`, error);
    throw error;
  }
}

/**
 * Revokes a blob URL and cleans up memory
 * Should be called when the image is no longer needed (e.g., component unmount)
 *
 * @param url - The blob: URL to revoke
 * @param originalPath - The original API path (for cache cleanup)
 */
export function revokeImageUrl(url: string, originalPath?: string) {
  if (!url || !url.startsWith('blob:')) {
    return;
  }

  // If we have the original path, manage ref counting
  if (originalPath && blobUrlCache.has(originalPath)) {
    const cached = blobUrlCache.get(originalPath)!;
    cached.refCount--;

    console.debug(`[AuthImage] Decreased ref count for ${originalPath} (refs: ${cached.refCount})`);

    // Only revoke when no more references
    if (cached.refCount <= 0) {
      URL.revokeObjectURL(cached.blobUrl);
      blobUrlCache.delete(originalPath);
      console.debug(`[AuthImage] Revoked and removed ${originalPath} from cache`);
    }
  } else {
    // No original path or not in cache - just revoke directly
    URL.revokeObjectURL(url);
    console.debug(`[AuthImage] Revoked blob URL directly`);
  }
}

/**
 * Preloads multiple images in parallel and caches their blob URLs
 * Useful for reader page preloading
 *
 * @param paths - Array of image paths to preload
 * @returns Promise<void>
 */
export async function preloadImages(paths: string[]): Promise<void> {
  const promises = paths.map((path) =>
    fetchAuthenticatedImage(path, true).catch((err) => {
      console.warn(`[AuthImage] Failed to preload ${path}:`, err);
    })
  );

  await Promise.all(promises);
  console.debug(`[AuthImage] Preloaded ${paths.length} images`);
}

/**
 * Clears all cached blob URLs and frees memory
 * Useful when navigating away from image-heavy pages
 */
export function clearImageCache() {
  for (const [, { blobUrl }] of blobUrlCache.entries()) {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrlCache.clear();
  console.debug('[AuthImage] Cleared all cached blob URLs');
}
