<script lang="ts">
  import type { SubmissionDetail } from '$lib/types';
  import { apiFetch } from '$lib/services/api';
  import { resolve } from '$app/paths';
  import { SvelteDate, SvelteSet } from 'svelte/reactivity';
  import { contributionsSummaryState } from '$lib/states/contributions/ContributionsSummaryState.svelte';
  import { toastStore } from '$lib/stores/toastStore.svelte.ts';
  import { onMount } from 'svelte';
  import { ArrowRight, ClipboardList, FileText, LoaderCircle, TriangleAlert } from 'lucide-svelte';

  let { onOpenBulkReject } = $props<{
    onOpenBulkReject: (selectedIds: string[]) => void;
  }>();

  let submissions = $state<SubmissionDetail[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selectedIds = new SvelteSet<string>();

  // Load pending submissions (admin view)
  async function loadSubmissions() {
    loading = true;
    error = null;
    try {
      const data = (await apiFetch('/api/contributions/submissions?status=pending', {
        showErrorToast: false
      })) as SubmissionDetail[];
      submissions = data || [];
    } catch (e) {
      const msg = (e as Error).message || 'Failed to load submissions';
      error = msg;
      console.error('Failed to load submissions', e);
    } finally {
      loading = false;
    }
  }

  // Toggle selection
  function toggleSelection(submissionId: string) {
    if (selectedIds.has(submissionId)) {
      selectedIds.delete(submissionId);
    } else {
      selectedIds.add(submissionId);
    }
    selectedIds = selectedIds;
  }

  function selectAll() {
    selectedIds = new SvelteSet(submissions.map((s) => s.id));
  }

  function deselectAll() {
    selectedIds = new SvelteSet();
  }

  async function handleAccept(submissionId: string) {
    if (!confirm('Accept this submission? Files will be moved to the admin library.')) return;

    try {
      await apiFetch(`/api/contributions/submissions/${submissionId}/accept`, {
        method: 'POST'
      });
      await contributionsSummaryState.refresh({ force: true });
      toastStore.addToast('Submission accepted successfully', 'success');
      await loadSubmissions();
      selectedIds.delete(submissionId);
      selectedIds = selectedIds;
    } catch (e) {
      toastStore.addToast((e as Error).message || 'Failed to accept submission', 'error');
    }
  }

  function handleReject(submissionId: string) {
    onOpenBulkReject([submissionId]);
  }

  async function handleBulkAccept() {
    if (selectedIds.size === 0) return;

    if (
      !confirm(
        `Accept ${selectedIds.size} submission(s)? Files will be moved to the admin library.`
      )
    )
      return;

    try {
      const result = await apiFetch<{ success: number; failed: number }>(
        '/api/contributions/submissions/bulk-accept',
        {
          method: 'POST',
          body: { submissionIds: Array.from(selectedIds) }
        }
      );
      await contributionsSummaryState.refresh({ force: true });

      if (result.failed > 0) {
        toastStore.addToast(`Accepted ${result.success}, failed ${result.failed}`, 'warning');
      } else {
        toastStore.addToast(`Successfully accepted ${result.success} submission(s)`, 'success');
      }

      await loadSubmissions();
      deselectAll();
    } catch (e) {
      toastStore.addToast((e as Error).message || 'Failed to accept submissions', 'error');
    }
  }

  function handleBulkReject() {
    if (selectedIds.size === 0) return;
    onOpenBulkReject(Array.from(selectedIds));
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

  export function reload() {
    loadSubmissions();
    deselectAll();
  }

  onMount(() => {
    loadSubmissions();
  });
</script>

<div class="space-y-4">
  {#if selectedIds.size > 0}
    <div
      class="bg-accent/10 border-2 border-accent rounded-lg p-4 flex items-center gap-3 animate-slideIn"
    >
      <div class="flex-1">
        <div class="font-bold text-sm text-accent">{selectedIds.size} Selected</div>
        <div class="text-xs text-theme-secondary">
          Bulk operations will process all selected submissions
        </div>
      </div>
      <button
        onclick={deselectAll}
        class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-theme-surface text-theme-primary hover:bg-theme-surface-hover border border-theme-border transition-all"
      >
        Deselect All
      </button>
      <button
        onclick={handleBulkAccept}
        class="px-4 py-2 rounded-lg text-sm font-semibold bg-status-success text-white hover:bg-status-success/90 transition-all"
      >
        ✅ Accept Selected
      </button>
      <button
        onclick={handleBulkReject}
        class="px-4 py-2 rounded-lg text-sm font-semibold bg-status-danger text-white hover:bg-status-danger/90 transition-all"
      >
        ❌ Reject Selected
      </button>
    </div>
  {/if}

  {#if loading}
    <div
      class="bg-theme-surface/30 border border-theme-border rounded-lg p-12 text-center flex flex-col items-center"
    >
      <LoaderCircle class="w-8 h-8 mb-3 text-accent animate-spin" />
      <div class="text-sm text-theme-secondary font-medium">Loading pending submissions...</div>
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
  {:else if submissions.length === 0}
    <div
      class="bg-theme-surface/30 border border-theme-border rounded-lg p-12 text-center flex flex-col items-center"
    >
      <ClipboardList class="w-12 h-12 mb-4 text-theme-tertiary/50" />
      <div class="text-sm font-bold text-theme-primary mb-1">All Caught Up!</div>
      <div class="text-xs text-theme-tertiary max-w-xs">
        No pending submissions to review. New submissions from users will appear here.
      </div>
    </div>
  {:else}
    <div class="flex items-center gap-2 pb-2">
      <button
        onclick={selectAll}
        class="text-xs text-accent hover:text-accent-hover font-semibold transition-colors"
      >
        Select All ({submissions.length})
      </button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {#each submissions as submission (submission.id)}
        <div
          class="bg-theme-surface/30 border-2 rounded-lg overflow-hidden transition-all {selectedIds.has(
            submission.id
          )
            ? 'border-accent shadow-lg'
            : 'border-theme-border hover:border-accent/30'}"
        >
          <div class="p-4">
            <div class="flex items-start gap-3 mb-3">
              <button
                onclick={() => toggleSelection(submission.id)}
                class="flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 transition-all {selectedIds.has(
                  submission.id
                )
                  ? 'bg-accent border-accent'
                  : 'border-theme-border hover:border-accent'}"
              >
                {#if selectedIds.has(submission.id)}
                  <span class="text-white text-xs font-bold">✓</span>
                {/if}
              </button>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <div class="text-xs font-semibold text-theme-primary">
                    {submission.user?.username || 'Unknown User'}
                  </div>
                  <div class="text-[10px] text-theme-tertiary">
                    {formatDate(submission.submittedAt)}
                  </div>
                </div>
                <div class="flex items-center gap-3 text-xs text-theme-tertiary">
                  <span class="flex items-center gap-1">
                    <FileText class="w-3 h-3" />
                    {submission._count?.volumes || 0} volume{submission._count?.volumes === 1 ? '' : 's'}
                  </span>
                  <span>•</span>
                  <span>Submitted {formatDate(submission.submittedAt)}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 mt-4">
              <button
                onclick={() => handleAccept(submission.id)}
                class="px-3 py-2 rounded-lg text-xs font-semibold bg-status-success text-white hover:bg-status-success/90 transition-all"
              >
                Accept
              </button>
              <button
                onclick={() => handleReject(submission.id)}
                class="px-3 py-2 rounded-lg text-xs font-semibold bg-status-danger text-white hover:bg-status-danger/90 transition-all"
              >
                Reject
              </button>
              <a
                href={resolve(`/contributions/submissions/${submission.id}`, {})}
                class="ml-auto text-xs text-accent hover:text-accent-hover font-bold transition-colors flex items-center gap-1 group-hover:gap-2 duration-200"
              >
                View Details <ArrowRight class="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
