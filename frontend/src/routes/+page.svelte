<script lang="ts">
  import { browser } from '$app/environment';
  import { user } from '$lib/stores/authStore';
  import { metadataOps } from '$lib/states/metadata/metadataOperations.svelte.ts';
  import AuthView from '$lib/components/auth/AuthView.svelte';
  import LibraryView from './home/components/LibraryView.svelte';
  import backgroundImage from './home/assets/background.png';

  $effect(() => {
    if (browser && $user === null) {
      metadataOps.flush();
    }
  });
</script>

<svelte:head>
  <title>{$user ? `${$user.username}'s Library` : 'Mokuro Library'}</title>
</svelte:head>

{#if $user === null}
  <AuthView {backgroundImage} />
{:else}
  <LibraryView />
{/if}
