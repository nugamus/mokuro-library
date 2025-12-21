<script lang="ts">
	import { browser } from '$app/environment';
	import MenuGridRadio from '$lib/components/menu/MenuGridRadio.svelte';
	import MenuToggle from '$lib/components/menu/MenuToggle.svelte';
	import MenuSlider from '$lib/components/menu/MenuSlider.svelte';
	import { readerState } from '$lib/states/ReaderState.svelte';

	let {
		onClose,
		inReader = false,
		hideHUD = $bindable(false)
	}: { onClose?: () => void; inReader?: boolean; hideHUD?: boolean } = $props();

	// Helper Proxy for Zoom Mode (Boolean in State <-> String in UI)
	class ZoomProxy {
		get value() {
			return readerState.retainZoom ? 'keep' : 'fit-screen';
		}
		set value(v: string) {
			readerState.retainZoom = v === 'keep';
		}
	}
	const zoomProxy = new ZoomProxy();

	// Placeholder local states for settings NOT yet in ReaderState
	// These remain local until we decide to persist them in the backend
	let autoFullscreenState = $state(initFromStorage('mokuro_auto_fullscreen', false));
	const autoFullscreenProxy = {
		get value() { return autoFullscreenState; },
		set value(v: boolean) {
			autoFullscreenState = v;
			if (browser) {
				localStorage.setItem('mokuro_auto_fullscreen', JSON.stringify(v));
				if (v) {
					if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
				} else {
					if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
				}
			}
		}
	};
	let showCharacterCount = $state(false);
	let showTimer = $state(false);

	// Helper to initialize state from localStorage
	function initFromStorage<T>(key: string, fallback: T): T {
		if (browser) {
			const stored = localStorage.getItem(key);
			if (stored !== null) {
				try {
					return JSON.parse(stored);
				} catch (e) {
					console.error('Failed to parse setting', key, e);
				}
			}
		}
		return fallback;
	}

	// New settings for Night Mode
	let nightModeEnabled = $state(initFromStorage('mokuro_night_mode_enabled', false));
	let nightModeScheduleEnabled = $state(initFromStorage('mokuro_night_mode_schedule_enabled', false));
	let nightModeBrightness = $state(initFromStorage('mokuro_night_mode_brightness', 100)); // 0-100%
	let nightModeStartHour = $state(initFromStorage('mokuro_night_mode_start_hour', 22)); // 0-23
	let nightModeEndHour = $state(initFromStorage('mokuro_night_mode_end_hour', 6)); // 0-23

	// New settings for Invert Colors
	let invertColorsEnabled = $state(initFromStorage('mokuro_invert_enabled', false));
	let invertColorsScheduleEnabled = $state(initFromStorage('mokuro_invert_schedule_enabled', false));
	let invertColorsIntensity = $state(initFromStorage('mokuro_invert_intensity', 100)); // 0-100%
	let invertColorsStartHour = $state(initFromStorage('mokuro_invert_start_hour', 22)); // 0-23
	let invertColorsEndHour = $state(initFromStorage('mokuro_invert_end_hour', 6)); // 0-23

	// Time tracking for schedules
	let now = $state(new Date());

	$effect(() => {
		const interval = setInterval(() => {
			now = new Date();
		}, 60000);
		return () => clearInterval(interval);
	});

	let isNightModeActive = $derived.by(() => {
		if (!nightModeEnabled) return false;
		if (!nightModeScheduleEnabled) return true;
		const h = now.getHours();
		if (nightModeStartHour <= nightModeEndHour) {
			return h >= nightModeStartHour && h < nightModeEndHour;
		} else {
			return h >= nightModeStartHour || h < nightModeEndHour;
		}
	});

	let isInvertActive = $derived.by(() => {
		if (!invertColorsEnabled) return false;
		if (!invertColorsScheduleEnabled) return true;
		const h = now.getHours();
		if (invertColorsStartHour <= invertColorsEndHour) {
			return h >= invertColorsStartHour && h < invertColorsEndHour;
		} else {
			return h >= invertColorsStartHour || h < invertColorsEndHour;
		}
	});

	$effect(() => {
		const b = isNightModeActive ? nightModeBrightness : 100;
		
		// Smart Invert Logic:
		// If active, fully invert (100%), but use intensity to adjust brightness (so it's not too harsh).
		// We map intensity 0-100 to brightness 40%-100% to ensure text remains visible.
		const inv = isInvertActive ? 100 : 0;
		const invBright = isInvertActive ? (40 + (invertColorsIntensity * 0.6)) : 100;

		document.documentElement.style.setProperty('--reader-brightness', `${b}%`);
		document.documentElement.style.setProperty('--reader-invert', `${inv}%`);
		document.documentElement.style.setProperty('--reader-invert-brightness', `${invBright}%`);

		if (browser) {
			localStorage.setItem('mokuro_night_mode_enabled', JSON.stringify(nightModeEnabled));
			localStorage.setItem('mokuro_night_mode_schedule_enabled', JSON.stringify(nightModeScheduleEnabled));
			localStorage.setItem('mokuro_night_mode_brightness', JSON.stringify(nightModeBrightness));
			localStorage.setItem('mokuro_night_mode_start_hour', JSON.stringify(nightModeStartHour));
			localStorage.setItem('mokuro_night_mode_end_hour', JSON.stringify(nightModeEndHour));

			localStorage.setItem('mokuro_invert_enabled', JSON.stringify(invertColorsEnabled));
			localStorage.setItem('mokuro_invert_schedule_enabled', JSON.stringify(invertColorsScheduleEnabled));
			localStorage.setItem('mokuro_invert_intensity', JSON.stringify(invertColorsIntensity));
			localStorage.setItem('mokuro_invert_start_hour', JSON.stringify(invertColorsStartHour));
			localStorage.setItem('mokuro_invert_end_hour', JSON.stringify(invertColorsEndHour));
		}
	});
