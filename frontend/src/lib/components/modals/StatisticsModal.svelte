<script lang="ts">
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/services/api';
	import { browser } from '$app/environment';
	import AchievementsSection from './statistics/AchievementsSection.svelte';
	import CompletedVolumesTable from './statistics/CompletedVolumesTable.svelte';
	import SpeedBySeriesTable from './statistics/SpeedBySeriesTable.svelte';
	import SpeedHistorySection from './statistics/SpeedHistorySection.svelte';
	import StatsSummaryCards from './statistics/StatsSummaryCards.svelte';
	import type {
		Achievement,
		CompletedVolume,
		ReadingStats,
		Series,
		SpeedBySeries,
		TimeFilter
	} from './statistics/types';

	let { isOpen, onClose } = $props<{ isOpen: boolean; onClose: () => void }>();

	let isLoading = $state(true);
	let stats = $state<ReadingStats>({
		recentSpeed: 0,
		charactersRead: 0,
		volumesCompleted: 0,
		totalTime: 0
	});

	// Mock data for features not yet implemented
	let speedHistory = $state<Array<{ date: string; speed: number }>>([]);
	let achievements = $state<Achievement[]>([
		{
			id: 'first_volume',
			title: 'First Volume',
			description: 'You finished your first volume',
			icon: 'trophy',
			color: 'text-status-warning',
			unlocked: false
		},
		{
			id: 'mokuro',
			title: 'Mookuro',
			description: 'Welcome to the reader',
			icon: 'ribbon',
			color: 'text-purple-400',
			unlocked: true
		}
	]);

	let speedBySeries = $state<SpeedBySeries[]>([]);
	let completedVolumes = $state<CompletedVolume[]>([]);
	let selectedTimeFilter = $state<TimeFilter>('month');

	function getTimeRangeDays() {
		const ranges = { week: 7, month: 30, '3months': 90, '6months': 180, year: 365 };
		return ranges[selectedTimeFilter];
	}

	// Mock reading speed history data
	const generateMockHistory = () => {
		const data = [];
		const now = new Date();
		for (let i = 29; i >= 0; i--) {
			const date = new Date(now);
			date.setDate(date.getDate() - i);
			data.push({
				date: date.toISOString().split('T')[0],
				speed: 40 + Math.random() * 40 + i * 0.5 // Gradually increasing trend
			});
		}
		return data;
	};

	async function fetchStatistics() {
		if (!browser) return;

		try {
			isLoading = true;

			// Fetch stats from new API endpoints
			const [summaryData, historyData, seriesData, completedData] = await Promise.all([
				apiFetch('/api/stats/summary'),
				apiFetch(`/api/stats/reading-history?timeRange=${getTimeRangeDays()}`),
				apiFetch('/api/stats/by-series'),
				apiFetch('/api/stats/completed-volumes')
			]);

			// Update stats
			stats = {
				recentSpeed: summaryData.recentSpeed || 0,
				charactersRead: summaryData.charactersRead || 0,
				volumesCompleted: summaryData.volumesCompleted || 0,
				totalTime: summaryData.totalTime || 0
			};

			// Update speed history for chart
			speedHistory = (historyData.history || []).map((h: any) => ({
				date: h.date,
				speed: h.speed || 0
			}));

			// Update series stats
			speedBySeries = (seriesData.seriesStats || []).map((s: any) => ({
				seriesName: s.seriesName,
				volumes: s.volumes,
				avgSpeed: s.avgSpeed,
				improvement: 0 // Can calculate if we track historical data
			}));

			// Update completed volumes
			completedVolumes = (completedData.completedVolumes || []).map((v: any) => ({
				...v,
				vsAvg: 0 // Can calculate with average speed
			}));

			// Fallback to old method if new API fails
			const series = [] as Series[];

			// Calculate statistics from real data
			let totalCharsRead = 0;
			let totalTime = 0;
			let completedCount = 0;
			let recentReading: { chars: number; time: number; date?: string } | null = null;

			const seriesStats = new Map<
				string,
				{ volumes: number; totalChars: number; totalTime: number; speeds: number[] }
			>();
			const completedVols: CompletedVolume[] = [];

			for (const s of series) {
				if (!s.volumes) continue;

				let seriesChars = 0;
				let seriesTime = 0;
				const speeds: number[] = [];

				for (const vol of s.volumes) {
					const progress = vol.progress?.[0];
					if (progress) {
						totalCharsRead += progress.charsRead || 0;
						totalTime += progress.timeRead || 0;

						seriesChars += progress.charsRead || 0;
						seriesTime += progress.timeRead || 0;

						if (progress.completed && progress.page >= vol.pageCount) {
							completedCount++;
							const speed = progress.timeRead > 0 ? progress.charsRead / progress.timeRead : 0;
							speeds.push(speed);

							// Add to completed volumes
							const avgSpeed =
								speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
							const vsAvg = avgSpeed > 0 ? ((speed - avgSpeed) / avgSpeed) * 100 : 0;

							completedVols.push({
								seriesName: s.title || s.folderName,
								volumeTitle: vol.title || `Vol ${vol.folderName}`,
								speed: Math.round(speed),
								vsAvg: Math.round(vsAvg),
								duration: progress.timeRead,
								characters: progress.charsRead,
								dateFinished: progress.lastReadAt || new Date().toISOString()
							});

							// Track most recent reading for recent speed
							if (progress.lastReadAt) {
								if (
									!recentReading ||
									new Date(progress.lastReadAt) > new Date(recentReading.date || 0)
								) {
									recentReading = {
										chars: progress.charsRead,
										time: progress.timeRead,
										date: progress.lastReadAt
									};
								}
							} else if (!recentReading) {
								// Fallback: use first completed volume if no lastReadAt
								recentReading = {
									chars: progress.charsRead,
									time: progress.timeRead
								};
							}
						}
					}
				}

				if (seriesTime > 0 && speeds.length > 0) {
					const avgSpeed = seriesTime > 0 ? seriesChars / seriesTime : 0;
					const firstSpeed = speeds[0] || 0;
					const lastSpeed = speeds.length > 1 ? speeds[speeds.length - 1] : avgSpeed;
					const improvement = firstSpeed > 0 ? ((lastSpeed - firstSpeed) / firstSpeed) * 100 : 0;

					seriesStats.set(s.id, {
						volumes: s.volumes.length,
						totalChars: seriesChars,
						totalTime: seriesTime,
						speeds
					});

					speedBySeries.push({
						seriesName: s.title || s.folderName,
						volumes: s.volumes.length,
						avgSpeed: Math.round(avgSpeed),
						improvement: Math.round(improvement)
					});
				}
			}

			// Calculate recent speed
			const recentSpeed =
				recentReading && recentReading.time > 0
					? Math.round(recentReading.chars / recentReading.time)
					: 0;

			// Update achievements based on real data
			achievements[0].unlocked = completedCount > 0;

			stats = {
				recentSpeed,
				charactersRead: totalCharsRead,
				volumesCompleted: completedCount,
				totalTime: Math.round(totalTime)
			};

			// Sort speed by series by improvement (descending)
			speedBySeries.sort((a, b) => b.improvement - a.improvement);

			// Sort completed volumes by date (most recent first)
			completedVolumes = completedVols
				.sort((a, b) => new Date(b.dateFinished).getTime() - new Date(a.dateFinished).getTime())
				.slice(0, 10); // Limit to 10 most recent

			// Add mock data if no real data available
			if (speedBySeries.length === 0) {
				speedBySeries = [
					{ seriesName: 'Example B', volumes: 4, avgSpeed: 73, improvement: 64 },
					{ seriesName: 'Example A', volumes: 4, avgSpeed: 65, improvement: 84 }
				];
			}

			if (completedVolumes.length === 0) {
				const now = new Date();
				completedVolumes = [
					{
						seriesName: 'Example A',
						volumeTitle: 'Vol 1',
						speed: 45,
						vsAvg: -32,
						duration: 111, // 1h 51m
						characters: 5000,
						dateFinished: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString() // 2 months ago
					},
					{
						seriesName: 'Example B',
						volumeTitle: 'Vol 1',
						speed: 55,
						vsAvg: -20,
						duration: 91, // 1h 31m
						characters: 5000,
						dateFinished: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() // 1 month ago
					}
				];
			}

			// Generate mock history if no real data
			if (completedCount === 0) {
				speedHistory = generateMockHistory();
			} else {
				// Use real data if available (simplified for now)
				speedHistory = generateMockHistory();
			}
		} catch (error) {
			console.error('Failed to fetch statistics:', error);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		if (isOpen) {
			fetchStatistics();
		}
	});

	// Refetch when modal opens
	$effect(() => {
		if (isOpen) {
			fetchStatistics();
		}
	});

	// Refetch when time filter changes
	$effect(() => {
		if (isOpen && selectedTimeFilter) {
			fetchStatistics();
		}
	});

	const formatTime = (minutes: number): string => {
		if (minutes < 60) return `${Math.round(minutes)} min`;
		const hours = Math.floor(minutes / 60);
		const mins = Math.round(minutes % 60);
		return `${hours}h ${mins}m`;
	};

	const formatDate = (dateString: string): string => {
		const date = new Date(dateString);
		const now = new Date();
		const diffTime = Math.abs(now.getTime() - date.getTime());
		const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
		const diffMonths = Math.floor(diffDays / 30);

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 30) return `${diffDays} days ago`;
		if (diffMonths === 1) return '1 month ago';
		if (diffMonths < 12) return `${diffMonths} months ago`;

		return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
	};

