<script lang="ts">
	import { apiFetch, apiUpload } from '$lib/api';
	import { fade } from 'svelte/transition';

	let { isOpen, onClose, onUploadSuccess } = $props<{
		isOpen: boolean;
		onClose: () => void;
		onUploadSuccess: () => void;
	}>();

	// --- Types ---

	type UploadJob = {
		id: string;
		name: string;
		files: File[];
		status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
		progress: number;
		resultMsg?: string;
		seriesFolderName: string;
		volumeFolderName: string;
		metadata: {
			seriesTitle?: string | null;
			seriesDescription?: string | null;
			volumeTitle?: string | null;
			volumeProgress?: { page: number; completed: boolean } | null;
		};
	};

	type DirNode = {
		name: string;
		fullPath: string;
		files: File[];
		children: Map<string, DirNode>;
	};

	type SeriesMetadata = {
		series: {
			title: string | null;
			description?: string | null;
		};
		volumes: Record<
			string,
			{
				displayTitle: string | null;
				progress?: { page: number; completed: boolean } | null;
			}
		>;
	};

	// --- State ---

	let files = $state<FileList | null>(null);
	let jobs = $state<UploadJob[]>([]);
	let isProcessingQueue = $state(false);

	let totalJobs = $derived(jobs.length);
	let completedJobs = $derived(jobs.filter((j) => j.status === 'done').length);

	// --- Actions ---

	const resetState = () => {
		files = null;
		jobs = [];
		isProcessingQueue = false;
	};

	const handleClose = () => {
		onClose();
	};

	$effect(() => {
		if (files) createJobsFromFiles(files);
	});

	// --- 1. TREE BUILDER & JOB CREATOR ---

	const createJobsFromFiles = async (fileList: FileList) => {
		const rootChildren = new Map<string, DirNode>();

		// Step A: Build the Directory Tree
		for (const file of fileList) {
			// FILTER 1: Ignore junk files immediately (DS_Store, Thumbs.db, txt, etc.)
			// We allow .json because we need to read it for metadata, even if we don't upload it.
			if (!/\.(jpg|jpeg|png|webp|mokuro|json)$/i.test(file.name)) {
				continue;
			}

			// FILTER 2: Ignore Hidden Files & System Folders
			// We check every segment of the path (folders and filename)
			const pathParts = file.webkitRelativePath.split('/');

			const isJunk = pathParts.some(
				(part) =>
					part.startsWith('.') || // Hidden files/folders (.git, ._image.jpg)
					[
						'__MACOSX',
						'node_modules',
						'$RECYCLE.BIN',
						'System Volume Information',
						'Thumbs.db',
						'_ocr'
					].includes(part)
			);

			if (isJunk) continue;

			// this is the key for clustering (i.e. determine if files belong to the same volume)
			const folderParts = file.webkitRelativePath.split('/').slice(0, -1);

			// if file is mokuro, put it in the same cluster as ${seriesFolderName}/${volumeFolderName}
			if (file.name.toLowerCase().endsWith('.mokuro')) {
				folderParts.push(file.name.replace(/\.mokuro$/i, ''));
			}
			if (folderParts.length > 3) continue; // file tree should not be deeper than 3 (root/series/volume)

			let currentMap = rootChildren;
			let currentPath = '';
			let node: DirNode | undefined;

			for (const part of folderParts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;

				if (!currentMap.has(part)) {
					currentMap.set(part, {
						name: part,
						fullPath: currentPath,
						files: [],
						children: new Map()
					});
				}

				node = currentMap.get(part)!;
				currentMap = node.children;
			}

			if (node) node.files.push(file);
		}

		// Step B: Traverse Tree
		const newJobs: UploadJob[] = [];

		const traverse = async (
			map: Map<string, DirNode>,
			parentName: string | null,
			parentMetadata?: SeriesMetadata
		) => {
			const sortedKeys = Array.from(map.keys()).sort((a, b) =>
				a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
			);

			for (const key of sortedKeys) {
				const node = map.get(key)!;
				let currentMetadata = parentMetadata;

				// metadata json file if json file name is the same as parent directory
				const jsonFile = node.files.find((f) => f.name === `${node.name}.json`);
				if (jsonFile) {
					try {
						const text = await jsonFile.text();
						currentMetadata = JSON.parse(text) as SeriesMetadata;
					} catch (e) {
						console.warn(`Failed to parse metadata for ${node.fullPath}`, e);
					}
				}

				// Merge Parent Covers
				if (node.files.length > 0 && node.children.size > 0) {
					const validCovers = node.files.filter((f) => {
						const fName = f.name.substring(0, f.name.lastIndexOf('.'));
						return fName === node.name && /\.(jpg|jpeg|png|webp)$/i.test(f.name);
					});

					if (validCovers.length > 0) {
						const firstChildKey = Array.from(node.children.keys()).sort((a, b) =>
							a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
						)[0];

						if (firstChildKey) {
							const child = node.children.get(firstChildKey)!;
							child.files.push(...validCovers);
							node.files = node.files.filter((f) => !validCovers.includes(f));
						}
					}
				}

				// CREATE JOB
				if (node.files.length > 0) {
					// FILTER 3: Exclude JSON files from the actual upload payload
					// We have already extracted their data into 'currentMetadata'.
					// Uploading them wastes bandwidth and triggers backend cleanup logic.
					const payloadFiles = node.files.filter((f) => !f.name.toLowerCase().endsWith('.json'));

					// Only create a job if there are actual files left (images or mokuro)
					if (payloadFiles.length > 0) {
						const seriesFolder = parentName ?? node.name;
						const volumeFolder = node.name;

						const displayName =
							seriesFolder === volumeFolder ? seriesFolder : `${seriesFolder}/${volumeFolder}`;

						// Extract Data
						const seriesTitle = currentMetadata?.series?.title ?? null;
						const seriesDescription = currentMetadata?.series?.description ?? null;
						const volMeta = currentMetadata?.volumes?.[node.name];
						const volumeTitle = volMeta?.displayTitle ?? null;
						const volumeProgress = volMeta?.progress ?? null;

						newJobs.push({
							id: `vol-${node.fullPath}`,
							name: displayName,
							files: payloadFiles,
							status: 'pending',
							progress: 0,
							seriesFolderName: seriesFolder,
							volumeFolderName: volumeFolder,
							metadata: { seriesTitle, seriesDescription, volumeTitle, volumeProgress }
						});
					}
				}

				await traverse(node.children, node.name, currentMetadata);
			}
		};

		await traverse(rootChildren, null);

		jobs = newJobs;
		processQueue();
	};

	// --- 2. PIPELINE RUNNER ---

	const processQueue = async () => {
		if (isProcessingQueue) return;
		isProcessingQueue = true;

		for (const job of jobs) {
			if (job.status === 'done') continue;

			try {
				// --- STEP 1: PRE-FLIGHT CHECK ---
				// Ask server if this volume exists before sending heavy files.
				const check = await apiFetch('/api/library/check', {
					method: 'POST',
					body: {
						series_folder_name: job.seriesFolderName,
						volume_folder_name: job.volumeFolderName
					}
				});

				if (check.exists) {
					job.status = 'done';
					job.progress = 100;
					job.resultMsg = 'Skipped (Duplicate)';
					// Don't trigger onUploadSuccess() for skips to avoid unnecessary refreshes
					continue;
				}

				// --- STEP 2: UPLOAD (Only if new) ---
				job.status = 'uploading';

				const formData = new FormData();

				// Append fields and files

				// Metadata FIRST
				formData.append('series_folder_name', job.seriesFolderName);
				formData.append('volume_folder_name', job.volumeFolderName);

				if (job.metadata.seriesTitle || job.metadata.volumeTitle || job.metadata.volumeProgress) {
					formData.append(
						'metadata',
						JSON.stringify({
							series_title: job.metadata.seriesTitle,
							series_description: job.metadata.seriesDescription,
							volume_title: job.metadata.volumeTitle,
							volume_progress: job.metadata.volumeProgress
						})
					);
				}

				// Files SECOND
				for (const file of job.files) {
					formData.append('files', file, file.webkitRelativePath);
				}

				await apiUpload('/api/library/upload', formData, (percent) => {
					job.progress = percent;
					if (percent === 100) job.status = 'processing';
				});

				job.status = 'done';
				job.resultMsg = `OK`;
				onUploadSuccess();
			} catch (e) {
				console.error(`Failed to upload ${job.name}`, e);
				job.status = 'error';
				job.resultMsg = (e as Error).message;
			}
		}

		isProcessingQueue = false;
		files = null;
	};
