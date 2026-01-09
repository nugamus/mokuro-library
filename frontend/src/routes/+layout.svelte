<script lang="ts">
  import favicon from '$lib/assets/favicon.svg';
  import '../app.css';

  import { onMount } from 'svelte';
  import { checkAuth, startAuthMonitoring, user } from '$lib/stores/authStore';
  import { uiState } from '$lib/states/ui/uiState.svelte.ts';
  import { toastStore } from '$lib/stores/toastStore.svelte.ts';
  import { contributionsStore } from '$lib/stores/contributionsStore';
  import { keybindStore } from '$lib/stores/keybindStore';
  import { handleGlobalKeydown } from '$lib/keybinds/runtime';
  import { prefetchAppData } from '$lib/utils/caching/eagercache';
  import { prefetchCommonRoutes } from '$lib/utils/caching/prefetch';

  // Components - Critical components loaded immediately
  import Header from '$lib/components/layout/Header.svelte';
  import ContextMenu from '$lib/components/menu/ContextMenu.svelte';
  import ConfirmationModal from '$lib/components/modals/ConfirmationModal.svelte';
  import ToastContainer from '$lib/components/feedback/ToastContainer.svelte';
  import KeyboardShortcutsModal from '$lib/components/modals/KeyboardShortcutsModal.svelte';
  import { apiCache } from '$lib/utils/caching/apiCache';

  // Lazy load modals that are less frequently used
  const loadUploadModal = () => import('$lib/components/modals/UploadModal.svelte');
  const loadStatisticsModal = () => import('$lib/components/modals/StatisticsModal.svelte');
  const loadAboutModal = () => import('$lib/components/modals/AboutModal.svelte');
  const loadAppearanceModal = () => import('$lib/components/modals/AppearanceModal.svelte');

  let { children } = $props();

  // Lazy-loaded modal components
  let UploadModal = $state<unknown>(null);
  let StatisticsModal = $state<unknown>(null);
  let AboutModal = $state<unknown>(null);
  let AppearanceModal = $state<unknown>(null);
  let didPrefetch = $state(false);

  // Load modals when needed
  $effect(() => {
    if (uiState.isUploadOpen && !UploadModal) {
      loadUploadModal().then((m) => (UploadModal = m.default));
    }
  });

  $effect(() => {
    if (uiState.isStatsOpen && !StatisticsModal) {
      loadStatisticsModal().then((m) => (StatisticsModal = m.default));
    }
  });

  $effect(() => {
    if (uiState.isAboutOpen && !AboutModal) {
      loadAboutModal().then((m) => (AboutModal = m.default));
    }
  });

  $effect(() => {
    if (uiState.isAppearanceOpen && !AppearanceModal) {
      loadAppearanceModal().then((m) => (AppearanceModal = m.default));
    }
  });

  onMount(() => {
    checkAuth();

    // Start periodic auth monitoring
    const stopMonitoring = startAuthMonitoring();
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
      stopMonitoring();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  $effect(() => {
    if (!$user || didPrefetch) return;
    didPrefetch = true;

    contributionsStore.refresh();

    // Prefetch app data after login
    prefetchAppData();
    prefetchCommonRoutes();
  });

  $effect(() => {
    if ($user === null) {
      didPrefetch = false;
    }
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
    {#if uiState.isUploadOpen && UploadModal}
      <UploadModal
        isOpen={uiState.isUploadOpen}
        onClose={() => (uiState.isUploadOpen = false)}
        onUploadSuccess={() => {
          apiCache.invalidateSeriesCache();
          apiCache.invalidateLibraryCache(true);
          uiState.refreshLibrary();
        }}
      />
    {/if}

    {#if uiState.isStatsOpen && StatisticsModal}
      <StatisticsModal isOpen={uiState.isStatsOpen} onClose={() => (uiState.isStatsOpen = false)} />
    {/if}

    {#if uiState.isAboutOpen && AboutModal}
      <AboutModal isOpen={uiState.isAboutOpen} onClose={() => (uiState.isAboutOpen = false)} />
    {/if}

    {#if uiState.isAppearanceOpen && AppearanceModal}
      <AppearanceModal
        isOpen={uiState.isAppearanceOpen}
        onClose={() => (uiState.isAppearanceOpen = false)}
      />
    {/if}
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
