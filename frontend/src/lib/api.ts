/**
 * It's the same as RequestInit, but 'body' can be 'any'
 * We will convert 'body' into a valid type inside of apiFetch.
 */
interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: any;
}

/**
 * A simple wrapper for fetch to interact with our backend API.
 * This automatically handles JSON serialization, error handling,
 * and uses relative paths that work with our Vite proxy.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  // Set default headers
  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Stringify the body if it's an object and method is not GET
  // GET request doesn't have a body by specification
  let body: BodyInit | null | undefined = options.body;
  if (
    options.body &&
    typeof options.body === 'object' &&
    options.method !== 'GET' &&
    !(options.body instanceof FormData)
  ) {
    body = JSON.stringify(options.body);
  }

  // --- Conditionally build headers ---
  const finalHeaders: Record<string, string> = {
    ...defaultHeaders,
    ...(options.headers as Record<string, string>),
  };

  if (options.body instanceof FormData || options.method === 'DELETE') {
    // If body is FormData, delete the 'Content-Type' header
    // so the browser can set it automatically.
    delete finalHeaders['Content-Type'];
  }

  const response = await fetch(path, {
    ...options,
    headers: finalHeaders,
    body,
  });

  // If not OK, try to parse error message from backend
  if (!response.ok) {
    try {
      const errorData = await response.json();
      throw new Error(errorData.message || 'An unknown API error occurred.');
    } catch (e) {
      throw new Error(
        (e as Error).message || `HTTP error! Status: ${response.status}`
      );
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
}

/**
 * Specialized upload function using XMLHttpRequest to support progress tracking.
 * fetch() does not support upload progress, so we must use XHR.
 */
export function apiUpload(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);

    // 1. Track Upload Progress
    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };
    }

    // 2. Handle Response
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch (e) {
          resolve(xhr.responseText);
        }
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          reject(new Error(errorData.message || 'Upload failed'));
        } catch (e) {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };

    // 3. Send
    xhr.send(formData);
  });
}

/**
 * Triggers a browser download by navigating to the URL.
 */
export function triggerDownload(path: string) {
  // Create a temporary hidden link and click it
  const link = document.createElement('a');
  link.href = path;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