</script>

{#snippet singleIcon()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="28"
		height="28"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<rect x="7" y="2" width="10" height="20" rx="2" ry="2" />
	</svg>
{/snippet}

{#snippet doubleIcon()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="28"
		height="28"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<rect x="3" y="2" width="7" height="20" rx="1" ry="1" />
		<rect x="14" y="2" width="7" height="20" rx="1" ry="1" />
	</svg>
{/snippet}

{#snippet verticalIcon()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="28"
		height="28"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<rect x="6" y="2" width="12" height="6" rx="1" ry="1" />
		<rect x="6" y="9" width="12" height="6" rx="1" ry="1" />
		<rect x="6" y="16" width="12" height="6" rx="1" ry="1" />
	</svg>
{/snippet}

{#snippet settingsContent()}
	<MenuGridRadio
		title="Page Layout"
		tooltip="Single: one page
Double: side-by-side
Vertical: continuous scroll"
		bind:value={readerState.layoutMode}
		layout={[3]}
		options={[
			{ value: 'single', label: 'Single', icon: singleIcon },
			{ value: 'double', label: 'Double', icon: doubleIcon },
			{ value: 'vertical', label: 'Vertical', icon: verticalIcon }
		]}
	/>

	<MenuGridRadio
		title="Direction"
		tooltip="LTR: western comics
RTL: manga/right-to-left"
		bind:value={readerState.readingDirection}
		layout={[2]}
		options={[
			{ value: 'ltr', label: 'LTR' },
			{ value: 'rtl', label: 'RTL' }
		]}
	/>

	<MenuGridRadio
		title="On Page Change"
		tooltip="Fit to Screen: auto-adjust
Keep Zoom: maintain level"
		bind:value={zoomProxy.value}
		layout={[2]}
		options={[
			{ value: 'fit-screen', label: 'Fit to Screen' },
			// { value: 'fit-width', label: 'Fit to Width' },
			// { value: 'original', label: 'Original Size' },
			{ value: 'keep', label: 'Keep Zoom' }
			// { value: 'keep-pan', label: 'Keep Zoom & Pan Top' }
		]}
	/>

	<div class="rounded-2xl bg-theme-main p-6 border border-theme-border-light space-y-4">
		<div
			role="group"
			onmousedown={() => document.documentElement.style.setProperty('--nav-zone-opacity', '0.3')}
			onmouseup={() => document.documentElement.style.setProperty('--nav-zone-opacity', '0')}
			onmouseleave={() => document.documentElement.style.setProperty('--nav-zone-opacity', '0')}
			ontouchstart={() => document.documentElement.style.setProperty('--nav-zone-opacity', '0.3')}
			ontouchend={() => document.documentElement.style.setProperty('--nav-zone-opacity', '0')}
			ontouchcancel={() => document.documentElement.style.setProperty('--nav-zone-opacity', '0')}
		>
			<MenuSlider
				label="Nav Zone Width (%)"
				tooltip="Clickable area width on edges.
Higher = easier nav, smaller OCR area."
				bind:value={readerState.navZoneWidth}
				min={0}
				max={50}
				step={1}
				displayValue="{readerState.navZoneWidth}%"
			/>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-4">
		<MenuToggle label="First Page is Cover" bind:checked={readerState.firstPageIsCover} />
		<MenuToggle label="Auto fullscreen" bind:checked={autoFullscreenProxy.value} />
		<MenuToggle label="Hide HUD unless hovered" bind:checked={hideHUD} />
		<MenuToggle label="Show Character Count" bind:checked={showCharacterCount} />
		<MenuToggle label="Show Timer" bind:checked={showTimer} />
		<MenuToggle label="OCR Outline" bind:checked={readerState.showTriggerOutline} />
	</div>

	<!-- Night Mode Settings -->
	<div class="rounded-2xl bg-theme-main p-6 border border-theme-border-light space-y-4">
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-semibold text-white">Night Mode</h3>
			<div class="clean-toggle">
				<MenuToggle bind:checked={nightModeEnabled} />
			</div>
		</div>
		<MenuSlider
			label="Brightness (%)"
			tooltip="Adjust the brightness level for night mode."
			bind:value={nightModeBrightness}
			min={0}
			max={100}
			step={1}
			displayValue="{nightModeBrightness}%"
		/>
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-sm text-theme-secondary">Schedule (Local Time)</span>
				<div class="clean-toggle">
					<MenuToggle bind:checked={nightModeScheduleEnabled} />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col">
					<label for="nightModeStartHour" class="text-sm text-theme-secondary mb-1">Start Hour (0-23)</label>
					<input
						type="number"
						id="nightModeStartHour"
						bind:value={nightModeStartHour}
						min={0}
						max={23}
						class="w-full p-2 rounded-md bg-theme-surface border border-theme-border-light text-theme-primary"
					/>
				</div>
				<div class="flex flex-col">
					<label for="nightModeEndHour" class="text-sm text-theme-secondary mb-1">End Hour (0-23)</label>
					<input
						type="number"
						id="nightModeEndHour"
						bind:value={nightModeEndHour}
						min={0}
						max={23}
						class="w-full p-2 rounded-md bg-theme-surface border border-theme-border-light text-theme-primary"
					/>
				</div>
			</div>
		</div>
	</div>

	<!-- Invert Colors Settings -->
	<div class="rounded-2xl bg-theme-main p-6 border border-theme-border-light space-y-4">
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-semibold text-white">Invert Colors</h3>
			<div class="clean-toggle">
				<MenuToggle bind:checked={invertColorsEnabled} />
			</div>
		</div>
		<MenuSlider
			label="Intensity (%)"
			tooltip="Adjust the intensity of color inversion."
			bind:value={invertColorsIntensity}
			min={0}
			max={100}
			step={1}
			displayValue="{invertColorsIntensity}%"
		/>
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-sm text-theme-secondary">Schedule (Local Time)</span>
				<div class="clean-toggle">
					<MenuToggle bind:checked={invertColorsScheduleEnabled} />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="flex flex-col">
					<label for="invertColorsStartHour" class="text-sm text-theme-secondary mb-1">Start Hour (0-23)</label>
					<input
						type="number"
						id="invertColorsStartHour"
						bind:value={invertColorsStartHour}
						min={0}
						max={23}
						class="w-full p-2 rounded-md bg-theme-surface border border-theme-border-light text-theme-primary"
					/>
				</div>
				<div class="flex flex-col">
					<label for="invertColorsEndHour" class="text-sm text-theme-secondary mb-1">End Hour (0-23)</label>
					<input
						type="number"
						id="invertColorsEndHour"
						bind:value={invertColorsEndHour}
						min={0}
						max={23}
						class="w-full p-2 rounded-md bg-theme-surface border border-theme-border-light text-theme-primary"
					/>
				</div>
			</div>
		</div>
	</div>
{/snippet}

{#if inReader}
	<div
		class="w-full max-w-2xl h-full flex flex-col rounded-l-2xl border-l border-t border-b border-theme-border bg-theme-surface shadow-2xl"
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-6 py-4 bg-theme-main border-b border-theme-border flex-shrink-0">
			<div class="flex items-center gap-3">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="24"
					height="24"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="text-accent"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
					/>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
					/>
				</svg>
				<h2 class="text-2xl font-bold text-white">Reader Settings</h2>
			</div>
			<button
				onclick={onClose}
				class="p-2 rounded-lg text-theme-secondary hover:text-white hover:bg-theme-surface-hover transition-colors"
				aria-label="Close"
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
				>
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		</div>

		<!-- Content (Scrollable) -->
		<div class="flex-1 overflow-y-auto p-6">
			<div class="space-y-5">
				{@render settingsContent()}
			</div>
		</div>
	</div>
{:else}
	<div class="w-full p-8 max-w-4xl">
		<div class="mb-8">
			<h1 class="text-3xl font-bold text-white mb-2">Reader Settings</h1>
			<p class="text-base text-theme-secondary">Configure how you read your content by default.</p>
		</div>

		<div class="space-y-5">
			{@render settingsContent()}
		</div>
	</div>
{/if}

<style>
	/* Hide spin buttons for number inputs */
	input[type='number']::-webkit-inner-spin-button,
	input[type='number']::-webkit-outer-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[type='number'] {
		-moz-appearance: textfield;
	}

	/* Hide the empty label container in MenuToggle when used in clean-toggle context */
	.clean-toggle :global(.flex.flex-col) {
		display: none;
	}

	/* Remove container styling from MenuToggle when used in clean-toggle context */
	.clean-toggle :global(> *) {
		background-color: transparent !important;
		border: none !important;
		padding: 0 !important;
		width: auto !important;
		min-height: 0 !important;
	}

	/* Apply filters to reader content (pages and OCR) */
	:global(.reader-page) {
		/* Apply invert first so brightness dims the result (keeping bg black), not the source */
		filter: brightness(var(--reader-brightness, 100%)) brightness(var(--reader-invert-brightness, 100%)) invert(var(--reader-invert, 0%));
	}
</style>
