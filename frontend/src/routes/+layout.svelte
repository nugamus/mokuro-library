<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { checkAuth, user } from '$lib/authStore';
	import { uiState } from '$lib/states/uiState.svelte';
	import { toastStore } from '$lib/stores/toastStore.svelte';
	import { contributionsStore } from '$lib/stores/contributionsStore';
	import { keybindStore } from '$lib/stores/keybindStore';
	import { handleGlobalKeydown } from '$lib/keybindsRuntime';

	// Components
	import Header from '$lib/components/Header.svelte';
	import ContextMenu from '$lib/components/ContextMenu.svelte';
	import ConfirmationModal from '$lib/components/ConfirmationModal.svelte';
	import UploadModal from '$lib/components/UploadModal.svelte';
	import StatisticsModal from '$lib/components/StatisticsModal.svelte';
	import AboutModal from '$lib/components/AboutModal.svelte';
	import AppearanceModal from '$lib/components/AppearanceModal.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import KeyboardShortcutsModal from '$lib/components/KeyboardShortcutsModal.svelte';

	let { children } = $props();

	onMount(() => {
		checkAuth();
		// Initialize theme (themeStore constructor applies saved theme)
		// This ensures theme is applied on page load
		let lastMessage = '';
		let lastAt = 0;

		const notify = (message: string) => {
			const now = Date.now();
			if (message && (message !== lastMessage || now - lastAt > 2000)) {
				toastStore.error(message);
				lastMessage = message;
				lastAt = now;
			}
		};

		const onError = (event: ErrorEvent) => {
			if (event?.error?.message) {
				notify(event.error.message);
			} else {
				notify('Unexpected error occurred.');
			}
		};

		const onRejection = (event: PromiseRejectionEvent) => {
			if (event?.reason instanceof Error) {
				notify(event.reason.message);
			} else {
				notify('Unexpected error occurred.');
			}
		};

		const handleKeydown = (event: KeyboardEvent) => {
			handleGlobalKeydown(event);
		};

		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);
		window.addEventListener('keydown', handleKeydown);

		return () => {
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	$effect(() => {
		if (!$user) return;
		uiState.libraryVersion;
		contributionsStore.refresh();
	});

	$effect(() => {
		keybindStore.setFromSettings($user?.settings ?? null);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1e293b" />
</svelte:head>

<a href="#main-content" class="skip-link">Skip to main content</a>

<div
	class="min-h-screen bg-theme-main text-theme-primary font-sans selection:bg-accent-surface selection:text-white"
>
	{#if $user && uiState.context !== 'reader'}
		<Header />
	{/if}

	<main id="main-content" class="relative" tabindex="-1">
		{@render children()}
	</main>

	{#if $user}
		<UploadModal
			isOpen={uiState.isUploadOpen}
			onClose={() => (uiState.isUploadOpen = false)}
			onUploadSuccess={() => {
				uiState.refreshLibrary();
			}}
		/>

		<StatisticsModal isOpen={uiState.isStatsOpen} onClose={() => (uiState.isStatsOpen = false)} />

		<AboutModal isOpen={uiState.isAboutOpen} onClose={() => (uiState.isAboutOpen = false)} />

		<AppearanceModal
			isOpen={uiState.isAppearanceOpen}
			onClose={() => (uiState.isAppearanceOpen = false)}
		/>
	{/if}

	<ContextMenu />
	<ConfirmationModal />
	<ToastContainer />
	<KeyboardShortcutsModal />
</div>

<style>
	.skip-link {
		position: absolute;
		top: -3rem;
		left: 0;
		background: var(--color-accent);
		color: white;
		padding: 0.75rem 1rem;
		z-index: 9999;
		text-decoration: none;
		font-weight: 500;
		border-radius: 0 0 0.25rem 0;
		transition: top 0.2s ease;
	}

	.skip-link:focus {
		top: 0;
		outline: 2px solid white;
		outline-offset: 2px;
	}
</style>
