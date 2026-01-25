<script lang="ts">
  import type { SubmissionEntry } from '$lib/types';
  import { apiFetch } from '$lib/services/api';
  import { SvelteDate } from 'svelte/reactivity';
  import { resolve } from '$app/paths';
  import { contributionsSummaryState } from '$lib/states/contributions/ContributionsSummaryState.svelte';
  import { toastStore } from '$lib/stores/toastStore.svelte.ts';
  import { onMount } from 'svelte';

  import {
    Clock,
    CircleCheck,
    CircleX,
    CircleQuestionMark,
    LoaderCircle,
    TriangleAlert,
    ClipboardList,
    ArrowRight,
    FileText
  } from 'lucide-svelte';

  let submissions = $state<SubmissionEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let statusFilter = $state<'all' | 'pending' | 'accepted' | 'rejected'>('all');

  let filteredSubmissions = $derived(
    statusFilter === 'all' ? submissions : submissions.filter((s) => s.status === statusFilter)
  );

  async function loadSubmissions() {
    loading = true;
    error = null;
    try {
      const data = (await apiFetch('/api/contributions/submissions', {
        showErrorToast: false
      })) as SubmissionEntry[];
      submissions = data || [];
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load submissions';
      error = msg;
      console.error('Failed to load submissions', e);
    } finally {
      loading = false;
    }
  }

  async function handleCancel(submissionId: string) {
    if (!confirm('Are you sure you want to cancel this submission?')) return;

    try {
      await apiFetch(`/api/contributions/submissions/${submissionId}`, {
        method: 'DELETE'
      });
      await contributionsSummaryState.refresh({ force: true });
      toastStore.success('Submission cancelled successfully');
      await loadSubmissions();
    } catch (e) {
      toastStore.error((e as Error).message || 'Failed to cancel submission');
    }
  }

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

  function getStatusStyles(status: string) {
    switch (status) {
      case 'pending':
        return 'bg-status-warning/10 text-status-warning border-status-warning/20';
      case 'accepted':
        return 'bg-status-success/10 text-status-success border-status-success/20';
      case 'rejected':
        return 'bg-status-danger/10 text-status-danger border-status-danger/20';
      default:
        return 'bg-theme-surface text-theme-secondary border-theme-border';
    }
  }

  const statusIcons = {
    pending: Clock,
    accepted: CircleCheck,
    rejected: CircleX,
    default: CircleQuestionMark
  };

  onMount(() => {
    loadSubmissions();
  });
</script>

