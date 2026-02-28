import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

const CLIPS_JSON_PATH = resolve(__dirname, '../web/src/data/clips.json');

/**
 * Dev-only Vite plugin: POST /api/save-clips writes JSON directly to disk.
 * No file picker dialogs, no File System Access API — just save.
 */
function saveClipsPlugin(): Plugin {
  return {
    name: 'save-clips',
    configureServer(server) {
      server.middlewares.use('/api/save-clips', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'POST only' }));
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks).toString('utf-8');

        try {
          // Validate JSON before writing
          const parsed = JSON.parse(body);
          const formatted = JSON.stringify(parsed, null, 2) + '\n';
          await writeFile(CLIPS_JSON_PATH, formatted, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: CLIPS_JSON_PATH }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveClipsPlugin()],
  publicDir: resolve(__dirname, '../web/public'),
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5174,
    allowedHosts: ['avatar-config.wtch.ing'],
    fs: {
      allow: [
        resolve(__dirname, '..'),
      ],
    },
  },
  resolve: {
    alias: {
      '@avatar': resolve(__dirname, '../web/src/avatar'),
      '@data': resolve(__dirname, '../web/src/data'),
    },
  },
});
