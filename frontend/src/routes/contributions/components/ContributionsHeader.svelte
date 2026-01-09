<script lang="ts">
	import type { ActivityGraphDay, VolumeContribution } from '../lib/types';
	import { SvelteDate } from 'svelte/reactivity';

	type SampleStats = {
		totalEdits: number;
		editsMerged: number;
		volumesEdited: number;
		lastEditAt: string;
	};

	let {
	  sampleStats,
	  activityGraph,
	  showQuickActions,
	  volumesNeedingRebase,
	  activityHistoryCount,
	  selectedItemsCount,
	  onRebaseAll,
	  onToggleActivityTimeline,
	  onBatchRebase,
	  onExportEdits
	} = $props<{
		sampleStats: SampleStats;
		activityGraph: ActivityGraphDay[];
		showQuickActions: boolean;
		volumesNeedingRebase: VolumeContribution[];
		activityHistoryCount: number;
		selectedItemsCount: number;
		onRebaseAll: () => void;
		onToggleActivityTimeline: () => void;
		onBatchRebase: () => void;
		onExportEdits: () => void;
	}>();
</script>

<div class="mb-8">
	<!-- Title Section with Gradient -->
	<div
		class="relative mb-6 sm:mb-8 overflow-hidden rounded-xl sm:rounded-2xl bg-gradient-to-br from-accent/20 via-theme-surface/50 to-theme-main border-2 border-accent/30 p-4 sm:p-6 md:p-8 shadow-xl"
	>
		<!-- Background Decoration -->
		<div class="absolute inset-0 bg-grid-pattern opacity-5"></div>
		<div class="absolute -top-24 -right-24 w-96 h-96 bg-accent/20 rounded-full blur-3xl"></div>
		<div
			class="absolute -bottom-24 -left-24 w-96 h-96 bg-theme-primary/10 rounded-full blur-3xl"
		></div>

		<!-- Content -->
		<div class="relative z-10">
			<div class="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
				<div
					class="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-accent/20 border-2 border-accent/40 shadow-lg flex-shrink-0"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="sm:w-8 sm:h-8 text-accent"
					>
						<polygon
							points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
						/>
					</svg>
				</div>
				<div class="flex-1 min-w-0">
					<h1
						class="text-xl sm:text-2xl md:text-4xl font-black text-theme-primary mb-0.5 sm:mb-1 tracking-tight"
					>
						Your Contributions
					</h1>
					<p class="text-xs sm:text-sm text-theme-secondary font-medium">
						Track edits & sync with shared library
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Stats and Quick Actions Container -->
	<div class="flex flex-col lg:flex-row gap-6">
		<!-- Left: Stats Dashboard -->
		<div class="flex flex-col gap-4 lg:flex-1">
			<!-- Stats Grid (3 cards) -->
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
				<!-- Total Edits -->
				<div
					class="group relative rounded-xl sm:rounded-2xl bg-gradient-to-br from-theme-main to-theme-surface border-2 border-theme-border hover:border-accent/50 p-4 sm:p-5 transition-all duration-300 hover:scale-105 hover:shadow-2xl overflow-hidden"
				>
					<div
						class="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
					></div>
					<div class="relative z-10">
						<div class="flex items-center justify-between mb-2 sm:mb-3">
							<div class="p-1.5 sm:p-2 rounded-lg bg-accent/10 border border-accent/30">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="sm:w-5 sm:h-5 text-accent"
								>
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
								</svg>
							</div>
							<div
								class="text-2xl sm:text-3xl font-black text-accent group-hover:scale-110 transition-transform"
							>
								{sampleStats.totalEdits}
							</div>
						</div>
						<div
							class="text-[10px] sm:text-xs font-bold text-theme-secondary uppercase tracking-wider"
						>
							Total Edits
						</div>
					</div>
				</div>

				<!-- Edits Merged -->
				<div
					class="group relative rounded-xl sm:rounded-2xl bg-gradient-to-br from-theme-main to-theme-surface border-2 border-theme-border hover:border-status-success/50 p-4 sm:p-5 transition-all duration-300 hover:scale-105 hover:shadow-2xl overflow-hidden"
				>
					<div
						class="absolute inset-0 bg-gradient-to-br from-status-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
					></div>
					<div class="relative z-10">
						<div class="flex items-center justify-between mb-2 sm:mb-3">
							<div
								class="p-1.5 sm:p-2 rounded-lg bg-status-success/10 border border-status-success/30"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="sm:w-5 sm:h-5 text-status-success"
								>
									<polyline points="20 6 9 17 4 12" />
								</svg>
							</div>
							<div
								class="text-2xl sm:text-3xl font-black text-status-success group-hover:scale-110 transition-transform"
							>
								{sampleStats.editsMerged}
							</div>
						</div>
						<div
							class="text-[10px] sm:text-xs font-bold text-theme-secondary uppercase tracking-wider"
						>
							Edits Merged
						</div>
					</div>
				</div>

				<!-- Volumes Edited -->
				<div
					class="group relative rounded-xl sm:rounded-2xl bg-gradient-to-br from-theme-main to-theme-surface border-2 border-theme-border hover:border-theme-primary/50 p-4 sm:p-5 transition-all duration-300 hover:scale-105 hover:shadow-2xl overflow-hidden"
				>
					<div
						class="absolute inset-0 bg-gradient-to-br from-theme-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
					></div>
					<div class="relative z-10">
						<div class="flex items-center justify-between mb-2 sm:mb-3">
							<div
								class="p-1.5 sm:p-2 rounded-lg bg-theme-primary/10 border border-theme-primary/30"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="sm:w-5 sm:h-5 text-theme-primary"
								>
									<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
									<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
								</svg>
							</div>
							<div
								class="text-2xl sm:text-3xl font-black text-theme-primary group-hover:scale-110 transition-transform"
							>
								{sampleStats.volumesEdited}
							</div>
						</div>
						<div
							class="text-[10px] sm:text-xs font-bold text-theme-secondary uppercase tracking-wider"
						>
							Volumes Edited
						</div>
					</div>
				</div>
			</div>

			<!-- Activity Graph (Last 30 Days) -->
			{#if activityGraph.length > 0}
				{@const maxCount = Math.max(...activityGraph.map((day: ActivityGraphDay) => day.count), 1)}
				{@const totalEdits = activityGraph.reduce(
				  (sum: number, day: ActivityGraphDay) => sum + day.count,
				  0
				)}
				{@const activeDays = activityGraph.filter((day: ActivityGraphDay) => day.count > 0).length}
				{@const firstDay = activityGraph[0]}
				{@const lastDay = activityGraph[activityGraph.length - 1]}
				<div
					class="p-4 rounded-xl bg-gradient-to-br from-accent/10 to-theme-surface border-2 border-accent/30"
				>
					<!-- Header with Stats -->
					<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
						<div class="flex items-center gap-2 sm:gap-3">
							<div class="text-xl sm:text-2xl">📊</div>
							<div>
								<div class="text-xs sm:text-sm font-bold text-accent">30-Day Activity Graph</div>
								<div class="text-[10px] sm:text-xs text-theme-secondary">
									{totalEdits} edit{totalEdits === 1 ? '' : 's'} across {activeDays} day{activeDays ===
									1
									  ? ''
									  : 's'}
								</div>
							</div>
						</div>
						<div class="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs flex-wrap">
							<div class="flex items-center gap-1 sm:gap-1.5">
								<div class="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm bg-accent"></div>
								<span class="text-theme-secondary">Active</span>
							</div>
							<div class="flex items-center gap-1 sm:gap-1.5">
								<div class="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-sm bg-theme-border/30"></div>
								<span class="text-theme-secondary">Inactive</span>
							</div>
							<span
								class="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-accent/20 text-accent font-bold"
							>
								Max: {maxCount}
							</span>
						</div>
					</div>

					<!-- Graph with Date Labels -->
					<div class="space-y-2">
						<!-- Graph Container with Y-axis -->
						<div class="flex gap-2">
							<!-- Y-axis labels -->
							<div
								class="flex flex-col justify-between text-[9px] sm:text-[10px] text-theme-tertiary font-semibold w-6 sm:w-8 flex-shrink-0 text-right pr-1"
							>
								<span>{maxCount}</span>
								<span>{Math.floor(maxCount / 2)}</span>
								<span>0</span>
							</div>

							<!-- Graph Bars -->
							<div class="flex-1 relative">
								<div class="flex items-end gap-0.5 h-16 relative">
									{#each activityGraph as day (day.date)}
										{@const heightPercent =
											day.count > 0 ? Math.max((day.count / maxCount) * 100, 8) : 0}
										<div
											class="group/bar flex-1 rounded-sm transition-all cursor-pointer hover:opacity-80 relative {day.count >
											0
											  ? 'bg-accent hover:bg-accent/80'
											  : 'bg-theme-border/30 hover:bg-theme-border/50'}"
											style="height: {heightPercent}%"
											title="{day.dayName}, {new SvelteDate(day.date).toLocaleDateString('en-US', {
											  month: 'short',
											  day: 'numeric'
											})}: {day.count} edit{day.count === 1 ? '' : 's'}"
										>
											<!-- Tooltip on hover - positioned above the graph container -->
											{#if day.count > 0}
												<div
													class="absolute bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2 px-2 py-1 bg-theme-main border border-accent/50 rounded-md shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20 text-xs font-semibold"
												>
													<div class="text-accent">
														{day.count} edit{day.count === 1 ? '' : 's'}
													</div>
													<div class="text-theme-secondary text-[10px]">
														{new SvelteDate(day.date).toLocaleDateString('en-US', {
														  month: 'short',
														  day: 'numeric'
														})}
													</div>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>

						<!-- Date Range Labels -->
						<div
							class="flex items-center justify-between text-[10px] text-theme-tertiary font-semibold"
						>
							<span class="w-6 sm:w-8 flex-shrink-0"></span>
							<div class="flex-1 flex items-center justify-between px-0.5">
								<span class="text-[9px] sm:text-[10px]"
									>{new SvelteDate(firstDay.date).toLocaleDateString('en-US', {
									  month: 'short',
									  day: 'numeric'
									})}</span
								>
								<span class="text-theme-secondary text-[9px] sm:text-[10px]">← 30 days →</span>
								<span class="text-[9px] sm:text-[10px]"
									>{new SvelteDate(lastDay.date).toLocaleDateString('en-US', {
									  month: 'short',
									  day: 'numeric'
									})}</span
								>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Right: Quick Actions Panel -->
		{#if showQuickActions}
			<div
				class="flex flex-col lg:flex-1 rounded-xl bg-gradient-to-br from-theme-surface to-theme-main border-2 border-theme-border p-4 sm:p-5"
			>
				<div class="mb-3 sm:mb-4">
					<h3 class="text-xs sm:text-sm font-bold text-theme-primary uppercase tracking-wider">
						Quick Actions
					</h3>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 auto-rows-min content-start">
					<!-- Rebase All -->
					{#if volumesNeedingRebase.length > 0}
						<button
							onclick={onRebaseAll}
							class="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 hover:bg-status-warning/20 transition-all text-left group"
						>
							<div
								class="p-1.5 sm:p-2 rounded-lg bg-status-warning/20 group-hover:bg-status-warning/30 transition-colors flex-shrink-0"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="sm:w-5 sm:h-5 text-status-warning"
									><path
										d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"
									/></svg
								>
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-[10px] sm:text-xs font-bold text-status-warning mb-0.5 sm:mb-1">
									Rebase All
								</div>
								<div class="text-[9px] sm:text-xs text-theme-secondary truncate">
									{volumesNeedingRebase.length} vol{volumesNeedingRebase.length === 1 ? '' : 's'} behind
								</div>
							</div>
						</button>
					{/if}

					<!-- Recently Edited Dropdown -->
					<div class="relative">
						<button
							onclick={onToggleActivityTimeline}
							class="w-full flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg bg-theme-primary/10 border border-theme-primary/30 hover:bg-theme-primary/20 transition-all text-left group"
						>
							<div
								class="p-1.5 sm:p-2 rounded-lg bg-theme-primary/20 group-hover:bg-theme-primary/30 transition-colors flex-shrink-0"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="sm:w-5 sm:h-5 text-theme-primary"
									><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg
								>
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-[10px] sm:text-xs font-bold text-theme-primary mb-0.5 sm:mb-1">
									Activity Timeline
								</div>
								<div class="text-[9px] sm:text-xs text-theme-secondary truncate">
									{activityHistoryCount} recent edits
								</div>
							</div>
						</button>
					</div>

					<!-- Batch Rebase -->
					<button
						onclick={onBatchRebase}
						disabled={selectedItemsCount === 0}
						class="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg transition-all text-left group {selectedItemsCount ===
						0
						  ? 'bg-status-warning/5 border border-status-warning/20 opacity-50 cursor-not-allowed'
						  : 'bg-status-warning/10 border border-status-warning/30 hover:bg-status-warning/20'}"
						title={selectedItemsCount === 0 ? 'Hold to select volumes' : 'Rebase selected volumes'}
					>
						<div
							class="p-1.5 sm:p-2 rounded-lg bg-status-warning/20 group-hover:bg-status-warning/30 transition-colors flex-shrink-0"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="sm:w-5 sm:h-5 text-status-warning"
								><path
									d="M3 2v6h6M21 12A9 9 0 0 0 6 5.3L3 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"
								/></svg
							>
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-[10px] sm:text-xs font-bold text-status-warning mb-0.5 sm:mb-1">
								Batch Rebase
							</div>
							<div class="text-[9px] sm:text-xs text-theme-secondary truncate">
								{selectedItemsCount === 0
								  ? 'Hold to select'
								  : `${selectedItemsCount} item${selectedItemsCount === 1 ? '' : 's'}`}
							</div>
						</div>
					</button>

					<!-- Export Edits -->
					<button
						onclick={onExportEdits}
						class="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-left group"
					>
						<div
							class="p-1.5 sm:p-2 rounded-lg bg-emerald-500/20 group-hover:bg-emerald-500/30 transition-colors flex-shrink-0"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="sm:w-5 sm:h-5 text-emerald-400"
								><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
									points="7 10 12 15 17 10"
								/><line x1="12" y1="15" x2="12" y2="3" /></svg
							>
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-[10px] sm:text-xs font-bold text-emerald-400 mb-0.5 sm:mb-1">
								Export Data
							</div>
							<div class="text-[9px] sm:text-xs text-theme-secondary truncate">Download JSON</div>
						</div>
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
