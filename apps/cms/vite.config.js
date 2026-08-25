import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from /admin/ behind the gateway, so the base path has to match or
// every hashed asset 404s in production while working fine in dev.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev the API runs on its own port; in production the gateway does this.
      '/api': {
        target: process.env.API_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
      '/media': {
        target: process.env.API_URL || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
