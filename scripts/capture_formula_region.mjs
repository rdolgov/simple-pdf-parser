#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, 'true');
      continue;
    }
    args.set(key, next);
    index += 1;
  }
  return args;
}

function requireArg(args, key) {
  const value = args.get(key);
  if (!value) {
    throw new Error(`Missing required argument --${key}`);
  }
  return value;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCropArg(value) {
  if (!value) {
    return undefined;
  }

  const [x, y, width, height] = value.split(',').map((part) => Number(part));
  if (![x, y, width, height].every((entry) => Number.isFinite(entry))) {
    throw new Error(`Invalid crop rectangle: ${value}`);
  }

  return { x, y, width, height };
}

async function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error(`${command} ${commandArgs.join(' ')} failed with code ${code}\n${stderr}`));
    });
  });
}

async function captureWithHeadlessChrome({ chromeBinary, outputPath, url, userDataDir, windowSize }) {
  rmSync(outputPath, { force: true });

  const chrome = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    `--window-size=${windowSize.width},${windowSize.height}`,
    `--screenshot=${outputPath}`,
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=5000',
    url
  ], {
    cwd: repoRoot,
    stdio: 'ignore'
  });

  try {
    const startedAt = Date.now();
    let lastSize = -1;
    while (Date.now() - startedAt < 15000) {
      if (existsSync(outputPath)) {
        const { size } = statSync(outputPath);
        if (size > 0 && size === lastSize) {
          return;
        }
        lastSize = size;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error(`Timed out waiting for Chrome to write ${outputPath}`);
  } finally {
    if (chrome.exitCode === null) {
      chrome.kill('SIGTERM');
      await new Promise((resolveClose) => {
        chrome.once('close', () => resolveClose());
        setTimeout(() => {
          if (chrome.exitCode === null) {
            chrome.kill('SIGKILL');
          }
        }, 1000).unref();
      });
    }
  }
}

function parseBounds(item) {
  return item?.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function expandBounds(base, extra) {
  return {
    minX: Math.min(base.minX, extra.minX),
    minY: Math.min(base.minY, extra.minY),
    maxX: Math.max(base.maxX, extra.maxX),
    maxY: Math.max(base.maxY, extra.maxY)
  };
}

async function computeCropRect({ pdfPath, pageNumber, matchPattern, matchIndex, contextX, contextY }) {
  const modulePath = resolve(repoRoot, 'dist/pdfDocument.js');
  const { PDFDocument } = await import(modulePath);
  const documentModel = PDFDocument.from(readFileSync(pdfPath));
  const page = documentModel.getPage(pageNumber);
  if (!page) {
    throw new Error(`Page ${pageNumber} not found in ${pdfPath}`);
  }

  const regex = new RegExp(matchPattern);
  const matches = page.textItems.filter((item) => regex.test(item.text));
  const target = matches[matchIndex];
  if (!target) {
    throw new Error(`No text item matched /${matchPattern}/ on page ${pageNumber}`);
  }

  const targetBounds = parseBounds(target);
  const searchBounds = {
    minX: targetBounds.minX - contextX,
    minY: targetBounds.minY - contextY,
    maxX: targetBounds.maxX + contextX,
    maxY: targetBounds.maxY + contextY
  };

  const relatedItems = page.textItems.filter((item) => {
    const bounds = parseBounds(item);
    const intersectsX = bounds.maxX >= searchBounds.minX && bounds.minX <= searchBounds.maxX;
    const intersectsY = bounds.maxY >= searchBounds.minY && bounds.minY <= searchBounds.maxY;
    return intersectsX && intersectsY;
  });

  const cropBounds = relatedItems.reduce(
    (accumulator, item) => expandBounds(accumulator, parseBounds(item)),
    { ...targetBounds }
  );

  return {
    x: cropBounds.minX,
    y: cropBounds.minY,
    width: cropBounds.maxX - cropBounds.minX,
    height: cropBounds.maxY - cropBounds.minY
  };
}

function buildFormulaCheckUrl({ port, pdfPath, pageNumber, cropRect, scale, cropPadding, debug }) {
  const params = new URLSearchParams({
    pdfPath,
    page: String(pageNumber),
    crop: `${cropRect.x},${cropRect.y},${cropRect.width},${cropRect.height}`,
    scale: String(scale),
    cropPadding: String(cropPadding)
  });
  if (debug) {
    params.set('debug', '1');
  }
  return `http://127.0.0.1:${port}/formula-check.html?${params.toString()}`;
}

function resolveChromeBinary() {
  const candidate = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!candidate) {
    throw new Error('Unable to resolve Chrome binary.');
  }
  return candidate;
}

function mimeTypeForPath(filePath) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

async function startFormulaCheckServer({ port }) {
  const distRoot = resolve(repoRoot, 'testApp/dist');

  if (!existsSync(distRoot)) {
    throw new Error(`Missing built testApp output at ${distRoot}`);
  }

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

    if (requestUrl.pathname === '/__formula_pdf__') {
      const pdfPathArg = requestUrl.searchParams.get('path');
      if (!pdfPathArg) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Missing path query parameter.');
        return;
      }

      const pdfPath = isAbsolute(pdfPathArg) ? pdfPathArg : resolve(repoRoot, pdfPathArg);
      if (!existsSync(pdfPath)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(`PDF not found: ${pdfPath}`);
        return;
      }

      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store'
      });
      response.end(readFileSync(pdfPath));
      return;
    }

    const relativePath = requestUrl.pathname === '/' ? 'formula-check.html' : requestUrl.pathname.slice(1);
    const filePath = resolve(distRoot, relativePath);
    if (!filePath.startsWith(distRoot) || !existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`Not found: ${requestUrl.pathname}`);
      return;
    }

    response.writeHead(200, {
      'Content-Type': mimeTypeForPath(filePath),
      'Cache-Control': 'no-store'
    });
    response.end(readFileSync(filePath));
  });

  await new Promise((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(port, '127.0.0.1', () => resolveServer());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve formula-check server address.');
  }

  return {
    port: address.port,
    server
  };
}

