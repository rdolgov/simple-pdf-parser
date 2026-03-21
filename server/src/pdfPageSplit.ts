import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
let pdfSplitToolPromise: Promise<string | null> | null = null;

export interface SplitPdfPagesResult {
  pageFiles: string[];
  tool: 'pdfseparate';
  workspaceDir: string;
  cleanup: () => Promise<void>;
}

export async function splitPdfIntoPages(
  pdfPath: string,
  options: {
    workspaceRootDir?: string;
    workspaceKey?: string;
    keepWorkspace?: boolean;
  } = {}
): Promise<SplitPdfPagesResult | null> {
  const tool = await resolvePdfSplitTool();
  if (!tool) {
    return null;
  }

  const keepWorkspace = options.keepWorkspace ?? Boolean(options.workspaceRootDir);
  const workspace = options.workspaceRootDir
    ? await prepareNamedWorkspace(options.workspaceRootDir, options.workspaceKey ?? pdfPath)
    : await mkdtemp(join(tmpdir(), 'llm-proxy-pdf-pages-'));
  const outputPattern = join(workspace, `${sanitizeBaseName(basename(pdfPath))}-%d.pdf`);

  try {
    await execFileAsync(tool, [pdfPath, outputPattern]);
    const entries = await readdir(workspace);
    const pageFiles = entries
      .filter((name) => name.toLowerCase().endsWith('.pdf'))
      .sort(comparePageFiles)
      .map((name) => join(workspace, name));

    if (pageFiles.length === 0) {
      await rm(workspace, { recursive: true, force: true });
      return null;
    }

    return {
      pageFiles,
      tool: 'pdfseparate',
      workspaceDir: workspace,
      cleanup: async () => {
        if (!keepWorkspace) {
          await rm(workspace, { recursive: true, force: true });
        }
      }
    };
  } catch {
    await rm(workspace, { recursive: true, force: true });
    return null;
  }
}

async function prepareNamedWorkspace(workspaceRootDir: string, workspaceKey: string): Promise<string> {
  const rootDir = resolve(workspaceRootDir);
  await mkdir(rootDir, { recursive: true });
  const workspaceDir = join(rootDir, createWorkspaceName(workspaceKey));
  await rm(workspaceDir, { recursive: true, force: true });
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}

async function resolvePdfSplitTool(): Promise<string | null> {
  pdfSplitToolPromise ??= (async () => {
    try {
      const { stdout } = await execFileAsync('/usr/bin/env', ['bash', '-lc', 'command -v pdfseparate']);
      const resolved = stdout.trim();
      return resolved.length > 0 ? resolved : null;
    } catch {
      return null;
    }
  })();
  return pdfSplitToolPromise;
}

function comparePageFiles(left: string, right: string): number {
  const leftPage = extractTrailingPageNumber(left);
  const rightPage = extractTrailingPageNumber(right);
  if (leftPage !== rightPage) {
    return leftPage - rightPage;
  }
  return left.localeCompare(right);
}

function extractTrailingPageNumber(value: string): number {
  const match = /(\d+)(?=\.pdf$)/i.exec(value);
  return match ? Number.parseInt(match[1]!, 10) : Number.MAX_SAFE_INTEGER;
}

function sanitizeBaseName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-');
}

function createWorkspaceName(value: string): string {
  const baseName = sanitizeBaseName(basename(value, '.pdf')).replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document';
  const suffix = createHash('sha1').update(value).digest('hex').slice(0, 10);
  return `${baseName}-${suffix}`;
}
