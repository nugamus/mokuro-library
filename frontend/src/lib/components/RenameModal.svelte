<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	// Define props with Svelte 5 runes
	let {
		isOpen = $bindable(), // Allows parent to bind to this boolean
		initialTitle,
		onSave,
		onClose
	} = $props<{
		isOpen: boolean;
		initialTitle: string | null;
		onSave: (newTitle: string | null) => Promise<void> | void;
		onClose: () => void;
	}>();

	let title = $state(initialTitle ?? '');
	let isSaving = $state(false);
	let error = $state<string | null>(null);

	// Reset local state when the modal opens or initialTitle changes
	$effect(() => {
		if (isOpen) {
			title = initialTitle ?? '';
			error = null;
			isSaving = false;
		}
	});

	const handleSubmit = async () => {
		isSaving = true;
		error = null;
		try {
			const val = title.trim() === '' ? null : title.trim();
			await onSave(val);
			handleClose();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			isSaving = false;
		}
	};

	const handleClose = () => {
		isOpen = false;
		onClose();
	};
</script>

{#if isOpen}
	<button
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-all"
		transition:fade={{ duration: 150 }}
		onclick={handleClose}
		aria-label="close"
	></button>

	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-2xl dark:bg-[#161b2e] dark:border dark:border-gray-700"
		transition:scale={{ duration: 200, start: 0.95 }}
		role="dialog"
		aria-modal="true"
	>
		<h3 class="mb-6 text-xl font-bold text-gray-900 dark:text-white">Rename</h3>

		<div class="mb-5">
			<label
				for="rename-input"
				class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
			>
				Display Title
			</label>
			<input
				id="rename-input"
				type="text"
				bind:value={title}
				placeholder="Leave empty to use folder name"
				class="w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-[#0a0e17] dark:text-white dark:placeholder-gray-500"
				onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
			/>
			<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
				Leave blank to revert to the original folder name.
			</p>
		</div>

		{#if error}
			<div
				class="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
			>
				{error}
			</div>
		{/if}

		<div class="flex justify-end gap-3">
			<button
				onclick={handleClose}
				disabled={isSaving}
				class="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:ring-4 focus:ring-gray-300 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
			>
				Cancel
			</button>
			<button
				onclick={handleSubmit}
				disabled={isSaving}
				class="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-700"
			>
				{isSaving ? 'Saving...' : 'Save'}
			</button>
		</div>
	</div>
{/if}
