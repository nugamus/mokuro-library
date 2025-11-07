<script lang="ts">
	import { browser } from '$app/environment';
	import type { MokuroBlock } from '$lib/types';

	// --- Props ---
	let {
		isOpen = $bindable(false),
		block,
		position,
		onOcrChange
	} = $props<{
		isOpen: boolean;
		block: MokuroBlock | null;
		position: { x: number; y: number };
		onOcrChange: () => void;
	}>();

	// --- State ---
	let sliderElement: HTMLDivElement | null = $state(null);
	let internalFontSize = $state(16);
	let finalX = $state(0);
	let finalY = $state(0);

	// --- Effects ---

	// Sync internal state when the block prop changes (when opening)
	$effect(() => {
		if (block) {
			internalFontSize = block.font_size ?? 16;
		}
	});

	// Keep the slider in the viewport
	$effect(() => {
		if (isOpen && sliderElement && browser) {
			const { x, y } = position;
			const menuWidth = sliderElement.offsetWidth;
			const menuHeight = sliderElement.offsetHeight;
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;

			// Calculate final X
			if (x + menuWidth > viewportWidth) {
				finalX = x - menuWidth;
			} else {
				finalX = x;
			}

			// Calculate final Y
			if (y + menuHeight > viewportHeight) {
				finalY = y - menuHeight;
			} else {
				finalY = y;
			}

			if (finalX < 0) finalX = 0;
			if (finalY < 0) finalY = 0;
		}
	});

	// --- Handlers ---

	/**
	 * This is the "on:input" handler.
	 * It fires continuously as the slider moves.
	 */
	const handleSliderInput = (e: Event) => {
		const target = e.target as HTMLInputElement;
		internalFontSize = parseFloat(target.value);

		if (block) {
			block.font_size = internalFontSize;
			onOcrChange(); // Mark state as dirty
		}
	};
</script>

<!-- 
  This outer div is necessary for the "click-outside"
  logic in ContextMenu.svelte to work correctly.
  We add a unique data-attribute.
-->
<div data-font-slider-popover>
	{#if isOpen}
		<div
			bind:this={sliderElement}
			class="fixed z-50 w-56 rounded-md bg-white p-4 shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800"
			style="left: {finalX}px; top: {finalY}px;"
		>
			<label
				for="fontSizeSlider"
				class="mb-2 flex justify-between text-sm font-medium text-gray-900 dark:text-white"
			>
				<span>Font Size</span>
				<span class="font-bold">{internalFontSize.toFixed(0)}px</span>
			</label>
			<input
				id="fontSizeSlider"
				type="range"
				min="8"
				max="48"
				step="1"
				value={internalFontSize}
				oninput={handleSliderInput}
				class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-indigo-600 dark:bg-gray-700"
			/>
		</div>
	{/if}
</div>
