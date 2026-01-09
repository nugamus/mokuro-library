<script lang="ts">
	import { apiFetch } from '$lib/services/api';
	import Button from '$lib/components/controls/Button.svelte';
	import Modal from '$lib/components/modals/Modal.svelte';
	import { XCircle, AlertTriangle } from 'lucide-svelte';
	import { toastStore } from '$lib/stores/toastStore.svelte.ts';

	let { submissionId, on_close, on_success } = $props<{
		submissionId: string;
		on_close: () => void;
		on_success: () => void;
	}>();

	const rejectionTemplates = [
	  'Duplicate content already exists in the shared library.',
	  'The OCR quality is too low for inclusion.',
	  'The submission contains inappropriate or low-quality content.',
	  'The submitted volumes are part of an incomplete series.',
	  'The file format or structure is not compatible.'
	];

	let reason = $state('');
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	function selectTemplate(e: Event) {
	  const target = e.target as HTMLSelectElement;
	  if (target.value) {
	    reason = target.value;
	  }
	}

	async function handleReject() {
	  if (!reason.trim()) {
	    error = 'A reason for rejection is required.';
	    return;
	  }
	  isLoading = true;
	  error = null;
	  try {
	    await apiFetch(`/api/contributions/submissions/${submissionId}/reject`, {
	      method: 'POST',
	      body: { reason: reason.trim() }
	    });
	    toastStore.success('Submission rejected.');
	    on_success();
	  } catch (e: unknown) {
	    console.error('Failed to reject submission:', e);
	    const message = e instanceof Error ? e.message : 'An unknown error occurred.';
	    error = message;
	    toastStore.error(message);
	  } finally {
	    isLoading = false;
	  }
	}
</script>

<Modal {on_close} title="Reject Submission">
	<div class="p-6 space-y-4">
		<div
			class="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300"
		>
			<AlertTriangle class="w-8 h-8 flex-shrink-0 mt-1" />
			<p class="text-sm">
				You are about to reject this submission. Please provide a clear reason for the user.
			</p>
		</div>

		<div class="space-y-2">
			<label for="rejection-template" class="text-sm font-medium text-white/80">
				Rejection Templates (optional)
			</label>
			<select
				id="rejection-template"
				onchange={selectTemplate}
				class="w-full bg-white/5 border border-white/20 rounded-md p-2 text-sm focus:ring-accent focus:border-accent"
			>
				<option value="">Select a template...</option>
				{#each rejectionTemplates as template (template)}
					<option value={template}>{template}</option>
				{/each}
			</select>
		</div>

		<div class="space-y-2">
			<label for="rejection-reason" class="text-sm font-medium text-white/80">
				Reason for Rejection
			</label>
			<textarea
				id="rejection-reason"
				bind:value={reason}
				rows="4"
				class="w-full bg-white/5 border border-white/20 rounded-md p-2 text-sm focus:ring-accent focus:border-accent"
				placeholder="Explain why the submission is being rejected..."
			></textarea>
		</div>

		{#if error}
			<div class="text-sm p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300">
				<strong>Error:</strong>
				{error}
			</div>
		{/if}
	</div>

	<div class="px-6 py-4 bg-white/5 border-t border-white/10 flex justify-end gap-3">
		<Button variant="secondary" onclick={on_close} disabled={isLoading}>Cancel</Button>
		<Button
			variant="danger"
			onclick={handleReject}
			is_loading={isLoading}
			disabled={!reason.trim()}
		>
			{#snippet icon()}
				<XCircle class="w-4 h-4" />
			{/snippet}
			Reject Submission
		</Button>
	</div>
</Modal>
