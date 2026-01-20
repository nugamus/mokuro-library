import { RebaseSession } from './RebaseSession.svelte';
import { rebaseApi, type RebaseSessionData } from '$lib/services/rebaseApi';
import { toastStore } from '$lib/stores/toastStore.svelte';
import type { RebaseResolution } from '$lib/types';

// --- Configuration ---
export const MAX_ACTIVE_SESSIONS = 10;

class RebaseState {
  // --- Global State ---
  isModalOpen = $state(false);
  isLoading = $state(false);

  // The list of all active sessions for this user
  sessions = $state<RebaseSession[]>([]);

  // The ID of the session currently being viewed in the modal
  selectedSessionId = $state<string | null>(null);

  // --- Derived ---
  selectedSession = $derived(
    this.sessions.find(s => s.id === this.selectedSessionId) || null
  );

  activeSessionCount = $derived(this.sessions.length);
  canStartNewSession = $derived(this.sessions.length < MAX_ACTIVE_SESSIONS);

  constructor() {
    // No auto-init.
  }

  /**
   * Opens the Rebase Manager Modal.
   * @param targetVolumeIds - (Optional) If provided, ensures sessions exist for these volumes
   * and selects the first one.
   */
  async open(targetVolumeIds?: string[]) {
    this.isModalOpen = true;
    this.isLoading = true;

    try {
      // 1. Always refresh global list first to get latest state from DB
      await this.refreshSessions();

      // 2. Handle specific targets if requested
      if (targetVolumeIds && targetVolumeIds.length > 0) {
        await this.ensureSessionsFor(targetVolumeIds);
      }

      // 3. Set default selection if nothing selected yet
      if (!this.selectedSessionId && this.sessions.length > 0) {
        this.selectedSessionId = this.sessions[0].id;
      }
    } catch (err) {
      console.error('Failed to initialize rebase modal:', err);
      toastStore.error('Failed to load rebase sessions');
    } finally {
      this.isLoading = false;
    }
  }

  close() {
    this.isModalOpen = false;
    this.selectedSessionId = null;
  }

  selectSession(sessionId: string) {
    this.selectedSessionId = sessionId;
  }

  async refreshSessions() {
    try {
      const response = await rebaseApi.getSessions();
      this.sessions = response.sessions.map((data: RebaseSessionData) => new RebaseSession(data));

      // Cleanup: If selected session no longer exists, deselect it
      if (this.selectedSessionId && !this.sessions.find(s => s.id === this.selectedSessionId)) {
        this.selectedSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
      }
    } catch (err) {
      console.error('Fetch sessions error', err);
      throw err;
    }
  }

  private async ensureSessionsFor(volumeIds: string[]) {
    for (const volId of volumeIds) {
      // Check if we already have a session for this volume
      const existing = this.sessions.find(s => s.volumeId === volId);
      if (existing) {
        this.selectedSessionId = existing.id;
        continue;
      }

      // Check limit before starting new
      if (!this.canStartNewSession) {
        toastStore.error(`Cannot start more than ${MAX_ACTIVE_SESSIONS} concurrent rebase sessions.`);
        break;
      }

      // Start new session
      await this.startSession(volId);
    }
  }

  async startSession(volumeId: string) {
    try {
      await rebaseApi.start(volumeId);
      await this.refreshSessions();

      const newSession = this.sessions.find(s => s.volumeId === volumeId);
      if (newSession) {
        this.selectedSessionId = newSession.id;
      }
    } catch (err: any) {
      console.error(`Failed to start session for volume ${volumeId}:`, err);
      toastStore.error(err.message || 'Failed to start rebase');
    }
  }

  async resolveConflict(sessionId: string, resolution: RebaseResolution) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const isComplete = await session.resolve(resolution);

    if (isComplete) {
      // Remove from local list immediately
      this.sessions = this.sessions.filter(s => s.id !== sessionId);

      // Select next available if any
      if (this.sessions.length > 0) {
        this.selectedSessionId = this.sessions[0].id;
      } else {
        this.selectedSessionId = null;
      }
    }
  }

  async abortSession(sessionId: string) {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) return;

    try {
      await rebaseApi.abort(session.volumeId, sessionId);
      this.sessions = this.sessions.filter(s => s.id !== sessionId);
      toastStore.info('Rebase session aborted');

      if (this.selectedSessionId === sessionId) {
        this.selectedSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
      }
    } catch (err: any) {
      toastStore.error(err.message || 'Failed to abort session');
    }
  }
}

export const rebaseState = new RebaseState();
