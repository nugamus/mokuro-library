<script lang="ts">
  import { onMount } from 'svelte';
  import { user } from '$lib/stores/authStore';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { browser } from '$app/environment';
  import { sampleStats } from './lib/constants';
  import { ContributionsState } from './state/ContributionsState.svelte.ts';
  import ContributionsHeader from './components/ContributionsHeader.svelte';
  import ActivityTimeline from './components/ActivityTimeline.svelte';
  import DevelopmentNotice from './components/DevelopmentNotice.svelte';
  import ErrorState from './components/ErrorState.svelte';
  import FilterBar from './components/FilterBar.svelte';
  import LoadingState from './components/LoadingState.svelte';
  import EmptyState from './components/EmptyState.svelte';
  import SeriesGrid from './components/SeriesGrid.svelte';
  import ResetModal from './components/modals/ResetModal.svelte';
  import RebaseModal from './components/modals/RebaseModal.svelte';
  import DiffViewerModal from './components/modals/DiffViewerModal.svelte';
  import SubmitVolumesModal from './components/modals/SubmitVolumesModal.svelte';
  import SubmissionsList from './components/SubmissionsList.svelte';
  import AdminQueue from './components/AdminQueue.svelte';
  import BulkRejectModal from './components/modals/BulkRejectModal.svelte';
  import UserSubmissionPanel from './components/UserSubmissionPanel.svelte';
  import AdminStats from './components/AdminStats.svelte';

  const contributionsState = new ContributionsState();

  let activeTab = $state<'my-contributions' | 'review-queue'>('my-contributions');
  let userSubTab = $state<'ocr-edits' | 'submit-manga' | 'my-submissions'>('ocr-edits');
  let showSubmitModal = $state(false);
  let showBulkRejectModal = $state(false);
  let bulkRejectSubmissionIds = $state<string[]>([]);
  let adminQueueRef: AdminQueue | undefined = $state();

  // Determine if user is admin
  const isAdmin = $derived($user?.id === 'admin');

  onMount(() => contributionsState.mount());

  $effect(() => {
    if (browser && $user === null) goto(resolve('/login'));
  });

  $effect(() => {
    if (browser) {
      contributionsState.persistExpanded();
    }
  });

  // Reset to my-contributions tab if non-admin tries to access review queue
  $effect(() => {
    if (!isAdmin && activeTab === 'review-queue') {
      activeTab = 'my-contributions';
    }
  });

  // Handle bulk reject modal
  function handleOpenBulkReject(ids: string[]) {
    bulkRejectSubmissionIds = ids;
    showBulkRejectModal = true;
  }

  function handleBulkRejectComplete() {
    showBulkRejectModal = false;
    bulkRejectSubmissionIds = [];
    // Reload admin queue
    adminQueueRef?.reload();
  }
</script>

