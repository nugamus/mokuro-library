<script lang="ts">
	import { Shield, GitMerge, User, Calendar, Hash } from 'lucide-svelte';

	// Components
	import CommentThread from '../../components/CommentThread.svelte';
	import AcceptSubmissionModal from '../../components/modals/AcceptSubmissionModal.svelte';
	import RejectSubmissionModal from '../../components/modals/RejectSubmissionModal.svelte';
	import SubmissionReader from '../../components/SubmissionReader.svelte';
	import Badge from '$lib/components/controls/Badge.svelte';
	import Button from '$lib/components/controls/Button.svelte';
	import Icon from '$lib/components/controls/Icon.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';

	// Types
	import type { Submission } from '$lib/types';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteDate } from 'svelte/reactivity';

	let { data } = $props<{ data: { submission: Submission } }>();

	let submission = $derived(data.submission);
	let showReader = $state(false);
	let previewVolumeId = $state<string | null>(null);
	let showAcceptModal = $state(false);
	let showRejectModal = $state(false);

	const statusColors: Record<Submission['status'], string> = {
	  pending: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
	  accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
	  rejected: 'bg-red-500/20 text-red-400 border-red-500/30'
	};

	function handleSuccess() {
	  // Navigate back to the review queue
	  goto(resolve('/contributions?tab=queue'), { invalidateAll: true });
	}

	function openPreview(volumeId: string) {
	  previewVolumeId = volumeId;
	  showReader = true;
	}

	function closePreview() {
	  showReader = false;
	  previewVolumeId = null;
	}
</script>

{#if showReader && previewVolumeId}
	<SubmissionReader volumeId={previewVolumeId} close={closePreview} />
{/if}

{#if showAcceptModal && submission}
	<AcceptSubmissionModal
		submissionId={submission.id}
		on_close={() => (showAcceptModal = false)}
		on_success={handleSuccess}
	/>
{/if}

{#if showRejectModal && submission}
	<RejectSubmissionModal
		submissionId={submission.id}
		on_close={() => (showRejectModal = false)}
		on_success={handleSuccess}
	/>
{/if}

<div class="flex h-full w-full flex-col">
	{#if submission}
		<PageHeader
			title="Submission Review"
			description="Review the submission details and contents before accepting or rejecting."
		>
			<div class="flex items-center gap-2">
				<Button
					onclick={() => (showRejectModal = true)}
					variant="danger"
					disabled={submission.status !== 'pending'}
				>
					Reject
				</Button>
				<Button
					onclick={() => (showAcceptModal = true)}
					variant="success"
					disabled={submission.status !== 'pending'}
				>
					Accept
				</Button>
			</div>
		</PageHeader>

		<main class="flex-1 overflow-y-auto p-6 space-y-6">
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
				<!-- Submission Info -->
				<div class="md:col-span-1 bg-white/5 border border-white/10 rounded-lg p-4">
					<h2 class="font-bold text-lg mb-4">Submission Details</h2>
					<div class="space-y-3 text-sm">
						<div class="flex items-center gap-3">
							<Icon icon={Shield} class="text-white/50" />
							<span
								>Status: <Badge class={statusColors[submission.status as Submission['status']]}
									>{submission.status}</Badge
								></span
							>
						</div>
						<div class="flex items-center gap-3">
							<Icon icon={User} class="text-white/50" />
							<span
								>Submitted by: <span class="font-semibold">{submission.user.username}</span></span
							>
						</div>
						<div class="flex items-center gap-3">
							<Icon icon={Calendar} class="text-white/50" />
							<span>Submitted on: {new SvelteDate(submission.submittedAt).toLocaleDateString()}</span>
						</div>
						<div class="flex items-center gap-3">
							<Icon icon={Hash} class="text-white/50" />
							<span>ID: <span class="font-mono text-xs">{submission.id}</span></span>
						</div>
					</div>
				</div>

				<!-- Target Info -->
				<div class="md:col-span-2 bg-white/5 border border-white/10 rounded-lg p-4">
					<h2 class="font-bold text-lg mb-4">Target Series</h2>
					<div class="space-y-3 text-sm">
						<div class="flex items-center gap-3">
							<Icon icon={GitMerge} class="text-white/50" />
							{#if submission.targetSeries}
								<span
									>Merge into existing series: <span class="font-semibold"
										>{submission.targetSeries.title}</span
									></span
								>
							{:else if submission.sourceSeries}
								<span
									>Create new series from: <span class="font-semibold"
										>{submission.sourceSeries.title}</span
									></span
								>
							{:else}
								<span>Create new series</span>
							{/if}
						</div>
						<p class="text-white/60 text-xs italic">
							{#if submission.targetSeries}
								The submitted volumes will be added to the existing admin series '{submission
								  .targetSeries.title}'.
							{:else if submission.sourceSeries}
								A new admin series will be created based on the user's series '{submission
								  .sourceSeries.title}'.
							{:else}
								A new admin series will be created.
							{/if}
						</p>
					</div>
				</div>
			</div>

			<!-- Submitted Volumes -->
			<div>
				<h2 class="text-xl font-bold mb-4">Submitted Volumes ({submission.volumes.length})</h2>
				<div
					class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4"
				>
					{#each submission.volumes as volume (volume.id)}
						<div class="group">
							<div
								class="rounded-lg border bg-white/5 border-white/10 overflow-hidden relative aspect-[7/10] transition-all group-hover:shadow-lg group-hover:scale-105"
							>
								<div class="aspect-[7/10] bg-gray-700">
									{#if volume.coverFile}
										<img
											src={`/api/files/volume/${volume.id}/image/${volume.coverFile}`}
											alt={volume.title}
											class="w-full h-full object-cover"
										/>
									{:else}
										<div
											class="w-full h-full flex items-center justify-center text-3xl text-white/50"
										>
											📖
										</div>
									{/if}
								</div>
								<div
									class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20"
								></div>
								<div class="absolute bottom-0 left-0 right-0 p-2 text-sm">
									<p class="font-bold truncate text-white">{volume.title}</p>
									{#if volume.number}
										<p class="text-xs text-white/70">Volume {volume.number}</p>
									{/if}
								</div>
							</div>
							<Button
								class="w-full mt-2"
								variant="secondary"
								size="sm"
								onclick={() => openPreview(volume.id)}
							>
								Preview
							</Button>
						</div>
					{/each}
				</div>
			</div>

			<CommentThread comments={submission.comments} submissionId={submission.id} />
		</main>
	{:else}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-red-400">Submission not found.</p>
		</div>
	{/if}
</div>
