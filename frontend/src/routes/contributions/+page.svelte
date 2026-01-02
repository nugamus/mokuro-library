<script lang="ts">
	import { user } from '$lib/authStore';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { uiState } from '$lib/states/uiState.svelte';
	import { apiFetch } from '$lib/api';
	import { onMount } from 'svelte';
	import { longpress } from '$lib/actions/longPress';
	import type { Series, Volume } from '$lib/types';

	// Enhanced types for contribution tracking
	type VolumeContribution = Volume & {
		hasAhead: boolean;
		hasBehind: boolean;
		userPatchCount: number;
		behindByCount: number;
	};

	type SeriesContribution = {
		id: string;
		title: string;
		coverPath: string | null;
		volumes: VolumeContribution[];
		totalAhead: number;
		totalBehind: number;
		volumesAhead: number;
		volumesBehind: number;
	};

	type FilterType = 'all' | 'behind' | 'ahead';

	type ActivityEntry = {
		id: string;
		volumeId: string;
		volumeTitle: string;
		seriesTitle: string;
		seriesId: string;
		timestamp: string;
		patchCount: number;
		editType: 'text' | 'box' | 'font' | 'structure';
	};

	type DiffBlock = {
		blockIndex: number;
		userVersion: string[];
		adminVersion: string[];
		hasConflict: boolean;
	};

	type ConflictType = 'content_conflict' | 'dead_zone' | 'structure_change';

	type ConflictResolution = 'keep_admin' | 'keep_user' | 'skip';

	type RebaseConflict = {
		type: ConflictType;
		path: string;
		userValue: string | null;
		adminValue: string | null;
		context: {
			pageNumber?: number;
			blockIndex?: number;
			lineIndex?: number;
		};
	};

	// State
	let activeFilter = $state<FilterType>('behind');
	let library = $state<Series[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let expandedSeries = $state<Set<string>>(new Set());

	// Loading states for async operations
	let isResetting = $state(false);
	let isRebasing = $state(false);

	// New feature states
	let showActivityTimeline = $state(false);
	let showDiffViewer = $state(false);
	let showQuickActions = $state(true);
	let selectedDiffVolume = $state<VolumeContribution | null>(null);

	// Selection mode state
	let isSelectionMode = $state(false);
	let selectedItems = $state<Set<string>>(new Set()); // Can contain both series and volume IDs

	// Sample contribution stats
	const sampleStats = {
		totalEdits: 150,
		editsMerged: 45,
		volumesEdited: 23,
		lastEditAt: '2025-01-15T10:00:00Z'
	};

	// Initialize
	onMount(() => {
		uiState.setContext('contributions', 'Contributions', []);
		// Clear any stale return path to prevent navigation bugs
		uiState.clearReturnPath();

		// Restore expanded state from sessionStorage
		const savedExpanded = sessionStorage.getItem('contributions_expanded');
		if (savedExpanded) {
			try {
				const expandedArray = JSON.parse(savedExpanded);
				expandedSeries = new Set(expandedArray);
				console.log('[Contributions] Restored expanded series:', expandedArray);
			} catch (e) {
				console.error('[Contributions] Failed to restore expanded state:', e);
			}
		}

		// Add keyboard listener for Escape key and rebase modal navigation
		const handleKeyDown = (e: KeyboardEvent) => {
			// Selection mode escape
			if (e.key === 'Escape' && isSelectionMode) {
				exitSelectionMode();
				return;
			}

			// Rebase modal navigation
			if (rebaseModal.isOpen) {
				switch (e.key) {
					case 'ArrowLeft':
						e.preventDefault();
						if (rebaseModal.currentConflictIndex > 0) {
							rebaseModal.currentConflictIndex--;
						}
						break;
					case 'ArrowRight':
						e.preventDefault();
						if (rebaseModal.currentConflictIndex < rebaseModal.conflicts.length - 1) {
							rebaseModal.currentConflictIndex++;
						}
						break;
					case '1':
						e.preventDefault();
						resolveConflict('keep_admin');
						break;
					case '2':
						e.preventDefault();
						resolveConflict('keep_mine');
						break;
					case '3':
						e.preventDefault();
						resolveConflict('skip');
						break;
					case '4':
						e.preventDefault();
						resolveConflict('resurrect');
						break;
				}
			}
		};

		window.addEventListener('keydown', handleKeyDown);

		fetchLibrary();

		// Cleanup
		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	});

	// Auth check
	$effect(() => {
		if (browser && $user === null) goto('/login');
	});

	// Fetch library data with full volume details
	const fetchLibrary = async () => {
		try {
			isLoading = true;
			error = null;

			// Fetch basic library list
			const response = await apiFetch('/api/library');
			const basicLibrary = response.data as Series[];

			// Fetch full details for each series to get complete volume data
			// This is a workaround until we have a dedicated contributions API endpoint
			const detailedLibrary = await Promise.all(
				basicLibrary.slice(0, 5).map(async (series) => {
					try {
						const detailResponse = await apiFetch(`/api/library/series/${series.id}`);
						return detailResponse as Series;
					} catch (e) {
						console.error(`Failed to fetch details for series ${series.id}:`, e);
						return series; // Fallback to basic data
					}
				})
			);

			library = detailedLibrary;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			isLoading = false;
		}
	};

	// Transform library into contribution data
	const seriesContributions = $derived.by(() => {
		const seriesList: SeriesContribution[] = [];
		let behindCount = 0;
		let aheadCount = 0;

		// NOTE: OCR branch status (hasAhead, hasBehind, etc.) is still sample data
		// TODO: Query actual OCR branch data from the database
		library.forEach((series, seriesIdx) => {
			if (!series.volumes || series.volumes.length === 0) return;

			const volumeContribs: VolumeContribution[] = [];
			let totalAhead = 0;
			let totalBehind = 0;
			let volumesAhead = 0;
			let volumesBehind = 0;

			// Use actual volumes from the API
			series.volumes.forEach((volume, idx) => {
				// TODO: Replace with actual OCR branch status from database
				const hasAhead = idx % 2 === 0;
				const hasBehind = idx % 3 !== 2;
				// Use deterministic sample data based on volume ID to prevent re-render flickering
				const hashCode = volume.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
				const userPatchCount = hasAhead ? (hashCode % 15) + 3 : 0;
				const behindByCount = hasBehind ? (hashCode % 10) + 2 : 0;

				if (hasAhead) {
					totalAhead += userPatchCount;
					volumesAhead++;
				}
				if (hasBehind) {
					totalBehind += behindByCount;
					volumesBehind++;
				}

				// Use actual volume data
				volumeContribs.push({
					...volume,
					hasAhead,
					hasBehind,
					userPatchCount,
					behindByCount
				});
			});

			if (totalAhead > 0 || totalBehind > 0) {
				// Count for filter badges while we're already iterating
				if (totalBehind > 0) behindCount++;
				if (totalAhead > 0) aheadCount++;

				seriesList.push({
					id: series.id,
					title: series.title || series.folderName,
					coverPath: series.coverPath,
					volumes: volumeContribs,
					totalAhead,
					totalBehind,
					volumesAhead,
					volumesBehind
				});
			}
		});

		return { seriesList, filterCounts: { behind: behindCount, ahead: aheadCount } };
	});

	// Filter contributions
	const filteredSeries = $derived.by(() => {
		switch (activeFilter) {
			case 'behind':
				return seriesContributions.seriesList.filter((s: SeriesContribution) => s.totalBehind > 0);
			case 'ahead':
				return seriesContributions.seriesList.filter((s: SeriesContribution) => s.totalAhead > 0);
			default:
				return seriesContributions.seriesList;
		}
	});

	// Extract filter counts (already calculated during series processing)
	const filterCounts = $derived.by(() => seriesContributions.filterCounts);


	// Persist expanded state to sessionStorage
	$effect(() => {
		if (browser && expandedSeries.size > 0) {
			sessionStorage.setItem('contributions_expanded', JSON.stringify([...expandedSeries]));
		}
	});

	// Toggle series expansion (only toggle the clicked series)
	const toggleSeries = (e: MouseEvent, seriesId: string) => {
		e.preventDefault();
		e.stopPropagation();
		const newExpanded = new Set(expandedSeries);
		if (newExpanded.has(seriesId)) {
			newExpanded.delete(seriesId);
		} else {
			newExpanded.add(seriesId);
		}
		expandedSeries = newExpanded;
	};

	// Rebase modal state
	let rebaseModal = $state<{
		isOpen: boolean;
		volumeId: string | null;
		volumeTitle: string | null;
		seriesTitle: string | null;
		conflicts: RebaseConflict[];
		currentConflictIndex: number;
	}>({
		isOpen: false,
		volumeId: null,
		volumeTitle: null,
		seriesTitle: null,
		conflicts: [],
		currentConflictIndex: 0
	});

	// Reset confirmation modal state
	let resetModal = $state<{
		isOpen: boolean;
		volumeId: string | null;
		volumeTitle: string | null;
	}>({
		isOpen: false,
		volumeId: null,
		volumeTitle: null
	});

	// Handle rebase click
	const handleRebase = (e: MouseEvent, volume: VolumeContribution, seriesTitle: string) => {
		e.preventDefault();
		e.stopPropagation();

		// Sample conflicts - in real implementation, this comes from API
		const sampleConflicts: RebaseConflict[] = [
			{
				type: 'content_conflict',
				path: '/pages/5/blocks/2/lines/0/text',
				userValue: '彼は学生です',
				adminValue: '彼女は学生です',
				context: {
					pageNumber: 5,
					blockIndex: 2,
					lineIndex: 0
				}
			},
			{
				type: 'dead_zone',
				path: '/pages/12/blocks/3',
				userValue: 'Deleted block that user edited',
				adminValue: null,
				context: {
					pageNumber: 12,
					blockIndex: 3
				}
			}
		];

		rebaseModal = {
			isOpen: true,
			volumeId: volume.id,
			volumeTitle: volume.title || volume.folderName,
			seriesTitle: seriesTitle,
			conflicts: sampleConflicts,
			currentConflictIndex: 0
		};
	};

	// Handle reset click
	const handleReset = (e: MouseEvent, volume: VolumeContribution) => {
		e.preventDefault();
		e.stopPropagation();

		resetModal = {
			isOpen: true,
			volumeId: volume.id,
			volumeTitle: volume.title || volume.folderName
		};
	};

	// Confirm reset
	const confirmReset = async () => {
		if (!resetModal.volumeId || isResetting) return;

		try {
			isResetting = true;
			// TODO: Call API endpoint POST /api/library/volumes/:volumeId/reset
			await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call
			resetModal.isOpen = false;
		} catch (e) {
			console.error('[Reset] Failed to reset volume:', e);
			error = 'Failed to reset volume. Please try again.';
		} finally {
			isResetting = false;
		}
	};

	// Resolve conflict
	const resolveConflict = (resolution: 'keep_admin' | 'keep_mine' | 'skip' | 'resurrect') => {
		console.log(
			'[Rebase] Resolving conflict',
			rebaseModal.currentConflictIndex,
			'with',
			resolution
		);
		// TODO: Call API endpoint POST /api/library/volumes/:volumeId/rebase/continue

		if (rebaseModal.currentConflictIndex < rebaseModal.conflicts.length - 1) {
			rebaseModal.currentConflictIndex++;
		} else {
			// All conflicts resolved
			rebaseModal.isOpen = false;
		}
	};

	// Abort rebase
	const abortRebase = () => {
		console.log('[Rebase] Aborting rebase for volume:', rebaseModal.volumeId);
		// TODO: Call API endpoint POST /api/library/volumes/:volumeId/rebase/abort
		rebaseModal.isOpen = false;
	};

	// Get conflict type label
	const getConflictTypeLabel = (type: string) => {
		switch (type) {
			case 'content_conflict':
				return 'Content Conflict';
			case 'dead_zone':
				return 'Deleted Block';
			case 'double_delete':
				return 'Double Delete';
			case 'reorder_length_change':
				return 'Reorder + Length Change';
			case 'competing_reorder':
				return 'Competing Reorders';
			default:
				return 'Conflict';
		}
	};

	// Get available resolutions for conflict type
	const getAvailableResolutions = (type: string) => {
		switch (type) {
			case 'dead_zone':
				return ['skip', 'resurrect'];
			case 'double_delete':
				return ['skip'];
			default:
				return ['keep_admin', 'keep_mine'];
		}
	};

	// Handle view volume
	const handleViewVolume = (volumeId: string, seriesId: string) => {
		console.log('[Contributions] handleViewVolume called with:', { volumeId, seriesId });

		// Save expanded state to sessionStorage
		const expandedArray = Array.from(expandedSeries);
		sessionStorage.setItem('contributions_expanded', JSON.stringify(expandedArray));
		console.log('[Contributions] Saved expanded series before navigation:', expandedArray);

		// Set return context for the reader's back button
		try {
			uiState.setReturnPath('/contributions', 'Back to Contributions');
			console.log('[Contributions] Set return path to /contributions');
		} catch (e) {
			console.error('[Contributions] Failed to set return path:', e);
		}

		// Navigate to volume
		console.log('[Contributions] Navigating to /volume/' + volumeId);
		goto(`/volume/${volumeId}`);
	};

	// Get status info
	const getStatusInfo = (volume: VolumeContribution) => {
		if (volume.hasAhead && volume.hasBehind) {
			return { color: 'bg-status-warning', textColor: 'text-status-warning', icon: '⚠️' };
		}
		if (volume.hasAhead) {
			return { color: 'bg-accent', textColor: 'text-accent', icon: '✏️' };
		}
		if (volume.hasBehind) {
			return { color: 'bg-status-unread', textColor: 'text-status-unread', icon: '🔄' };
		}
		return { color: 'bg-status-success', textColor: 'text-status-success', icon: '✓' };
	};

	// Format date
	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
			Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
			'day'
		);
	};

	// Get cover URLs
	const getSeriesCoverUrl = (seriesId: string) => {
		const url = `/api/files/series/${seriesId}/cover`;
		console.log('[Series Cover] Generated URL:', url, 'for seriesId:', seriesId);
		return url;
	};

	const getVolumeCoverUrl = (volumeId: string, coverImageName: string | null) => {
		console.log('[Volume Cover URL] Generating for:', { volumeId, coverImageName });
		if (!coverImageName) {
			console.log('[Volume Cover URL] ❌ No coverImageName provided, returning null');
			return null;
		}
		const url = `/api/files/volume/${volumeId}/image/${coverImageName}`;
		console.log('[Volume Cover URL] ✓ Generated:', url);
		console.log('[Volume Cover URL] ⚠️ Note: This will fail for mock volume IDs');
		return url;
	};

	// Image error handler
	const handleImageError = (e: Event, type: 'series' | 'volume', id: string) => {
		const img = e.target as HTMLImageElement;
		console.error(`[${type} Cover] Failed to load image for ${id}:`, img.src);
	};

	// Generate sample activity history with more data points
	const generateActivityHistory = (): ActivityEntry[] => {
		const editTypes: ('text' | 'box' | 'font' | 'structure')[] = ['text', 'box', 'font', 'structure'];
		const now = new Date();
		const entries: ActivityEntry[] = [];

		// Generate diverse activity across the last 30 days
		seriesContributions.seriesList.slice(0, 3).forEach((series, seriesIdx) => {
			series.volumes.slice(0, 2).forEach((volume, volIdx) => {
				if (volume.hasAhead) {
					// Create multiple edits for each volume across different days
					const numEdits = Math.floor(Math.random() * 4) + 2; // 2-5 edit sessions per volume
					for (let i = 0; i < numEdits; i++) {
						const daysAgo = Math.floor(Math.random() * 28) + 1; // Random day in last 28 days
						const patchCount = Math.floor(Math.random() * 8) + 1; // 1-8 patches per session
						entries.push({
							id: `activity-${volume.id}-${i}`,
							volumeId: volume.id,
							volumeTitle: volume.title || `Volume ${volIdx + 1}`,
							seriesTitle: series.title || 'Unknown Series',
							seriesId: series.id,
							timestamp: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
							patchCount: patchCount,
							editType: editTypes[(seriesIdx + volIdx + i) % editTypes.length]
						});
					}
				}
			});
		});

		return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	};

	// Get recently edited volumes
	const getRecentlyEdited = (): VolumeContribution[] => {
		const allVolumes: VolumeContribution[] = [];
		seriesContributions.seriesList.forEach((series) => {
			series.volumes.forEach((vol) => {
				if (vol.hasAhead) allVolumes.push(vol);
			});
		});
		return allVolumes.slice(0, 5);
	};

	// Handle rebase all - rebases all volumes that are behind
	const handleRebaseAll = async () => {
		if (volumesNeedingRebaseDerived.length === 0) return;

		const volumeCount = volumesNeedingRebaseDerived.length;
		console.log('[Rebase All] Starting for', volumeCount, 'volumes');

		// Sample implementation - in real app, this would batch-process all volumes
		for (let i = 0; i < volumeCount; i++) {
			const volume = volumesNeedingRebaseDerived[i];
			console.log(`[Rebase All] Processing ${i + 1}/${volumeCount}:`, volume.title);

			// Simulate the rebase process with sample conflicts
			const sampleConflicts = [
				{
					type: 'content_conflict',
					path: `/pages/${i}/blocks/1/lines/0/text`,
					userValue: 'ユーザーの編集',
					adminValue: '管理者の編集',
					context: { pageNumber: i, blockIndex: 1, lineIndex: 0 }
				}
			];

			// In real implementation, you would open a conflict resolution modal
			// or handle it automatically based on user preferences
			console.log('[Rebase All] Volume has', sampleConflicts.length, 'conflicts');
		}

		alert(`Rebase all complete! Processed ${volumeCount} volumes.\n\nNote: This is sample data. In the real implementation, each volume with conflicts would open a resolution modal.`);
	};

	// Handle batch rebase - works with selected items from hold-to-select
	const handleBatchRebase = async () => {
		if (selectedItems.size === 0) return;

		// Filter to only get volume IDs (not series IDs)
		const selectedVolumeIds = Array.from(selectedItems).filter(id => {
			// Check if this ID belongs to a volume
			return seriesContributions.seriesList.some(s => s.volumes.some(v => v.id === id));
		});

		console.log('[Batch Rebase] Starting for volumes:', selectedVolumeIds);

		// Sample implementation - process each selected volume
		for (let i = 0; i < selectedVolumeIds.length; i++) {
			const volumeId = selectedVolumeIds[i];
			const volume = seriesContributions
				.flatMap(s => s.volumes)
				.find(v => v.id === volumeId);

			if (!volume) continue;

			console.log(`[Batch Rebase] Processing ${i + 1}/${selectedVolumeIds.length}:`, volume.title);

			// Only rebase volumes that are behind
			if (volume.hasBehind) {
				const sampleConflicts = [
					{
						type: 'content_conflict',
						path: `/pages/${i}/blocks/2/lines/0/text`,
						userValue: 'ユーザーの変更',
						adminValue: '公式の変更',
						context: { pageNumber: i, blockIndex: 2, lineIndex: 0 }
					}
				];
				console.log('[Batch Rebase] Volume has', sampleConflicts.length, 'conflicts');
			}
		}

		alert(`Batch rebase complete! Processed ${selectedVolumeIds.length} selected volumes.\n\nNote: This is sample data. In the real implementation, each volume with conflicts would require resolution.`);

		// Exit selection mode after operation
		exitSelectionMode();
	};

	// Handle export edits
	const handleExportEdits = () => {
		const exportData = {
			exportedAt: new Date().toISOString(),
			stats: sampleStats,
			activity: activityHistoryDerived,
			selectedItems: Array.from(selectedItems)
		};

		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `contributions-export-${new Date().toISOString().split('T')[0]}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	// Open diff viewer
	const openDiffViewer = (volume: VolumeContribution) => {
		selectedDiffVolume = volume;
		showDiffViewer = true;
	};

	// Format edit type for display
	const getEditTypeIcon = (type: ActivityEntry['editType']) => {
		switch (type) {
			case 'text':
				return '✏️';
			case 'box':
				return '📦';
			case 'font':
				return '🔤';
			case 'structure':
				return '🏗️';
		}
	};

	// Derive activity data directly without effect to avoid infinite loops
	const activityHistoryDerived = $derived.by(() => {
		if (seriesContributions.seriesList.length === 0) return [];
		return generateActivityHistory();
	});

	const recentlyEditedDerived = $derived.by(() => {
		if (seriesContributions.seriesList.length === 0) return [];
		return getRecentlyEdited();
	});

	// Generate activity graph data for the last 30 days
	const activityGraphDerived = $derived.by(() => {
		if (activityHistoryDerived.length === 0) return [];

		const days = 30;
		const now = new Date();
		const graphData: { date: string; count: number; dayName: string }[] = [];

		// Create array of last 30 days
		for (let i = days - 1; i >= 0; i--) {
			const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
			const dateStr = date.toISOString().split('T')[0];
			graphData.push({
				date: dateStr,
				count: 0,
				dayName: date.toLocaleDateString('en-US', { weekday: 'short' })
			});
		}

		// Count activities per day
		activityHistoryDerived.forEach((activity) => {
			const activityDate = new Date(activity.timestamp).toISOString().split('T')[0];
			const dayData = graphData.find(d => d.date === activityDate);
			if (dayData) {
				dayData.count += activity.patchCount;
			}
		});

		return graphData;
	});

	const lastContinueVolumeDerived = $derived(
		activityHistoryDerived.length > 0 ? activityHistoryDerived[0].volumeId : null
	);

	// Count volumes that need rebasing (volumes with hasBehind)
	const volumesNeedingRebaseDerived = $derived.by(() => {
		const volumes: VolumeContribution[] = [];
		seriesContributions.seriesList.forEach((series) => {
			series.volumes.forEach((vol) => {
				if (vol.hasBehind) volumes.push(vol);
			});
		});
		return volumes;
	});

	// Selection mode handlers
	const enterSelectionMode = (itemId: string, isSeries: boolean = false) => {
		console.log('[Selection] Entering selection mode for:', itemId, 'isSeries:', isSeries);
		isSelectionMode = true;
		const newSelection = new Set<string>();

		if (isSeries) {
			// Only select the volumes, not the series itself
			const series = seriesContributions.seriesList.find(s => s.id === itemId);
			if (series) {
				console.log('[Selection] Adding', series.volumes.length, 'volumes from series');
				series.volumes.forEach(vol => newSelection.add(vol.id));
			}
		} else {
			newSelection.add(itemId);
		}
		selectedItems = newSelection;
		console.log('[Selection] Selected items:', Array.from(selectedItems));
	};

	const toggleSelection = (itemId: string, isSeries: boolean = false) => {
		console.log('[Selection] Toggle selection for:', itemId, 'isSeries:', isSeries, 'isSelectionMode:', isSelectionMode);

		if (!isSelectionMode) {
			enterSelectionMode(itemId, isSeries);
			return;
		}

		const newSelection = new Set(selectedItems);

		if (isSeries) {
			const series = seriesContributions.seriesList.find(s => s.id === itemId);
			if (!series) return;

			// Check if all volumes are currently selected
			const allVolumesSelected = series.volumes.every(vol => newSelection.has(vol.id));

			if (allVolumesSelected) {
				// Deselect all volumes (not the series ID, since we never stored it)
				console.log('[Selection] Deselecting all', series.volumes.length, 'volumes from series');
				series.volumes.forEach(vol => newSelection.delete(vol.id));
			} else {
				// Select all volumes (not the series ID)
				console.log('[Selection] Selecting all', series.volumes.length, 'volumes from series');
				series.volumes.forEach(vol => newSelection.add(vol.id));
			}
		} else {
			// Toggle individual volume
			if (newSelection.has(itemId)) {
				newSelection.delete(itemId);
			} else {
				newSelection.add(itemId);
			}
		}

		selectedItems = newSelection;
		console.log('[Selection] Updated selected items:', Array.from(selectedItems));

		// Exit selection mode if nothing selected
		if (selectedItems.size === 0) {
			isSelectionMode = false;
			console.log('[Selection] Exiting selection mode - no items selected');
		}
	};

	const exitSelectionMode = () => {
		console.log('[Selection] Exiting selection mode');
		isSelectionMode = false;
		selectedItems = new Set();
	};

	const handleSeriesLongPress = (seriesId: string) => {
		console.log('[Event] Series long press:', seriesId);
		enterSelectionMode(seriesId, true);
	};

	const handleVolumeSelect = (e: MouseEvent, volumeId: string) => {
		console.log('[Event] Volume select:', volumeId, 'isSelectionMode:', isSelectionMode);
		if (isSelectionMode) {
			e.preventDefault();
			e.stopPropagation();
			toggleSelection(volumeId, false);
		}
	};

	const handleVolumeLongPress = (volumeId: string) => {
		console.log('[Event] Volume long press:', volumeId);
		enterSelectionMode(volumeId, false);
	};

	const handleSeriesSelect = (e: MouseEvent, seriesId: string) => {
		console.log('[Event] Series select:', seriesId, 'isSelectionMode:', isSelectionMode);
		if (isSelectionMode) {
			e.preventDefault();
			e.stopPropagation();
			toggleSelection(seriesId, true);
		}
	};
</script>

<div class="max-w-7xl mx-auto p-4">
	<!-- Development Notice -->
	<div class="mb-6 rounded-xl bg-status-warning/10 border-2 border-status-warning/30 p-4">
		<div class="flex items-start gap-3">
			<div class="text-2xl flex-shrink-0">🚧</div>
			<div class="flex-1">
				<div class="text-sm font-bold text-status-warning mb-1">Development Preview</div>
				<div class="text-xs text-theme-secondary leading-relaxed">
					Volume data is loaded from the API, but OCR branch status is using sample data. Missing:
					<ul class="list-disc list-inside mt-1 ml-2">
						<li>OCR branch status (hasAhead, hasBehind, patch counts)</li>
						<li>Actual conflict detection and resolution data</li>
						<li>Database queries for user vs admin branch comparison</li>
					</ul>
				</div>
			</div>
		</div>
	</div>

	<!-- Header with Stats -->
	<div class="mb-8">
		<!-- Title Section with Gradient -->
		<div class="relative mb-6 sm:mb-8 overflow-hidden rounded-xl sm:rounded-2xl bg-gradient-to-br from-accent/20 via-theme-surface/50 to-theme-main border-2 border-accent/30 p-4 sm:p-6 md:p-8 shadow-xl">
			<!-- Background Decoration -->
			<div class="absolute inset-0 bg-grid-pattern opacity-5"></div>
			<div class="absolute -top-24 -right-24 w-96 h-96 bg-accent/20 rounded-full blur-3xl"></div>
			<div class="absolute -bottom-24 -left-24 w-96 h-96 bg-theme-primary/10 rounded-full blur-3xl"></div>

			<!-- Content -->
			<div class="relative z-10">
				<div class="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
					<div class="p-2 sm:p-3 rounded-lg sm:rounded-xl bg-accent/20 border-2 border-accent/40 shadow-lg flex-shrink-0">
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
							<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
						</svg>
					</div>
					<div class="flex-1 min-w-0">
						<h1 class="text-xl sm:text-2xl md:text-4xl font-black text-theme-primary mb-0.5 sm:mb-1 tracking-tight">
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
					<div class="group relative rounded-xl sm:rounded-2xl bg-gradient-to-br from-theme-main to-theme-surface border-2 border-theme-border hover:border-accent/50 p-4 sm:p-5 transition-all duration-300 hover:scale-105 hover:shadow-2xl overflow-hidden">
						<div class="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
						<div class="relative z-10">
							<div class="flex items-center justify-between mb-2 sm:mb-3">
								<div class="p-1.5 sm:p-2 rounded-lg bg-accent/10 border border-accent/30">
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-accent">
										<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
										<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
									</svg>
								</div>
								<div class="text-2xl sm:text-3xl font-black text-accent group-hover:scale-110 transition-transform">
									{sampleStats.totalEdits}
								</div>
							</div>
							<div class="text-[10px] sm:text-xs font-bold text-theme-secondary uppercase tracking-wider">Total Edits</div>
						</div>
					</div>

					<!-- Edits Merged -->
					<div class="group relative rounded-xl sm:rounded-2xl bg-gradient-to-br from-theme-main to-theme-surface border-2 border-theme-border hover:border-status-success/50 p-4 sm:p-5 transition-all duration-300 hover:scale-105 hover:shadow-2xl overflow-hidden">
						<div class="absolute inset-0 bg-gradient-to-br from-status-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
						<div class="relative z-10">
							<div class="flex items-center justify-between mb-2 sm:mb-3">
								<div class="p-1.5 sm:p-2 rounded-lg bg-status-success/10 border border-status-success/30">
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-status-success">
										<polyline points="20 6 9 17 4 12" />
									</svg>
								</div>
								<div class="text-2xl sm:text-3xl font-black text-status-success group-hover:scale-110 transition-transform">
									{sampleStats.editsMerged}
								</div>
							</div>
							<div class="text-[10px] sm:text-xs font-bold text-theme-secondary uppercase tracking-wider">Edits Merged</div>
						</div>
					</div>

					<!-- Volumes Edited -->
					<div class="group relative rounded-xl sm:rounded-2xl bg-gradient-to-br from-theme-main to-theme-surface border-2 border-theme-border hover:border-theme-primary/50 p-4 sm:p-5 transition-all duration-300 hover:scale-105 hover:shadow-2xl overflow-hidden">
						<div class="absolute inset-0 bg-gradient-to-br from-theme-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
						<div class="relative z-10">
							<div class="flex items-center justify-between mb-2 sm:mb-3">
								<div class="p-1.5 sm:p-2 rounded-lg bg-theme-primary/10 border border-theme-primary/30">
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-theme-primary">
										<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
										<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
									</svg>
								</div>
								<div class="text-2xl sm:text-3xl font-black text-theme-primary group-hover:scale-110 transition-transform">
									{sampleStats.volumesEdited}
								</div>
							</div>
							<div class="text-[10px] sm:text-xs font-bold text-theme-secondary uppercase tracking-wider">Volumes Edited</div>
						</div>
					</div>
				</div>

				<!-- Activity Graph (Last 30 Days) -->
				{#if activityGraphDerived.length > 0}
					{@const maxCount = Math.max(...activityGraphDerived.map(d => d.count), 1)}
					{@const totalEdits = activityGraphDerived.reduce((sum, d) => sum + d.count, 0)}
					{@const activeDays = activityGraphDerived.filter(d => d.count > 0).length}
					{@const firstDay = activityGraphDerived[0]}
					{@const lastDay = activityGraphDerived[activityGraphDerived.length - 1]}
					<div class="p-4 rounded-xl bg-gradient-to-br from-accent/10 to-theme-surface border-2 border-accent/30">
						<!-- Header with Stats -->
						<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
							<div class="flex items-center gap-2 sm:gap-3">
								<div class="text-xl sm:text-2xl">📊</div>
								<div>
									<div class="text-xs sm:text-sm font-bold text-accent">30-Day Activity Graph</div>
									<div class="text-[10px] sm:text-xs text-theme-secondary">
										{totalEdits} edit{totalEdits === 1 ? '' : 's'} across {activeDays} day{activeDays === 1 ? '' : 's'}
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
								<span class="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-accent/20 text-accent font-bold">
									Max: {maxCount}
								</span>
							</div>
						</div>

						<!-- Graph with Date Labels -->
						<div class="space-y-2">
							<!-- Graph Container with Y-axis -->
							<div class="flex gap-2">
								<!-- Y-axis labels -->
								<div class="flex flex-col justify-between text-[9px] sm:text-[10px] text-theme-tertiary font-semibold w-6 sm:w-8 flex-shrink-0 text-right pr-1">
									<span>{maxCount}</span>
									<span>{Math.floor(maxCount / 2)}</span>
									<span>0</span>
								</div>

								<!-- Graph Bars -->
								<div class="flex-1 relative">
									<div class="flex items-end gap-0.5 h-16 relative">
										{#each activityGraphDerived as day, idx}
											{@const heightPercent = day.count > 0 ? Math.max((day.count / maxCount) * 100, 8) : 0}
											<div
												class="group/bar flex-1 rounded-sm transition-all cursor-pointer hover:opacity-80 relative {day.count > 0 ? 'bg-accent hover:bg-accent/80' : 'bg-theme-border/30 hover:bg-theme-border/50'}"
												style="height: {heightPercent}%"
												title="{day.dayName}, {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: {day.count} edit{day.count === 1 ? '' : 's'}"
											>
												<!-- Tooltip on hover - positioned above the graph container -->
												{#if day.count > 0}
													<div class="absolute bottom-[calc(100%+0.5rem)] left-1/2 -translate-x-1/2 px-2 py-1 bg-theme-main border border-accent/50 rounded-md shadow-lg opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20 text-xs font-semibold">
														<div class="text-accent">{day.count} edit{day.count === 1 ? '' : 's'}</div>
														<div class="text-theme-secondary text-[10px]">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							</div>

							<!-- Date Range Labels -->
							<div class="flex items-center justify-between text-[10px] text-theme-tertiary font-semibold">
								<span class="w-6 sm:w-8 flex-shrink-0"></span>
								<div class="flex-1 flex items-center justify-between px-0.5">
									<span class="text-[9px] sm:text-[10px]">{new Date(firstDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
									<span class="text-theme-secondary text-[9px] sm:text-[10px]">← 30 days →</span>
									<span class="text-[9px] sm:text-[10px]">{new Date(lastDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Right: Quick Actions Panel -->
			{#if lastContinueVolumeDerived || recentlyEditedDerived.length > 0}
				<div class="flex flex-col lg:flex-1 rounded-xl bg-gradient-to-br from-theme-surface to-theme-main border-2 border-theme-border p-4 sm:p-5">
					<div class="mb-3 sm:mb-4">
						<h3 class="text-xs sm:text-sm font-bold text-theme-primary uppercase tracking-wider">Quick Actions</h3>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 auto-rows-min content-start">
						<!-- Rebase All -->
						{#if volumesNeedingRebaseDerived.length > 0}
							<button
								onclick={handleRebaseAll}
								class="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 hover:bg-status-warning/20 transition-all text-left group"
							>
								<div class="p-1.5 sm:p-2 rounded-lg bg-status-warning/20 group-hover:bg-status-warning/30 transition-colors flex-shrink-0">
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-status-warning"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
								</div>
								<div class="flex-1 min-w-0">
									<div class="text-[10px] sm:text-xs font-bold text-status-warning mb-0.5 sm:mb-1">Rebase All</div>
									<div class="text-[9px] sm:text-xs text-theme-secondary truncate">{volumesNeedingRebaseDerived.length} vol{volumesNeedingRebaseDerived.length === 1 ? '' : 's'} behind</div>
								</div>
							</button>
						{/if}

						<!-- Recently Edited Dropdown -->
						<div class="relative">
							<button
								onclick={() => showActivityTimeline = !showActivityTimeline}
								class="w-full flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg bg-theme-primary/10 border border-theme-primary/30 hover:bg-theme-primary/20 transition-all text-left group"
							>
								<div class="p-1.5 sm:p-2 rounded-lg bg-theme-primary/20 group-hover:bg-theme-primary/30 transition-colors flex-shrink-0">
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-theme-primary"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
								</div>
								<div class="flex-1 min-w-0">
									<div class="text-[10px] sm:text-xs font-bold text-theme-primary mb-0.5 sm:mb-1">Activity Timeline</div>
									<div class="text-[9px] sm:text-xs text-theme-secondary truncate">{activityHistoryDerived.length} recent edits</div>
								</div>
							</button>
						</div>

						<!-- Batch Rebase -->
						<button
							onclick={handleBatchRebase}
							disabled={selectedItems.size === 0}
							class="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg transition-all text-left group {selectedItems.size === 0 ? 'bg-status-warning/5 border border-status-warning/20 opacity-50 cursor-not-allowed' : 'bg-status-warning/10 border border-status-warning/30 hover:bg-status-warning/20'}"
							title={selectedItems.size === 0 ? 'Hold to select volumes' : 'Rebase selected volumes'}
						>
							<div class="p-1.5 sm:p-2 rounded-lg bg-status-warning/20 group-hover:bg-status-warning/30 transition-colors flex-shrink-0">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-status-warning"><path d="M3 2v6h6M21 12A9 9 0 0 0 6 5.3L3 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-[10px] sm:text-xs font-bold text-status-warning mb-0.5 sm:mb-1">Batch Rebase</div>
								<div class="text-[9px] sm:text-xs text-theme-secondary truncate">{selectedItems.size === 0 ? 'Hold to select' : `${selectedItems.size} item${selectedItems.size === 1 ? '' : 's'}`}</div>
							</div>
						</button>

						<!-- Export Edits -->
						<button
							onclick={handleExportEdits}
							class="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-left group"
						>
							<div class="p-1.5 sm:p-2 rounded-lg bg-emerald-500/20 group-hover:bg-emerald-500/30 transition-colors flex-shrink-0">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 text-emerald-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-[10px] sm:text-xs font-bold text-emerald-400 mb-0.5 sm:mb-1">Export Data</div>
								<div class="text-[9px] sm:text-xs text-theme-secondary truncate">Download JSON</div>
							</div>
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Activity Timeline Panel -->
	{#if showActivityTimeline && activityHistoryDerived.length > 0}
		<div class="mb-6 rounded-xl bg-gradient-to-br from-theme-surface to-theme-main border-2 border-theme-border p-5">
			<div class="flex items-center justify-between mb-4">
				<h3 class="text-sm font-bold text-theme-primary uppercase tracking-wider">Recent Activity</h3>
				<button
					onclick={() => showActivityTimeline = false}
					class="p-1 rounded-lg hover:bg-theme-surface transition-colors text-theme-secondary hover:text-theme-primary"
					aria-label="Close recent activity"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			</div>

			<div class="space-y-2 max-h-64 overflow-y-auto">
				{#each activityHistoryDerived.slice(0, 10) as activity}
					<button
						onclick={(e) => {
							e.stopPropagation();
							handleViewVolume(activity.volumeId, activity.seriesId);
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
	{/if}


	<!-- Filters -->
	<div class="flex gap-2 sm:gap-3 mb-6">
		<button
			onclick={() => (activeFilter = 'behind')}
			class="group relative flex-1 sm:flex-none px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl font-bold text-xs sm:text-sm transition-all duration-300 overflow-hidden {activeFilter ===
			'behind'
				? 'bg-gradient-to-br from-status-warning to-status-warning/80 text-white shadow-xl shadow-status-warning/30 scale-105'
				: 'bg-theme-main text-theme-secondary hover:text-status-warning hover:bg-theme-surface border-2 border-theme-border hover:border-status-warning/30'}"
		>
			<div class="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
			<div class="relative flex items-center justify-center gap-1.5 sm:gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 flex-shrink-0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
				<span class="hidden xs:inline">Behind</span>
				<span class="px-1.5 sm:px-2 py-0.5 rounded-full bg-black/20 text-[10px] sm:text-xs font-black">{filterCounts.behind}</span>
			</div>
		</button>
		<button
			onclick={() => (activeFilter = 'ahead')}
			class="group relative flex-1 sm:flex-none px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl font-bold text-xs sm:text-sm transition-all duration-300 overflow-hidden {activeFilter ===
			'ahead'
				? 'bg-gradient-to-br from-accent to-accent/80 text-white shadow-xl shadow-accent/30 scale-105'
				: 'bg-theme-main text-theme-secondary hover:text-accent hover:bg-theme-surface border-2 border-theme-border hover:border-accent/30'}"
		>
			<div class="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
			<div class="relative flex items-center justify-center gap-1.5 sm:gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="sm:w-5 sm:h-5 flex-shrink-0"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
				<span class="hidden xs:inline">Ahead</span>
				<span class="px-1.5 sm:px-2 py-0.5 rounded-full bg-black/20 text-[10px] sm:text-xs font-black">{filterCounts.ahead}</span>
			</div>
		</button>
	</div>

	<!-- Loading State -->
	{#if isLoading}
		<div class="rounded-xl bg-theme-main border border-theme-border p-6">
			<div class="animate-pulse space-y-4">
				<div class="h-5 w-40 rounded bg-theme-surface"></div>
				<div class="h-3 w-3/4 rounded bg-theme-surface"></div>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="h-24 rounded-xl bg-theme-surface"></div>
					<div class="h-24 rounded-xl bg-theme-surface"></div>
				</div>
				<div class="h-3 w-2/3 rounded bg-theme-surface"></div>
			</div>
		</div>
	{:else if error}
		<div class="rounded-xl bg-theme-main border border-theme-border p-12 text-center">
			<div class="text-4xl mb-2">❌</div>
			<div class="text-sm text-status-danger">{error}</div>
		</div>
	{:else if filteredSeries.length === 0}
		<div class="rounded-xl bg-theme-main border border-theme-border p-12 text-center">
			<div class="text-4xl mb-2">📚</div>
			<div class="text-base font-medium text-theme-secondary mb-1">
				{#if activeFilter === 'all'}
					No contributions yet
				{:else if activeFilter === 'behind'}
					All caught up!
				{:else}
					No pending edits
				{/if}
			</div>
			<div class="text-xs text-theme-tertiary">
				{#if activeFilter === 'all'}
					Start editing volumes from the shared library
				{:else if activeFilter === 'behind'}
					You have no volumes that need rebasing
				{:else}
					You have no unpublished edits
				{/if}
			</div>
		</div>
	{:else if filteredSeries.length === 0}
		<!-- Empty State -->
		<div class="flex flex-col items-center justify-center py-16 sm:py-24 px-4">
			<div class="text-6xl sm:text-8xl mb-6 opacity-50">
				{#if activeFilter === 'behind'}
					✨
				{:else if activeFilter === 'ahead'}
					📝
				{:else}
					📚
				{/if}
			</div>
			<h3 class="text-xl sm:text-2xl font-bold text-theme-primary mb-3">
				{#if activeFilter === 'behind'}
					All caught up!
				{:else if activeFilter === 'ahead'}
					No pending edits
				{:else}
					No contributions yet
				{/if}
			</h3>
			<p class="text-sm sm:text-base text-theme-secondary text-center max-w-md mb-6">
				{#if activeFilter === 'behind'}
					You're up to date with all official versions. No volumes need rebasing.
				{:else if activeFilter === 'ahead'}
					You haven't made any edits yet. Start reading and editing volumes to contribute!
				{:else}
					Start making edits to volumes to see your contributions here.
				{/if}
			</p>
			<button
				onclick={() => activeFilter = 'all'}
				class="px-4 py-2 rounded-lg bg-accent text-white font-semibold hover:bg-accent/90 transition-colors"
			>
				View All
			</button>
		</div>
	{:else}
		<!-- Series Cards - Two Column Grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
			{#each filteredSeries as series, i}
				{@const isExpanded = expandedSeries.has(series.id)}
				{@const isSeriesSelected = series.volumes.length > 0 && series.volumes.every(vol => selectedItems.has(vol.id))}
				<div
					use:longpress
					onlongpress={() => handleSeriesLongPress(series.id)}
					class="group relative backdrop-blur-2xl rounded-xl sm:rounded-2xl border-2 transition-all duration-300 overflow-hidden shadow-theme-secondary/10 shadow-[0_4px_16px_0] hover:shadow-[0_8px_24px_0] {isSeriesSelected ? 'border-accent/50 ring-1 ring-accent shadow-[0_0_20px_rgba(99,102,241,0.4)] z-30 scale-[1.02]' : 'border-theme-primary/10 hover:border-accent/30 z-10'} {isSelectionMode && !isSeriesSelected ? 'opacity-40 grayscale-[0.4]' : 'opacity-100'}"
					style="animation: slideIn 0.3s ease-out {i * 0.05}s both"
				>
					<!-- Series Card Header -->
					<button
						onpointerdown={(e) => handleSeriesSelect(e, series.id)}
						onclick={(e) => {
							if (isSelectionMode) {
								e.preventDefault();
							} else {
								toggleSeries(e, series.id);
							}
						}}
						class="w-full flex items-center transition-colors duration-300 hover:bg-theme-surface/30"
					>
						<!-- Series Cover -->
						<div
							class="relative h-20 xs:h-24 sm:h-32 w-14 xs:w-[4.2rem] sm:w-auto sm:aspect-[7/11] bg-gradient-to-br from-theme-main to-theme-surface flex-shrink-0 border-r border-accent/20 overflow-hidden"
						>
							{#if series.coverPath}
								<img
									src={getSeriesCoverUrl(series.id)}
									alt={series.title}
									class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
									loading="lazy"
									onerror={(e) => handleImageError(e, 'series', series.id)}
								/>
							{:else}
								<div
									class="h-full w-full flex items-center justify-center text-3xl font-bold text-theme-tertiary"
								>
									📚
								</div>
							{/if}
							<div
								class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent pointer-events-none"
							></div>
						</div>

						<!-- Series Info -->
						<div class="flex-1 min-w-0 py-3 sm:py-4 px-3 sm:px-5 text-left">
							<div class="flex items-start justify-between gap-2 sm:gap-3 mb-2 sm:mb-3">
								<h3
									class="text-sm sm:text-lg font-extrabold text-theme-primary group-hover:text-accent transition-colors duration-300 line-clamp-2 tracking-tight"
								>
									{series.title}
								</h3>
								<div
									class="flex-shrink-0 text-accent/60 group-hover:text-accent transition-all duration-300 {isExpanded
										? 'rotate-180'
										: ''}"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
										stroke-linejoin="round"
										class="sm:w-5 sm:h-5"
										><polyline points="6 9 12 15 18 9"></polyline></svg
									>
								</div>
							</div>

							<!-- Stats Row -->
							<div class="flex flex-wrap items-center gap-1.5 sm:gap-2 md:gap-3 text-[10px] sm:text-xs font-semibold">
								<span
									class="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-theme-surface/60 text-theme-secondary border border-theme-border/50 whitespace-nowrap"
								>
									{series.volumes.length} vol{series.volumes.length === 1 ? '' : 's'}
								</span>
								{#if series.totalAhead > 0}
									<span
										class="group/badge relative inline-flex items-center gap-0.5 xs:gap-1 sm:gap-1.5 px-1.5 xs:px-2 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 rounded-md sm:rounded-lg bg-gradient-to-br from-accent/20 to-accent/10 text-accent border border-accent/30 sm:border-2 shadow-sm hover:shadow-lg hover:scale-105 transition-all duration-200 whitespace-nowrap"
									>
										<div class="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover/badge:opacity-100 transition-opacity rounded-lg"></div>
										<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="xs:w-3.5 xs:h-3.5 sm:w-4 sm:h-4 flex-shrink-0"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
										<span class="font-bold leading-none">{series.totalAhead}</span>
										<span class="hidden sm:inline text-[9px] sm:text-[10px] leading-none">edit{series.totalAhead === 1 ? '' : 's'}</span>
										<span class="hidden md:inline text-[9px] sm:text-xs leading-none">·</span>
										<span class="hidden md:inline font-semibold leading-none">{series.volumesAhead}</span>
										<span class="hidden md:inline text-[9px] sm:text-xs leading-none">vol{series.volumesAhead === 1 ? '' : 's'}</span>
									</span>
								{/if}
								{#if series.totalBehind > 0}
									<span
										class="group/badge relative inline-flex items-center gap-0.5 xs:gap-1 sm:gap-1.5 px-1.5 xs:px-2 sm:px-3 py-0.5 xs:py-1 sm:py-1.5 rounded-md sm:rounded-lg bg-gradient-to-br from-status-warning/20 to-status-warning/10 text-status-warning border border-status-warning/30 sm:border-2 shadow-sm hover:shadow-lg hover:scale-105 transition-all duration-200 whitespace-nowrap"
									>
										<div class="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover/badge:opacity-100 transition-opacity rounded-lg"></div>
										<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="xs:w-3.5 xs:h-3.5 sm:w-4 sm:h-4 flex-shrink-0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
										<span class="font-bold leading-none">{series.totalBehind}</span>
										<span class="hidden sm:inline text-[9px] sm:text-[10px] leading-none">update{series.totalBehind === 1 ? '' : 's'}</span>
										<span class="hidden md:inline text-[9px] sm:text-xs leading-none">·</span>
										<span class="hidden md:inline font-semibold leading-none">{series.volumesBehind}</span>
										<span class="hidden md:inline text-[9px] sm:text-xs leading-none">vol{series.volumesBehind === 1 ? '' : 's'}</span>
									</span>
								{/if}
							</div>
						</div>
					</button>

					<!-- Expandable Volumes List -->
					{#if isExpanded}
						<div
							class="border-t border-theme-primary/10 bg-theme-surface/20"
							style="animation: expandDown 0.3s ease-out"
						>
							<div class="divide-y divide-theme-border/20">
								{#each series.volumes as volume, idx}
									{@const status = getStatusInfo(volume)}
									{@const hasActivity = volume.hasAhead || volume.hasBehind}
									{@const isVolumeSelected = selectedItems.has(volume.id)}
									<div
										use:longpress
										onlongpress={() => handleVolumeLongPress(volume.id)}
										class="w-full flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 transition-all duration-200 {!hasActivity && !isSelectionMode
											? 'opacity-40'
											: ''} {isVolumeSelected ? 'bg-accent/10 border-l-4 border-accent' : ''} {isSelectionMode && !isVolumeSelected ? 'opacity-40 grayscale-[0.4]' : ''}"
										style="animation: fadeIn 0.2s ease-out {idx * 0.02}s both"
									>
										<!-- Volume Cover (Small) -->
										<div class="relative flex-shrink-0">
											{#if volume.coverImageName}
												<img
													src={getVolumeCoverUrl(volume.id, volume.coverImageName)}
													alt={volume.title || volume.folderName}
													class="w-10 h-14 sm:w-14 sm:h-20 object-cover rounded-md shadow-md transition-all duration-200 border border-theme-border/30"
													loading="lazy"
													onerror={(e) => handleImageError(e, 'volume', volume.id)}
												/>
											{:else}
												<div
													class="w-10 h-14 sm:w-14 sm:h-20 rounded-md bg-gradient-to-br from-theme-main to-theme-surface border border-theme-border flex items-center justify-center text-lg sm:text-xl text-theme-tertiary shadow-md"
												>
													📖
												</div>
											{/if}
											{#if hasActivity}
												<div class="absolute -top-1 -right-1">
													<div
														class="w-2 h-2 sm:w-3 sm:h-3 rounded-full {status.color} shadow-lg border-2 border-theme-surface animate-pulse"
													></div>
												</div>
											{/if}
										</div>

										<!-- Volume Info -->
										<div class="flex-1 min-w-0">
											<div
												class="text-xs sm:text-base font-bold text-theme-primary truncate mb-1.5 sm:mb-2 tracking-tight"
											>
												{volume.title || volume.folderName}
											</div>
											<div class="flex items-center gap-1 xs:gap-1.5 sm:gap-2 text-[9px] xs:text-[10px] sm:text-xs font-semibold flex-wrap">
												{#if volume.hasAhead}
													<span
														class="inline-flex items-center gap-0.5 xs:gap-1 sm:gap-1.5 px-1 xs:px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-accent/15 text-accent border border-accent/30 whitespace-nowrap"
													>
														<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="xs:w-3 xs:h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
														<span class="leading-none">{volume.userPatchCount}</span>
														<span class="hidden sm:inline text-[9px] sm:text-[10px] leading-none">edit{volume.userPatchCount === 1 ? '' : 's'}</span>
													</span>
												{/if}
												{#if volume.hasBehind}
													<span
														class="inline-flex items-center gap-0.5 xs:gap-1 sm:gap-1.5 px-1 xs:px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-status-warning/15 text-status-warning border border-status-warning/30 whitespace-nowrap"
													>
														<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="xs:w-3 xs:h-3 sm:w-3.5 sm:h-3.5 flex-shrink-0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
														<span class="leading-none">{volume.behindByCount}</span>
														<span class="hidden sm:inline text-[9px] sm:text-[10px] leading-none">update{volume.behindByCount === 1 ? '' : 's'}</span>
													</span>
												{/if}
												{#if !hasActivity}
													<span
														class="px-1 xs:px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-theme-surface/60 text-theme-tertiary border border-theme-border/50 whitespace-nowrap text-[9px] xs:text-[10px] sm:text-xs"
														>Up to date</span
													>
												{/if}
											</div>
										</div>

										<!-- Action Buttons -->
										<div class="flex flex-row items-center gap-1 sm:gap-1.5 md:gap-2 flex-shrink-0">
											<!-- Diff Viewer Button -->
											{#if volume.hasAhead || volume.hasBehind}
												<button
													onclick={(e) => {
														e.stopPropagation();
														openDiffViewer(volume);
													}}
													class="px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg font-semibold text-[10px] sm:text-xs transition-all border border-theme-primary/30 sm:border-2 bg-theme-primary/10 text-theme-primary hover:bg-theme-primary/20 hover:border-theme-primary shadow-sm hover:shadow-md flex items-center gap-1 flex-shrink-0 whitespace-nowrap"
													title="View differences"
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sm:w-3.5 sm:h-3.5"><path d="M12 3v18"/><path d="m8 9-3 3 3 3"/><path d="m16 15 3-3-3-3"/></svg>
													<span class="hidden lg:inline">Differences</span>
												</button>
											{/if}

											{#if hasActivity}
												{#if volume.hasBehind}
													<!-- Rebase Button -->
													<button
														onclick={(e) => handleRebase(e, volume, series.title)}
														class="px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg font-semibold text-[10px] sm:text-xs transition-all border border-status-warning/30 sm:border-2 bg-status-warning/10 text-status-warning hover:bg-status-warning hover:text-white hover:border-status-warning shadow-sm hover:shadow-md whitespace-nowrap flex-shrink-0"
														title="Sync with official updates"
													>
														🔄 Rebase
													</button>
												{/if}
												{#if volume.hasAhead}
													<!-- Reset Button -->
													<button
														onclick={(e) => handleReset(e, volume)}
														class="px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg font-semibold text-[10px] sm:text-xs transition-all border border-status-danger/30 sm:border-2 bg-status-danger/10 text-status-danger hover:bg-status-danger hover:text-white hover:border-status-danger shadow-sm hover:shadow-md whitespace-nowrap flex-shrink-0"
														title="Reset to official version"
													>
														↺ Reset
													</button>
												{/if}
											{/if}
											<!-- View Button -->
											<button
												onpointerdown={(e) => handleVolumeSelect(e, volume.id)}
												onclick={(e) => {
													e.preventDefault();
													e.stopPropagation();
													if (!isSelectionMode) {
														handleViewVolume(volume.id, series.id);
													}
												}}
												class="px-2 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg font-semibold text-[10px] sm:text-xs transition-all border border-theme-border/50 sm:border-2 bg-theme-surface/60 text-theme-secondary hover:bg-accent hover:text-white hover:border-accent shadow-sm hover:shadow-md flex items-center gap-1 whitespace-nowrap flex-shrink-0"
												title="Open volume"
											>
												<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sm:w-3.5 sm:h-3.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
												<span class="hidden md:inline">View</span>
											</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Reset Confirmation Modal -->
{#if resetModal.isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
		onclick={() => (resetModal.isOpen = false)}
		onkeydown={(e) => e.key === 'Escape' && (resetModal.isOpen = false)}
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
						{resetModal.volumeTitle}
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
					onclick={() => (resetModal.isOpen = false)}
					disabled={isResetting}
					class="flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm bg-theme-surface text-theme-primary hover:bg-theme-surface-hover border-2 border-theme-border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Cancel
				</button>
				<button
					onclick={confirmReset}
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

<!-- Rebase Conflict Resolution Modal -->
{#if rebaseModal.isOpen}
	{@const currentConflict = rebaseModal.conflicts[rebaseModal.currentConflictIndex]}
	{@const availableResolutions = getAvailableResolutions(currentConflict.type)}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4"
		onclick={abortRebase}
		onkeydown={(e) => e.key === 'Escape' && abortRebase()}
		role="button"
		tabindex="0"
	>
		<div
			class="bg-theme-main border border-accent/50 sm:border-2 rounded-xl sm:rounded-2xl shadow-2xl max-w-5xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<!-- Header -->
			<div class="bg-gradient-to-r from-accent/20 to-accent/10 p-3 sm:p-6 border-b border-accent/30 flex-shrink-0">
				<div class="flex items-start justify-between gap-2 sm:gap-4">
					<div class="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
						<div class="text-xl sm:text-3xl flex-shrink-0">🔄</div>
						<div class="flex-1 min-w-0">
							<h2 class="text-base sm:text-xl font-extrabold text-theme-primary mb-0.5 sm:mb-1">Rebase Conflict</h2>
							<p class="text-xs sm:text-sm text-theme-secondary truncate">
								{rebaseModal.seriesTitle} - {rebaseModal.volumeTitle}
							</p>
						</div>
					</div>
					<div class="flex items-center gap-2 flex-shrink-0">
						<span class="px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-accent/20 text-accent text-[10px] sm:text-xs font-bold border border-accent/30">
							{rebaseModal.currentConflictIndex + 1} / {rebaseModal.conflicts.length}
						</span>
					</div>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-3 sm:p-6 space-y-3 sm:space-y-4">
				<!-- Conflict Type Badge & Location -->
				<div class="flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
					<span class="px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-status-warning/20 text-status-warning text-[10px] sm:text-sm font-bold border border-status-warning/30">
						{getConflictTypeLabel(currentConflict.type)}
					</span>
					<span class="text-[10px] sm:text-xs text-theme-tertiary font-semibold">
						Page {currentConflict.context.pageNumber} · Block {currentConflict.context.blockIndex}
						{#if currentConflict.context.lineIndex !== undefined}
							· Line {currentConflict.context.lineIndex}
						{/if}
					</span>
				</div>

				<!-- Compact Explanation -->
				<div class="bg-status-warning/10 border border-status-warning/30 rounded-lg p-2 sm:p-3">
					<div class="text-[10px] sm:text-xs text-theme-secondary leading-snug sm:leading-relaxed">
						{#if currentConflict.type === 'content_conflict'}
							Both you and the admin edited the same text. Choose which version to keep.
						{:else if currentConflict.type === 'dead_zone'}
							The admin deleted this block, but you had edited it. You can skip your changes or
							resurrect the block with your edits.
						{:else if currentConflict.type === 'double_delete'}
							Both you and the admin deleted this item. Your deletion will be skipped as it's
							redundant.
						{:else if currentConflict.type === 'reorder_length_change'}
							The admin added or removed items from an array you reordered. Your reorder will be
							skipped.
						{:else if currentConflict.type === 'competing_reorder'}
							Both you and the admin reordered the same items. Choose which order to keep.
						{:else}
							A conflict occurred that needs your attention.
						{/if}
					</div>
				</div>

				<!-- Visual Comparison -->
				<div class="grid grid-cols-2 gap-2 sm:gap-3">
					<!-- Admin Version -->
					<div class="bg-theme-surface/30 border border-accent/30 sm:border-2 rounded-lg sm:rounded-xl overflow-hidden">
						<div class="bg-accent/20 px-2 py-1.5 sm:px-3 sm:py-2 border-b border-accent/30">
							<span class="text-[10px] sm:text-xs font-bold text-accent">✓ Official</span>
						</div>
						<div class="p-2 sm:p-3 space-y-2">
							<!-- Readable Image -->
							<div class="bg-theme-main border border-theme-border rounded-md overflow-hidden w-full h-32 sm:h-40 md:h-48 lg:h-56 flex items-center justify-center flex-shrink-0">
								<div class="text-center text-theme-tertiary">
									<div class="text-3xl sm:text-4xl md:text-5xl mb-2">📄</div>
									<div class="text-xs sm:text-sm">Panel</div>
								</div>
							</div>
							<!-- Text -->
							<div class="bg-theme-main border border-theme-border rounded-md p-2 sm:p-3">
								<div class="text-[9px] sm:text-xs text-theme-tertiary mb-1 sm:mb-1.5 font-semibold">Text:</div>
								{#if currentConflict.adminValue !== null}
									<div class="text-xs sm:text-base md:text-sm text-theme-primary font-medium leading-snug sm:leading-relaxed break-words max-h-24 sm:max-h-32 md:max-h-40 overflow-y-auto">
										{currentConflict.adminValue}
									</div>
								{:else}
									<div class="text-[10px] sm:text-sm text-status-danger italic">[Deleted]</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- User Version -->
					<div class="bg-theme-surface/30 border border-theme-primary/30 sm:border-2 rounded-lg sm:rounded-xl overflow-hidden">
						<div class="bg-theme-primary/20 px-2 py-1.5 sm:px-3 sm:py-2 border-b border-theme-primary/30">
							<span class="text-[10px] sm:text-xs font-bold text-theme-primary">✏️ Your Edit</span>
						</div>
						<div class="p-2 sm:p-3 space-y-2">
							<!-- Readable Image -->
							<div class="bg-theme-main border border-theme-border rounded-md overflow-hidden w-full h-32 sm:h-40 md:h-48 lg:h-56 flex items-center justify-center flex-shrink-0">
								<div class="text-center text-theme-tertiary">
									<div class="text-3xl sm:text-4xl md:text-5xl mb-2">📄</div>
									<div class="text-xs sm:text-sm">Panel</div>
								</div>
							</div>
							<!-- Text -->
							<div class="bg-theme-main border border-theme-border rounded-md p-2 sm:p-3">
								<div class="text-[9px] sm:text-xs text-theme-tertiary mb-1 sm:mb-1.5 font-semibold">Text:</div>
								<div class="text-xs sm:text-base md:text-sm text-theme-primary font-medium leading-snug sm:leading-relaxed break-words max-h-24 sm:max-h-32 md:max-h-40 overflow-y-auto">
									{currentConflict.userValue}
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Compact Resolution Options -->
				<div class="space-y-2">
					<div class="text-xs font-bold text-theme-tertiary uppercase tracking-wide">
						Choose Resolution:
					</div>
					<div class="grid grid-cols-1 gap-2">
						{#each availableResolutions as resolution}
							<button
								onclick={() => resolveConflict(resolution)}
								class="p-3 rounded-lg border-2 transition-all text-left {resolution === 'keep_admin'
									? 'bg-accent/10 border-accent/30 hover:bg-accent/20 hover:border-accent'
									: resolution === 'keep_mine'
										? 'bg-theme-primary/10 border-theme-primary/30 hover:bg-theme-primary/20 hover:border-theme-primary'
										: resolution === 'resurrect'
											? 'bg-status-success/10 border-status-success/30 hover:bg-status-success/20 hover:border-status-success'
											: 'bg-theme-surface/60 border-theme-border hover:bg-theme-surface-hover'}"
							>
								<div class="flex items-center gap-3">
									<div class="text-xl flex-shrink-0">
										{#if resolution === 'keep_admin'}
											✓
										{:else if resolution === 'keep_mine'}
											✏️
										{:else if resolution === 'resurrect'}
											♻️
										{:else}
											⏭️
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<div class="font-bold text-sm {resolution === 'keep_admin'
											? 'text-accent'
											: resolution === 'keep_mine'
												? 'text-theme-primary'
												: resolution === 'resurrect'
													? 'text-status-success'
													: 'text-theme-secondary'}">
											{#if resolution === 'keep_admin'}
												Keep Official
											{:else if resolution === 'keep_mine'}
												Keep Mine
											{:else if resolution === 'resurrect'}
												Resurrect Block
											{:else}
												Skip
											{/if}
										</div>
									</div>
								</div>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="p-3 sm:p-6 bg-theme-surface/30 border-t border-theme-border flex gap-2 sm:gap-3 flex-shrink-0 items-center">
				<button
					onclick={abortRebase}
					class="px-3 py-1.5 sm:px-6 sm:py-2.5 rounded-lg font-semibold text-xs sm:text-sm bg-theme-surface text-theme-primary hover:bg-theme-surface-hover border sm:border-2 border-theme-border transition-all"
				>
					Abort
				</button>
				<div class="flex-1"></div>
				<div class="text-[10px] sm:text-xs text-theme-tertiary flex items-center">
					<span class="hidden sm:inline">Resolve conflicts to complete rebase</span>
					<span class="sm:hidden">Resolve to complete</span>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Diff Viewer Modal -->
{#if showDiffViewer && selectedDiffVolume}
	<div
		class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
		onclick={() => showDiffViewer = false}
		onkeydown={(e) => e.key === 'Escape' && (showDiffViewer = false)}
		role="button"
		tabindex="0"
	>
		<div
			class="bg-theme-main rounded-2xl border-2 border-theme-primary/30 shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<!-- Header -->
			<div class="bg-gradient-to-r from-theme-primary/20 to-theme-primary/10 p-6 border-b border-theme-primary/30 flex-shrink-0">
				<div class="flex items-start justify-between gap-4">
					<div class="flex items-start gap-3 flex-1 min-w-0">
						<div class="text-3xl flex-shrink-0">👁️</div>
						<div class="flex-1 min-w-0">
							<h2 class="text-xl font-extrabold text-theme-primary mb-1">OCR Diff Viewer</h2>
							<p class="text-sm text-theme-secondary truncate">
								{selectedDiffVolume.title || 'Volume'} — Compare Your Version vs Official
							</p>
						</div>
					</div>
					<button
						onclick={() => showDiffViewer = false}
						class="p-2 rounded-lg hover:bg-theme-surface transition-colors text-theme-secondary hover:text-theme-primary"
						aria-label="Close diff viewer"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>
			</div>

			<!-- Stats Summary -->
			<div class="p-4 bg-theme-surface/30 border-b border-theme-border flex gap-4 flex-shrink-0">
				<div class="flex items-center gap-2 text-xs">
					<span class="font-bold text-theme-secondary">Your Edits:</span>
					<span class="px-2 py-1 rounded-lg bg-accent/20 text-accent font-bold">{selectedDiffVolume.userPatchCount}</span>
				</div>
				<div class="flex items-center gap-2 text-xs">
					<span class="font-bold text-theme-secondary">Behind By:</span>
					<span class="px-2 py-1 rounded-lg bg-status-warning/20 text-status-warning font-bold">{selectedDiffVolume.behindByCount}</span>
				</div>
				<div class="flex items-center gap-2 text-xs ml-auto">
					<span class="font-bold text-emerald-400">Sample Data</span>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto p-6 space-y-4">
				<div class="text-xs text-theme-secondary mb-4">
					Note: This is a preview of the diff viewer. In the real implementation, this would show actual OCR blocks side-by-side with highlighted differences.
				</div>

				<!-- Sample Diff Blocks -->
				{#each Array(3) as _, blockIdx}
					<div class="rounded-lg border border-theme-border sm:border-2 overflow-hidden">
						<div class="bg-theme-surface p-1.5 sm:p-2 border-b border-theme-border">
							<span class="text-[10px] sm:text-xs font-bold text-theme-secondary">Block {blockIdx + 1}</span>
						</div>
						<div class="grid grid-cols-2 divide-x divide-theme-border">
							<!-- Admin Version -->
							<div class="p-2 sm:p-4 bg-theme-main">
								<div class="text-[9px] sm:text-xs font-bold text-accent mb-1.5 sm:mb-2">Official</div>
								<div class="text-[10px] sm:text-sm text-theme-primary font-mono leading-snug sm:leading-relaxed">
									これは公式バージョンのテキストです。
									{#if blockIdx === 1}
										<span class="bg-red-500/20 text-red-400">古いテキスト</span>
									{/if}
								</div>
							</div>

							<!-- User Version -->
							<div class="p-2 sm:p-4 bg-theme-main">
								<div class="text-[9px] sm:text-xs font-bold text-theme-primary mb-1.5 sm:mb-2">Your Edit</div>
								<div class="text-[10px] sm:text-sm text-theme-primary font-mono leading-snug sm:leading-relaxed">
									これは公式バージョンのテキストです。
									{#if blockIdx === 1}
										<span class="bg-green-500/20 text-green-400">新しいテキスト</span>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<!-- Footer -->
			<div class="p-4 bg-theme-surface/30 border-t border-theme-border flex gap-2 justify-end flex-shrink-0">
				<button
					onclick={() => showDiffViewer = false}
					class="px-4 py-2 rounded-lg bg-theme-border text-theme-secondary hover:bg-theme-border/80 transition-all text-sm font-bold"
				>
					Close
				</button>
				<button
					onclick={() => {
						showDiffViewer = false;
						// TODO: Open rebase flow
						alert('Would start rebase process for this volume');
					}}
					class="px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/80 transition-all text-sm font-bold"
				>
					Start Rebase
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes expandDown {
		from {
			opacity: 0;
			max-height: 0;
		}
		to {
			opacity: 1;
			max-height: 3000px;
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>

