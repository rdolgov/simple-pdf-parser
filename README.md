# PDF Layout Parser

Lightweight TypeScript library for extracting text runs and basic layout metadata from PDF files without third-party parsing dependencies. The focus is on a modular architecture that can evolve toward full PDF specification coverage.

## Getting Started

```bash
npm install
npm run build
```

## Usage

```ts
import { readFileSync } from 'node:fs';
import { PDFDocument, CanvasRenderer } from 'pdf-layout-parser';

const bytes = readFileSync('invoice.pdf');
const document = PDFDocument.from(bytes);

for (const page of document.pages) {
  for (const item of page.textItems) {
    console.log(page.number, item.bounds.minX, item.bounds.minY, item.text);
  }
}

// Debug viewer (browser)
const canvas = document.getElementById('preview') as HTMLCanvasElement;
const renderer = new CanvasRenderer({ scale: 1.25 });
renderer.render(canvas, document, 1);
```

### Gemini API Helper

```ts
import { GeminiAPI } from 'pdf-layout-parser';

const gemini = new GeminiAPI({ apiKey: process.env.GEMINI_API_KEY ?? '', model: 'gemini-3-pro-image-preview' });
const result = await gemini.generateText('Explain how AI works in a few words');

console.log(result.text);

const imageResult = await gemini.generateImage(
  'Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme'
);

// imageResult.images[0].data contains the base64 payload for the rendered image
```

### Structured Extract (Gemini or OpenAI Provider)

```ts
import { StructuredExtractAPI } from 'pdf-layout-parser';
import { renderStructuredData } from './testApp/src/viewer/htmlStructuredDataRenderer';

const extractor = new StructuredExtractAPI({
  provider: 'gemini', // or 'openai'
  apiKey: process.env.GEMINI_API_KEY ?? '',
  model: 'gemini-3-pro-preview'
});

const pdfFile = new File([bytes], 'document.pdf');
const { document, assetMap } = await extractor.extractStructuredData(pdfFile);

renderStructuredData(container, document, { assetMap });
```

## Development

- `npm run build` – install deps and build both the library and `testApp`.
- `npm run build:lib` – compile TypeScript library to `dist/`.
- `npm run build:server` – compile the optional Node LLM proxy to `dist-server/`.
- `npm run start:server` – build and run the proxy server on `http://localhost:8787`.
- `npm test` – execute the Vitest suite.
- `npm run lint` – run type-checking.

### Optional LLM Proxy Backend

This repo now includes a separate TypeScript backend under [server/src/index.ts](/Users/rdolgov/code/simple-pdf-parser/server/src/index.ts). It is meant to sit between the browser UI and upstream LLM providers so the app can either:

- use task-oriented backend routes for all UI AI features, and
- optionally expose provider-specific passthrough proxy routes for debugging or external tooling.

The web app now talks to functionality-based task routes instead of provider/model-specific URLs. The main task routes are:

- `POST /api/tasks/documents` to upload a PDF, persist it server-side, and start backend detection
- `GET /api/tasks/documents/<documentId>` to poll for detection status/result
- `POST /api/tasks/ask-question`
- `POST /api/tasks/generate-widget`
- `POST /api/tasks/analyze-formula`
- `POST /api/tasks/logical-structure`
- `POST /api/tasks/analyze-relevance`
- `POST /api/tasks/analyze-image`
- `POST /api/tasks/generate-image`
- `POST /api/tasks/generate-table-infographic`
- `POST /api/tasks/build-semantic-index`
- `POST /api/tasks/search-semantic`

Route aliases also exist under `/proxy/api/tasks/...`, so the app can be opened at `/proxy` while still keeping the same backend task API contract.

The backend keeps per-user/per-file state under `LLM_PROXY_TASKS_DIR`, including:

- uploaded PDF bytes
- structured detection results
- semantic index caches
- interaction logs for user/document/task activity

Provider-specific passthrough proxy routes are still available on the server when you need raw upstream access:

- `POST /api/llm/openai/responses`
- `POST /api/llm/openai/embeddings`
- `POST /api/llm/openai/images/generations`
- `POST /api/llm/gemini/v1beta/models/<model>:generateContent`
- `POST /api/llm/gemini/v1beta/models/<model>:batchEmbedContents`
- `POST /api/llm/gemini/v1beta/models/<model>:embedContent`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Server environment variables:

