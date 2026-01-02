import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig(({ mode }) => ({
	plugins: [
		svelte({
			hot: !mode || mode === 'test' ? false : true,
			emitCss: false,
			compilerOptions: {
				dev: false
			},
			onwarn: () => {}
		})
	],
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		}
	},
	server: {
		middlewareMode: false
	},
	test: {
		globals: true,
		environment: 'jsdom',
		include: ['src/**/__tests__/**/*.test.ts'],
		setupFiles: ['src/vitest.setup.ts']
	}
}));
