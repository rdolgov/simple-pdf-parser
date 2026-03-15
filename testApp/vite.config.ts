import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        formulaCheck: resolve(__dirname, 'formula-check.html')
      }
    }
  },
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
