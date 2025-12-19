<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let { isOpen, onClose, onSave, initialTitle, initialDescription } = $props<{
		isOpen: boolean;
		onClose: () => void;
		onSave: (title: string | null, description: string | null) => void;
		initialTitle: string | null;
		initialDescription: string | null;
	}>();

	let title = $state(initialTitle ?? '');
	let description = $state(initialDescription ?? '');

	// Reset state when modal opens
	$effect(() => {
		if (isOpen) {
			title = initialTitle ?? '';
			description = initialDescription ?? '';
		}
	});

	const handleSave = () => {
		onSave(title || null, description || null);
		onClose();
	};
</script>

{#if isOpen}
	<button
		class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-all"
		transition:fade={{ duration: 150 }}
		onclick={onClose}
		aria-label="Close modal"
	></button>

	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-2xl dark:bg-[#161b2e] dark:border dark:border-gray-700"
		transition:scale={{ duration: 200, start: 0.95 }}
		role="dialog"
		aria-modal="true"
	>
		<h2 class="mb-6 text-xl font-bold text-gray-900 dark:text-white">Edit Series</h2>

		<div class="flex flex-col gap-5">
			<div>
				<label
					for="series-title"
					class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
				>
					Display Title
				</label>
				<input
					id="series-title"
					type="text"
					bind:value={title}
					placeholder="Original folder name will be used if empty"
					class="w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-[#0a0e17] dark:text-white dark:placeholder-gray-500"
				/>
			</div>

			<div>
				<label
					for="series-desc"
					class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
				>
					Description
				</label>
				<textarea
					id="series-desc"
					rows="5"
					bind:value={description}
					placeholder="Enter a synopsis or notes..."
					class="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-[#0a0e17] dark:text-white dark:placeholder-gray-500"
				></textarea>
			</div>
		</div>

		<div class="mt-8 flex justify-end gap-3">
			<button
				onclick={onClose}
				class="rounded-lg px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-300 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
			>
				Cancel
			</button>
			<button
				onclick={handleSave}
				class="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
			>
				Save Changes
			</button>
		</div>
	</div>
{/if}
