<script lang="ts">
  import type { Submission } from '$lib/types';
  import { apiFetch } from '$lib/services/api';
  import { SvelteDate } from 'svelte/reactivity';
  import { resolve } from '$app/paths';
  import { contributionsStore } from '$lib/stores/contributionsStore';
  import { toastStore } from '$lib/stores/toastStore.svelte.ts';
  import { onMount } from 'svelte';

  let submissions = $state<Submission[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let statusFilter = $state<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  // Filtered submissions based on status
  let filteredSubmissions = $derived(
    statusFilter === 'all' ? submissions : submissions.filter((s) => s.status === statusFilter)
  );

  // Load submissions
  async function loadSubmissions() {
    loading = true;
    error = null;
    try {
      const data = (await apiFetch('/api/contributions/submissions', {
        showErrorToast: false
      })) as Submission[];
      submissions = data || [];
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load submissions';
      error = msg;
      console.error('Failed to load submissions', e);
    } finally {
      loading = false;
    }
  }

  // Cancel a pending submission
  async function handleCancel(submissionId: string) {
    if (!confirm('Are you sure you want to cancel this submission?')) return;

    try {
      await contributionsStore.cancelSubmission(submissionId);
      toastStore.success('Submission cancelled successfully');
      // Reload submissions
      await loadSubmissions();
    } catch (e) {
      toastStore.error((e as Error).message || 'Failed to cancel submission');
    }
  }

  // Format date
  function formatDate(dateString: string): string {
    const date = new SvelteDate(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Get status badge styles
  function getStatusStyles(status: string) {
    switch (status) {
      case 'pending':
        return 'bg-status-warning/20 text-status-warning border-status-warning/30';
      case 'accepted':
        return 'bg-status-success/20 text-status-success border-status-success/30';
      case 'rejected':
        return 'bg-status-danger/20 text-status-danger border-status-danger/30';
      default:
        return 'bg-theme-surface text-theme-secondary border-theme-border';
    }
  }

  // Get status emoji
  function getStatusEmoji(status: string) {
    switch (status) {
      case 'pending':
        return '⏳';
      case 'accepted':
        return '✅';
      case 'rejected':
        return '❌';
      default:
        return '❓';
    }
  }

  onMount(() => {
    loadSubmissions();
  });
</script>

<div class="space-y-4">
  <!-- Filter Bar -->
  <div class="flex items-center gap-2 flex-wrap">
    <div class="text-xs font-semibold text-theme-tertiary uppercase tracking-wide">Filter:</div>
    {#each ['all', 'pending', 'accepted', 'rejected'] as filter (filter)}
      <button
        onclick={() => (statusFilter = filter as typeof statusFilter)}
        class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all {statusFilter === filter
          ? 'bg-accent text-white'
          : 'bg-theme-surface text-theme-secondary hover:bg-theme-surface-hover border border-theme-border'}"
      >
        {filter.charAt(0).toUpperCase() + filter.slice(1)}
        {#if filter === 'all'}
          ({submissions.length})
        {:else}
          ({submissions.filter((s) => s.status === filter).length})
        {/if}
      </button>
    {/each}
  </div>

  <!-- Loading State -->
  {#if loading}
    <div class="bg-theme-surface/30 border border-theme-border rounded-lg p-8 text-center">
      <div class="text-3xl mb-2">⏳</div>
      <div class="text-sm text-theme-secondary">Loading submissions...</div>
    </div>
  {:else if error}
    <!-- Error State -->
    <div class="bg-status-danger/10 border border-status-danger/30 rounded-lg p-6 text-center">
      <div class="text-3xl mb-2">⚠️</div>
      <div class="text-sm text-status-danger font-semibold mb-2">Failed to Load</div>
      <div class="text-xs text-theme-secondary">{error}</div>
      <button
        onclick={loadSubmissions}
        class="mt-3 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent-hover transition-all text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  {:else if filteredSubmissions.length === 0}
    <!-- Empty State -->
    <div class="bg-theme-surface/30 border border-theme-border rounded-lg p-8 text-center">
      <div class="text-4xl mb-3">📋</div>
      <div class="text-sm font-semibold text-theme-primary mb-1">
        {statusFilter === 'all' ? 'No submissions yet' : `No ${statusFilter} submissions`}
      </div>
      <div class="text-xs text-theme-tertiary">
        {statusFilter === 'all'
          ? 'Click "Submit to Library" to share your volumes with the admin'
          : `You don't have any ${statusFilter} submissions`}
      </div>
    </div>
  {:else}
    <!-- Submissions List -->
    <div class="space-y-3">
      {#each filteredSubmissions as submission (submission.id)}
        <div
          class="bg-theme-surface/30 border border-theme-border rounded-lg overflow-hidden hover:border-accent/30 transition-all"
        >
          <div class="p-4">
            <!-- Header Row -->
            <div class="flex items-start justify-between gap-3 mb-3">
              <div class="flex-1 min-w-0">
                <!-- Status Badge -->
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="px-2 py-1 rounded-lg text-xs font-bold border {getStatusStyles(
                      submission.status
                    )}"
                  >
                    {getStatusEmoji(submission.status)}
                    {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
                  </span>
                </div>

                <!-- Series Info -->
                <div class="text-sm font-semibold text-theme-primary mb-1">
                  {#if submission.targetSeries}
                    → {submission.targetSeries.title || submission.targetSeries.folderName}
                  {:else if submission.sourceSeries}
                    {submission.sourceSeries.title || submission.sourceSeries.folderName}
                    <span class="text-theme-tertiary text-xs">(New Series)</span>
                  {:else}
                    <span class="text-theme-tertiary">Unknown Series</span>
                  {/if}
                </div>

                <!-- Metadata -->
                <div class="flex items-center gap-3 text-xs text-theme-tertiary">
                  <span>
                    {submission._count?.volumes || 0} volume(s)
                  </span>
                  <span>•</span>
                  <span>Submitted {formatDate(submission.submittedAt)}</span>
                </div>
              </div>

              <!-- Actions -->
              <div class="flex-shrink-0">
                {#if submission.status === 'pending'}
                  <button
                    onclick={() => handleCancel(submission.id)}
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-status-danger/10 text-status-danger hover:bg-status-danger/20 border border-status-danger/30 transition-all"
                  >
                    Cancel
                  </button>
                {/if}
              </div>
            </div>

            <!-- Review Note (if rejected) -->
            {#if submission.status === 'rejected' && submission.reviewNote}
              <div class="bg-status-danger/10 border border-status-danger/30 rounded-lg p-3 mt-3">
                <div class="text-xs font-bold text-status-danger mb-1">Rejection Reason:</div>
                <div class="text-xs text-theme-secondary">{submission.reviewNote}</div>
                {#if submission.reviewedAt}
                  <div class="text-[10px] text-theme-tertiary mt-1">
                    Reviewed {formatDate(submission.reviewedAt)}
                  </div>
                {/if}
              </div>
            {/if}

            <!-- Acceptance Info -->
            {#if submission.status === 'accepted' && submission.reviewedAt}
              <div class="bg-status-success/10 border border-status-success/30 rounded-lg p-3 mt-3">
                <div class="text-xs font-bold text-status-success mb-1">✅ Accepted by Admin</div>
                <div class="text-[10px] text-theme-tertiary">
                  Reviewed {formatDate(submission.reviewedAt)}
                </div>
                {#if submission.reviewNote}
                  <div class="text-xs text-theme-secondary mt-1">{submission.reviewNote}</div>
                {/if}
              </div>
            {/if}
          </div>

          <!-- View Details Button -->
          <div class="bg-theme-surface/50 border-t border-theme-border px-4 py-2">
            <a
              href={resolve(`/contributions/submissions/${submission.id}`)}
              class="text-xs text-accent hover:text-accent-hover font-semibold transition-colors"
            >
              View Details →
            </a>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