- `PORT` defaults to `8787`
- `LLM_PROXY_AUTH_TOKEN` is optional shared auth checked against `Authorization: Bearer ...` or Gemini `?key=...`
- `LLM_PROXY_USERS` is optional predefined cookie-login users in `username:password,username:password` format
- `LLM_PROXY_SESSION_COOKIE_NAME` defaults to `llm_proxy_session`
- `LLM_PROXY_SESSION_TTL_MS` defaults to `2592000000` (30 days)
- `LLM_PROXY_SESSION_COOKIE_SECURE` defaults to `false`
- `OPENAI_API_KEY` configures the upstream OpenAI key used by the proxy
- `OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`
- `GEMINI_API_KEY` configures the upstream Gemini key used by the proxy
- `GEMINI_BASE_URL` defaults to `https://generativelanguage.googleapis.com`
- `LLM_PROXY_GEMINI_MODEL` defaults to `gemini-3-flash-preview` and is the server-selected Gemini `generateContent` text model
- `LLM_PROXY_GEMINI_BINARY_MODEL` is optional and, when set, overrides Gemini `generateContent` requests that contain inline binary inputs such as images or PDFs
- `LLM_PROXY_GEMINI_ANALYTICS_DIR` defaults to `.cache/llm-proxy-analytics`
- `LLM_PROXY_GEMINI_ANALYTICS_RETENTION_DAYS` defaults to `14`
- `LLM_PROXY_GEMINI_DAILY_MAX_CALLS` defaults to `1000`
- `LLM_PROXY_GEMINI_DAILY_MAX_TOKENS` defaults to `1000000`
- `/proxy/backoffice/gemini-analytics` is a server-rendered Gemini usage backoffice restricted to a hardcoded username allowlist
- `LLM_PROXY_CORS_ORIGIN` defaults to `*`
- `LLM_PROXY_CACHE_ENABLED` defaults to `true`
- `LLM_PROXY_CACHE_DIR` defaults to `.cache/llm-proxy`
- `LLM_PROXY_CACHE_TTL_MS` is optional; unset means entries do not expire automatically
- `LLM_PROXY_CACHE_MAX_BODY_BYTES` defaults to `20971520` (20 MB per cached response)
- `LLM_PROXY_ASYNC_POLL_INTERVAL_MS` defaults to `1500` and controls client polling hints for long-running proxied LLM jobs
- `LLM_PROXY_ASYNC_JOB_TTL_MS` defaults to `3600000` (1 hour) and controls how long completed async job results stay available for polling
- `LLM_PROXY_ASYNC_MAX_JOBS` defaults to `100`
- `LLM_PROXY_TASKS_DIR` defaults to `.cache/llm-proxy-tasks` and stores uploaded files, detection results, semantic indexes, and interaction logs for the task API
- `LLM_PROXY_APP_DIR` defaults to `testApp/dist` and is used when serving the built app under `/proxy`

The proxy server now auto-loads root-level `.env` and `.env.local` files on startup. Shell environment variables still win over file-loaded values.

The provider passthrough proxy persists successful upstream responses on disk and reuses them when the same request is issued again. It first computes a SHA-256 digest of the POST body, then derives the final cache key from provider, upstream route, normalized query params, request headers relevant to content negotiation, and that body digest. Each proxied response also includes:

- `X-LLM-Proxy-Cache: HIT|MISS|BYPASS`
- `X-LLM-Proxy-Cache-Key: <sha256>`
- `X-LLM-Proxy-Body-Hash: <sha256>`
- `X-LLM-Proxy-Cached-At: <iso timestamp>` on cache hits

For manual refresh/debugging, send `X-LLM-Proxy-Cache: bypass` or append `?cache=bypass` to skip the local cache for one request.

When the browser app uses the task API, startup document detection is:

- `POST /api/tasks/documents`
- if detection is still running, the response includes a `document.id`
- the client polls `GET /api/tasks/documents/<documentId>` until `detection.status === ready`

Long-running task and passthrough requests also switch to async job polling automatically:

