import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;
const upstream = process.env.TETHER_DEV_UPSTREAM;

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || '0.0.0.0',
    hmr: host ? { protocol: 'ws', host, port: 5183 } : undefined,
    proxy: upstream
      ? {
          '/oc-dev': {
            target: upstream,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/oc-dev/, '')
          }
        }
      : undefined
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
});
