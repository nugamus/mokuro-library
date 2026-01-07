import { toastStore } from '$lib/stores/toastStore.svelte.ts';
import { retryWithBackoff } from '$lib/utils/network/retry';
import { apiCache } from '$lib/utils/caching/apiCache';
import { getStoredFingerprint } from './deviceFingerprint';

/**
 * It's the same as RequestInit, but 'body' can be 'any'
 * We will convert 'body' into a valid type inside of apiFetch.
 */
interface ApiFetchOptions extends Omit<RequestInit, 'body' | 'cache'> {
  body?: any;
  retry?: boolean;
  showErrorToast?: boolean;
  cache?: boolean; // Enable caching for GET requests
  skipCache?: boolean; // Force fresh fetch
  onStaleRefetch?: (data: any) => void;
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
export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  const { retry = false, showErrorToast = true, cache = false, skipCache = false, ...fetchOptions } = options;

  const method = (fetchOptions.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  const doFetch = async () => {
    // Set default headers
    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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
      ...(fetchOptions.headers as Record<string, string>),
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
      body,
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
    return apiCache.get(
      cacheKey,
      () => doFetch(),
      { skipCache, onStaleRefetch }
    );
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
export const apiFetchWithRefresh = async <T = any>(
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
): Promise<any> {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const tryUpload = () => {
      attempts++;
      console.log(`Upload attempt ${attempts}/${maxRetries + 1}`);

      const xhr = new XMLHttpRequest();
      let hasStarted = false;

      // Short timeout to detect "stuck" requests that never start
      const stuckTimer = setTimeout(() => {
        console.log(`hasStarted: ${hasStarted}`)
        if (!hasStarted) {
          console.log('Request appears stuck, aborting...');
          xhr.abort();
          if (attempts <= maxRetries) {
            setTimeout(tryUpload, 200);
          } else {
            reject(new Error('Upload failed: request never started after retries'));
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
          reject(new Error('Upload timed out after retries'));
        }
      };

      xhr.onload = () => {
        clearTimeout(stuckTimer);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          // Don't retry on server errors (4xx, 5xx) - only on stuck/timeout
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.message || 'Upload failed'));
          } catch (e) {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        clearTimeout(stuckTimer);
        if (attempts <= maxRetries) {
          console.log('Network error, retrying...');
          setTimeout(tryUpload, 200);
        } else {
          reject(new Error('Network error during upload'));
        }
      };

      xhr.send(formData);
    };

    tryUpload();
  });
}

/**
 * Triggers a browser download by navigating to the URL.
 */
export function triggerDownload(path: string) {
  window.location.assign(path);
}




