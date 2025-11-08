<script lang="ts">
	import { user } from '$lib/authStore';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { apiFetch } from '$lib/api';
	import { confirmation } from '$lib/confirmationStore';
	import UploadModal from '$lib/components/UploadModal.svelte';

	// --- Type definitions ---
	interface Volume {
		id: string;
		title: string;
		pageCount: number;
	}
	interface Series {
		id: string;
		title: string;
		coverPath: string | null;
		volumes: Volume[];
	}

	// --- Use $state for all reactive variables ---
	let library = $state<Series[]>([]);
	let isLoadingLibrary = $state(true);
	let libraryError = $state<string | null>(null);
	let isUploadModalOpen = $state(false);

	// --- Auth Effect ---
	$effect(() => {
		if (browser) {
			// ONLY redirect if $user is NULL (check complete, no user)
			// DO NOT redirect if $user is UNDEFINED (still loading)
			if ($user === null) {
				goto('/login');
			}
		}
	});

	// --- Library Fetch Effect ---
	$effect(() => {
		if ($user && browser) {
			fetchLibrary();
		}
	});

	// --- fetchLibrary ---
	const fetchLibrary = async () => {
		try {
			isLoadingLibrary = true;
			libraryError = null;
			const data = await apiFetch('/api/library');
			library = data as Series[];
		} catch (e) {
			libraryError = (e as Error).message;
		} finally {
			isLoadingLibrary = false;
		}
	};

	// --- Opens confirmation to delete a series ---
	const handleDeleteSeries = (seriesId: string, seriesTitle: string) => {
		confirmation.open(
			'Delete Series?',
			`Are you sure you want to permanently delete "${seriesTitle}" and all ${
				library.find((s) => s.id === seriesId)?.volumes.length ?? 'its'
			} volumes? This action cannot be undone.`,
			async () => {
				// This is the onConfirm callback
				try {
					await apiFetch(`/api/library/series/${seriesId}`, {
						method: 'DELETE'
					});
					// Refresh the library list
					await fetchLibrary();
				} catch (e) {
					// Show error in the main UI
					libraryError = `Failed to delete series: ${(e as Error).message}`;
				}
			}
		);
	};

	// --- Logout Handler  ---
	const handleLogout = async () => {
		try {
			await apiFetch('/api/auth/logout', {
				method: 'POST'
			});
		} catch (e) {
			console.error('Logout failed:', (e as Error).message);
		}
		user.set(null);
	};
</script>

<div class="min-h-screen bg-gray-100 p-8 dark:bg-gray-900">
	{#if $user}
		<div
			class="flex flex-col items-center justify-between gap-4 border-b border-gray-300 pb-4 dark:border-gray-700 sm:flex-row"
		>
			<h1 class="text-3xl font-bold dark:text-white">
				{$user.username}'s Library
			</h1>

			<div class="flex items-center gap-4 w-full sm:w-auto sm:ml-auto">
				<button
					onclick={() => (isUploadModalOpen = true)}
					class="w-1/2 rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 sm:w-auto"
				>
					Upload
				</button>

				<button
					onclick={handleLogout}
					class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 sm:w-auto"
				>
					Log Out
				</button>
			</div>
		</div>

		<div class="mt-8">
			{#if isLoadingLibrary}
				<p class="mt-4 text-gray-700 dark:text-gray-300">Loading library...</p>
			{:else if libraryError}
				<p class="mt-4 text-red-500 dark:text-red-400">
					Error loading library: {libraryError}
				</p>
			{:else if library.length === 0}
				<div class="text-center">
					<p class="mt-4 text-lg text-gray-700 dark:text-gray-300">Your library is empty.</p>
					<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
						Upload some manga to get started.
					</p>
				</div>
			{:else}
				<div
					class="mt-6 grid grid-cols-2 gap-y-10 gap-x-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:gap-x-8"
				>
					{#each library as series (series.id)}
						<div class="group relative">
							<div class="mt-4">
								<h3 class="text-md font-medium text-gray-900 dark:text-white">
									<a href={`/series/${series.id}`}>
										<span aria-hidden="true" class="absolute inset-0"></span>
										{series.title}
									</a>
								</h3>
								<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
									{series.volumes.length}
									{series.volumes.length === 1 ? 'volume' : 'volumes'}
								</p>
							</div>

							<!-- Delete Button -->
							<button
								type="button"
								aria-label="Delete series"
								onclick={(e) => {
									e.preventDefault(); // Stop navigation
									e.stopPropagation(); // Stop group click
									handleDeleteSeries(series.id, series.title);
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
	{:else}
		<div class="flex h-screen items-center justify-center">
			<p class="text-gray-700 dark:text-gray-300">Loading...</p>
		</div>
	{/if}

	<UploadModal
		isOpen={isUploadModalOpen}
		onClose={() => (isUploadModalOpen = false)}
		onUploadSuccess={() => {
			isUploadModalOpen = false;
			fetchLibrary(); // Refresh the library list!
		}}
	/>
</div>
