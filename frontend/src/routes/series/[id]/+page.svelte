<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { user } from '$lib/authStore';
	import { confirmation } from '$lib/confirmationStore';

	// --- Type definitions ---
	interface Volume {
		id: string;
		title: string;
		pageCount: number;
		coverImageName: string | null;
	}
	interface Series {
		id: string;
		title: string;
		coverPath: string | null;
		volumes: Volume[];
	}

	// --- State ---
	let series = $state<Series | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Get the series ID from the URL
	// Get the 'params' prop from SvelteKit's router
	let { params } = $props<{ params: { id: string } }>();

	// --- Fetch Data ---
	$effect(() => {
		// This effect now reactively depends on $user and $page.params.id
		if ($user && params.id) {
			// Pass the reactive ID to the fetch function
			fetchSeriesData(params.id);
		}
	});

	// Make the function accept the id as an argument
	const fetchSeriesData = async (seriesId: string) => {
		isLoading = true;
		error = null;
		try {
			// Use the seriesId argument in the API call
			const data = await apiFetch(`/api/library/series/${seriesId}`);
			series = data as Series;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			isLoading = false;
		}
	};

	// --- Opens confirmation to delete a volume
	const handleDeleteVolume = (volumeId: string, volumeTitle: string) => {
		confirmation.open(
			'Delete Volume?',
			`Are you sure you want to permanently delete "${volumeTitle}"? This action cannot be undone.`,
			async () => {
				// This is the onConfirm callback
				try {
					await apiFetch(`/api/library/volume/${volumeId}`, {
						method: 'DELETE'
					});
					// Refresh the series data
					await fetchSeriesData(params.id);
				} catch (e) {
					// Show error in the main UI
					error = `Failed to delete volume: ${(e as Error).message}`;
				}
			}
		);
	};
</script>

<div class="min-h-screen bg-gray-100 p-8 dark:bg-gray-900">
	<a
		href="/"
		class="mb-6 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
	>
		&larr; Back to Library
	</a>

	{#if isLoading}
		<p class="text-gray-700 dark:text-gray-300">Loading series...</p>
	{:else if error}
		<p class="text-red-500 dark:text-red-400">
			Error loading series: {error}
		</p>
	{:else if series}
		<h1 class="text-4xl font-bold dark:text-white">{series.title}</h1>

		<div
			class="mt-8 grid grid-cols-2 gap-y-10 gap-x-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:gap-x-8"
		>
			{#each series.volumes as volume (volume.id)}
				<div class="group relative">
					<div
						class="aspect-w-2 aspect-h-3 w-full overflow-hidden rounded-md bg-gray-200 dark:bg-gray-800"
					>
						{#if volume.coverImageName}
							<img
								src={`/api/files/volume/${volume.id}/image/${volume.coverImageName}`}
								alt={volume.title}
								class="h-full w-full object-cover object-center"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center text-center text-gray-400">
								{volume.title}
							</div>
						{/if}
					</div>
					<div class="mt-4">
						<h3 class="text-md font-medium text-gray-900 dark:text-white">
							<a href={`/volume/${volume.id}`}>
								<span aria-hidden="true" class="absolute inset-0"></span>
								{volume.title}
							</a>
						</h3>
					</div>

					<!-- Delete Button -->
					<button
						type="button"
						aria-label="Delete volume"
						onclick={(e) => {
							e.preventDefault(); // Stop navigation
							e.stopPropagation(); // Stop group click
							handleDeleteVolume(volume.id, volume.title);
						}}
						class="absolute top-2 right-2 z-10 rounded-full bg-black/30 p-1 text-white/70 opacity-0 transition-opacity hover:bg-red-600 hover:text-white group-hover:opacity-100"
					>
						<!-- Trash Icon -->
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
							<path
								fill="currentColor"
								d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12l1.41 1.41L13.41 14l2.12 2.12l-1.41 1.41L12 15.41l-2.12 2.12l-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"
							/>
						</svg>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
