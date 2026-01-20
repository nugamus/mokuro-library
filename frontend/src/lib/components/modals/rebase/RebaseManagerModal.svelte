<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { rebaseState } from '$lib/states/rebase/RebaseState.svelte';
  import SessionList from './SessionList.svelte';
  import ConflictResolver from './ConflictResolver.svelte';

  // We use the global state directly
  // Just close the modal via state
  const close = () => {
    rebaseState.close();
  };
</script>

{#if rebaseState.isModalOpen}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
  >
    <button
      class="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
      transition:fade={{ duration: 150 }}
      onclick={close}
      onkeydown={(event) => event.key === 'Escape' && close()}
      aria-label="Close modal"
    ></button>

    <div
      class="relative w-full max-w-6xl h-[85vh] overflow-hidden rounded-2xl border border-theme-border bg-theme-surface shadow-2xl flex flex-col"
      transition:scale={{ duration: 200, start: 0.97 }}
    >
      <div
        class="flex items-center justify-between px-6 py-4 bg-theme-main border-b border-theme-border flex-shrink-0"
      >
        <h2 class="text-lg font-bold text-theme-primary">Rebase Manager</h2>
        <button
          onclick={close}
          class="p-2 rounded-lg text-theme-secondary hover:text-theme-primary hover:bg-theme-surface-hover"
          aria-label="Close"
        >
          <span aria-hidden="true" class="text-xl leading-none">&times;</span>
        </button>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <SessionList />

        <div class="flex-1 bg-theme-main h-full overflow-hidden relative">
          {#if rebaseState.isLoading}
            <div class="absolute inset-0 flex items-center justify-center bg-theme-main/50 z-10">
              <div
                class="animate-spin h-8 w-8 border-4 border-theme-primary border-t-transparent rounded-full"
              ></div>
            </div>
          {/if}

          {#if rebaseState.selectedSession}
            <ConflictResolver session={rebaseState.selectedSession} />
          {:else}
            <div
              class="flex flex-col items-center justify-center h-full text-theme-secondary p-8 text-center"
            >
              <div
                class="w-16 h-16 bg-theme-surface-highlight rounded-full flex items-center justify-center mb-4"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="opacity-50"
                >
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                </svg>
              </div>
              <h3 class="text-lg font-bold text-theme-primary mb-2">No Session Selected</h3>
              <p class="max-w-md">
                Select a session from the sidebar to resolve its conflicts, or close this window to
                return to the library.
              </p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
