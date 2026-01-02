import { writable } from 'svelte/store';
import { apiFetch } from '$lib/api';

export interface ContributionCounts {
	behind: number;
	ahead: number;
}

function createContributionsStore() {
	const { subscribe, set, update } = writable<ContributionCounts>({
		behind: 0,
		ahead: 0
	});

	return {
		subscribe,
		set,
		update,
		setBehindCount: (count: number) =>
			update((state) => ({ ...state, behind: count })),
		setAheadCount: (count: number) =>
			update((state) => ({ ...state, ahead: count })),
		refresh: async () => {
			try {
				const data = await apiFetch('/api/contributions/summary', { showErrorToast: false });
				if (typeof data?.behind === 'number' && typeof data?.ahead === 'number') {
					set({ behind: data.behind, ahead: data.ahead });
				}
			} catch (error) {
				console.error('Failed to refresh contributions summary', error);
			}
		}
	};
}

export const contributionsStore = createContributionsStore();
