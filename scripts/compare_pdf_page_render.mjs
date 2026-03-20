#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '../dist/pdfDocument.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const captureScriptPath = resolve(repoRoot, 'scripts/capture_formula_region.mjs');

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

function createSeededRandom(seed) {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x6d2b79f5;
  }

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function parsePagesSpec(value, pageCount) {
  const pages = new Set();
  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const min = Math.max(1, Math.min(start, end));
      const max = Math.min(pageCount, Math.max(start, end));
      for (let pageNumber = min; pageNumber <= max; pageNumber += 1) {
        pages.add(pageNumber);
      }
      continue;
    }

    const pageNumber = Number(part);
    if (Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= pageCount) {
      pages.add(pageNumber);
    }
  }

  return [...pages].sort((left, right) => left - right);
}

function samplePages(pageCount, sampleSize, seed) {
  const requested = Math.max(1, Math.min(pageCount, sampleSize));
  const rng = createSeededRandom(seed);
  const pages = new Set();

  while (pages.size < requested) {
    pages.add(1 + Math.floor(rng() * pageCount));
  }

  return [...pages].sort((left, right) => left - right);
}

async function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
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
      resolveRun({ code: code ?? 0, stdout, stderr });
    });
  });
}

function resolveToolPath(envKey, fallbackPath, fallbackCommand) {
  const envValue = process.env[envKey];
  if (envValue) {
    return envValue;
  }
  if (existsSync(fallbackPath)) {
    return fallbackPath;
  }
  return fallbackCommand;
}

function parseRmseMetric(metricOutput) {
  const match = metricOutput.match(/([0-9.]+)\s+\(([0-9.]+)\)/);
  if (!match) {
    return null;
  }
  return {
    absolute: Number(match[1]),
    normalized: Number(match[2])
  };
}

function sanitizeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

async function captureRenderedPage({ pdfPath, pageNumber, pageSize, scale, outputPath }) {
  const crop = `0,0,${pageSize.width},${pageSize.height}`;
  const result = await runCommand(process.execPath, [
    captureScriptPath,
    '--pdf',
    pdfPath,
    '--page',
    String(pageNumber),
    '--crop',
    crop,
    '--padding',
    '0',
    '--crop-padding',
    '0',
    '--scale',
    String(scale),
    '--virtual-time-budget-ms',
    '15000',
    '--capture-timeout-ms',
    '45000',
    '--skip-build',
    '--output',
    outputPath
  ]);

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `Capture failed for page ${pageNumber}`);
  }
}

