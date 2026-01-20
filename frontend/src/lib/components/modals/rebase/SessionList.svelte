<script lang="ts">
  import { rebaseState } from '$lib/states/rebase/RebaseState.svelte';

  // Helper to format the time since update
  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    }).format(date);
  };
</script>

<div
  class="flex flex-col h-full border-r border-theme-border bg-theme-surface-highlight w-64 flex-shrink-0"
>
  <div class="p-4 border-b border-theme-border">
    <h3 class="font-bold text-theme-primary">Active Sessions ({rebaseState.activeSessionCount})</h3>
    <p class="text-xs text-theme-secondary mt-1">
      {rebaseState.activeSessionCount} / {10} slots used
    </p>
  </div>

  <div class="flex-1 overflow-y-auto p-2 space-y-2">
    {#each rebaseState.sessions as session (session.id)}
      <div class="relative group w-full">
        <button
          class="w-full text-left p-3 rounded-lg border transition-all duration-200"
          class:bg-theme-main={rebaseState.selectedSessionId === session.id}
          class:border-theme-primary={rebaseState.selectedSessionId === session.id}
          class:bg-theme-surface={rebaseState.selectedSessionId !== session.id}
          class:border-theme-border={rebaseState.selectedSessionId !== session.id}
          class:hover:border-theme-primary-dim={rebaseState.selectedSessionId !== session.id}
          onclick={() => rebaseState.selectSession(session.id)}
        >
          <div class="flex justify-between items-start mb-1">
            <span
              class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              class:bg-red-500={session.status === 'conflict'}
              class:text-white={session.status === 'conflict'}
              class:bg-blue-500={session.status === 'resolving' || session.status === 'starting'}
              class:bg-theme-surface-hover={session.status === 'idle'}
            >
              {session.status}
            </span>
            <span class="text-[10px] text-theme-secondary">
              {formatTime(session.updatedAt)}
            </span>
          </div>

          <div
            class="font-medium text-sm text-theme-primary truncate pr-6"
            title={session.seriesTitle}
          >
            {session.seriesTitle}
          </div>
          <div class="text-xs text-theme-secondary truncate" title={session.volumeTitle}>
            {session.volumeTitle}
          </div>
        </button>

        <button
          class="absolute right-2 bottom-2 p-1 rounded z-10 hover:bg-red-100 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Abort Session"
          onclick={(e) => {
            e.stopPropagation(); // Prevent triggering selection
            rebaseState.abortSession(session.id);
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    {/each}

    {#if rebaseState.sessions.length === 0}
      <div class="p-4 text-center text-theme-secondary text-sm italic">
        No active rebase sessions.
      </div>
    {/if}
  </div>
</div>
