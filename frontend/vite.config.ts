import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// 1. Get the proxy target from an environment variable
//    If it's not set, default to 'http://localhost:3001' for local dev
const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:3001';
export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
  ],
  server: {
    allowedHosts: ["homemachine"],
    proxy: {
      // 2. Proxy all requests starting with /api
      '/api': {
        // 3. Target backend server
        target: proxyTarget,
        // 4. Change origin to match target (for cookie/CORS)
        changeOrigin: true,
      },
    },
  },
});
