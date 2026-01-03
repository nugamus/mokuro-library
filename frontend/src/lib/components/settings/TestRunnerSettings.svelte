<script lang="ts">
	import { apiFetch } from '$lib/services/api';
	import type { TestResult } from './test-runner/types';
	import TestRunnerHeader from './test-runner/TestRunnerHeader.svelte';
	import TestRunnerActions from './test-runner/TestRunnerActions.svelte';
	import TestRunnerStatus from './test-runner/TestRunnerStatus.svelte';
	import TestRunnerResults from './test-runner/TestRunnerResults.svelte';

	let isRunning = $state(false);
	let lastResults = $state<TestResult[]>([]);
	let lastSuccess = $state<boolean | null>(null);
	let errorMessage = $state<string | null>(null);
	let expandedResults = $state<Set<string>>(new Set());
	let expandedSuites = $state<Set<string>>(new Set());
	let showRawOutput = $state<Set<string>>(new Set());

	const runTests = async (target: 'backend' | 'frontend' | 'all') => {
		if (isRunning) return;
		isRunning = true;
		errorMessage = null;
		lastSuccess = null;
		lastResults = [];
		expandedResults.clear();
		expandedSuites.clear();
		showRawOutput.clear();

		try {
			const response = await apiFetch('/api/tests/run', {
				method: 'POST',
				body: { target }
			});
			lastResults = response.results || [];
			lastSuccess = Boolean(response.success);
		} catch (error) {
			errorMessage = (error as Error).message;
		} finally {
			isRunning = false;
		}
	};

	const toggleExpanded = (target: string) => {
		if (expandedResults.has(target)) {
			expandedResults.delete(target);
		} else {
			expandedResults.add(target);
		}
		expandedResults = expandedResults;
	};

	const toggleSuite = (suiteKey: string) => {
		if (expandedSuites.has(suiteKey)) {
			expandedSuites.delete(suiteKey);
		} else {
			expandedSuites.add(suiteKey);
		}
		expandedSuites = expandedSuites;
	};

	const toggleRawOutput = (target: string) => {
		if (showRawOutput.has(target)) {
			showRawOutput.delete(target);
		} else {
			showRawOutput.add(target);
		}
		showRawOutput = showRawOutput;
	};

	const copyOutput = async (output: string) => {
		try {
			await navigator.clipboard.writeText(output);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	};
</script>

<div class="w-full max-w-4xl">
	<TestRunnerHeader />

	<div class="rounded-2xl bg-theme-main border border-theme-border-light p-6 space-y-6">
		<TestRunnerActions isRunning={isRunning} onRun={runTests} />
		<TestRunnerStatus {errorMessage} {lastSuccess} />
		<TestRunnerResults
			results={lastResults}
			{expandedResults}
			{expandedSuites}
			{showRawOutput}
			onToggleExpanded={toggleExpanded}
			onToggleSuite={toggleSuite}
			onToggleRawOutput={toggleRawOutput}
			onCopyOutput={copyOutput}
		/>
	</div>
</div>
