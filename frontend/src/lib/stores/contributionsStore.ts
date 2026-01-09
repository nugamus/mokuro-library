import { writable } from 'svelte/store';
import { apiFetch } from '$lib/services/api';
import type {
  SubmitVolumesRequest,
  BulkAcceptRequest,
  BulkRejectRequest,
  BulkOperationResult
} from '$lib/types';

export interface ContributionCounts {
  behind: number;
  ahead: number;
  pendingSubmissionsCount: number;
}

function createContributionsStore() {
  const { subscribe, set, update } = writable<ContributionCounts>({
    behind: 0,
    ahead: 0,
    pendingSubmissionsCount: 0
  });

  let inFlight: Promise<void> | null = null;
  let lastRefreshAt = 0;
  const MIN_REFRESH_INTERVAL = 15000;

  return {
    subscribe,
    set,
    update,
    setBehindCount: (count: number) => update((state) => ({ ...state, behind: count })),
    setAheadCount: (count: number) => update((state) => ({ ...state, ahead: count })),
    setPendingSubmissionsCount: (count: number) =>
      update((state) => ({ ...state, pendingSubmissionsCount: count })),
    refresh: async (options?: { force?: boolean }) => {
      const now = Date.now();
      if (!options?.force) {
        if (inFlight) return inFlight;
        if (now - lastRefreshAt < MIN_REFRESH_INTERVAL) return;
      }

      inFlight = (async () => {
        try {
          const data = await apiFetch<ContributionCounts>('/api/contributions/summary', {
            showErrorToast: false,
            cache: true,
            skipCache: options?.force ?? false
          });
          set(data);
          lastRefreshAt = Date.now();
        } catch (error) {
          console.error('Failed to refresh contributions summary', error);
        } finally {
          inFlight = null;
        }
      })();

      return inFlight;
    },

    // --- Submission Methods ---

    /**
     * Submit volumes to the shared library
     */
    submitVolumes: async (volumeIds: string[], targetSeriesId?: string) => {
      const body: SubmitVolumesRequest = { volumeIds, targetSeriesId };
      await apiFetch('/api/contributions/submissions', {
        method: 'POST',
        body
      });
      // Refresh counts after submission
      await contributionsStore.refresh({ force: true });
    },

    /**
     * Cancel a pending submission
     */
    cancelSubmission: async (submissionId: string) => {
      await apiFetch(`/api/contributions/submissions/${submissionId}`, {
        method: 'DELETE'
      });
      // Refresh counts after cancellation
      await contributionsStore.refresh({ force: true });
    },

    /**
     * Accept a submission (admin only)
     */
    acceptSubmission: async (submissionId: string) => {
      await apiFetch(`/api/contributions/submissions/${submissionId}/accept`, {
        method: 'POST'
      });
      // Refresh counts after acceptance
      await contributionsStore.refresh({ force: true });
    },

    /**
     * Reject a submission (admin only)
     */
    rejectSubmission: async (submissionId: string, reason?: string) => {
      await apiFetch(`/api/contributions/submissions/${submissionId}/reject`, {
        method: 'POST',
        body: { reason }
      });
      // Refresh counts after rejection
      await contributionsStore.refresh({ force: true });
    },

    /**
     * Bulk accept multiple submissions (admin only)
     */
    bulkAcceptSubmissions: async (submissionIds: string[]): Promise<BulkOperationResult> => {
      const body: BulkAcceptRequest = { submissionIds };
      const result = await apiFetch<BulkOperationResult>(
        '/api/contributions/submissions/bulk-accept',
        {
          method: 'POST',
          body
        }
      );
      // Refresh counts after bulk operation
      await contributionsStore.refresh({ force: true });
      return result;
    },

    /**
     * Bulk reject multiple submissions (admin only)
     */
    bulkRejectSubmissions: async (
      submissionIds: string[],
      reason: string
    ): Promise<BulkOperationResult> => {
      const body: BulkRejectRequest = { submissionIds, reason };
      const result = await apiFetch<BulkOperationResult>(
        '/api/contributions/submissions/bulk-reject',
        {
          method: 'POST',
          body
        }
      );
      // Refresh counts after bulk operation
      await contributionsStore.refresh({ force: true });
      return result;
    }
  };
}

export const contributionsStore = createContributionsStore();
