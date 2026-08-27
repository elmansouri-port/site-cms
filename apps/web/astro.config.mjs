import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

/**
 * Server-rendered on every request (reco.md 6): A/B variants are assigned per
 * visitor and the `?version=` entry points are per request, so nothing above
 * the fold can be baked at build time. Freshness comes from the Redis cache in
 * front of MongoDB, not from static output.
 */
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: process.env.SITE_URL || 'http://localhost:3000',
  trailingSlash: 'ignore',
  compressHTML: false, // the authored markup ships exactly as written
  build: {
    format: 'directory',
  },
  server: {
    port: Number(process.env.PORT || 3000),
    host: true,
  },
  vite: {
    ssr: {
      // The shared render core is plain ESM; let Vite bundle it with the app.
      noExternal: ['@rainbow/core'],
    },
    server: {
      /*
       * Development only. In production the nginx gateway routes these two
       * prefixes to the API before Astro sees them; without the same routing in
       * dev, every form on the site posts into a 404 and every uploaded image
       * is broken — a difference between environments that costs an afternoon
       * the first time somebody hits it.
       */
      proxy: {
        '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
        '/media': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true },
      },
    },
  },
});
