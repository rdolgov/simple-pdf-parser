#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '../dist/pdfDocument.js';
import { findTextItemSubstringMatches } from '../dist/textItemSubstringBounds.js';

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

function parseCropArg(value) {
  const [x, y, width, height] = value.split(',').map((part) => Number(part));
  if (![x, y, width, height].every((entry) => Number.isFinite(entry))) {
    throw new Error(`Invalid crop rectangle: ${value}`);
  }

  return { x, y, width, height };
}

function expandCropRect(cropRect, padding, pageSize) {
  const minX = Math.max(0, cropRect.x - padding);
  const minY = Math.max(0, cropRect.y - padding);
  const maxX = Math.min(pageSize.width, cropRect.x + cropRect.width + padding);
  const maxY = Math.min(pageSize.height, cropRect.y + cropRect.height + padding);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
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

async function computeCropRect({
  pdfPath,
  pageNumber,
  matchPattern,
  matchIndex,
  substring,
  substringIndex,
  contextX,
  contextY
}) {
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

  let targetBounds = parseBounds(target);
  if (substring) {
    const substringMatches = findTextItemSubstringMatches(target, substring);
    const substringMatch = substringMatches[substringIndex];
    if (!substringMatch) {
      throw new Error(`No substring "${substring}" found inside matched item on page ${pageNumber}`);
    }
    targetBounds = substringMatch.bounds;
  }
  const searchBounds = {
    minX: targetBounds.minX - contextX,
    minY: targetBounds.minY - contextY,
    maxX: targetBounds.maxX + contextX,
    maxY: targetBounds.maxY + contextY
  };

  if (substring) {
    return {
      x: searchBounds.minX,
      y: searchBounds.minY,
      width: searchBounds.maxX - searchBounds.minX,
      height: searchBounds.maxY - searchBounds.minY
    };
  }

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

async function captureRenderedRegion({
  pdfPath,
  pageNumber,
  cropRect,
  scale,
  cropPadding,
  outputPath
}) {
  const crop = `${cropRect.x},${cropRect.y},${cropRect.width},${cropRect.height}`;
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
    String(cropPadding),
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

async function cropReferenceImage({
  magickPath,
  inputPath,
  cropRect,
  cropPadding,
  pageHeight,
  scale,
  outputPath
}) {
  const left = Math.max(0, Math.floor(cropRect.x * scale - cropPadding));
  const top = Math.max(0, Math.floor((pageHeight - (cropRect.y + cropRect.height)) * scale - cropPadding));
  const width = Math.max(1, Math.ceil(cropRect.width * scale + cropPadding * 2));
  const height = Math.max(1, Math.ceil(cropRect.height * scale + cropPadding * 2));
  const geometry = `${width}x${height}+${left}+${top}`;
  const result = await runCommand(magickPath, [
    inputPath,
    '-crop',
    geometry,
    '+repage',
    outputPath
  ]);

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `magick crop failed for ${inputPath}`);
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

  return {
    metric,
    diffBounds: trimResult.code === 0 ? trimResult.stdout.trim() : ''
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfArg = requireArg(args, 'pdf');
  const pdfPath = isAbsolute(pdfArg) ? pdfArg : resolve(repoRoot, pdfArg);
  const pageNumber = parseNumber(requireArg(args, 'page'), NaN);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Invalid --page value: ${args.get('page')}`);
  }

  const scale = parseNumber(args.get('scale'), 6);
  const matchPattern = args.get('match');
  const cropArg = args.get('crop');
  if (!matchPattern && !cropArg) {
    throw new Error('Specify either --match or --crop.');
  }

  const matchIndex = Math.max(0, Math.trunc(parseNumber(args.get('match-index'), 0)));
  const contextX = parseNumber(args.get('context-x'), 40);
  const contextY = parseNumber(args.get('context-y'), 18);
  const cropPadding = parseNumber(args.get('crop-padding'), 2);
  const threshold = args.get('threshold');
  const substring = args.get('substring');
  const substringIndex = Math.max(0, Math.trunc(parseNumber(args.get('substring-index'), 0)));

  const documentModel = PDFDocument.from(readFileSync(pdfPath));
  const page = documentModel.getPage(pageNumber);
  if (!page) {
    throw new Error(`Page ${pageNumber} not found in ${pdfPath}`);
  }

  const cropRect = cropArg
    ? parseCropArg(cropArg)
    : await computeCropRect({
      pdfPath,
      pageNumber,
      matchPattern,
      matchIndex,
      substring,
      substringIndex,
      contextX,
      contextY
    });
  const outputDirArg = args.get('output-dir');
  const outputDir = outputDirArg
    ? (isAbsolute(outputDirArg) ? outputDirArg : resolve(repoRoot, outputDirArg))
    : mkdtempSync(join(tmpdir(), 'pdf-region-compare-'));
  mkdirSync(outputDir, { recursive: true });

  const actualPath = join(outputDir, 'actual.png');
  const referencePath = join(outputDir, 'reference.png');
  const diffPath = join(outputDir, 'diff.png');
  const actualNormalizedPath = join(outputDir, 'actual-normalized.png');
  const referenceNormalizedPath = join(outputDir, 'reference-normalized.png');
  const actualComparePath = threshold ? join(outputDir, 'actual-compare.png') : actualNormalizedPath;
  const referenceComparePath = threshold ? join(outputDir, 'reference-compare.png') : referenceNormalizedPath;

  const pdfToCairoPath = resolveToolPath('PDFTOCAIRO_BIN', '/opt/homebrew/bin/pdftocairo', 'pdftocairo');
  const magickPath = resolveToolPath('MAGICK_BIN', '/opt/homebrew/bin/magick', 'magick');

  const tempDir = mkdtempSync(join(tmpdir(), 'pdf-region-reference-'));
  try {
    await captureRenderedRegion({
      pdfPath,
      pageNumber,
      cropRect,
      scale,
      cropPadding,
      outputPath: actualPath
    });

    const referenceStem = join(tempDir, 'reference-page');
    await renderReferencePage({
      pdfToCairoPath,
      pdfPath,
      pageNumber,
      scale,
      outputStem: referenceStem
    });
    await cropReferenceImage({
      magickPath,
      inputPath: `${referenceStem}.png`,
      cropRect,
      cropPadding,
      pageHeight: page.size.height,
      scale,
      outputPath: referencePath
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

    const { metric, diffBounds } = await compareImages({
      magickPath,
      referencePath: referenceComparePath,
      actualPath: actualComparePath,
      diffPath
    });

    console.log(
      [
        `page ${pageNumber}`,
        metric ? `rmse=${metric.absolute} (${metric.normalized})` : 'rmse=unknown',
        diffBounds ? `diffBounds=${diffBounds}` : 'diffBounds=none'
      ].join(' ')
    );
    console.log(`crop=${JSON.stringify(expandCropRect(cropRect, cropPadding, page.size))}`);
    if (threshold) {
      console.log(`threshold=${threshold}`);
    }
    if (substring) {
      console.log(`substring=${substring}`);
    }
    console.log(`artifacts: ${outputDir}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