</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-0">
		<div
			class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
			onclick={onClose}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			aria-label="Close modal"
		></div>

		<div
			class="relative w-full max-w-7xl max-h-[90vh] transform overflow-hidden rounded-2xl border border-theme-border bg-theme-surface shadow-2xl transition-all sm:my-8 flex flex-col"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between px-6 py-4 bg-theme-main border-b border-theme-border"
			>
				<div class="flex items-center gap-3">
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
						class="text-accent"
					>
						<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
					</svg>
					<h2 class="text-2xl font-bold theme-primary">Reading Statistics</h2>
				</div>
				<div class="flex items-center gap-2">
					<a
						href="/api/stats/export"
						download="reading-stats.csv"
						class="px-4 py-2 rounded-lg bg-theme-main text-theme-secondary hover:theme-primary hover:bg-theme-surface-hover transition-colors text-sm font-medium flex items-center gap-2"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
							<polyline points="7 10 12 15 17 10"></polyline>
							<line x1="12" y1="15" x2="12" y2="3"></line>
						</svg>
						Export CSV
					</a>
					<button
						onclick={onClose}
						class="p-2 rounded-lg text-theme-secondary hover:theme-primary hover:bg-theme-surface-hover transition-colors"
						aria-label="Close"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
			</div>

			<!-- Content (Scrollable) -->
			<div class="flex-1 overflow-y-auto p-6 space-y-6">
				{#if isLoading}
					<div class="flex items-center justify-center py-20">
						<div class="text-theme-secondary">Loading statistics...</div>
					</div>
				{:else}
					<!-- Reading Speed History Section -->
					<div>
						<h3 class="text-xl font-bold theme-primary mb-4">Reading Speed History</h3>
						{#if stats.volumesCompleted === 0}
							<div
								class="rounded-2xl bg-theme-main p-12 border border-theme-border-light text-center"
							>
								<p class="text-2xl font-bold theme-primary mb-2">No Reading History Yet</p>
								<p class="text-theme-secondary">Start reading to track your reading speed!</p>
							</div>
						{/if}

						<StatsSummaryCards {stats} {formatTime} />
						<AchievementsSection {achievements} />
						<SpeedHistorySection
							{stats}
							{speedHistory}
							selectedTimeFilter={selectedTimeFilter}
							onFilterChange={(filter) => (selectedTimeFilter = filter)}
						/>

						<!-- Bottom Tables -->
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
							<SpeedBySeriesTable {speedBySeries} />
							<CompletedVolumesTable {completedVolumes} {formatTime} {formatDate} />
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
