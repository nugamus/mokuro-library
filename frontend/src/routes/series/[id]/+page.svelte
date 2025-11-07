<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { user } from '$lib/authStore';

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
				</div>
			{/each}
		</div>
	{/if}
</div>
