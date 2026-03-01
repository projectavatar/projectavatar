import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { writeFile, readdir } from 'node:fs/promises';
import type { Plugin } from 'vite';
const CLIPS_JSON_PATH = resolve(__dirname, '../web/src/data/clips.json');
/** Maximum request body size (1 MB). */
const MAX_BODY_BYTES = 1_048_576;
/**
 * Dev-only Vite plugin: POST /api/save-clips writes JSON directly to disk.
 *
 * ⚠️  NO AUTHENTICATION — this is a local dev tool. Do not expose to the
 * internet or run on a publicly accessible host without adding auth.
 * The endpoint is only registered in Vite's dev server (configureServer),
 * so it does not exist in production builds.
 */
function saveClipsPlugin(): Plugin {
  return {
    name: 'save-clips',
    configureServer(server) {
      // GET /api/scan-clips — list .fbx files in the animations folder
      server.middlewares.use('/api/scan-clips', async (_req, res) => {
        try {
          const animDir = resolve(__dirname, '../web/public/animations');
          const files = await readdir(animDir);
          const fbxFiles = files.filter(f => f.toLowerCase().endsWith('.fbx')).sort();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ files: fbxFiles }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

      // GET /api/scan-props — list .glb files in the props folder
      server.middlewares.use('/api/scan-props', async (_req, res) => {
        try {
          const propsDir = resolve(__dirname, '../web/public/props');
          const files = await readdir(propsDir).catch(() => [] as string[]);
          const glbFiles = files.filter(f => f.toLowerCase().endsWith('.glb')).sort();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ files: glbFiles }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });

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
        let totalBytes = 0;
        for await (const chunk of req) {
          totalBytes += (chunk as Buffer).length;
          if (totalBytes > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large (max 1 MB)' }));
            return;
          }
          chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
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
      '@data': resolve(__dirname, '../web/src/data'),
    },
  },
});
