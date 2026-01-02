<script lang="ts">
	import { apiFetch } from '$lib/api';
	import { fade, fly, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	type TestCase = {
		name: string;
		status: 'pass' | 'fail' | 'skip';
		duration?: number;
		error?: string;
	};

	type TestSuite = {
		name: string;
		tests: TestCase[];
		passed: number;
		failed: number;
		skipped: number;
		total: number;
	};

	type TestResult = {
		target: 'backend' | 'frontend';
		code: number;
		durationMs: number;
		output: string;
		suites?: TestSuite[];
		summary?: {
			totalTests: number;
			passed: number;
			failed: number;
			skipped: number;
		};
	};

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
	<div class="mb-8">
		<div class="flex items-center gap-3 mb-2">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="32"
				height="32"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="text-accent"
			>
				<path d="M10 2h4v2h-1v4.6l5.7 9.9a2 2 0 0 1-1.7 3H7a2 2 0 0 1-1.7-3L11 8.6V4h-1V2z" />
			</svg>
			<h1 class="text-3xl font-bold text-theme-primary">Test Runner</h1>
		</div>
		<p class="text-base text-theme-secondary">
			Run the backend and frontend test suites from the app.
		</p>
	</div>

	<div class="rounded-2xl bg-theme-main border border-theme-border-light p-6 space-y-6">
		<!-- Action Buttons -->
		<div class="flex flex-wrap items-center gap-3">
			<button
				onclick={() => runTests('backend')}
				disabled={isRunning}
				class="group relative px-5 py-2.5 rounded-xl text-sm font-semibold bg-theme-surface hover:bg-theme-surface-hover text-theme-primary border-2 border-theme-border-light hover:border-accent/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
			>
				<span class="relative z-10 flex items-center gap-2">
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
					>
						<path d="M4 17l6-6-6-6M12 19h8" />
					</svg>
					Backend
				</span>
				<div
					class="absolute inset-0 bg-gradient-to-r from-accent/0 via-accent/10 to-accent/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"
				></div>
			</button>
			<button
				onclick={() => runTests('frontend')}
				disabled={isRunning}
				class="group relative px-5 py-2.5 rounded-xl text-sm font-semibold bg-theme-surface hover:bg-theme-surface-hover text-theme-primary border-2 border-theme-border-light hover:border-accent/50 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
			>
				<span class="relative z-10 flex items-center gap-2">
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
					>
						<polyline points="16 18 22 12 16 6" />
						<polyline points="8 6 2 12 8 18" />
					</svg>
					Frontend
				</span>
				<div
					class="absolute inset-0 bg-gradient-to-r from-accent/0 via-accent/10 to-accent/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"
				></div>
			</button>
			<button
				onclick={() => runTests('all')}
				disabled={isRunning}
				class="group relative px-6 py-2.5 rounded-xl text-sm font-semibold bg-accent text-white hover:bg-accent/90 border-2 border-accent hover:border-accent/80 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent/20 hover:shadow-xl hover:shadow-accent/30 overflow-hidden"
			>
				<span class="relative z-10 flex items-center gap-2">
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
						class="group-hover:rotate-12 transition-transform duration-300"
					>
						<path d="M5 12l5 5L20 7" />
					</svg>
					Run All Tests
				</span>
				<div
					class="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"
				></div>
			</button>
			{#if isRunning}
				<div
					class="flex items-center gap-2 text-accent font-medium"
					in:fly={{ x: -10, duration: 300, easing: quintOut }}
					out:fade={{ duration: 200 }}
				>
					<svg
						class="animate-spin"
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M21 12a9 9 0 1 1-6.219-8.56" />
					</svg>
					<span class="text-sm">Running tests...</span>
				</div>
			{/if}
		</div>

		<!-- Error Message -->
		{#if errorMessage}
			<div
				class="rounded-xl border-2 border-status-danger/40 bg-status-danger/10 px-4 py-3 text-sm text-status-danger flex items-start gap-3"
				in:fly={{ y: -10, duration: 300, easing: quintOut }}
				out:fade={{ duration: 200 }}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="flex-shrink-0 mt-0.5"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				<span>{errorMessage}</span>
			</div>
		{/if}

		<!-- Success/Failure Summary -->
		{#if lastSuccess !== null}
			<div
				class="rounded-xl border-2 px-5 py-3 text-sm font-semibold flex items-center gap-3 {lastSuccess
					? 'border-status-success/40 bg-status-success/10 text-status-success'
					: 'border-status-danger/40 bg-status-danger/10 text-status-danger'}"
				in:scale={{ start: 0.95, duration: 400, easing: quintOut }}
				out:fade={{ duration: 200 }}
			>
				{#if lastSuccess}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="flex-shrink-0"
					>
						<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
						<polyline points="22 4 12 14.01 9 11.01" />
					</svg>
					<span>All tests passed!</span>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="flex-shrink-0"
					>
						<circle cx="12" cy="12" r="10" />
						<line x1="15" y1="9" x2="9" y2="15" />
						<line x1="9" y1="9" x2="15" y2="15" />
					</svg>
					<span>Some tests failed.</span>
				{/if}
			</div>
		{/if}

		<!-- Test Results -->
		{#if lastResults.length > 0}
			<div class="space-y-4">
				{#each lastResults as result, i}
					{@const isExpanded = expandedResults.has(result.target)}
					{@const isPassed = result.code === 0}
					{@const showRaw = showRawOutput.has(result.target)}
					<div
						class="group rounded-xl border-2 border-theme-border-light bg-theme-surface/60 hover:bg-theme-surface transition-all duration-300 overflow-hidden {isPassed
							? 'hover:border-status-success/30'
							: 'hover:border-status-danger/30'}"
						in:fly={{ y: 20, duration: 300, delay: i * 100, easing: quintOut }}
					>
						<button
							onclick={() => toggleExpanded(result.target)}
							class="w-full px-5 py-4 flex items-center justify-between text-left transition-colors duration-200"
						>
							<div class="flex items-center gap-4 flex-1">
								<div
									class="w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300 {isPassed
										? 'bg-status-success/10 text-status-success group-hover:bg-status-success/20'
										: 'bg-status-danger/10 text-status-danger group-hover:bg-status-danger/20'}"
								>
									{#if isPassed}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<polyline points="20 6 9 17 4 12" />
										</svg>
									{:else}
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<line x1="18" y1="6" x2="6" y2="18" />
											<line x1="6" y1="6" x2="18" y2="18" />
										</svg>
									{/if}
								</div>
								<div class="flex-1">
									<div class="flex items-center gap-3 flex-wrap">
										<h3 class="text-base font-bold text-theme-primary">
											{result.target.toUpperCase()}
										</h3>
										<span
											class="px-2 py-0.5 rounded-full text-xs font-semibold {isPassed
												? 'bg-status-success/20 text-status-success'
												: 'bg-status-danger/20 text-status-danger'}"
										>
											{isPassed ? 'PASS' : 'FAIL'}
										</span>
										{#if result.summary}
											<div class="flex items-center gap-2 text-xs font-medium">
												<span class="text-status-success">{result.summary.passed} passed</span>
												{#if result.summary.failed > 0}
													<span class="text-status-danger">{result.summary.failed} failed</span>
												{/if}
												{#if result.summary.skipped > 0}
													<span class="text-theme-tertiary">{result.summary.skipped} skipped</span>
												{/if}
											</div>
										{/if}
									</div>
									<div class="flex items-center gap-4 mt-1 text-xs text-theme-tertiary font-medium">
										<span class="flex items-center gap-1">
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<circle cx="12" cy="12" r="10" />
												<polyline points="12 6 12 12 16 14" />
											</svg>
											{(result.durationMs / 1000).toFixed(1)}s
										</span>
										<span>Exit code: {result.code}</span>
										{#if result.suites}
											<span>{result.suites.length} test files</span>
										{/if}
									</div>
								</div>
							</div>
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
								class="text-theme-tertiary transition-transform duration-300 {isExpanded
									? 'rotate-180'
									: ''}"
							>
								<polyline points="6 9 12 15 18 9" />
							</svg>
						</button>

						{#if isExpanded}
							<div
								class="border-t border-theme-border-light bg-theme-main/50"
								in:fly={{ y: -10, duration: 300, easing: quintOut }}
								out:fade={{ duration: 200 }}
							>
								<!-- Test Suite Results -->
								{#if result.suites && result.suites.length > 0}
									<div class="p-5 space-y-3">
										{#each result.suites as suite, suiteIdx}
											{@const suiteKey = `${result.target}-${suiteIdx}`}
											{@const isSuiteExpanded = expandedSuites.has(suiteKey)}
											{@const suitePassed = suite.failed === 0}
											<div
												class="rounded-lg border border-theme-border-light bg-theme-surface/40 overflow-hidden"
												in:fly={{ y: 10, duration: 200, delay: suiteIdx * 50, easing: quintOut }}
											>
												<button
													onclick={() => toggleSuite(suiteKey)}
													class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-theme-surface transition-colors"
												>
													<div class="flex items-center gap-3 flex-1">
														<div
															class="w-8 h-8 rounded flex items-center justify-center {suitePassed
																? 'bg-status-success/10 text-status-success'
																: 'bg-status-danger/10 text-status-danger'}"
														>
															{#if suitePassed}
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
																>
																	<polyline points="20 6 9 17 4 12" />
																</svg>
															{:else}
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
																>
																	<line x1="18" y1="6" x2="6" y2="18" />
																	<line x1="6" y1="6" x2="18" y2="18" />
																</svg>
															{/if}
														</div>
														<div class="flex-1">
															<div class="text-sm font-semibold text-theme-primary font-mono">
																{suite.name}
															</div>
															<div class="flex items-center gap-3 mt-0.5 text-xs font-medium">
																<span class="text-status-success">{suite.passed}/{suite.total}</span>
																{#if suite.failed > 0}
																	<span class="text-status-danger">{suite.failed} failed</span>
																{/if}
																{#if suite.skipped > 0}
																	<span class="text-theme-tertiary">{suite.skipped} skipped</span>
																{/if}
															</div>
														</div>
													</div>
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
														class="text-theme-tertiary transition-transform duration-300 {isSuiteExpanded
															? 'rotate-180'
															: ''}"
													>
														<polyline points="6 9 12 15 18 9" />
													</svg>
												</button>

												{#if isSuiteExpanded && suite.tests.length > 0}
													<div
														class="border-t border-theme-border-light px-4 py-3 space-y-2"
														in:fly={{ y: -5, duration: 200, easing: quintOut }}
													>
														{#each suite.tests as test, testIdx}
															<div
																class="flex items-center justify-between py-2 px-3 rounded bg-theme-main/50"
																in:fly={{ x: -5, duration: 150, delay: testIdx * 30, easing: quintOut }}
															>
																<div class="flex items-center gap-2 flex-1">
																	{#if test.status === 'pass'}
																		<svg
																			xmlns="http://www.w3.org/2000/svg"
																			width="14"
																			height="14"
																			viewBox="0 0 24 24"
																			fill="none"
																			stroke="currentColor"
																			stroke-width="2.5"
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			class="text-status-success flex-shrink-0"
																		>
																			<polyline points="20 6 9 17 4 12" />
																		</svg>
																	{:else if test.status === 'fail'}
																		<svg
																			xmlns="http://www.w3.org/2000/svg"
																			width="14"
																			height="14"
																			viewBox="0 0 24 24"
																			fill="none"
																			stroke="currentColor"
																			stroke-width="2.5"
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			class="text-status-danger flex-shrink-0"
																		>
																			<line x1="18" y1="6" x2="6" y2="18" />
																			<line x1="6" y1="6" x2="18" y2="18" />
																		</svg>
																	{:else}
																		<svg
																			xmlns="http://www.w3.org/2000/svg"
																			width="14"
																			height="14"
																			viewBox="0 0 24 24"
																			fill="none"
																			stroke="currentColor"
																			stroke-width="2"
																			stroke-linecap="round"
																			stroke-linejoin="round"
																			class="text-theme-tertiary flex-shrink-0"
																		>
																			<circle cx="12" cy="12" r="10" />
																			<line x1="8" y1="12" x2="16" y2="12" />
																		</svg>
																	{/if}
																	<span class="text-xs text-theme-primary font-medium">{test.name}</span>
																</div>
																{#if test.duration}
																	<span class="text-xs text-theme-tertiary">{test.duration}ms</span>
																{/if}
															</div>
														{/each}
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}

								<!-- Raw Output Section (Always Visible) -->
								<div class="px-5 py-4 border-t border-theme-border-light space-y-3">
									<div class="flex items-center justify-between gap-3 flex-wrap">
										<div class="flex items-center gap-2 text-xs font-bold text-theme-primary">
											<svg
												xmlns="http://www.w3.org/2000/svg"
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												class="text-accent"
											>
												<path d="M4 17l6-6-6-6M12 19h8" />
											</svg>
											Test Output
										</div>
										<div class="flex items-center gap-2">
											{#if result.suites && result.suites.length > 0}
												<button
													onclick={() => toggleRawOutput(result.target)}
													class="px-3 py-1.5 text-xs font-semibold rounded-lg border-2 transition-all {showRaw
														? 'border-accent/50 bg-accent/10 text-accent'
														: 'border-theme-border-light text-theme-secondary hover:text-theme-primary hover:border-accent/50'}"
												>
													{showRaw ? 'Show Structured' : 'Show Raw'}
												</button>
											{/if}
											<button
												onclick={() => copyOutput(result.output)}
												class="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border-2 border-theme-border-light text-theme-secondary hover:text-theme-primary hover:border-accent/50 transition-all"
											>
												<svg
													xmlns="http://www.w3.org/2000/svg"
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													stroke-linecap="round"
													stroke-linejoin="round"
												>
													<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
													<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
												</svg>
												Copy Output
											</button>
										</div>
									</div>
									<pre
										class="max-h-96 overflow-auto rounded-lg bg-theme-main border border-theme-border px-4 py-3 text-xs text-theme-secondary whitespace-pre-wrap font-mono leading-relaxed"
									>{result.output || 'No output.'}</pre>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.animate-spin {
		animation: spin 1s linear infinite;
	}
</style>
