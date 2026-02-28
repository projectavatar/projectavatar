import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
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
