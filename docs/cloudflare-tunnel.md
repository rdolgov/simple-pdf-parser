# Cloudflare Tunnel Deployment

Recommended topology:

- Build the React app once to `testApp/dist`.
- Run the existing Node proxy server as the only local origin on `127.0.0.1:8787`.
- Let Cloudflare Tunnel publish that single origin.
- Keep the public hostname pointed at `/`, which redirects to `/proxy`, so the browser stays on the proxy-gated route and all UI + LLM proxy traffic share one host.

Why this is the right fit here:

- The Node server already serves the built app under `/proxy` and already owns `/api/llm/*` and `/proxy/api/llm/*`.
- You avoid running Vite in production.
- You keep a single same-origin deployment for cookies, auth, and proxy calls.
- Binding the origin to `127.0.0.1` means nothing listens on a public interface; only `cloudflared` reaches it.

Recommended security posture:

- Put the hostname behind Cloudflare Tunnel: https://developers.cloudflare.com/tunnel/
- Publish the hostname to the local origin through a Tunnel public hostname: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/routing-to-tunnel/
- For anything beyond strictly personal use, add Cloudflare Access in front of the hostname as the edge auth layer.
- Also keep app-side proxy auth enabled with `LLM_PROXY_USERS` unless you intentionally want Cloudflare Access to be the only gate.

Build the origin bundle:

```bash
npm run cloudflare:origin:build
```

Start the origin locally:

```bash
PUBLIC_ORIGIN=https://discoverlab.app \
LLM_PROXY_USERS='alice:strong-password' \
GEMINI_API_KEY=... \
LLM_PROXY_GEMINI_MODEL=gemini-3-flash-preview \
OPENAI_API_KEY=... \
npm run cloudflare:origin:start
```

Important environment notes:

- `PUBLIC_ORIGIN` is used to set `LLM_PROXY_CORS_ORIGIN` if you do not set it explicitly.
- `LLM_PROXY_HOST` defaults to `127.0.0.1`.
- `LLM_PROXY_ROOT_REDIRECT_PATH` defaults to `/proxy`.
- `LLM_PROXY_SESSION_COOKIE_SECURE` defaults to `true` in the Cloudflare origin start script.
- `LLM_PROXY_GEMINI_MODEL` defaults to `gemini-3-flash-preview` and lets the proxy choose the Gemini text model server-side.
- `LLM_PROXY_GEMINI_BINARY_MODEL` is optional if you want a separate server-selected Gemini model for image/PDF inputs.
- Long-running proxied LLM requests now auto-switch to `202 + poll` under `/api/llm/jobs/...`, which avoids Cloudflare `524` timeouts without changing the browser-side app API.
- `CODEX_EXEC_ENABLED=1` still works in this deployment if you want Codex proxy support.

Expected public flow:

1. User visits `https://discoverlab.app/`
2. Origin redirects to `https://discoverlab.app/proxy`
3. The built app loads from the same origin
4. UI requests hit `/proxy/api/...` on the same host
5. The Node origin proxies upstream LLM calls

See the example tunnel config in [cloudflared-config.example.yml](/Users/rdolgov/code/simple-pdf-parser/docs/cloudflared-config.example.yml).
