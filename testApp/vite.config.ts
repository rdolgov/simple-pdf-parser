import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { extname, resolve } from 'node:path';

function proxyRouteDevPlugin(): Plugin {
  return {
    name: 'proxy-route-dev-plugin',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const originalUrl = request.url ?? '/';
        const pathname = originalUrl.split('?')[0] ?? originalUrl;
        const search = originalUrl.slice(pathname.length);

        if (!(pathname === '/proxy' || pathname.startsWith('/proxy/'))) {
          next();
          return;
        }

        if (pathname.startsWith('/proxy/api/') || pathname.startsWith('/proxy/backoffice/')) {
          next();
          return;
        }

        request.url = extname(pathname)
          ? `${pathname.replace(/^\/proxy/, '') || '/'}${search}`
          : `/index.html${search}`;
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), proxyRouteDevPlugin()],
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
    port: 5174,
    proxy: {
      '/api/auth': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/api/backoffice': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/api/llm': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/backoffice': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/proxy/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      },
      '/proxy/backoffice': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  }
});
