import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'jsdom',
		include: ['src/**/__tests__/**/*.test.ts'],
		setupFiles: ['src/vitest.setup.ts']
	}
});
