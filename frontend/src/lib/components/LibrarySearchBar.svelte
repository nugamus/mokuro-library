<script lang="ts">
	import { page } from '$app/state'; // New SvelteKit 5 state source
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	// Read directly from the reactive page object
	let q = $state(page.url.searchParams.get('q') || '');

	// Derived state for styling active buttons
	let currentSort = $derived(page.url.searchParams.get('sort') || 'title');
	let currentOrder = $derived(page.url.searchParams.get('order') || 'asc');
	let currentView = $derived(page.url.searchParams.get('view') || 'grid');

	let timer: ReturnType<typeof setTimeout>;

	// Debounced Search
	const updateSearch = (newVal: string) => {
		q = newVal;
		clearTimeout(timer);
		timer = setTimeout(() => {
			updateUrl({ q: newVal, page: '1' });
		}, 300);
	};

	// Toggle Order if clicking same sort, otherwise set new sort
	const updateSort = (newSort: string) => {
		let newOrder = 'asc';
		if (currentSort === newSort && currentOrder === 'asc') {
			newOrder = 'desc';
		}
		updateUrl({ sort: newSort, order: newOrder, page: '1' });
	};

	const updateView = (newView: string) => {
		if (browser) {
			localStorage.setItem('library_view_mode', newView);
		}
		// Changing view doesn't need to reset the page
		updateUrl({ view: newView });
	};

	const updateUrl = (changes: Record<string, string | null>) => {
		const params = new URLSearchParams(page.url.searchParams);

		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === '') {
				params.delete(key);
			} else {
				params.set(key, value);
			}
		}

		// keepFocus: true prevents input blur, replaceState: true keeps history clean
		goto(`${page.url.pathname}?${params.toString()}`, { keepFocus: true, replaceState: true });
	};

	// Restore persistence on mount
	$effect(() => {
		if (browser) {
			const savedView = localStorage.getItem('library_view_mode');
			const currentViewParam = page.url.searchParams.get('view');

			// If we have a saved preference and no URL override, apply it
			if (savedView && !currentViewParam) {
				updateUrl({ view: savedView });
			}
		}
	});
</script>

<div
	class="flex flex-col gap-4 sm:flex-row sm:items-center bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-6"
>
	<div class="relative flex-1">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<!-- magnifying glass icon -->
			<svg class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
				<path
					fill-rule="evenodd"
					d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
					clip-rule="evenodd"
				/>
			</svg>
		</div>
		<input
			type="text"
			bind:value={q}
			oninput={(e) => updateSearch(e.currentTarget.value)}
			placeholder="Search library..."
			class="block w-full rounded-md border-0 py-1.5 pl-10 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 dark:bg-gray-700 dark:text-white dark:ring-gray-600 sm:text-sm sm:leading-6"
		/>
	</div>

	<div class="flex items-center gap-2">
		<span class="text-sm text-gray-500 dark:text-gray-400">Sort by:</span>
		<div class="flex rounded-md shadow-sm">
			{#each ['title', 'created', 'updated', 'recent'] as sortKey}
				<button
					onclick={() => updateSort(sortKey)}
					class={`relative inline-flex items-center px-3 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10 dark:ring-gray-600 dark:hover:bg-gray-700 
            ${sortKey === 'title' ? 'rounded-l-md' : ''} 
            ${sortKey === 'recent' ? 'rounded-r-md -ml-px' : '-ml-px'}
            ${currentSort === sortKey ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-200' : 'bg-white text-gray-900 dark:bg-gray-800 dark:text-white'}`}
				>
					{sortKey === 'title' ? 'A-Z' : sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}
					{#if currentSort === sortKey}
						<span class="ml-1">{currentOrder === 'desc' ? '↓' : '↑'}</span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="hidden sm:block h-6 w-px bg-gray-300 dark:bg-gray-600"></div>

		<div class="flex rounded-md shadow-sm">
			<button
				onclick={() => updateView('grid')}
				class={`relative inline-flex items-center p-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 rounded-l-md hover:bg-gray-50 focus:z-10 dark:ring-gray-600 dark:hover:bg-gray-700
          ${currentView === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-200' : 'bg-white text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}
				title="Grid View"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect
						x="14"
						y="14"
						width="7"
						height="7"
					/><rect x="3" y="14" width="7" height="7" /></svg
				>
			</button>
			<button
				onclick={() => updateView('list')}
				class={`relative inline-flex items-center p-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 rounded-r-md -ml-px hover:bg-gray-50 focus:z-10 dark:ring-gray-600 dark:hover:bg-gray-700
          ${currentView === 'list' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-200' : 'bg-white text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}
				title="List View"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line
						x1="8"
						y1="18"
						x2="21"
						y2="18"
					/><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line
						x1="3"
						y1="18"
						x2="3.01"
						y2="18"
					/></svg
				>
			</button>
		</div>
	</div>
</div>
