<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { browser } from '$app/environment';

	// Stores & State
	import { user } from '$lib/stores/authStore';
	import { imageStore } from '$lib/stores/cachedImageStore';
	import { confirmation } from '$lib/stores/confirmationStore';
	import { readerState } from '$lib/states/reader/ReaderState.svelte.ts';
	import { uiState } from '$lib/states/ui/uiState.svelte.ts';

	// Components
	import ReaderSettings from '$lib/components/settings/ReaderSettings.svelte';
	import SinglePageReader from '$lib/components/readers/SinglePageReader.svelte';
	import DoublePageReader from '$lib/components/readers/DoublePageReader.svelte';
	import VerticalReader from '$lib/components/readers/VerticalReader.svelte';
	import LineOrderModal from '$lib/components/modals/LineOrderModal.svelte';
	import ReaderHeader from '$lib/components/layout/ReaderHeader.svelte';
	import type { PanzoomObject } from '@panzoom/panzoom';
	import type { MokuroBlock, MokuroPage } from '$lib/types';

	// --- Props ---
	let { params } = $props<{ params: { id: string } }>();

	// --- UI State (View Specific) ---
	let settingsOpen = $state(false);
	let panzoomInstance = $state<PanzoomObject | null>(null);
	// handle header visibility on mobile
	let headerTimer: ReturnType<typeof setTimeout> | null = null;
	let headerIsVisible = $state(false);
	let showTouchZones = $state(false);
	let touchHintTimer: ReturnType<typeof setTimeout> | null = null;

	// --- Initialization ---
	$effect(() => {
		if (params.id) {
			readerState.mount(params.id);
		}
		return () => {
			readerState.cleanup();
			imageStore.clear();
		};
	});

	// Auth Check
	$effect(() => {
		if ($user === null && browser) {
			goto('/login');
		}
	});

	// --- Navigation Guard ---
	beforeNavigate(({ to, cancel }) => {
		if (readerState.hasUnsavedChanges) {
			cancel();
			confirmation.open(
				'Discard Unsaved Changes?',
				'You have unsaved OCR edits. Are you sure you want to discard them?',
				async () => {
					readerState.hasUnsavedChanges = false;
					if (to?.url) goto(to.url);
				},
				'Discard & Exit',
				'Exiting...'
			);
		}
	});

	// Font Slider Helpers
	const focusedBlockFontSize = $derived(readerState.focusedBlock?.font_size ?? 16);
	const sliderMax = $derived(
		readerState.focusedPage
			? Math.floor(
					Math.min(readerState.focusedPage.img_height, readerState.focusedPage.img_width) / 3
				)
			: 100
	);

	const handleFontSizeInput = (e: Event) => {
		if (readerState.focusedBlock) {
			readerState.focusedBlock.font_size = parseFloat((e.target as HTMLInputElement).value);
			readerState.onOcrChange();
		}
	};

	const handleFontSizeWheel = (e: WheelEvent) => {
		if (readerState.focusedBlock) {
			const delta = e.deltaY > 0 ? -1 : 1;
			const newSize = (readerState.focusedBlock.font_size ?? 16) + delta;
			readerState.focusedBlock.font_size = Math.max(newSize, 1);
			readerState.onOcrChange();
		}
	};

	// Reset Panzoom
	$effect(() => {
		readerState.currentPageIndex; // Dependency
		if (panzoomInstance && readerState.layoutMode !== 'vertical') {
			if (readerState.retainZoom) {
				panzoomInstance.pan(0, 0, { animate: true });
			} else {
				panzoomInstance.reset({ animate: true });
			}
		}
	});

	// Touch/Hover Detection
	let hasHover = $state(true);
	onMount(() => {
		if (browser) {
			const mq = window.matchMedia('(hover: none)');
			hasHover = !mq.matches;
			showTouchZones = mq.matches;
			if (mq.matches) {
				touchHintTimer = setTimeout(() => {
					showTouchZones = false;
				}, 3000);
			}
			const listener = (e: MediaQueryListEvent) => (hasHover = !e.matches);
			const hintListener = (e: MediaQueryListEvent) => {
				if (e.matches) {
					showTouchZones = true;
					if (touchHintTimer) clearTimeout(touchHintTimer);
					touchHintTimer = setTimeout(() => {
						showTouchZones = false;
					}, 3000);
				}
			};

			mq.addEventListener('change', listener);
			mq.addEventListener('change', hintListener);

			// Set Context for header
			uiState.setContext('reader', 'Reader', []);

			return () => {
				mq.removeEventListener('change', listener);
				mq.removeEventListener('change', hintListener);
				if (touchHintTimer) clearTimeout(touchHintTimer);
			};
		}
	});

	// Bridge functions
	const onOcrChange = () => readerState.onOcrChange();
	const onLineFocus = (block: MokuroBlock | null, page: MokuroPage | null) =>
		readerState.setFocusedBlock(block, page);
