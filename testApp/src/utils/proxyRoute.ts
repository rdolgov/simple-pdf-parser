export const PROXY_APP_PATH_PREFIX = '/proxy';
export const ROOT_PROXY_API_BASE_URL = '/api/tasks';
export const ROOT_PROXY_AUTH_BASE_URL = '/api/auth';
export const PROXY_ROUTE_API_BASE_URL = '/proxy/api/tasks';
export const PROXY_ROUTE_AUTH_BASE_URL = '/proxy/api/auth';

export function isProxyAppRoute(pathname = getBrowserPathname()): boolean {
  return pathname === PROXY_APP_PATH_PREFIX || pathname.startsWith(`${PROXY_APP_PATH_PREFIX}/`);
}

export function getDefaultProxyApiBaseUrl(pathname = getBrowserPathname()): string {
  return isProxyAppRoute(pathname) ? PROXY_ROUTE_API_BASE_URL : ROOT_PROXY_API_BASE_URL;
}

export function getDefaultProxyAuthBaseUrl(pathname = getBrowserPathname()): string {
  return isProxyAppRoute(pathname) ? PROXY_ROUTE_AUTH_BASE_URL : ROOT_PROXY_AUTH_BASE_URL;
}

function getBrowserPathname(): string {
  if (typeof window === 'undefined') {
    return '/';
  }
  return window.location?.pathname ?? '/';
}
