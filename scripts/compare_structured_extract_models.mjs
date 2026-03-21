#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const { StructuredExtractAPI } = await import(resolve(repoRoot, 'dist/index.js'));
const { loadLocalEnvFiles } = await import(resolve(repoRoot, 'dist-server/loadLocalEnv.js'));

loadLocalEnvFiles(repoRoot);

const DEFAULT_MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview'
];
const DEFAULT_PDF = 'pdfs/NIPS-2017-attention-is-all-you-need-Paper.pdf';
const DEFAULT_OUTPUT_ROOT = '.artifacts/structured-extract-comparisons';
const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

const args = parseArgs(process.argv.slice(2));
const pdfPath = resolve(repoRoot, args.pdf ?? DEFAULT_PDF);
const outputDir = resolve(
  repoRoot,
  args.outputDir ?? join(DEFAULT_OUTPUT_ROOT, `${timestampSlug()}-${basename(pdfPath, '.pdf')}`)
);
const models = args.models.length > 0 ? args.models : DEFAULT_MODELS;

await mkdir(outputDir, { recursive: true });

const pdfBytes = await readFile(pdfPath);
const comparisons = [];

for (let index = 0; index < models.length; index += 1) {
  const model = models[index];
  const safeModel = sanitizeFilename(model);
  const modelDir = join(outputDir, safeModel);
  await mkdir(modelDir, { recursive: true });

  const port = await findOpenPort();
  const authToken = `structured-compare-${Date.now()}-${index}`;
  const logPath = join(modelDir, 'proxy.log');
  const server = spawn('node', ['dist-server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      LLM_PROXY_HOST: '127.0.0.1',
      LLM_PROXY_AUTH_TOKEN: authToken,
      LLM_PROXY_USERS: '',
      LLM_PROXY_CACHE_ENABLED: 'false',
      LLM_PROXY_GEMINI_MODEL: model,
      LLM_PROXY_GEMINI_BINARY_MODEL: model
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logChunks = [];
  server.stdout?.on('data', (chunk) => {
    logChunks.push(String(chunk));
  });
  server.stderr?.on('data', (chunk) => {
    logChunks.push(String(chunk));
  });

  try {
    await waitForServer(port);
    const timeout = createTimeoutAbort(REQUEST_TIMEOUT_MS);
    try {
      const api = new StructuredExtractAPI({
        provider: 'gemini',
        apiKey: authToken,
        endpoint: `http://127.0.0.1:${port}/api/llm/gemini`
      });

      const startedAt = Date.now();
      const result = await Promise.race([
        api.extractStructuredData(new Uint8Array(pdfBytes), { fileName: basename(pdfPath) }),
        timeout.promise
      ]);
      const durationMs = Date.now() - startedAt;
      const rawText = decodeUtf8(result.rawZip);
      const summary = summarizeStructuredExtract(result.document);

      await writeJson(join(modelDir, 'structured-extract.json'), {
        model,
        durationMs,
        pdfPath,
        summary,
        document: result.document,
        parsedTables: result.parsedTables,
        assetMap: result.assetMap,
        rawText
      });

      comparisons.push({
        model,
        status: 'ok',
        durationMs,
        summary
      });
    } finally {
      timeout.cancel();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeJson(join(modelDir, 'structured-extract.error.json'), {
      model,
      pdfPath,
      error: message
    });
    comparisons.push({
      model,
      status: 'error',
      error: message
    });
  } finally {
    await writeFile(logPath, logChunks.join(''), 'utf8');
    server.kill('SIGTERM');
    if (server.exitCode === null && server.signalCode === null) {
      await Promise.race([
        once(server, 'exit'),
        delay(2_000)
      ]).catch(() => {});
    }
  }
}

const comparisonSummary = buildComparisonSummary(comparisons);
await writeJson(join(outputDir, 'comparison-summary.json'), comparisonSummary);
await writeFile(join(outputDir, 'comparison-summary.md'), buildComparisonMarkdown(pdfPath, comparisons), 'utf8');

console.log(`Saved structured extract comparison to ${outputDir}`);
console.log(JSON.stringify(comparisonSummary, null, 2));

function parseArgs(argv) {
  const result = {
    pdf: null,
    outputDir: null,
    models: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pdf') {
      result.pdf = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--output-dir') {
      result.outputDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      const model = argv[index + 1] ?? null;
      if (model) {
        result.models.push(model);
      }
      index += 1;
      continue;
    }
  }
  return result;
}

async function waitForServer(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for proxy server on port ${port}`);
}

async function findOpenPort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate an open port.')));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function summarizeStructuredExtract(document) {
  const pages = Array.isArray(document.pages) ? document.pages.length : 0;
  const elements = Array.isArray(document.elements) ? document.elements : [];
  const typeCounts = {};
  let totalTextChars = 0;
  for (const element of elements) {
    const type = normalizeElementType(element);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (typeof element.Text === 'string') {
      totalTextChars += element.Text.length;
    }
  }
  return {
    pages,
    elements: elements.length,
    totalTextChars,
    typeCounts
  };
}

function normalizeElementType(element) {
  if (typeof element?.SemanticType === 'string' && element.SemanticType.trim().length > 0) {
    return element.SemanticType.trim();
  }
  if (typeof element?.Path === 'string') {
    const parts = element.Path.split('/').filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return 'unknown';
}

function buildComparisonSummary(results) {
  const successful = results.filter((entry) => entry.status === 'ok');
  const typeUniverse = Array.from(new Set(successful.flatMap((entry) => Object.keys(entry.summary.typeCounts)))).sort();
  return {
    models: results,
    typeUniverse,
    pairwiseDifferences: buildPairwiseDifferences(successful, typeUniverse)
  };
}

function buildPairwiseDifferences(results, typeUniverse) {
  const differences = [];
  for (let index = 0; index < results.length; index += 1) {
    for (let inner = index + 1; inner < results.length; inner += 1) {
      const left = results[index];
      const right = results[inner];
      const typeCountDifferences = {};
      for (const type of typeUniverse) {
        const leftCount = left.summary.typeCounts[type] ?? 0;
        const rightCount = right.summary.typeCounts[type] ?? 0;
        if (leftCount !== rightCount) {
          typeCountDifferences[type] = {
            [left.model]: leftCount,
            [right.model]: rightCount
          };
        }
      }
      differences.push({
        models: [left.model, right.model],
        elementDelta: left.summary.elements - right.summary.elements,
        textCharDelta: left.summary.totalTextChars - right.summary.totalTextChars,
        typeCountDifferences
      });
    }
  }
  return differences;
}

function buildComparisonMarkdown(pdfPath, results) {
  const lines = [
    '# Structured Extract Model Comparison',
    '',
    `PDF: \`${pdfPath}\``,
    ''
  ];
  for (const result of results) {
    if (result.status === 'ok') {
      lines.push(`- ${result.model}: ok, ${result.durationMs} ms, elements=${result.summary.elements}, pages=${result.summary.pages}, textChars=${result.summary.totalTextChars}`);
      continue;
    }
    lines.push(`- ${result.model}: error, ${result.error}`);
  }
  lines.push('');
  lines.push('Per-model JSON lives in sibling folders as `structured-extract.json` or `structured-extract.error.json`.');
  return `${lines.join('\n')}\n`;
}

function decodeUtf8(value) {
  return new TextDecoder().decode(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
}

function sanitizeFilename(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function timestampSlug() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('') + '-' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}

function createTimeoutAbort(timeoutMs) {
  let handle = null;
  let rejectPromise = null;
  const promise = new Promise((_, reject) => {
    rejectPromise = reject;
    handle = setTimeout(() => {
      reject(new Error(`Structured extract timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return {
    promise,
    cancel() {
      if (handle !== null) {
        clearTimeout(handle);
      }
      if (rejectPromise) {
        rejectPromise = null;
      }
    }
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