</script>

<svelte:head>
	<title>
		{readerState.volume ? `${readerState.seriesTitle} - ${readerState.volumeTitle}` : 'Loading...'}
	</title>
</svelte:head>

<div class="relative flex h-screen w-full flex-col bg-gray-800 dark:bg-black overflow-hidden">
	{#if readerState.isLoading}
		<div class="flex flex-1 items-center justify-center">
			<div class="w-full max-w-3xl px-6 py-10 animate-pulse space-y-4">
				<div class="h-4 w-32 rounded-full bg-white/20"></div>
				<div class="h-[60vh] rounded-2xl border border-white/10 bg-white/5"></div>
			</div>
		</div>
	{:else if readerState.error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-red-400">Error: {readerState.error}</p>
		</div>
	{:else if readerState.volume}
		<ReaderHeader bind:settingsOpen />

		<main class="flex flex-1 items-center justify-center overflow-hidden h-full">
			{#if readerState.layoutMode === 'vertical'}
				<VerticalReader
					bind:panzoomInstance
					showTriggerOutline={readerState.showTriggerOutline}
					{onOcrChange}
					{onLineFocus}
					onOcrChangeMode={(m) => readerState.setOcrMode(m)}
				/>
			{:else if readerState.layoutMode === 'double'}
				<DoublePageReader
					bind:panzoomInstance
					navZoneWidth={readerState.navZoneWidth}
					showTriggerOutline={readerState.showTriggerOutline}
					{onOcrChange}
					{onLineFocus}
					onOcrChangeMode={(m) => readerState.setOcrMode(m)}
				/>
			{:else}
				<SinglePageReader
					bind:panzoomInstance
					navZoneWidth={readerState.navZoneWidth}
					showTriggerOutline={readerState.showTriggerOutline}
					{onOcrChange}
					{onLineFocus}
					onOcrChangeMode={(m) => readerState.setOcrMode(m)}
				/>
			{/if}
		</main>

		{#if showTouchZones}
			<div class="pointer-events-none absolute inset-0 z-40 flex text-[11px] text-white/80">
				<div class="flex-1 flex items-center justify-start pl-4">Prev</div>
				<div class="flex-1 flex items-center justify-center">Menu</div>
				<div class="flex-1 flex items-center justify-end pr-4">Next</div>
			</div>
		{/if}

		{#if settingsOpen}
			<button
				onclick={() => (settingsOpen = false)}
				type="button"
				class="fixed inset-0 z-[60] h-full w-full cursor-auto bg-black/60 backdrop-blur-sm"
				aria-label="Close settings"
			></button>

			<div
				class="fixed right-0 top-0 z-[70] h-full"
				onclick={(e) => e.stopPropagation()}
				role="presentation"
			>
				<ReaderSettings onClose={() => (settingsOpen = false)} inReader={true} />
			</div>
		{/if}
		<LineOrderModal />
	{/if}
</div>




