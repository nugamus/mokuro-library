import type { SeriesContribution, VolumeContribution } from './types';

export async function runSampleRebaseAll(volumes: VolumeContribution[]) {
	if (volumes.length === 0) return;

	const volumeCount = volumes.length;
	console.log('[Rebase All] Starting for', volumeCount, 'volumes');

	// Sample implementation - in real app, this would batch-process all volumes
	for (let i = 0; i < volumeCount; i++) {
		const volume = volumes[i];
		console.log(`[Rebase All] Processing ${i + 1}/${volumeCount}:`, volume.title);

		// Simulate the rebase process with sample conflicts
		const sampleConflicts = [
			{
				type: 'content_conflict',
				path: `/pages/${i}/blocks/1/lines/0/text`,
				userValue:
					"ユーザーの編集",
				adminValue: '管理者の編集',
				context: { pageNumber: i, blockIndex: 1, lineIndex: 0 }
			}
		];

		// In real implementation, you would open a conflict resolution modal
		// or handle it automatically based on user preferences
		console.log('[Rebase All] Volume has', sampleConflicts.length, 'conflicts');
	}

	alert(
		`Rebase all complete! Processed ${volumeCount} volumes.\n\nNote: This is sample data. In the real implementation, each volume with conflicts would open a resolution modal.`
	);
}

export async function runSampleBatchRebase(
	seriesList: SeriesContribution[],
	selectedVolumeIds: string[]
) {
	console.log('[Batch Rebase] Starting for volumes:', selectedVolumeIds);

	const volumeById = new Map<string, VolumeContribution>();
	seriesList.forEach((series) => {
		series.volumes.forEach((volume) => volumeById.set(volume.id, volume));
	});

	// Sample implementation - process each selected volume
	for (let i = 0; i < selectedVolumeIds.length; i++) {
		const volumeId = selectedVolumeIds[i];
		const volume = volumeById.get(volumeId);

		if (!volume) continue;

		console.log(`[Batch Rebase] Processing ${i + 1}/${selectedVolumeIds.length}:`, volume.title);

		// Only rebase volumes that are behind
		if (volume.hasBehind) {
			const sampleConflicts = [
				{
					type: 'content_conflict',
					path: `/pages/${i}/blocks/2/lines/0/text`,
					userValue: "ユーザーの変更",
					adminValue: '公式の変更',
					context: { pageNumber: i, blockIndex: 2, lineIndex: 0 }
				}
			];
			console.log('[Batch Rebase] Volume has', sampleConflicts.length, 'conflicts');
		}
	}

	alert(
		`Batch rebase complete! Processed ${selectedVolumeIds.length} selected volumes.\n\nNote: This is sample data. In the real implementation, each volume with conflicts would require resolution.`
	);
}
