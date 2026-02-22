import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'pdf-layout-parser': resolve(__dirname, '../src/index.ts'),
      '@viewer': resolve(__dirname, './src/viewer')
    }
  },
  assetsInclude: ['**/*.xlsx'],
  server: {
    port: 5174
  }
});
