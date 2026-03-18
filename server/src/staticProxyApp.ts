import { readFile } from 'node:fs/promises';
import { resolve, extname, join, normalize } from 'node:path';
import type { ServerResponse } from 'node:http';

export type StaticProxyAppConfig = {
  appDir: string;
  routePrefix: string;
};

export class StaticProxyApp {
  readonly appDir: string;

  constructor(private readonly config: StaticProxyAppConfig) {
    this.appDir = resolve(config.appDir);
  }

  async tryServe(pathname: string, response: ServerResponse): Promise<boolean> {
    const normalizedPathname = pathname.split('?')[0] ?? pathname;
    const candidatePath = this.resolvePublicPath(normalizedPathname);
    if (!candidatePath) {
      return false;
    }

    const file = await this.readCandidateFile(candidatePath);
    if (!file) {
      return false;
    }

    response.writeHead(200, {
      'Content-Type': getContentType(candidatePath),
      'Content-Length': String(file.length)
    });
    response.end(file);
    return true;
  }

  private resolvePublicPath(pathname: string): string | null {
    if (pathname === this.config.routePrefix || pathname === `${this.config.routePrefix}/`) {
      return join(this.appDir, 'index.html');
    }

    if (pathname.startsWith(`${this.config.routePrefix}/`)) {
      const relativeFromProxy = pathname.slice(this.config.routePrefix.length).replace(/^\/+/, '');
      if (!relativeFromProxy || !extname(relativeFromProxy)) {
        return join(this.appDir, 'index.html');
      }
      return this.resolveAppFile(relativeFromProxy);
    }

    const rootRelative = pathname.replace(/^\/+/, '');
    if (!rootRelative || !extname(rootRelative)) {
      return null;
    }
    return this.resolveAppFile(rootRelative);
  }

  private resolveAppFile(relativePath: string): string | null {
    const normalizedRelative = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const resolvedPath = resolve(this.appDir, normalizedRelative);
    if (!resolvedPath.startsWith(this.appDir)) {
      return null;
    }
    return resolvedPath;
  }

  private async readCandidateFile(filePath: string): Promise<Buffer | null> {
    try {
      return await readFile(filePath);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      return code === 'ENOENT' || code === 'ENOTDIR' ? null : Promise.reject(error);
    }
  }
}

function getContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}
