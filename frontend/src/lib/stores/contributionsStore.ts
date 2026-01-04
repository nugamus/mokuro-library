import { writable } from 'svelte/store';
import { apiFetch } from '$lib/services/api';

export interface ContributionCounts {
	behind: number;
	ahead: number;
}

function createContributionsStore() {
	const { subscribe, set, update } = writable<ContributionCounts>({
		behind: 0,
		ahead: 0
	});

	let inFlight: Promise<void> | null = null;
	let lastRefreshAt = 0;
	const MIN_REFRESH_INTERVAL = 15000;

	return {
		subscribe,
		set,
		update,
		setBehindCount: (count: number) =>
			update((state) => ({ ...state, behind: count })),
		setAheadCount: (count: number) =>
			update((state) => ({ ...state, ahead: count })),
		refresh: async (options?: { force?: boolean }) => {
			const now = Date.now();
			if (!options?.force) {
				if (inFlight) return inFlight;
				if (now - lastRefreshAt < MIN_REFRESH_INTERVAL) return;
			}

			inFlight = (async () => {
				try {
					const data = await apiFetch('/api/contributions/summary', {
						showErrorToast: false,
						cache: true,
						skipCache: options?.force ?? false
					});
					if (typeof data?.behind === 'number' && typeof data?.ahead === 'number') {
						set({ behind: data.behind, ahead: data.ahead });
					}
					lastRefreshAt = Date.now();
				} catch (error) {
					console.error('Failed to refresh contributions summary', error);
				} finally {
					inFlight = null;
				}
			})();

			return inFlight;
		}
	};
}

export const contributionsStore = createContributionsStore();
