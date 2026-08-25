#!/usr/bin/env node
/*
 * build-media-index.mjs — list the images that ship with the frontend.
 *
 * The API container does not carry the 260 MB of site imagery, but the media
 * library still has to offer those files to editors. This writes a manifest
 * the seed can read instead of walking the directory.
 *
 *   node tools/build-media-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const OUT = path.join(ROOT, 'content-source', 'media.bundled.json');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.pdf': 'application/pdf',
};

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const items = [];
for (const root of ['images', 'img']) {
  const dir = path.join(PUBLIC_DIR, root);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const rel = path.relative(PUBLIC_DIR, file).split(path.sep).join('/');
    const ext = path.extname(file).toLowerCase();
    items.push({
      filename: rel,
      originalName: path.basename(file),
      url: `/${rel}`,
      mime: MIME[ext] || 'application/octet-stream',
      size: fs.statSync(file).size,
      folder: path.dirname(rel),
    });
  }
}

items.sort((a, b) => a.filename.localeCompare(b.filename));
fs.writeFileSync(OUT, JSON.stringify(items, null, 2) + '\n');
console.log(`wrote ${items.length} bundled assets to content-source/media.bundled.json`);