</script>

{#if isOpen}
	<button
		transition:fade={{ duration: 150 }}
		onclick={handleClose}
		type="button"
		class="fixed inset-0 z-40 bg-black/50"
		aria-label="button"
	></button>

	<div
		transition:fade={{ duration: 150 }}
		class="fixed top-1/2 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
	>
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-semibold dark:text-white">Upload Pipeline</h2>
			<button onclick={handleClose} class="text-gray-400 hover:text-gray-600 cursor-pointer">
				✕
			</button>
		</div>

		{#if jobs.length === 0}
			<label
				class="flex w-full cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-10 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700"
			>
				<span class="text-sm text-gray-500 dark:text-gray-400">Select Root Folder</span>
				<input type="file" class="hidden" webkitdirectory bind:files />
			</label>
		{:else}
			<div class="flex justify-between mb-2 text-sm font-medium dark:text-gray-300">
				<span>Processing Queue</span>
				<span>{completedJobs} / {totalJobs} Volumes</span>
			</div>

			<div
				class="max-h-[60vh] overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2 space-y-2"
			>
				{#each jobs as job (job.id)}
					<div
						class="rounded bg-white dark:bg-gray-800 p-3 shadow-sm border border-gray-100 dark:border-gray-700"
					>
						<div class="flex items-center justify-between text-sm">
							<span class="font-medium truncate w-1/2 dark:text-gray-200" title={job.name}>
								{job.name}
							</span>
							<span class="text-xs font-bold uppercase tracking-wide">
								{#if job.status === 'pending'}
									<span class="text-gray-400">Waiting</span>
								{:else if job.status === 'uploading'}
									<span class="text-blue-500">Uploading {job.progress}%</span>
								{:else if job.status === 'processing'}
									<span class="text-yellow-500 animate-pulse">Processing...</span>
								{:else if job.status === 'done'}
									<span class="text-green-500">{job.resultMsg || 'Done'}</span>
								{:else}
									<span class="text-red-500">Error</span>
								{/if}
							</span>
						</div>

						{#if job.status === 'uploading'}
							<div
								class="mt-2 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
							>
								<div
									class="h-full bg-blue-500 transition-all duration-300"
									style="width: {job.progress}%"
								></div>
							</div>
						{/if}

						{#if job.status === 'error'}
							<div class="mt-1 text-xs text-red-500">{job.resultMsg}</div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="mt-4 flex justify-end gap-3">
				{#if !isProcessingQueue}
					<button
						onclick={resetState}
						class="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-white cursor-pointer"
					>
						Upload More
					</button>
					<button
						onclick={handleClose}
						class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
					>
						Done
					</button>
				{:else}
					<span class="text-xs text-gray-400 self-center"
						>Please wait for pipeline to finish...</span
					>
				{/if}
			</div>
		{/if}
	</div>
{/if}
