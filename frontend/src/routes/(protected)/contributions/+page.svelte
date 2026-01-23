<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { apiFetch } from '$lib/services/api';
  import { rebaseState } from '$lib/states/rebase/RebaseState.svelte';
  import { user as authUser } from '$lib/stores/authStore';
  import { page } from '$app/state';

  import {
    Inbox,
    ClipboardList,
    RefreshCw,
    PartyPopper,
    GitMerge,
    GitPullRequest
  } from 'lucide-svelte';

  // Components
  import ContributionsHeader from './components/ContributionsHeader.svelte';
  import ActivityTimeline from './components/ActivityTimeline.svelte';
  import LibraryEntry from '$lib/components/library/LibraryEntry.svelte';
  import LoadingState from './components/LoadingState.svelte';
  import UserQueue from '$lib/components/layout/contributions/UserQueue.svelte';
  import AdminQueue from '$lib/components/layout/contributions/AdminQueue.svelte';
  import BulkRejectModal from './components/modals/BulkRejectModal.svelte';
  import UserReviewRequestList from '$lib/components/layout/contributions/UserReviewRequestList.svelte';
  import AdminReviewRequestList from '$lib/components/layout/contributions/AdminReviewRequestList.svelte';
  import SubmissionReader from '$lib/components/readers/SubmissionReader.svelte';
  import ReviewCandidates from '$lib/components/layout/contributions/ReviewCandidates.svelte';

  import { sampleStats } from './lib/constants';
  import type { RebaseQueueEntry } from '$lib/types';

  // --- Local State ---
  let isLoading = $state(true);
  let rebaseQueue = $state<RebaseQueueEntry[]>([]);
  let showActivityTimeline = $state(false);
  let activeTab = $state<'rebase' | 'submissions' | 'reviews'>('rebase');
  let showRejectModal = $state(false);
  let rejectIds = $state<string[]>([]);
  let adminQueue: { reload: () => void } | null = $state(null);
  let showReader = $state(false);
  let previewVolumeId = $state<string | null>(null);

  // Admin check
  let isAdmin = $derived($authUser?.id === 'admin' || $authUser?.role === 'admin');

  // --- Actions ---
  const loadQueue = async () => {
    isLoading = true;
    try {
      const res = await apiFetch<RebaseQueueEntry[]>('/api/contributions/rebase');
      rebaseQueue = res || [];
    } catch (err) {
      console.error('Failed to load queue:', err);
    } finally {
      isLoading = false;
    }
  };

  const handleRebaseAll = () => {
    if (rebaseQueue.length === 0) return;
    const ids = rebaseQueue.map((v) => v.id);
    rebaseState.open(ids);
  };

  const getEntryData = (task: RebaseQueueEntry) => ({
    id: task.id,
    title: task.title,
    folderName: task.title,
    coverUrl: task.coverImageName
      ? `/api/files/volume/${task.id}/image/${task.coverImageName}`
      : null
  });

  $effect(() => {
    const hash = page.url.hash;
    if (hash.startsWith('#preview-')) {
      previewVolumeId = hash.replace('#preview-', '');
      showReader = true;
    } else {
      showReader = false;
      previewVolumeId = null;
    }
  });

  function closePreview() {
    if (page.url.hash.startsWith('#preview-')) {
      history.back();
    } else {
      showReader = false;
      previewVolumeId = null;
    }
  }

  onMount(() => {
    if (isAdmin) {
      activeTab = 'submissions';
      return;
    }
    loadQueue();
  });
</script>

