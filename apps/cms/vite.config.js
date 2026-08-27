import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// Served from /admin/ behind the gateway, so the base path has to match or
// every hashed asset 404s in production while working fine in dev.
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      // In dev each service runs on its own port; in production the gateway
      // does this. The three prefixes are everything the admin asks another
      // origin for, so without them the library, the uploads and the API all
      // 404 in development while working fine once deployed.
      '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
      '/media': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
      /*
       * Everything else is the site.
       *
       * Behind the gateway one origin serves the admin, the API and the pages,
       * which is why every "View" link in the CMS is a plain relative path. In
       * development the admin is its own dev server, so those links used to land
       * on the admin's own 404 and the header's "View site" button did nothing.
       * Standing in for the gateway here keeps the two environments honest —
       * `/admin/*` and Vite's own module URLs stay local, the rest is proxied.
       */
      '^/(?!admin/|@|__|node_modules/|src/).*': {
        target: process.env.WEB_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * Keep the dependencies in their own chunk.
         *
         * React and the Radix primitives change on a release cadence; the admin
         * changes daily. Splitting them means a deploy invalidates the app chunk
         * and leaves the ~150 kB of vendor code in the editor's cache, which is
         * the difference between a fast reload and a full one every afternoon.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router')) return 'router';
          if (id.includes('/react') || id.includes('/scheduler')) return 'react';
          if (id.includes('@radix-ui') || id.includes('lucide-react')) return 'ui';
          return 'vendor';
        },
      },
    },
  },
});
