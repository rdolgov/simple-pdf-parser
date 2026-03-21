import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SplitPdfPagesResult } from './pdfPageSplit.js';

const execFileAsync = promisify(execFile);
let pdfMergeToolPromise: Promise<string | null> | null = null;

export interface PdfPageBatch {
  startPage: number;
  pageCount: number;
  pageNumbers: number[];
  filePath: string;
  byteSize: number;
  merged: boolean;
}

export async function buildPdfPageBatches(
  split: SplitPdfPagesResult,
  options: {
    initialPageCount?: number;
    batchSize?: number;
  } = {}
): Promise<PdfPageBatch[]> {
  const totalPages = split.pageFiles.length;
  const initialPageCount = Math.max(0, Math.min(options.initialPageCount ?? 3, totalPages));
  const requestedBatchSize = Math.max(1, options.batchSize ?? 3);
  const mergeTool = requestedBatchSize > 1 && totalPages - initialPageCount > 1
    ? await resolvePdfMergeTool()
    : null;
  const effectiveBatchSize = mergeTool ? requestedBatchSize : 1;
  const batches: PdfPageBatch[] = [];

  for (let index = 0; index < initialPageCount; index += 1) {
    batches.push(await createSinglePageBatch(split.pageFiles[index]!, index + 1));
  }

  for (let index = initialPageCount; index < totalPages; index += effectiveBatchSize) {
    const pageFiles = split.pageFiles.slice(index, index + effectiveBatchSize);
    if (pageFiles.length === 1) {
      batches.push(await createSinglePageBatch(pageFiles[0]!, index + 1));
      continue;
    }

    const startPage = index + 1;
    const endPage = index + pageFiles.length;
    const outputPath = join(
      split.workspaceDir,
      `batch-${String(startPage).padStart(4, '0')}-${String(endPage).padStart(4, '0')}.pdf`
    );
    await execFileAsync(mergeTool!, [...pageFiles, outputPath]);
    const outputStat = await stat(outputPath);
    batches.push({
      startPage,
      pageCount: pageFiles.length,
      pageNumbers: Array.from({ length: pageFiles.length }, (_, offset) => startPage + offset),
      filePath: outputPath,
      byteSize: outputStat.size,
      merged: true
    });
  }

  return batches;
}

async function createSinglePageBatch(filePath: string, pageNumber: number): Promise<PdfPageBatch> {
  const fileStat = await stat(filePath);
  return {
    startPage: pageNumber,
    pageCount: 1,
    pageNumbers: [pageNumber],
    filePath,
    byteSize: fileStat.size,
    merged: false
  };
}

async function resolvePdfMergeTool(): Promise<string | null> {
  pdfMergeToolPromise ??= (async () => {
    try {
      const { stdout } = await execFileAsync('/usr/bin/env', ['bash', '-lc', 'command -v pdfunite']);
      const resolved = stdout.trim();
      return resolved.length > 0 ? resolved : null;
    } catch {
      return null;
    }
  })();
  return pdfMergeToolPromise;
}