async function stopFormulaCheckServer(server) {
  await new Promise((resolveStop, rejectStop) => {
    server.close((error) => {
      if (error) {
        rejectStop(error);
        return;
      }
      resolveStop();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfPathArg = requireArg(args, 'pdf');
  const pdfPath = isAbsolute(pdfPathArg) ? pdfPathArg : resolve(repoRoot, pdfPathArg);
  const pageNumber = Math.max(1, Math.floor(parseNumber(args.get('page'), 1)));
  const matchPattern = args.get('match');
  const matchIndex = Math.max(0, Math.floor(parseNumber(args.get('index'), 0)));
  const explicitCrop = parseCropArg(args.get('crop'));
  const outputArg = args.get('output') ?? resolve(tmpdir(), 'formula-check.png');
  const outputPath = isAbsolute(outputArg) ? outputArg : resolve(repoRoot, outputArg);
  const contextX = Math.max(0, parseNumber(args.get('context-x'), 36));
  const contextY = Math.max(0, parseNumber(args.get('context-y'), 18));
  const cropPadding = Math.max(0, parseNumber(args.get('crop-padding'), 8));
  const scale = Math.max(1, parseNumber(args.get('scale'), 2));
  const portArg = args.get('port');
  const port = portArg ? Math.max(1024, Math.floor(parseNumber(portArg, 4174))) : 0;
  const debug = args.get('debug') === 'true';

  await runCommand('npm', ['run', 'build:lib']);
  await runCommand('npm', ['--prefix', 'testApp', 'run', 'build']);

  const cropRect =
    explicitCrop ??
    (await computeCropRect({
      pdfPath,
      pageNumber,
      matchPattern: requireArg(args, 'match'),
      matchIndex,
      contextX,
      contextY
    }));

  const { server, port: activePort } = await startFormulaCheckServer({ port });

  try {
    const captureWidth = Math.max(240, Math.ceil(cropRect.width * scale + cropPadding * 2));
    const captureHeight = Math.max(180, Math.ceil(cropRect.height * scale + cropPadding * 2));
    const url = buildFormulaCheckUrl({
      port: activePort,
      pdfPath,
      pageNumber,
      cropRect,
      scale,
      cropPadding,
      debug
    });
    const chromeUserDataDir = mkdtempSync(join(tmpdir(), 'formula-check-chrome-'));
    try {
      await captureWithHeadlessChrome({
        chromeBinary: resolveChromeBinary(),
        outputPath,
        url,
        userDataDir: chromeUserDataDir,
        windowSize: {
          height: captureHeight,
          width: captureWidth
        }
      });
    } finally {
      rmSync(chromeUserDataDir, { recursive: true, force: true });
    }
    process.stdout.write(`${outputPath}\n`);
  } finally {
    await stopFormulaCheckServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