<div class="max-w-7xl mx-auto p-4">
  <DevelopmentNotice />

  <ContributionsHeader
    {sampleStats}
    activityGraph={contributionsState.activityGraph}
    showQuickActions={Boolean(
      contributionsState.lastContinueVolume || contributionsState.recentlyEdited.length > 0
    )}
    volumesNeedingRebase={contributionsState.volumesNeedingRebase}
    activityHistoryCount={contributionsState.activityHistory.length}
    selectedItemsCount={contributionsState.selectedItems.size}
    onRebaseAll={() => contributionsState.handleRebaseAll()}
    onToggleActivityTimeline={() =>
      (contributionsState.showActivityTimeline = !contributionsState.showActivityTimeline)}
    onBatchRebase={() => contributionsState.handleBatchRebase()}
    onExportEdits={() => contributionsState.handleExportEdits()}
  />

  <!-- Activity Timeline Panel -->
  {#if contributionsState.showActivityTimeline && contributionsState.activityHistory.length > 0}
    <ActivityTimeline
      activityHistory={contributionsState.activityHistory}
      onClose={() => (contributionsState.showActivityTimeline = false)}
      onViewVolume={(volumeId) => contributionsState.handleViewVolume(volumeId)}
    />
  {/if}

  <!-- Tab Navigation -->
  <div class="flex items-center gap-2 border-b border-theme-border mb-6 mt-6">
    <button
      onclick={() => (activeTab = 'my-contributions')}
      class="px-4 py-2 font-semibold text-sm transition-all relative {activeTab ===
      'my-contributions'
        ? 'text-accent border-b-2 border-accent'
        : 'text-theme-secondary hover:text-theme-primary'}"
    >
      My Contributions
    </button>

    {#if isAdmin}
      <button
        onclick={() => (activeTab = 'review-queue')}
        class="px-4 py-2 font-semibold text-sm transition-all relative {activeTab === 'review-queue'
          ? 'text-accent border-b-2 border-accent'
          : 'text-theme-secondary hover:text-theme-primary'}"
      >
        Review Queue
      </button>
    {/if}

    <div class="flex-1"></div>
  </div>

  <!-- Tab Content -->
  {#if activeTab === 'my-contributions'}
    <!-- User Sub-Tabs -->
    <div class="flex items-center gap-2 border-b border-theme-border/50 mb-4">
      <button
        onclick={() => (userSubTab = 'ocr-edits')}
        class="px-3 py-2 font-semibold text-xs transition-all relative {userSubTab === 'ocr-edits'
          ? 'text-accent border-b-2 border-accent'
          : 'text-theme-tertiary hover:text-theme-primary'}"
      >
        ✏️ OCR Edits
      </button>
      <button
        onclick={() => (userSubTab = 'submit-manga')}
        class="px-3 py-2 font-semibold text-xs transition-all relative {userSubTab ===
        'submit-manga'
          ? 'text-accent border-b-2 border-accent'
          : 'text-theme-tertiary hover:text-theme-primary'}"
      >
        📤 Submit Manga
      </button>
      <button
        onclick={() => (userSubTab = 'my-submissions')}
        class="px-3 py-2 font-semibold text-xs transition-all relative {userSubTab ===
        'my-submissions'
          ? 'text-accent border-b-2 border-accent'
          : 'text-theme-tertiary hover:text-theme-primary'}"
      >
        📋 My Submissions
      </button>
    </div>

    <!-- User Sub-Tab Content -->
    {#if userSubTab === 'ocr-edits'}
      <FilterBar
        activeFilter={contributionsState.activeFilter}
        filterCounts={contributionsState.filterCounts}
        onFilterChange={(filter) => (contributionsState.activeFilter = filter)}
      />

      <!-- OCR Sync Grid -->
      {#if contributionsState.isLoading}
        <LoadingState />
      {:else if contributionsState.error}
        <ErrorState message={contributionsState.error} />
      {:else if contributionsState.filteredSeries.length === 0}
        <EmptyState activeFilter={contributionsState.activeFilter} />
      {:else}
        <SeriesGrid
          seriesList={contributionsState.filteredSeries}
          expandedSeries={contributionsState.expandedSeries}
          selectedItems={contributionsState.selectedItems}
          isSelectionMode={contributionsState.isSelectionMode}
          onToggleSeries={(e, seriesId) => contributionsState.toggleSeries(e, seriesId)}
          onSeriesLongPress={(seriesId) => contributionsState.handleSeriesLongPress(seriesId)}
          onSeriesSelect={(e, seriesId) => contributionsState.handleSeriesSelect(e, seriesId)}
          onVolumeLongPress={(volumeId) => contributionsState.handleVolumeLongPress(volumeId)}
          onVolumeSelect={(e, volumeId) => contributionsState.handleVolumeSelect(e, volumeId)}
          onViewVolume={(volumeId) => contributionsState.handleViewVolume(volumeId)}
          onRebase={(e, volume, seriesTitle) =>
            contributionsState.handleRebase(e, volume, seriesTitle)}
          onReset={(e, volume) => contributionsState.handleReset(e, volume)}
          onOpenDiffViewer={(volume) => contributionsState.openDiffViewer(volume)}
        />
      {/if}
    {:else if userSubTab === 'submit-manga'}
      <!-- Submit Manga Panel -->
      <UserSubmissionPanel />
    {:else if userSubTab === 'my-submissions'}
      <!-- My Submissions List -->
      <SubmissionsList />
    {/if}
  {:else if activeTab === 'review-queue'}
    <!-- Tab 2: Admin Review Queue -->
    <AdminStats />
    <AdminQueue bind:this={adminQueueRef} onOpenBulkReject={handleOpenBulkReject} />
  {/if}
</div>

<ResetModal
  isOpen={contributionsState.resetModal.isOpen}
  volumeTitle={contributionsState.resetModal.volumeTitle}
  isResetting={contributionsState.isResetting}
  onClose={() => (contributionsState.resetModal.isOpen = false)}
  onConfirm={() => contributionsState.confirmReset()}
/>

<RebaseModal
  isOpen={contributionsState.rebaseModal.isOpen}
  rebaseModal={contributionsState.rebaseModal}
  onAbort={() => contributionsState.abortRebase()}
  onResolve={(resolution) => contributionsState.resolveConflict(resolution)}
/>

<DiffViewerModal
  isOpen={contributionsState.showDiffViewer}
  volume={contributionsState.selectedDiffVolume}
  onClose={() => (contributionsState.showDiffViewer = false)}
  onStartRebase={() => {
    contributionsState.showDiffViewer = false;
    alert('Would start rebase process for this volume');
  }}
/>

<SubmitVolumesModal bind:isOpen={showSubmitModal} />

<BulkRejectModal
  bind:isOpen={showBulkRejectModal}
  bind:submissionIds={bulkRejectSubmissionIds}
  onComplete={handleBulkRejectComplete}
/>

<style>
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes expandDown {
    from {
      opacity: 0;
      max-height: 0;
    }
    to {
      opacity: 1;
      max-height: 3000px;
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
