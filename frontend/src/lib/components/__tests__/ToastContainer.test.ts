import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ToastContainer from '../ToastContainer.svelte';
import { toastStore } from '$lib/stores/toastStore.svelte';

describe('ToastContainer', () => {
	it('renders a toast message', async () => {
		render(ToastContainer);
		toastStore.success('Saved', 0);

		expect(await screen.findByText('Saved')).toBeTruthy();
	});
});
