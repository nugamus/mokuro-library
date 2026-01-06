<script lang="ts">
	import type { Submission } from '$lib/types';
	import { apiFetch } from '$lib/services/api';
	import { contributionsStore } from '$lib/stores/contributionsStore';
import { toastStore } from '$lib/stores/toastStore.svelte.ts';
	import { onMount } from 'svelte';

	let { onOpenBulkReject } = $props<{
		onOpenBulkReject: (selectedIds: string[]) => void;
	}>();

	let submissions = $state<Submission[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let selectedIds = $state<Set<string>>(new Set());

	// Load pending submissions (admin view)
	async function loadSubmissions() {
		loading = true;
		error = null;
		try {
			const data = await apiFetch<Submission[]>(
				'/api/contributions/submissions?status=pending',
				{
					showErrorToast: false
				}
			);
			submissions = data || [];
		} catch (e: any) {
			error = e.message || 'Failed to load submissions';
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
		selectedIds = selectedIds; // Trigger reactivity
	}

	// Select all
	function selectAll() {
		selectedIds = new Set(submissions.map((s) => s.id));
	}

	// Deselect all
	function deselectAll() {
		selectedIds = new Set();
	}

	// Accept single submission
	async function handleAccept(submissionId: string) {
		if (!confirm('Accept this submission? Files will be moved to the admin library.')) return;

		try {
			await contributionsStore.acceptSubmission(submissionId);
			toastStore.addToast('Submission accepted successfully', 'success');
			// Reload submissions
			await loadSubmissions();
			// Clear selection if it was selected
			selectedIds.delete(submissionId);
			selectedIds = selectedIds;
		} catch (e: any) {
			toastStore.addToast(e.message || 'Failed to accept submission', 'error');
		}
	}

	// Reject single submission (opens modal)
	function handleReject(submissionId: string) {
		onOpenBulkReject([submissionId]);
	}

	// Bulk accept selected submissions
	async function handleBulkAccept() {
		if (selectedIds.size === 0) return;

		if (
			!confirm(
				`Accept ${selectedIds.size} submission(s)? Files will be moved to the admin library.`
			)
		)
			return;

		try {
			const result = await contributionsStore.bulkAcceptSubmissions(Array.from(selectedIds));

			if (result.failed > 0) {
				toastStore.addToast(
					`Accepted ${result.success}, failed ${result.failed}`,
					'warning'
				);
			} else {
				toastStore.addToast(
					`Successfully accepted ${result.success} submission(s)`,
					'success'
				);
			}

			// Reload submissions
			await loadSubmissions();
			deselectAll();
		} catch (e: any) {
			toastStore.addToast(e.message || 'Failed to accept submissions', 'error');
		}
	}

	// Bulk reject (opens modal)
	function handleBulkReject() {
		if (selectedIds.size === 0) return;
		onOpenBulkReject(Array.from(selectedIds));
	}

	// Format date
	function formatDate(dateString: string): string {
		const date = new Date(dateString);
		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Reload when bulk reject completes
	export function reload() {
		loadSubmissions();
		deselectAll();
	}

	onMount(() => {
		loadSubmissions();
	});
</script>

<div class="space-y-4">
	<!-- Bulk Actions Toolbar -->
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

	<!-- Loading State -->
	{#if loading}
		<div class="bg-theme-surface/30 border border-theme-border rounded-lg p-8 text-center">
			<div class="text-3xl mb-2">⏳</div>
			<div class="text-sm text-theme-secondary">Loading pending submissions...</div>
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
	{:else if submissions.length === 0}
		<!-- Empty State -->
		<div class="bg-theme-surface/30 border border-theme-border rounded-lg p-8 text-center">
			<div class="text-4xl mb-3">✨</div>
			<div class="text-sm font-semibold text-theme-primary mb-1">All Caught Up!</div>
			<div class="text-xs text-theme-tertiary">
				No pending submissions to review. New submissions from users will appear here.
			</div>
		</div>
	{:else}
		<!-- Header Actions -->
		<div class="flex items-center gap-2 pb-2">
			<button
				onclick={selectAll}
				class="text-xs text-accent hover:text-accent-hover font-semibold transition-colors"
			>
				Select All ({submissions.length})
			</button>
		</div>

		<!-- Submissions Grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			{#each submissions as submission}
				<div
					class="bg-theme-surface/30 border-2 rounded-lg overflow-hidden transition-all {selectedIds.has(
						submission.id
					)
						? 'border-accent shadow-lg'
						: 'border-theme-border hover:border-accent/30'}"
				>
					<div class="p-4">
						<!-- Selection Checkbox & Header -->
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
								<!-- Submitter Info -->
								<div class="flex items-center gap-2 mb-2">
									<div class="text-xs font-semibold text-theme-primary">
										{submission.user?.username || 'Unknown User'}
									</div>
									<span
										class="px-2 py-0.5 rounded bg-status-warning/20 text-status-warning text-[10px] font-bold border border-status-warning/30"
									>
										Pending
									</span>
								</div>

								<!-- Series Info -->
								<div class="text-sm font-bold text-theme-primary mb-1">
									{#if submission.sourceSeries}
										<span class="text-theme-secondary text-xs">From:</span>
										{submission.sourceSeries.title || submission.sourceSeries.folderName}
									{/if}
								</div>

								{#if submission.targetSeries}
									<div class="text-xs text-theme-tertiary mb-2">
										→ Merge into: <strong
											>{submission.targetSeries.title || submission.targetSeries.folderName}</strong
										>
									</div>
								{:else}
									<div class="text-xs text-theme-tertiary mb-2">
										→ <span
											class="px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 font-semibold"
											>New Series</span
										>
									</div>
								{/if}

								<!-- Metadata -->
								<div class="flex items-center gap-2 text-xs text-theme-tertiary flex-wrap">
									<span class="font-semibold"
										>{submission._count?.volumes || 0} volume(s)</span
									>
									<span>•</span>
									<span>{formatDate(submission.submittedAt)}</span>
								</div>
							</div>
						</div>

						<!-- Action Buttons -->
						<div class="flex items-center gap-2 mt-4 pt-3 border-t border-theme-border">
							<a
								href="/contributions/submissions/{submission.id}"
								class="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-center bg-theme-surface text-theme-primary hover:bg-theme-surface-hover border border-theme-border transition-all"
							>
								👁️ Review
							</a>
							<button
								onclick={() => handleAccept(submission.id)}
								class="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-status-success/10 text-status-success hover:bg-status-success/20 border border-status-success/30 transition-all"
							>
								✅ Accept
							</button>
							<button
								onclick={() => handleReject(submission.id)}
								class="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-status-danger/10 text-status-danger hover:bg-status-danger/20 border border-status-danger/30 transition-all"
							>
								❌ Reject
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.animate-slideIn {
		animation: slideIn 0.2s ease-out;
	}
</style>
