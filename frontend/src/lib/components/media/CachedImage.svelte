<script lang="ts">
	import { browser } from '$app/environment';
	import { imageStore } from '$lib/stores/cachedImageStore';

	let { src } = $props<{ src: string }>();

	let localUrl = $state<string | null>(null);
	let error = $state<string | null>(null);
	let optimizedSrc = $derived.by(() => {
		if (!browser) return src;
		try {
			const url = new URL(src, window.location.origin);
			const isOptimizable =
				url.pathname.startsWith('/api/files/volume/') ||
				url.pathname.startsWith('/api/files/series/');
			if (!isOptimizable) return src;
			if (url.searchParams.has('w') || url.searchParams.has('format')) return src;

			const width = Math.min(
				Math.ceil(window.innerWidth * window.devicePixelRatio),
				2200
			);
			url.searchParams.set('w', width.toString());
			url.searchParams.set('q', '80');
			url.searchParams.set('format', 'webp');
			return `${url.pathname}?${url.searchParams.toString()}`;
		} catch {
			return src;
		}
	});

	$effect(() => {
		if (!browser) return;

		// Call the store's 'get' method.
		// This handles all caching and deduplication.
		imageStore
			.get(optimizedSrc)
			.then((url) => {
				localUrl = url;
			})
			.catch((e) => {
				error = (e as Error).message;
			});
	});
</script>

{#if error}
	<div class="flex h-full w-full items-center justify-center bg-gray-900">
		<span class="text-red-500">Error loading image</span>
	</div>
{:else if !localUrl}
	<div class="flex h-full w-full items-center justify-center bg-gray-900">
		<span class="text-gray-500">Loading...</span>
	</div>
{:else}
	<img src={localUrl} alt="Page" class="h-full w-full object-contain" draggable="false" />
{/if}
