<script lang="ts">
	import { lineOrderStore } from '$lib/lineOrderStore';
	import { fade } from 'svelte/transition';

	/**
	 * Swaps two elements in an array.
	 * This function mutates the array, which is what we want
	 * to trigger Svelte 5's fine-grained reactivity.
	 */
	const swap = (arr: any[], i: number, j: number) => {
		[arr[i], arr[j]] = [arr[j], arr[i]];
	};

	const handleMoveUp = (lineIndex: number) => {
		const { block } = $lineOrderStore;
		if (!block || lineIndex === 0) return;

		swap(block.lines, lineIndex, lineIndex - 1);
		swap(block.lines_coords, lineIndex, lineIndex - 1);
	};

	const handleMoveDown = (lineIndex: number) => {
		const { block } = $lineOrderStore;
		if (!block || lineIndex === block.lines.length - 1) return;

		swap(block.lines, lineIndex, lineIndex + 1);
		swap(block.lines_coords, lineIndex, lineIndex + 1);
	};

	const handleDone = () => {
		$lineOrderStore.onSave();
		lineOrderStore.close();
	};
</script>

{#if $lineOrderStore.isOpen && $lineOrderStore.block}
	<!-- click on background to close-->
	<button
		transition:fade={{ duration: 150 }}
		class="fixed inset-0 z-40 h-full w-full bg-black/50"
		onclick={handleDone}
		aria-label="Close modal"
	></button>

	<div
		transition:fade={{ duration: 150 }}
		class="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
		role="dialog"
		aria-labelledby="dialog-title"
	>
		<h2 id="dialog-title" class="text-xl font-semibold text-gray-900 dark:text-white">
			Re-order Lines
		</h2>

		<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
			Click the arrows to change the order of lines for text selection.
		</p>

		<div
			class="mt-4 max-h-96 space-y-2 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900"
		>
			{#each $lineOrderStore.block.lines as line, lineIndex (lineIndex)}
				<!-- line entry -->
				<div
					class="flex items-center justify-between rounded-md bg-white p-2 text-sm text-gray-800 shadow-sm dark:bg-gray-800 dark:text-gray-200"
				>
					<span class="truncate pr-4">
						{lineIndex + 1}: {line}
					</span>

					<!-- move up button -->
					<div class="flex flex-shrink-0 gap-1">
						<button
							type="button"
							onclick={() => handleMoveUp(lineIndex)}
							disabled={lineIndex === 0}
							class="rounded-md p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
							aria-label="Move line up"
						>
							<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
								<path
									fill-rule="evenodd"
									d="M14.77 12.79a.75.75 0 01-1.06 0L10 9.06l-3.71 3.73a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>

						<!-- move down button -->
						<button
							type="button"
							onclick={() => handleMoveDown(lineIndex)}
							disabled={lineIndex === $lineOrderStore.block.lines.length - 1}
							class="rounded-md p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
							aria-label="Move line down"
						>
							<svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
								<path
									fill-rule="evenodd"
									d="M5.23 7.21a.75.75 0 011.06 0L10 10.94l3.71-3.73a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.23 8.27a.75.75 0 010-1.06z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>
					</div>
				</div>
			{/each}
		</div>

		<div class="mt-6 flex justify-end">
			<button
				type="button"
				onclick={handleDone}
				class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
			>
				Done
			</button>
		</div>
	</div>
{/if}
