#!/usr/bin/env node

import { readdirSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '../dist/pdfDocument.js';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const compareScriptPath = resolve(repoRoot, 'scripts/compare_pdf_page_render.mjs');

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

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function resolvePath(root, value) {
  return isAbsolute(value) ? value : resolve(root, value);
}

async function runCommand(command, commandArgs) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
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
      resolveRun({
        code: code ?? 0,
        stdout,
        stderr
      });
    });
  });
}

function parseCompareOutput(stdout) {
  const pageResults = [];
  let artifacts;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const pageMatch = line.match(/^page (\d+): rmse=([0-9.]+) \(([0-9.]+)\) diffBounds=(.+)$/);
    if (pageMatch) {
      pageResults.push({
        pageNumber: Number(pageMatch[1]),
        rmseAbsolute: Number(pageMatch[2]),
        rmseNormalized: Number(pageMatch[3]),
        diffBounds: pageMatch[4]
      });
      continue;
    }

    const artifactsMatch = line.match(/^artifacts:\s+(.+)$/);
    if (artifactsMatch) {
      artifacts = artifactsMatch[1];
    }
  }

  return { pageResults, artifacts };
}

function buildTodoMarkdown(report) {
  const lines = [
    '# PDF Render Audit TODO',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Audit script: \`scripts/audit_pdf_render_folder.mjs\``,
    `Total PDFs: ${report.totalFiles}`,
    `Total pages: ${report.totalPages}`,
    '',
    'Default compare command pattern:',
    '- `node scripts/compare_pdf_page_render.mjs --pdf <file> --pages 1-N --scale 1 --output-dir tmp/render-audit/<slug>`',
    '- `actual.png`, `reference.png`, and `diff.png` are written per page under the file artifact directory.',
    '',
    'Legend:',
    '- `[ ]` pending compare or follow-up review',
    '- `[x]` page-by-page compare completed for that file',
    ''
  ];

  if (report.completedFiles > 0) {
    lines.push(`Completed compares: ${report.completedFiles}/${report.totalFiles}`);
    lines.push('');
  }

  for (const fileReport of report.files) {
    const compareComplete = fileReport.status === 'completed';
    lines.push(`## ${compareComplete ? '[x]' : '[ ]'} ${fileReport.name}`);
    lines.push(`- Pages: ${fileReport.pageCount}`);
    lines.push(`- Compare command: \`${fileReport.compareCommand}\``);
    lines.push(`- Artifact directory: \`${fileReport.artifactDir}\``);
    if (fileReport.artifacts) {
      lines.push(`- Artifacts: [${fileReport.artifacts}](${fileReport.artifacts})`);
    }
    if (fileReport.status === 'error') {
      lines.push(`- Compare error: ${fileReport.error}`);
    }
    if (fileReport.topPages.length > 0) {
      lines.push('- Highest-diff pages to inspect next:');
      for (const page of fileReport.topPages) {
        lines.push(
          `  - [ ] page ${page.pageNumber}: rmse=${page.rmseNormalized.toFixed(6)} diffBounds=${page.diffBounds}`
        );
      }
    } else if (!compareComplete) {
      lines.push('- [ ] Run page-by-page compare for this file.');
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfDir = resolvePath(repoRoot, args.get('pdf-dir') ?? 'pdfs');
  const outputDir = resolvePath(repoRoot, args.get('output-dir') ?? 'tmp/render-audit');
  const todoFile = resolvePath(repoRoot, args.get('todo-file') ?? 'docs/pdf-render-audit-todo.md');
  const scale = Math.max(1, parseNumber(args.get('scale'), 1));
  const limit = Math.max(0, Math.floor(parseNumber(args.get('limit'), 0)));
  const topPages = Math.max(1, Math.floor(parseNumber(args.get('top-pages'), 5)));
  const runCompare = args.get('run') === 'true';

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(resolve(todoFile, '..'), { recursive: true });

  const fileNames = readdirSync(pdfDir)
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .sort((left, right) => left.localeCompare(right));
  const selectedFileNames = limit > 0 ? fileNames.slice(0, limit) : fileNames;

  const files = selectedFileNames.map((name) => {
    const pdfPath = join(pdfDir, name);
    const artifactDir = join(outputDir, sanitizeName(basename(name, '.pdf')));
    const document = PDFDocument.from(readFileSync(pdfPath));
    return {
      name,
      pdfPath,
      artifactDir,
      pageCount: document.pages.length,
      status: 'pending',
      artifacts: undefined,
      error: undefined,
      topPages: [],
      compareCommand: ''
    };
  });

  for (const file of files) {
    file.compareCommand = [
      'node',
      'scripts/compare_pdf_page_render.mjs',
      '--pdf',
      file.pdfPath,
      '--pages',
      `1-${file.pageCount}`,
      '--scale',
      String(scale),
      '--output-dir',
      file.artifactDir
    ].join(' ');
  }

  const report = {
    totalFiles: fileNames.length,
    totalPages: files.reduce((sum, file) => sum + file.pageCount, 0),
    completedFiles: 0,
    files
  };

  writeFileSync(todoFile, buildTodoMarkdown(report), 'utf8');

  if (!runCompare) {
    return;
  }

  for (const file of files) {
    const compareArgs = [
      compareScriptPath,
      '--pdf',
      file.pdfPath,
      '--pages',
      `1-${file.pageCount}`,
      '--scale',
      String(scale),
      '--output-dir',
      file.artifactDir
    ];
    const result = await runCommand(process.execPath, compareArgs);
    if (result.code !== 0) {
      file.status = 'error';
      file.error = (result.stderr || result.stdout || 'Compare failed.').trim();
      writeFileSync(todoFile, buildTodoMarkdown(report), 'utf8');
      continue;
    }

    const parsed = parseCompareOutput(result.stdout);
    file.status = 'completed';
    file.artifacts = parsed.artifacts ?? file.artifactDir;
    file.topPages = parsed.pageResults
      .sort((left, right) => right.rmseNormalized - left.rmseNormalized)
      .slice(0, topPages);
    report.completedFiles += 1;
    writeFileSync(todoFile, buildTodoMarkdown(report), 'utf8');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