<div class="max-w-5xl mx-auto p-4 space-y-6 pb-20">
  <ContributionsHeader
    {sampleStats}
    activityGraph={[]}
    showQuickActions={true}
    volumesNeedingRebase={rebaseQueue}
    activityHistoryCount={0}
    selectedItemsCount={0}
    onRebaseAll={handleRebaseAll}
    onToggleActivityTimeline={() => (showActivityTimeline = !showActivityTimeline)}
    onBatchRebase={() => {}}
    onExportEdits={() => {}}
  />

  <div class="flex items-center gap-6 border-b border-theme-border overflow-x-auto">
    {#if !isAdmin}
      <button
        onclick={() => (activeTab = 'rebase')}
        class="pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap
        {activeTab === 'rebase'
          ? 'border-accent text-accent'
          : 'border-transparent text-theme-secondary hover:text-theme-primary'}"
      >
        <Inbox class="w-4 h-4" />
        <span>Needs Attention</span>
        {#if rebaseQueue.length > 0}
          <span
            class="px-1.5 py-0.5 rounded-full bg-status-warning text-white text-[10px] leading-none"
          >
            {rebaseQueue.length}
          </span>
        {/if}
      </button>
    {/if}

    <button
      onclick={() => (activeTab = 'submissions')}
      class="pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap
      {activeTab === 'submissions'
        ? 'border-accent text-accent'
        : 'border-transparent text-theme-secondary hover:text-theme-primary'}"
    >
      <ClipboardList class="w-4 h-4" />
      <span>Asset Submissions</span>
    </button>

    <button
      onclick={() => (activeTab = 'reviews')}
      class="pb-3 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap
      {activeTab === 'reviews'
        ? 'border-accent text-accent'
        : 'border-transparent text-theme-secondary hover:text-theme-primary'}"
    >
      <GitPullRequest class="w-4 h-4" />
      <span>Edit Reviews</span>
    </button>
  </div>

  {#if !isAdmin && activeTab === 'rebase'}
    <section class="min-h-[300px]" transition:fade={{ duration: 200 }}>
      <div class="flex items-center justify-end mb-4">
        <button
          class="text-xs text-theme-secondary hover:text-theme-primary transition-colors flex items-center gap-1.5"
          onclick={loadQueue}
        >
          <RefreshCw class="w-3 h-3" />
          Refresh
        </button>
      </div>

      {#if isLoading}
        <LoadingState />
      {:else if rebaseQueue.length === 0}
        <div
          class="py-16 text-center bg-theme-surface/30 rounded-2xl border-2 border-dashed border-theme-border flex flex-col items-center"
        >
          <PartyPopper class="w-12 h-12 mb-4 text-theme-tertiary" />
          <h3 class="font-bold text-theme-primary text-lg mb-1">All Caught Up!</h3>
          <p class="text-sm text-theme-secondary max-w-xs mx-auto">
            You have no conflicting edits.
          </p>
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-3">
          {#each rebaseQueue as task (task.id)}
            <div>
              <LibraryEntry
                entry={getEntryData(task)}
                type="volume"
                viewMode="list"
                href={`#preview-${task.id}`}
                progress={{ percent: 0, isRead: false, hideBar: true }}
                mainStat={`Ahead: +${task.versionInfo.hasAhead}`}
                subStat={`Behind: -${task.versionInfo.hasBehind}`}
              >
                {#snippet listActions()}
                  <button
                    class="px-4 py-2 bg-status-warning text-white text-sm font-bold rounded-lg shadow-lg shadow-status-warning/20 hover:bg-status-warning-hover transition-transform active:scale-95 flex items-center gap-2"
                    onclick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      rebaseState.open([task.id]);
                    }}
                  >
                    <GitMerge class="w-4 h-4" />
                    Rebase
                  </button>
                {/snippet}
              </LibraryEntry>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {:else if activeTab === 'submissions'}
    <div transition:fade={{ duration: 200 }}>
      {#if isAdmin}
        <AdminQueue
          bind:this={adminQueue}
          onOpenBulkReject={(selectedIds) => {
            rejectIds = selectedIds;
            showRejectModal = true;
          }}
        />
      {:else}
        <UserQueue />
      {/if}
    </div>
  {:else if activeTab === 'reviews'}
    <div transition:fade={{ duration: 200 }}>
      <div class="mb-4 text-sm text-theme-tertiary">
        {#if isAdmin}
          Review pending edits from contributors.
        {:else}
          Track the status of text edits you have submitted for review.
        {/if}
      </div>

      {#if isAdmin}
        <AdminReviewRequestList />
      {:else}
        <ReviewCandidates />
        <UserReviewRequestList />
      {/if}
    </div>
  {/if}

  {#if showRejectModal}
    <BulkRejectModal
      bind:isOpen={showRejectModal}
      bind:submissionIds={rejectIds}
      onComplete={() => adminQueue?.reload()}
    />
  {/if}

  {#if showActivityTimeline}
    <ActivityTimeline
      activityHistory={[]}
      onClose={() => (showActivityTimeline = false)}
      onViewVolume={() => {}}
    />
  {/if}

  {#if showReader && previewVolumeId}
    <SubmissionReader volumeId={previewVolumeId} close={closePreview} />
  {/if}
</div>