<div>
  <div class="mb-4 text-sm text-theme-tertiary">
    Track the status of new Series and Volumes you have uploaded.
  </div>

  <div class="space-y-4">
    <div class="flex items-center gap-2 flex-wrap">
      <div class="text-xs font-semibold text-theme-tertiary uppercase tracking-wide mr-1">
        Filter:
      </div>
      {#each ['all', 'pending', 'accepted', 'rejected'] as filter (filter)}
        <button
          onclick={() => (statusFilter = filter as typeof statusFilter)}
          class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all {statusFilter === filter
            ? 'bg-accent text-white shadow-md shadow-accent/20'
            : 'bg-theme-surface text-theme-secondary hover:bg-theme-surface-hover border border-theme-border'}"
        >
          {filter.charAt(0).toUpperCase() + filter.slice(1)}
          {#if filter === 'all'}
            <span class="opacity-80 ml-0.5">({submissions.length})</span>
          {:else}
            <span class="opacity-80 ml-0.5"
              >({submissions.filter((s) => s.status === filter).length})</span
            >
          {/if}
        </button>
      {/each}
    </div>

    {#if loading}
      <div
        class="bg-theme-surface/30 border border-theme-border rounded-lg p-12 text-center flex flex-col items-center"
      >
        <LoaderCircle class="w-8 h-8 mb-3 text-accent animate-spin" />
        <div class="text-sm text-theme-secondary font-medium">Loading submissions...</div>
      </div>
    {:else if error}
      <div
        class="bg-status-danger/5 border border-status-danger/20 rounded-lg p-8 text-center flex flex-col items-center"
      >
        <TriangleAlert class="w-8 h-8 mb-3 text-status-danger" />
        <div class="text-sm text-status-danger font-bold mb-1">Failed to Load</div>
        <div class="text-xs text-theme-secondary mb-4">{error}</div>
        <button
          onclick={loadSubmissions}
          class="px-4 py-2 rounded-lg bg-status-danger text-white hover:bg-status-danger-hover transition-all text-xs font-bold shadow-lg shadow-status-danger/20"
        >
          Retry
        </button>
      </div>
    {:else if filteredSubmissions.length === 0}
      <div
        class="bg-theme-surface/30 border border-theme-border rounded-lg p-12 text-center flex flex-col items-center"
      >
        <ClipboardList class="w-12 h-12 mb-4 text-theme-tertiary/50" />
        <div class="text-sm font-bold text-theme-primary mb-1">
          {statusFilter === 'all' ? 'No submissions yet' : `No ${statusFilter} submissions`}
        </div>
        <div class="text-xs text-theme-tertiary max-w-xs">
          {statusFilter === 'all'
            ? 'Click "Submit to Library" on any series page to share your volumes with the community.'
            : `You don't have any ${statusFilter} submissions.`}
        </div>
      </div>
    {:else}
      <div class="space-y-3">
        {#each filteredSubmissions as submission (submission.id)}
          {@const StatusIcon =
            statusIcons[submission.status as keyof typeof statusIcons] || statusIcons.default}

          <div
            class="bg-theme-surface/30 border border-theme-border rounded-lg overflow-hidden hover:border-accent/30 transition-all group"
          >
            <div class="p-4">
              <div class="flex items-start justify-between gap-3 mb-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-2">
                    <span
                      class="pl-1.5 pr-2 py-0.5 rounded-md text-[11px] font-bold border flex items-center gap-1.5 {getStatusStyles(
                        submission.status
                      )}"
                    >
                      <StatusIcon class="w-3.5 h-3.5" />
                      {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
                    </span>
                  </div>

                  <div class="text-sm font-bold text-theme-primary mb-1 truncate">
                    {#if submission.targetSeries}
                      <span class="text-theme-tertiary font-normal">Update to:</span>
                      {submission.targetSeries.sortTitle}
                    {:else if submission.sourceSeries}
                      {submission.sourceSeries.sortTitle}
                      <span
                        class="text-accent text-[10px] ml-1 uppercase tracking-wider font-bold bg-accent/10 px-1 py-px rounded"
                        >New Series</span
                      >
                    {:else}
                      <span class="text-theme-tertiary italic">Unknown Series</span>
                    {/if}
                  </div>

                  <div class="flex items-center gap-3 text-xs text-theme-tertiary">
                    <span class="flex items-center gap-1">
                      <FileText class="w-3 h-3" />
                      {submission._count?.volumes || 0} volume(s)
                    </span>
                    <span>-</span>
                    <span>Submitted {formatDate(submission.submittedAt)}</span>
                  </div>
                </div>

                <div class="flex-shrink-0">
                  {#if submission.status === 'pending'}
                    <button
                      onclick={() => handleCancel(submission.id)}
                      class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-theme-surface hover:bg-status-danger/10 text-theme-secondary hover:text-status-danger border border-theme-border hover:border-status-danger/30 transition-all"
                    >
                      Cancel
                    </button>
                  {/if}
                </div>
              </div>

              {#if submission.status === 'rejected' && submission.reviewNote}
                <div
                  class="bg-status-danger/5 border border-status-danger/10 rounded-lg p-3 mt-3 flex gap-3"
                >
                  <TriangleAlert class="w-4 h-4 text-status-danger flex-shrink-0 mt-0.5" />
                  <div>
                    <div class="text-xs font-bold text-status-danger mb-0.5">Rejection Reason</div>
                    <div class="text-xs text-theme-secondary leading-relaxed">
                      {submission.reviewNote}
                    </div>
                    {#if submission.reviewedAt}
                      <div class="text-[10px] text-theme-tertiary mt-1.5">
                        Reviewed {formatDate(submission.reviewedAt)}
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}

              {#if submission.status === 'accepted' && submission.reviewedAt}
                <div
                  class="bg-status-success/5 border border-status-success/10 rounded-lg p-3 mt-3 flex gap-3"
                >
                  <CircleCheck class="w-4 h-4 text-status-success flex-shrink-0 mt-0.5" />
                  <div>
                    <div class="text-xs font-bold text-status-success mb-0.5">Accepted by Admin</div>
                    <div class="text-[10px] text-theme-tertiary">
                      Reviewed {formatDate(submission.reviewedAt)}
                    </div>
                    {#if submission.reviewNote}
                      <div class="text-xs text-theme-secondary mt-1">{submission.reviewNote}</div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>

            <div class="bg-theme-surface/30 border-t border-theme-border px-4 py-2 flex justify-end">
              <a
                href={resolve(`/contributions/submissions/${submission.id}`, {})}
                class="text-xs text-accent hover:text-accent-hover font-bold transition-colors flex items-center gap-1 group-hover:gap-2 duration-200"
              >
                View Details <ArrowRight class="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
