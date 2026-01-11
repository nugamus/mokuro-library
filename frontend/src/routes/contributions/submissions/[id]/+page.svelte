<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { SvelteDate } from 'svelte/reactivity';
  import { Shield, GitMerge, User, Calendar, Hash } from 'lucide-svelte';

  // Services & Types
  import { apiFetch } from '$lib/services/api';
  import { user } from '$lib/stores/authStore';
  import type { Submission } from '$lib/types';

  // Components
  import CommentThread from '../../components/CommentThread.svelte';
  import AcceptSubmissionModal from '../../components/modals/AcceptSubmissionModal.svelte';
  import RejectSubmissionModal from '../../components/modals/RejectSubmissionModal.svelte';
  import SubmissionReader from '$lib/components/readers/SubmissionReader.svelte';
  import Badge from '$lib/components/controls/Badge.svelte';
  import Button from '$lib/components/controls/Button.svelte';
  import Icon from '$lib/components/controls/Icon.svelte';
  import PageHeader from '$lib/components/layout/PageHeader.svelte';
  import LibraryListWrapper from '$lib/components/library/LibraryListWrapper.svelte';
  import LibraryEntry from '$lib/components/library/LibraryEntry.svelte';
  import { browser } from '$app/environment';
  import { uiState } from '$lib/states/ui/uiState.svelte';
  import SubmissionHero from '$lib/components/library/SubmissionHero.svelte';

  // State
  let submission = $state<Submission | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // UI State
  let showReader = $state(false);
  let previewVolumeId = $state<string | null>(null);
  let showAcceptModal = $state(false);
  let showRejectModal = $state(false);

  const statusColors: Record<Submission['status'], string> = {
    pending: 'bg-status-warning/20 text-status-warning border-status-warning/30',
    accepted: 'bg-status-success/20 text-status-success border-status-success/30',
    rejected: 'bg-status-danger/20 text-status-danger border-status-danger/30'
  };

  // --- Data Fetching ---
  async function loadSubmission(id: string) {
    loading = true;
    error = null;
    try {
      submission = await apiFetch<Submission>(`/api/contributions/submissions/${id}`);
    } catch (e) {
      console.error('Failed to load submission:', e);
      error = e instanceof Error ? e.message : 'Failed to load submission';
    } finally {
      loading = false;
    }
  }

  // Reactive ID handling
  $effect(() => {
    if (page.params.id) {
      loadSubmission(page.params.id);
    }
  });

  // Trigger open preview on LibraryEntry navigate
  $effect(() => {
    const hash = page.url.hash;
    if (hash.startsWith('#preview-')) {
      previewVolumeId = hash.replace('#preview-', '');
      showReader = true;
    } else {
      showReader = false;
      previewVolumeId = null;
    }
  });

  $effect(() => {
    if (browser && $user === null) goto(resolve('/login', {}));
  });

  $effect(() => {
    uiState.setReturnPath('/contributions?tab=queue', 'Back to Queue');
    return () => {
      uiState.clearReturnPath();
    };
  });

  // --- Actions ---

  function handleSuccess() {
    goto(resolve('/contributions?tab=queue', {}), { invalidateAll: true });
  }

  function closePreview() {
    // If the current URL is the preview hash, just go back!
    // This "deletes" the hash entry from the history stack.
    if (page.url.hash.startsWith('#preview-')) {
      history.back();
    } else {
      // Fallback: If they arrived here some other way, just close the UI
      showReader = false;
      previewVolumeId = null;
    }
  }
</script>

{#if showReader && previewVolumeId}
  <SubmissionReader volumeId={previewVolumeId} close={closePreview} />
{/if}

{#if showAcceptModal && submission}
  <AcceptSubmissionModal
    submissionId={submission.id}
    on_close={() => (showAcceptModal = false)}
    on_success={handleSuccess}
  />
{/if}

{#if showRejectModal && submission}
  <RejectSubmissionModal
    submissionId={submission.id}
    on_close={() => (showRejectModal = false)}
    on_success={handleSuccess}
  />
{/if}

<div class="flex flex-col min-h-[calc(100vh-5rem)] max-w-7xl mx-auto p-4 sm:p-6 pb-24">
  {#if loading}
    <div class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-4">
        <div
          class="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin"
        ></div>
        <p class="text-theme-secondary">Loading submission details...</p>
      </div>
    </div>
  {:else if error}
    <div class="flex flex-1 items-center justify-center">
      <div class="bg-red-500/10 border border-red-500/20 p-6 rounded-lg text-center max-w-md">
        <h3 class="text-lg font-bold text-red-400 mb-2">Error Loading Submission</h3>
        <p class="text-theme-secondary mb-4">{error}</p>
        <Button variant="secondary" onclick={() => loadSubmission(page.params.id)}>Try Again</Button
        >
      </div>
    </div>
  {:else if submission}
    <SubmissionHero {submission}>
      {#snippet actions()}
        <Button
          onclick={() => (showRejectModal = true)}
          variant="danger"
          disabled={submission!.status !== 'pending'}
          class="shadow-sm"
        >
          {$user?.id === 'admin' ? 'Reject Submission' : 'Cancel Submission'}
        </Button>

        {#if $user?.id === 'admin'}
          <Button
            onclick={() => (showAcceptModal = true)}
            variant="success"
            disabled={submission!.status !== 'pending'}
            class="shadow-sm shadow-status-success/20"
          >
            Accept & Merge
          </Button>
        {/if}
      {/snippet}
    </SubmissionHero>

    <main class="mt-10 flex-1 flex flex-col gap-8">
      <div class="space-y-4">
        <LibraryListWrapper>
          <h2
            class="text-2xl sm:text-3xl font-bold text-theme-primary mb-6 drop-shadow-md flex items-center gap-3"
          >
            Volumes
            <span class="text-lg font-normal text-theme-secondary opacity-80">
              ({submission.volumes.length})
            </span>
          </h2>

          <div
            class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6"
          >
            {#each submission.volumes as volume (volume.id)}
              <LibraryEntry
                entry={{
                  id: volume.id,
                  title: volume.title,
                  folderName: volume.folderName,
                  coverUrl: volume.coverImageName
                    ? `/api/files/volume/${volume.id}/image/${volume.coverImageName}?w=300&q=44&format=avif`
                    : null
                }}
                type="volume"
                href={`#preview-${volume.id}`}
                viewMode="grid"
                mainStat={`${volume.pageCount} P`}
                onSelect={() => {}}
                onLongPress={() => {}}
                isPrivate={true}
              ></LibraryEntry>
            {/each}
          </div>
        </LibraryListWrapper>
      </div>

      <CommentThread comments={submission.comments} submissionId={submission.id} />
    </main>
  {/if}
</div>
