<script lang="ts">
	import type { ActivityEntry } from '../lib/types';
	import { getEditTypeIcon } from '../lib/utils';

	let { activityHistory, onClose, onViewVolume } = $props<{
		activityHistory: ActivityEntry[];
		onClose: () => void;
		onViewVolume: (volumeId: string, seriesId: string) => void;
	}>();
</script>

<div class="mb-6 rounded-xl bg-gradient-to-br from-theme-surface to-theme-main border-2 border-theme-border p-5">
	<div class="flex items-center justify-between mb-4">
		<h3 class="text-sm font-bold text-theme-primary uppercase tracking-wider">Recent Activity</h3>
		<button
			onclick={onClose}
			class="p-1 rounded-lg hover:bg-theme-surface transition-colors text-theme-secondary hover:text-theme-primary"
			aria-label="Close recent activity"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
		</button>
	</div>

	<div class="space-y-2 max-h-64 overflow-y-auto">
		{#each activityHistory.slice(0, 10) as activity}
			<button
				onclick={(e) => {
					e.stopPropagation();
					onViewVolume(activity.volumeId, activity.seriesId);
				}}
				class="w-full flex items-center gap-3 p-3 rounded-lg bg-theme-main/50 hover:bg-theme-surface border border-theme-border hover:border-theme-primary/30 transition-all text-left group"
			>
				<div class="text-xl flex-shrink-0">{getEditTypeIcon(activity.editType)}</div>
				<div class="flex-1 min-w-0">
					<div class="text-xs font-bold text-theme-primary truncate">{activity.seriesTitle} — {activity.volumeTitle}</div>
					<div class="text-xs text-theme-secondary flex items-center gap-2 mt-1">
						<span>{new Date(activity.timestamp).toLocaleDateString()}</span>
						<span>•</span>
						<span>{activity.patchCount} edits</span>
						<span>•</span>
						<span class="capitalize">{activity.editType}</span>
					</div>
				</div>
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-theme-secondary group-hover:text-theme-primary transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
			</button>
		{/each}
	</div>
</div>
