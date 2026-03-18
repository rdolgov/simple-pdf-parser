import { useCallback, useEffect, useState } from 'react';
import { fetchProxySession, loginProxySession, logoutProxySession, type ProxySessionResponse } from '../utils/proxyAuthApi';

export type ProxyAuthSessionState = {
  status: 'disabled' | 'loading' | 'ready' | 'error';
  authEnabled: boolean;
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
  error: string | null;
};

type UseProxyAuthSessionResult = {
  state: ProxyAuthSessionState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useProxyAuthSession(enabled: boolean): UseProxyAuthSessionResult {
  const [state, setState] = useState<ProxyAuthSessionState>(() =>
    enabled
      ? {
          status: 'loading',
          authEnabled: false,
          authenticated: false,
          username: null,
          expiresAt: null,
          error: null
        }
      : {
          status: 'disabled',
          authEnabled: false,
          authenticated: false,
          username: null,
          expiresAt: null,
          error: null
        }
  );

  const applySession = useCallback((session: ProxySessionResponse) => {
    setState({
      status: 'ready',
      authEnabled: session.authEnabled,
      authenticated: session.authenticated,
      username: session.username,
      expiresAt: session.expiresAt,
      error: null
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setState({
        status: 'disabled',
        authEnabled: false,
        authenticated: false,
        username: null,
        expiresAt: null,
        error: null
      });
      return;
    }

    setState((current) => ({
      ...current,
      status: 'loading',
      error: null
    }));

    try {
      const session = await fetchProxySession();
      applySession(session);
    } catch (error) {
      setState({
        status: 'error',
        authEnabled: true,
        authenticated: false,
        username: null,
        expiresAt: null,
        error: error instanceof Error ? error.message : 'Failed to load proxy session.'
      });
    }
  }, [applySession, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const session = await loginProxySession(username, password);
    applySession(session);
  }, [applySession]);

  const logout = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const session = await logoutProxySession();
    applySession(session);
  }, [applySession, enabled]);

  return {
    state,
    login,
    logout,
    refresh
  };
}
