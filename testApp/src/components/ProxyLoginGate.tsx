import { useState } from 'react';

interface ProxyLoginGateProps {
  error: string | null;
  isLoading: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onRetry: () => Promise<void>;
}

export function ProxyLoginGate({
  error,
  isLoading,
  onLogin,
  onRetry
}: ProxyLoginGateProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || isLoading) {
      return;
    }

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setLocalError('Username and password are required.');
      return;
    }

    setSubmitting(true);
    setLocalError(null);
    try {
      await onLogin(normalizedUsername, password);
      setPassword('');
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const visibleError = localError ?? error;

  return (
    <div className="proxy-login-shell">
      <div className="proxy-login-card">
        <div className="proxy-login-eyebrow">Proxy Access</div>
        <h1 className="proxy-login-title">Sign in to use the shared LLM proxy</h1>
        <p className="proxy-login-copy">
          This route uses server-managed provider credentials and cookie-backed sessions. Sign in once and the browser
          will reuse the session cookie on later visits.
        </p>
        <form className="proxy-login-form" onSubmit={handleSubmit}>
          <input
            type="text"
            autoComplete="username"
            value={username}
            placeholder="Username"
            onChange={(event) => setUsername(event.target.value)}
            disabled={submitting || isLoading}
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            placeholder="Password"
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting || isLoading}
          />
          {visibleError && <div className="proxy-login-error">{visibleError}</div>}
          <div className="proxy-login-actions">
            <button type="submit" disabled={submitting || isLoading}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="proxy-login-secondary"
              onClick={() => {
                setLocalError(null);
                void onRetry();
              }}
              disabled={submitting || isLoading}
            >
              {isLoading ? 'Checking…' : 'Retry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
