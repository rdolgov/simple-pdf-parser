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

- call Gemini/OpenAI directly from the client, or
- call your own backend proxy first and let that server forward upstream.

Supported proxy routes:

- `POST /api/llm/openai/responses`
- `POST /api/llm/openai/embeddings`
- `POST /api/llm/openai/images/generations`
- `POST /api/llm/gemini/v1beta/models/<model>:generateContent`
- `POST /api/llm/gemini/v1beta/models/<model>:batchEmbedContents`
- `POST /api/llm/gemini/v1beta/models/<model>:embedContent`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Route aliases also exist under `/proxy/api/...`, so the app can be opened at `/proxy` while still keeping the original `/api/...` endpoints available.

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
- `LLM_PROXY_CORS_ORIGIN` defaults to `*`
- `LLM_PROXY_CACHE_ENABLED` defaults to `true`
- `LLM_PROXY_CACHE_DIR` defaults to `.cache/llm-proxy`
- `LLM_PROXY_CACHE_TTL_MS` is optional; unset means entries do not expire automatically
- `LLM_PROXY_CACHE_MAX_BODY_BYTES` defaults to `20971520` (20 MB per cached response)
- `LLM_PROXY_APP_DIR` defaults to `testApp/dist` and is used when serving the built app under `/proxy`

The proxy server now auto-loads root-level `.env` and `.env.local` files on startup. Shell environment variables still win over file-loaded values.

The proxy now persists successful upstream responses on disk and reuses them when the same request is issued again. It first computes a SHA-256 digest of the POST body, then derives the final cache key from provider, upstream route, normalized query params, request headers relevant to content negotiation, and that body digest. Each proxied response also includes:

- `X-LLM-Proxy-Cache: HIT|MISS|BYPASS`
- `X-LLM-Proxy-Cache-Key: <sha256>`
- `X-LLM-Proxy-Body-Hash: <sha256>`
- `X-LLM-Proxy-Cached-At: <iso timestamp>` on cache hits

For manual refresh/debugging, send `X-LLM-Proxy-Cache: bypass` or append `?cache=bypass` to skip the local cache for one request.

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

- `/` keeps the existing direct-provider workflow. Users can supply their own OpenAI/Gemini keys in the browser and can still manually switch transport to the proxy if needed.
- `/proxy` forces proxy transport and uses cookie-backed login when `LLM_PROXY_USERS` is configured.

When the browser loads `/proxy`:

- the app automatically uses `/proxy/api/llm`
- direct transport selection is disabled
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

In the React app sidebar, root-route users can still switch `LLM Transport` to `Proxy server` and use `/api/llm` manually. On the `/proxy` route the app locks to proxy mode automatically.

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
