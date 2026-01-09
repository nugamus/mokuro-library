import { refreshAccessToken } from './api';

let refreshInterval: ReturnType<typeof setInterval> | null = null;
const REFRESH_INTERVAL = 12 * 60 * 1000; // 12 minutes (before 15-min token expiry)

// BroadcastChannel for coordinating token refresh across tabs
let broadcastChannel: BroadcastChannel | null = null;
const CHANNEL_NAME = 'mokuro-token-refresh';

// Track last user activity to avoid unnecessary refreshes
let lastActivityTime = Date.now();
const ACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity

/**
 * Updates the last activity timestamp
 */
function updateActivity() {
  lastActivityTime = Date.now();
}

/**
 * Checks if user has been active recently
 */
function isUserActive(): boolean {
  return Date.now() - lastActivityTime < ACTIVITY_TIMEOUT;
}

/**
 * Sets up activity tracking listeners
 */
function setupActivityTracking() {
  if (typeof window === 'undefined') return;

  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
  events.forEach((event) => {
    window.addEventListener(event, updateActivity, { passive: true });
  });

  console.debug('[Token Refresh] Activity tracking enabled');
}

/**
 * Removes activity tracking listeners
 */
function cleanupActivityTracking() {
  if (typeof window === 'undefined') return;

  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
  events.forEach((event) => {
    window.removeEventListener(event, updateActivity);
  });

  console.debug('[Token Refresh] Activity tracking disabled');
}

/**
 * Sets up BroadcastChannel for multi-tab coordination
 * When one tab refreshes the token, it notifies other tabs
 */
function setupBroadcastChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    console.debug('[Token Refresh] BroadcastChannel not available');
    return;
  }

  broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

  broadcastChannel.onmessage = (event) => {
    if (event.data.type === 'TOKEN_REFRESHED') {
      console.debug('[Token Refresh] Another tab refreshed the token');
      // Token was refreshed by another tab, no need to refresh in this tab
      // The cookie is shared across tabs
    }
  };

  console.debug('[Token Refresh] BroadcastChannel initialized');
}

/**
 * Cleanup broadcast channel
 */
function cleanupBroadcastChannel() {
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
    console.debug('[Token Refresh] BroadcastChannel closed');
  }
}

/**
 * Notify other tabs that token was refreshed
 */
function notifyTokenRefreshed() {
  if (broadcastChannel) {
    broadcastChannel.postMessage({ type: 'TOKEN_REFRESHED', timestamp: Date.now() });
  }
}

/**
 * Starts background token refresh every 12 minutes
 * Only refreshes if user has been active recently
 */
export function startTokenRefresh() {
  if (refreshInterval) {
    console.debug('[Token Refresh] Already running, skipping start');
    return;
  }

  // Set up activity tracking and broadcast channel
  setupActivityTracking();
  setupBroadcastChannel();
  updateActivity(); // Mark as active now

  refreshInterval = setInterval(async () => {
    if (!isUserActive()) {
      console.debug('[Token Refresh] Skipping refresh - user inactive');
      return;
    }

    console.debug('[Token Refresh] Proactively refreshing token');
    try {
      const success = await refreshAccessToken();
      if (!success) {
        console.warn('[Token Refresh] Background refresh failed');
        // Don't stop - might be temporary network issue
        // User will get 401 on next action which triggers reactive refresh
      } else {
        console.debug('[Token Refresh] Token refreshed successfully');
        // Notify other tabs
        notifyTokenRefreshed();
      }
    } catch (error) {
      console.error('[Token Refresh] Error during refresh:', error);
      // Continue trying - don't stop the interval
    }
  }, REFRESH_INTERVAL);

  console.debug('[Token Refresh] Started background refresh (every 12 minutes)');
}

/**
 * Stops background token refresh and cleanup
 */
export function stopTokenRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    cleanupActivityTracking();
    cleanupBroadcastChannel();
    console.debug('[Token Refresh] Stopped background refresh');
  }
}

/**
 * Check if token refresh is currently running
 */
export function isTokenRefreshActive(): boolean {
  return refreshInterval !== null;
}
