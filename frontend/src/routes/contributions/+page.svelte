<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/stores/authStore';
	import { goto } from '$app/navigation';
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

	const state = new ContributionsState();

	onMount(() => state.mount());

	$effect(() => {
		if (browser && $user === null) goto('/login');
	});

	$effect(() => {
		if (browser) {
			const expandedKey = Array.from(state.expandedSeries).join('|');
			expandedKey;
			state.persistExpanded();
		}
	});
</script>

<div class="max-w-7xl mx-auto p-4">
	<DevelopmentNotice />

	<ContributionsHeader
		sampleStats={sampleStats}
		activityGraph={state.activityGraph}
		showQuickActions={Boolean(state.lastContinueVolume || state.recentlyEdited.length > 0)}
		volumesNeedingRebase={state.volumesNeedingRebase}
		activityHistoryCount={state.activityHistory.length}
		selectedItemsCount={state.selectedItems.size}
		onRebaseAll={() => state.handleRebaseAll()}
		onToggleActivityTimeline={() => (state.showActivityTimeline = !state.showActivityTimeline)}
		onBatchRebase={() => state.handleBatchRebase()}
		onExportEdits={() => state.handleExportEdits()}
	/>

	<!-- Activity Timeline Panel -->
	{#if state.showActivityTimeline && state.activityHistory.length > 0}
		<ActivityTimeline
			activityHistory={state.activityHistory}
			onClose={() => (state.showActivityTimeline = false)}
			onViewVolume={(volumeId) => state.handleViewVolume(volumeId)}
		/>
	{/if}

	<FilterBar
		activeFilter={state.activeFilter}
		filterCounts={state.filterCounts}
		onFilterChange={(filter) => (state.activeFilter = filter)}
	/>

	<!-- Loading State -->
	{#if state.isLoading}
		<LoadingState />
	{:else if state.error}
		<ErrorState message={state.error} />
	{:else if state.filteredSeries.length === 0}
		<EmptyState activeFilter={state.activeFilter} />
	{:else}
		<SeriesGrid
			seriesList={state.filteredSeries}
			expandedSeries={state.expandedSeries}
			selectedItems={state.selectedItems}
			isSelectionMode={state.isSelectionMode}
			onToggleSeries={(e, seriesId) => state.toggleSeries(e, seriesId)}
			onSeriesLongPress={(seriesId) => state.handleSeriesLongPress(seriesId)}
			onSeriesSelect={(e, seriesId) => state.handleSeriesSelect(e, seriesId)}
			onVolumeLongPress={(volumeId) => state.handleVolumeLongPress(volumeId)}
			onVolumeSelect={(e, volumeId) => state.handleVolumeSelect(e, volumeId)}
			onViewVolume={(volumeId) => state.handleViewVolume(volumeId)}
			onRebase={(e, volume, seriesTitle) => state.handleRebase(e, volume, seriesTitle)}
			onReset={(e, volume) => state.handleReset(e, volume)}
			onOpenDiffViewer={(volume) => state.openDiffViewer(volume)}
		/>
	{/if}
</div>

<ResetModal
	isOpen={state.resetModal.isOpen}
	volumeTitle={state.resetModal.volumeTitle}
	isResetting={state.isResetting}
	onClose={() => (state.resetModal.isOpen = false)}
	onConfirm={() => state.confirmReset()}
/>

<RebaseModal
	isOpen={state.rebaseModal.isOpen}
	rebaseModal={state.rebaseModal}
	onAbort={() => state.abortRebase()}
	onResolve={(resolution) => state.resolveConflict(resolution)}
/>

<DiffViewerModal
	isOpen={state.showDiffViewer}
	volume={state.selectedDiffVolume}
	onClose={() => (state.showDiffViewer = false)}
	onStartRebase={() => {
		state.showDiffViewer = false;
		alert('Would start rebase process for this volume');
	}}
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
