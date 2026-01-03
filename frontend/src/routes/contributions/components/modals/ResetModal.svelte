<script lang="ts">
	let { isOpen, volumeTitle, isResetting, onClose, onConfirm } = $props<{
		isOpen: boolean;
		volumeTitle: string | null;
		isResetting: boolean;
		onClose: () => void;
		onConfirm: () => void;
	}>();
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="button"
		tabindex="0"
	>
		<div
			class="bg-theme-main border-2 border-status-danger/50 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<!-- Header -->
			<div class="bg-gradient-to-r from-status-danger/20 to-status-danger/10 p-6 border-b border-status-danger/30">
				<div class="flex items-start gap-3">
					<div class="text-3xl">⚠️</div>
					<div class="flex-1">
						<h2 class="text-xl font-extrabold text-theme-primary mb-1">Reset to Official?</h2>
						<p class="text-sm text-theme-secondary">This action cannot be undone</p>
					</div>
				</div>
			</div>

			<!-- Content -->
			<div class="p-6 space-y-4">
				<div class="bg-theme-surface/50 border border-theme-border rounded-lg p-4">
					<div class="text-sm font-semibold text-theme-primary mb-1">
						{volumeTitle}
					</div>
					<div class="text-xs text-theme-tertiary">Volume will be reset</div>
				</div>

				<div class="bg-status-danger/10 border border-status-danger/30 rounded-lg p-4">
					<div class="text-sm font-bold text-status-danger mb-2">⚠️ Warning</div>
					<div class="text-xs text-theme-secondary leading-relaxed">
						All your personal edits and changes will be permanently lost. The volume will revert to
						the official version from the shared library.
					</div>
				</div>
			</div>

			<!-- Actions -->
			<div class="p-6 bg-theme-surface/30 border-t border-theme-border flex gap-3">
				<button
					onclick={onClose}
					disabled={isResetting}
					class="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm bg-theme-surface text-theme-primary hover:bg-theme-surface-hover border-2 border-theme-border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Cancel
				</button>
				<button
					onclick={onConfirm}
					disabled={isResetting}
					class="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm bg-status-danger text-white hover:bg-status-danger/90 border-2 border-status-danger transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
				>
					{#if isResetting}
						<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Resetting...
					{:else}
						Reset Volume
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