async function renderReferencePage({ pdfToCairoPath, pdfPath, pageNumber, scale, outputStem }) {
  const result = await runCommand(pdfToCairoPath, [
    '-png',
    '-singlefile',
    '-f',
    String(pageNumber),
    '-l',
    String(pageNumber),
    '-r',
    String(72 * scale),
    pdfPath,
    outputStem
  ]);

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pdftocairo failed for page ${pageNumber}`);
  }
}

async function identifyImageSize({ magickPath, inputPath }) {
  const result = await runCommand(magickPath, [
    'identify',
    '-format',
    '%w %h',
    inputPath
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `magick identify failed for ${inputPath}`);
  }

  const [widthText, heightText] = result.stdout.trim().split(/\s+/);
  const width = Number(widthText);
  const height = Number(heightText);
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`Unable to parse image size for ${inputPath}: ${result.stdout.trim()}`);
  }

  return { width, height };
}

async function normalizeImageCanvas({
  magickPath,
  inputPath,
  outputPath,
  width,
  height
}) {
  const result = await runCommand(magickPath, [
    inputPath,
    '-background',
    'white',
    '-gravity',
    'NorthWest',
    '-extent',
    `${width}x${height}`,
    outputPath
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `magick extent failed for ${inputPath}`);
  }
}

async function preprocessForCompare({ magickPath, inputPath, outputPath, threshold }) {
  const args = [inputPath, '-colorspace', 'Gray'];
  if (threshold) {
    args.push('-threshold', threshold);
  }
  args.push(outputPath);
  const result = await runCommand(magickPath, args);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `magick preprocess failed for ${inputPath}`);
  }
}

async function computeTileDarkness({
  magickPath,
  inputPath,
  x,
  y,
  width,
  height
}) {
  const result = await runCommand(magickPath, [
    inputPath,
    '-crop',
    `${width}x${height}+${x}+${y}`,
    '+repage',
    '-format',
    '%[fx:1-mean]',
    'info:'
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `magick tile analysis failed for ${inputPath}`);
  }

  const darkness = Number(result.stdout.trim());
  return Number.isFinite(darkness) ? darkness : 0;
}

async function computeDiffHotspots({
  magickPath,
  diffPath,
  tileSize,
  limit
}) {
  if (!(tileSize > 0) || !(limit > 0)) {
    return [];
  }

  const size = await identifyImageSize({ magickPath, inputPath: diffPath });
  const hotspots = [];

  for (let y = 0; y < size.height; y += tileSize) {
    for (let x = 0; x < size.width; x += tileSize) {
      const width = Math.min(tileSize, size.width - x);
      const height = Math.min(tileSize, size.height - y);
      const darkness = await computeTileDarkness({
        magickPath,
        inputPath: diffPath,
        x,
        y,
        width,
        height
      });
      hotspots.push({ x, y, width, height, darkness });
    }
  }

  return hotspots
    .sort((left, right) => right.darkness - left.darkness)
    .slice(0, limit);
}

async function compareImages({ magickPath, referencePath, actualPath, diffPath }) {
  const compareResult = await runCommand(magickPath, [
    'compare',
    '-metric',
    'RMSE',
    '-highlight-color',
    '#ff2d55',
    '-lowlight-color',
    '#ffffff',
    referencePath,
    actualPath,
    diffPath
  ]);

  if (compareResult.code !== 0 && compareResult.code !== 1) {
    throw new Error(compareResult.stderr || compareResult.stdout || `magick compare failed for ${actualPath}`);
  }

  const metric = parseRmseMetric(compareResult.stderr || compareResult.stdout);
  const trimResult = await runCommand(magickPath, [
    diffPath,
    '-fuzz',
    '1%',
    '-trim',
    '-format',
    '%@',
    'info:'
  ]);

  const diffBounds = trimResult.code === 0 ? trimResult.stdout.trim() : '';
  return {
    diffBounds,
    metric
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfArg = requireArg(args, 'pdf');
  const pdfPath = isAbsolute(pdfArg) ? pdfArg : resolve(repoRoot, pdfArg);
  const scale = Math.max(1, parseNumber(args.get('scale'), 2));
  const sampleSize = Math.max(1, Math.floor(parseNumber(args.get('sample'), 8)));
  const seed = Math.floor(parseNumber(args.get('seed'), 20260315));
  const outputRootArg = args.get('output-dir');
  const pdfBaseName = sanitizeName(basename(pdfPath, '.pdf'));
  const outputRoot = outputRootArg
    ? (isAbsolute(outputRootArg) ? outputRootArg : resolve(repoRoot, outputRootArg))
    : mkdtempSync(join(tmpdir(), `${pdfBaseName}-compare-`));
  const pdfToCairoPath = resolveToolPath('PDFTOCAIRO_BIN', '/opt/homebrew/bin/pdftocairo', 'pdftocairo');
  const magickPath = resolveToolPath('MAGICK_BIN', '/opt/homebrew/bin/magick', 'magick');
  const threshold = args.get('threshold');
  const tileSize = Math.max(0, Math.floor(parseNumber(args.get('tile-size'), 0)));
  const topTiles = Math.max(0, Math.floor(parseNumber(args.get('top-tiles'), 3)));

  mkdirSync(outputRoot, { recursive: true });

  const document = PDFDocument.from(readFileSync(pdfPath));
  const pageCount = document.pages.length;
  const explicitPages = args.get('pages');
  const pageNumbers = explicitPages
    ? parsePagesSpec(explicitPages, pageCount)
    : samplePages(pageCount, sampleSize, seed);

  if (pageNumbers.length === 0) {
    throw new Error(`No valid pages selected from ${pdfPath}`);
  }

  await runCommand('npm', ['run', 'build:lib']);
  await runCommand('npm', ['--prefix', 'testApp', 'run', 'build']);

  const results = [];

  for (const pageNumber of pageNumbers) {
    const page = document.getPage(pageNumber);
    if (!page) {
      continue;
    }

    const pagePrefix = join(outputRoot, `page-${String(pageNumber).padStart(4, '0')}`);
    const actualPath = `${pagePrefix}-actual.png`;
    const actualNormalizedPath = `${pagePrefix}-actual-normalized.png`;
    const actualComparePath = threshold ? `${pagePrefix}-actual-compare.png` : actualNormalizedPath;
    const referenceStem = `${pagePrefix}-reference`;
    const referencePath = `${referenceStem}.png`;
    const referenceNormalizedPath = `${pagePrefix}-reference-normalized.png`;
    const referenceComparePath = threshold ? `${pagePrefix}-reference-compare.png` : referenceNormalizedPath;
    const diffPath = `${pagePrefix}-diff.png`;

    await captureRenderedPage({
      pdfPath,
      pageNumber,
      pageSize: page.size,
      scale,
      outputPath: actualPath
    });
    await renderReferencePage({
      pdfToCairoPath,
      pdfPath,
      pageNumber,
      scale,
      outputStem: referenceStem
    });
    const actualSize = await identifyImageSize({ magickPath, inputPath: actualPath });
    const referenceSize = await identifyImageSize({ magickPath, inputPath: referencePath });
    const normalizedWidth = Math.max(actualSize.width, referenceSize.width);
    const normalizedHeight = Math.max(actualSize.height, referenceSize.height);
    await normalizeImageCanvas({
      magickPath,
      inputPath: actualPath,
      outputPath: actualNormalizedPath,
      width: normalizedWidth,
      height: normalizedHeight
    });
    await normalizeImageCanvas({
      magickPath,
      inputPath: referencePath,
      outputPath: referenceNormalizedPath,
      width: normalizedWidth,
      height: normalizedHeight
    });
    if (threshold) {
      await preprocessForCompare({
        magickPath,
        inputPath: actualNormalizedPath,
        outputPath: actualComparePath,
        threshold
      });
      await preprocessForCompare({
        magickPath,
        inputPath: referenceNormalizedPath,
        outputPath: referenceComparePath,
        threshold
      });
    }
    const comparison = await compareImages({
      magickPath,
      referencePath: referenceComparePath,
      actualPath: actualComparePath,
      diffPath
    });
    const hotspots = await computeDiffHotspots({
      magickPath,
      diffPath,
      tileSize,
      limit: topTiles
    });

    results.push({
      pageNumber,
      actualPath,
      diffBounds: comparison.diffBounds,
      diffPath,
      hotspots,
      metric: comparison.metric,
      referencePath
    });
  }

  const sortedResults = [...results].sort((left, right) => {
    const leftScore = left.metric?.normalized ?? Number.POSITIVE_INFINITY;
    const rightScore = right.metric?.normalized ?? Number.POSITIVE_INFINITY;
    return rightScore - leftScore;
  });

  for (const result of sortedResults) {
    const metric = result.metric
      ? `${result.metric.absolute.toFixed(2)} (${result.metric.normalized.toFixed(6)})`
      : 'unavailable';
    process.stdout.write(
      `page ${result.pageNumber}: rmse=${metric} diffBounds=${result.diffBounds || 'n/a'}\n`
    );
    for (const hotspot of result.hotspots ?? []) {
      process.stdout.write(
        `  hotspot ${hotspot.x},${hotspot.y},${hotspot.width},${hotspot.height}: darkness=${hotspot.darkness.toFixed(6)}\n`
      );
    }
  }

  if (threshold) {
    process.stdout.write(`threshold=${threshold}\n`);
  }
  if (tileSize > 0 && topTiles > 0) {
    process.stdout.write(`tileSize=${tileSize} topTiles=${topTiles}\n`);
  }
  process.stdout.write(`artifacts: ${outputRoot}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
