import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };

env.NODE_ENV = env.NODE_ENV ?? 'production';
env.LLM_PROXY_HOST = env.LLM_PROXY_HOST ?? '127.0.0.1';
env.LLM_PROXY_APP_DIR = resolveAppDir(env.LLM_PROXY_APP_DIR);
env.LLM_PROXY_ROOT_REDIRECT_PATH = env.LLM_PROXY_ROOT_REDIRECT_PATH ?? '/proxy';
env.LLM_PROXY_SESSION_COOKIE_SECURE = env.LLM_PROXY_SESSION_COOKIE_SECURE ?? 'true';

if (!env.LLM_PROXY_CORS_ORIGIN) {
  const publicOrigin = env.PUBLIC_ORIGIN?.trim();
  if (!publicOrigin) {
    console.error('[cloudflare-origin] Set PUBLIC_ORIGIN=https://discoverlab.app or LLM_PROXY_CORS_ORIGIN before starting.');
    process.exit(1);
  }
  env.LLM_PROXY_CORS_ORIGIN = publicOrigin;
}

if (!env.LLM_PROXY_USERS && !env.LLM_PROXY_AUTH_TOKEN) {
  console.warn(
    '[cloudflare-origin] Warning: no LLM proxy auth is configured. Protect the hostname with Cloudflare Access or set LLM_PROXY_USERS/LLM_PROXY_AUTH_TOKEN.'
  );
}

const child = spawn(process.execPath, ['dist-server/index.js'], {
  stdio: 'inherit',
  env,
  cwd: repoRoot
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('[cloudflare-origin] Failed to start origin server', error);
  process.exit(1);
});

function resolveAppDir(value) {
  const configured = value?.trim();
  if (!configured) {
    return resolve(repoRoot, 'testApp/dist');
  }
  return isAbsolute(configured) ? configured : resolve(repoRoot, configured);
}