- initial `POST` returns `202 Accepted`
- the response includes a poll URL under `/api/tasks/jobs/<id>` or `/proxy/api/tasks/jobs/<id>` for task requests
- passthrough provider routes continue to use `/api/llm/jobs/<id>` or `/proxy/api/llm/jobs/<id>`
- the client polls that URL until the final upstream payload is ready

This avoids Cloudflare `524` timeouts for long public requests while keeping the browser-side task API stable.

Example:

```bash
OPENAI_API_KEY=... \
GEMINI_API_KEY=... \
LLM_PROXY_USERS='alice:secret,bob:password' \
LLM_PROXY_AUTH_TOKEN=dev-shared-token \
npm run start:server
```

### `/proxy` Login Route

The app now supports two top-level access patterns:

- `/` serves the same app and uses the backend task API at `/api/tasks`.
- `/proxy` serves the same app behind the proxy-gated route and uses cookie-backed login when `LLM_PROXY_USERS` is configured.

When the browser loads `/proxy`:

- the app automatically uses `/proxy/api/tasks`
- the user is prompted to sign in once
- the server sets an `HttpOnly` session cookie so later visits do not require logging in again until the cookie expires or the user signs out

For local development with Vite:

- open the normal app at `http://localhost:5174/`
- open the proxy-gated app at `http://localhost:5174/proxy`
- Vite proxies both `/api/...` and `/proxy/api/...` to the Node backend

For production:

- build the React app with `npm --prefix testApp run build`
- start the Node proxy server
- the Node server will serve the built app at `/proxy` from `testApp/dist` by default

### Cloudflare Tunnel Deployment

For a public deployment with one local origin for both UI and proxy APIs, use the built Node proxy server behind Cloudflare Tunnel.

- build: `npm run cloudflare:origin:build`
- run locally on `127.0.0.1`: `PUBLIC_ORIGIN=https://discoverlab.app npm run cloudflare:origin:start`
- publish that localhost origin with `cloudflared`

Files:

- setup guide: [docs/cloudflare-tunnel.md](/Users/rdolgov/code/simple-pdf-parser/docs/cloudflare-tunnel.md)
- example tunnel config: [docs/cloudflared-config.example.yml](/Users/rdolgov/code/simple-pdf-parser/docs/cloudflared-config.example.yml)

The current app is proxy-only for AI features. The browser no longer instantiates provider SDK clients directly.

### Debug Web App

`testApp/` hosts a minimal React playground for manual inspection.

```bash
cd testApp
npm install
npm run dev
```

Upload a PDF and the viewer will render the currently selected page via `CanvasRenderer`.
Use the tabs to switch between the canvas overlay and the raw `PDFDocument` JSON payload.

### Publish Demo to GitHub Pages

This repo can publish the `testApp` bundle to GitHub Pages (for example `https://rdolgov.github.io/simple-pdf-parser/`).

Build the GitHub Pages bundle:

```bash
npm run pages:build
```

This command:
- installs root and `testApp` dependencies
- builds the library
- builds `testApp` with the correct GitHub Pages base path
- writes the static site to `testApp/dist`

Publish to the `gh-pages` branch (scripted):

```bash
npm run pages:publish
```

Notes:
- The publish script uses `npx gh-pages` and pushes `testApp/dist` to branch `gh-pages`.
- The base path is inferred from `origin` repo name (e.g. `/simple-pdf-parser/`).
- Override base path if needed:

```bash
GITHUB_PAGES_BASE=/ npm run pages:build
```

GitHub settings (one-time):
1. Create the repo on GitHub (private or public).
2. Push your code to `main`.
3. Run `npm run pages:publish` to create/update `gh-pages`.
4. In GitHub repo Settings -> Pages:
5. Source: `Deploy from a branch`
6. Branch: `gh-pages` and folder `/ (root)`

After that, GitHub Pages will serve the demo from:
- `https://<username>.github.io/<repo-name>/`

The current implementation resolves objects via the cross-reference table, decodes `/FlateDecode` streams, walks ancestor resource dictionaries, and applies `/ToUnicode` CMaps so Latin text survives custom fonts. The debugging `CanvasRenderer` module uses the HTML Canvas 2D API to visualize text runs and baselines so contributors can quickly validate positions. Additional parsing stages—extra filters, DecodeParms, graphics state tracking—can be layered in as the project grows.
