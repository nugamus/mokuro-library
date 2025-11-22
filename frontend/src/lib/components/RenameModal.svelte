<script lang="ts">
	import { renameStore } from '$lib/renameStore';

	// Local state for the input and loading status
	let title = $state('');
	let isSaving = $state(false);
	let error = $state<string | null>(null);

	// Reactively update local title when the store opens
	$effect(() => {
		if ($renameStore.isOpen) {
			title = $renameStore.currentTitle;
			error = null;
			isSaving = false;
		}
	});

	const handleSubmit = async () => {
		isSaving = true;
		error = null;
		try {
			const val = title.trim() === '' ? null : title.trim();
			// Call the callback defined when open() was called
			await $renameStore.onSave(val);
			renameStore.close();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			isSaving = false;
		}
	};

	const handleClose = () => {
		renameStore.close();
	};
</script>

{#if $renameStore.isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<button class="absolute inset-0" onclick={handleClose} tabindex="-1" aria-label="close"
		></button>

		<div class="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
			<h3 class="mb-4 text-lg font-medium text-gray-900 dark:text-white">Rename</h3>

			<div class="mb-4">
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
					class="w-full rounded-md border border-gray-300 p-2 focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
					onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
				/>
				<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
					Leave blank to revert to the original folder name.
				</p>
			</div>

			{#if error}
				<p class="mb-4 text-sm text-red-600">{error}</p>
			{/if}

			<div class="flex justify-end gap-3">
				<button
					onclick={handleClose}
					disabled={isSaving}
					class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={handleSubmit}
					disabled={isSaving}
					class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
				>
					{isSaving ? 'Saving...' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}
