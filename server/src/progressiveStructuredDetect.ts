import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PDFDocument } from '../../src/pdfDocument.js';
import { splitPdfIntoPages } from './pdfPageSplit.js';
import { buildPdfPageBatches } from './pdfPageBatching.js';
import { decideStructuredDetectSplit, shouldRetryStructuredDetectAsSplit } from './structuredDetectSplitPolicy.js';
import { formatDurationFields } from './logDuration.js';
import {
  executeStructuredDetectTask,
  type TaskServerProvidersConfig,
  type TaskStructuredDetectResult
} from './taskExecutors.js';
import {
  mergeStructuredDetectUnitResults,
  type StructuredDetectUnitResult,
  type StructuredDetectProgress
} from './structuredDetectMerge.js';
import type { StructuredExtractProvider } from '../../src/index.js';

export interface StructuredDetectExchangeRecord {
  stage: 'full-document' | 'page-batch';
  filePath: string;
  fileName: string;
  startPage: number;
  pageCount: number;
  byteSize: number;
  merged: boolean;
  durationMs: number;
  result: TaskStructuredDetectResult;
}

export interface StructuredDetectExchangeErrorRecord {
  stage: 'full-document' | 'page-batch';
  filePath: string;
  fileName: string;
  startPage: number;
  pageCount: number;
  byteSize: number;
  merged: boolean;
  durationMs: number;
  error: string;
}

export async function executeStructuredDetectTaskProgressive(
  input: {
    provider?: Exclude<StructuredExtractProvider, 'codex'>;
    model?: string;
    filePath: string;
    fileName: string;
  },
  config: TaskServerProvidersConfig & {
    structuredDetectPageConcurrency?: number;
    structuredDetectBatchSize?: number;
    structuredDetectInitialPageCount?: number;
    structuredDetectMinSplitBytes?: number;
    structuredDetectMinSplitPages?: number;
    structuredDetectTasksDataDir?: string;
  },
  options: {
    onPartial?: (partial: TaskStructuredDetectResult, progress: StructuredDetectProgress) => Promise<void> | void;
    onProgress?: (progress: StructuredDetectProgress) => Promise<void> | void;
    onExchange?: (exchange: StructuredDetectExchangeRecord) => Promise<void> | void;
    onExchangeError?: (exchange: StructuredDetectExchangeErrorRecord) => Promise<void> | void;
  } = {}
): Promise<TaskStructuredDetectResult> {
  const sourceFileStat = await stat(input.filePath);
  const sourcePdfBytes = await readFile(input.filePath);
  const sourcePdfBuffer = sourcePdfBytes.buffer.slice(
    sourcePdfBytes.byteOffset,
    sourcePdfBytes.byteOffset + sourcePdfBytes.byteLength
  ) as ArrayBuffer;
  const pageCount = PDFDocument.from(sourcePdfBuffer).pages.length;
  const splitDecision = decideStructuredDetectSplit({
    fileSizeBytes: sourceFileStat.size,
    minSplitBytes: config.structuredDetectMinSplitBytes ?? 1024 * 1024,
    pageCount,
    minSplitPages: config.structuredDetectMinSplitPages ?? 8
  });

  const runFullDocumentDetect = async (): Promise<TaskStructuredDetectResult> => {
    const fullStartedAt = Date.now();
    try {
      const full = await executeStructuredDetectTask(input, config);
      await options.onExchange?.({
        stage: 'full-document',
        filePath: input.filePath,
        fileName: input.fileName,
        startPage: 1,
        pageCount: 1,
        byteSize: sourceFileStat.size,
        merged: false,
        durationMs: Date.now() - fullStartedAt,
        result: full
      });
      const progress = { totalPages: 1, completedPages: 1, publishedPages: 1 };
      await options.onProgress?.(progress);
      await options.onPartial?.(full, progress);
      return full;
    } catch (error) {
      await options.onExchangeError?.({
        stage: 'full-document',
        filePath: input.filePath,
        fileName: input.fileName,
        startPage: 1,
        pageCount: 1,
        byteSize: sourceFileStat.size,
        merged: false,
        durationMs: Date.now() - fullStartedAt,
        error: error instanceof Error ? error.message : 'Failed to detect structure.'
      });
      throw error;
    }
  };

  let retryAsSplitError: Error | null = null;

  if (!splitDecision.shouldSplit) {
    console.log(
      `[structured-detect] skip-split reason=${splitDecision.reason} file=${input.filePath} bytes=${sourceFileStat.size} pages=${pageCount} byteThreshold=${config.structuredDetectMinSplitBytes ?? 1024 * 1024} pageThreshold=${config.structuredDetectMinSplitPages ?? 8}`
    );
    try {
      return await runFullDocumentDetect();
    } catch (error) {
      if (shouldRetryStructuredDetectAsSplit(error, pageCount)) {
        console.log(
          `[structured-detect] retry-as-split reason=no-text-or-recitation file=${input.filePath} bytes=${sourceFileStat.size} pages=${pageCount}`
        );
        retryAsSplitError = error instanceof Error ? error : new Error(String(error ?? 'Failed to detect structure.'));
      } else {
        throw error;
      }
    }
  }

  const splitStartedAt = Date.now();
  const split = await splitPdfIntoPages(input.filePath, {
    workspaceRootDir: config.structuredDetectTasksDataDir
      ? join(config.structuredDetectTasksDataDir, 'split-pages')
      : undefined,
    workspaceKey: input.filePath
  });
  if (!split || split.pageFiles.length <= 1) {
    if (retryAsSplitError) {
      throw retryAsSplitError;
    }
    console.log(
      `[structured-detect] skip-split reason=${split ? 'single-page-after-split' : 'split-tool-unavailable'} file=${input.filePath} bytes=${sourceFileStat.size}`
    );
    return runFullDocumentDetect();
  }

  console.log(
    `[structured-detect] split tool=${split.tool} pages=${split.pageFiles.length} dir=${split.workspaceDir} ${formatDurationFields(Date.now() - splitStartedAt)}`
  );
  for (let pageIndex = 0; pageIndex < split.pageFiles.length; pageIndex += 1) {
    const fileStat = await stat(split.pageFiles[pageIndex]!);
    console.log(
      `[structured-detect] split-page page=${pageIndex + 1} bytes=${fileStat.size} file=${split.pageFiles[pageIndex]}`
    );
  }

  const batches = await buildPdfPageBatches(split, {
    initialPageCount: config.structuredDetectInitialPageCount,
    batchSize: config.structuredDetectBatchSize
  });
  const totalPages = split.pageFiles.length;
  const concurrency = Math.max(1, Math.min(config.structuredDetectPageConcurrency ?? 2, totalPages));
  const completed = new Map<number, StructuredDetectUnitResult>();
  let nextBatchIndex = 0;
  let completedPages = 0;
  let publishedPages = 0;

  console.log(
    `[structured-detect] plan pages=${totalPages} batches=${batches.length} concurrency=${concurrency} initialPages=${Math.max(0, Math.min(config.structuredDetectInitialPageCount ?? 3, totalPages))} batchSize=${Math.max(1, config.structuredDetectBatchSize ?? 3)}`
  );
  for (const batch of batches) {
    console.log(
      `[structured-detect] batch pages=${formatPageRange(batch.startPage, batch.pageCount)} bytes=${batch.byteSize} merged=${batch.merged} file=${batch.filePath}`
    );
  }

  const publishProgress = async (): Promise<void> => {
    let nextPublishedPages = 0;
    while (true) {
      const nextUnit = completed.get(nextPublishedPages + 1);
      if (!nextUnit) {
        break;
      }
      nextPublishedPages += nextUnit.pageCount;
    }

    const progress: StructuredDetectProgress = {
      totalPages,
      completedPages,
      publishedPages: nextPublishedPages
    };
    await options.onProgress?.(progress);

    if (nextPublishedPages > publishedPages) {
      publishedPages = nextPublishedPages;
      const partial = mergeStructuredDetectUnitResults(
        collectPublishedUnits(completed, publishedPages)
      );
      await options.onPartial?.(partial, progress);
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextBatchIndex;
      nextBatchIndex += 1;
      if (currentIndex >= batches.length) {
        return;
      }

      const batch = batches[currentIndex]!;
      const startedAt = Date.now();
      console.log(
        `[structured-detect] batch-start pages=${formatPageRange(batch.startPage, batch.pageCount)} bytes=${batch.byteSize} file=${batch.filePath}`
      );
      const batchFileName =
        batch.pageCount === 1
          ? `${basename(input.fileName, '.pdf')}-page-${batch.startPage}.pdf`
          : `${basename(input.fileName, '.pdf')}-pages-${batch.startPage}-${batch.startPage + batch.pageCount - 1}.pdf`;
      let batchResult: TaskStructuredDetectResult;
      try {
        batchResult = await executeStructuredDetectTask(
          {
            provider: input.provider,
            model: input.model,
            filePath: batch.filePath,
            fileName: batchFileName
          },
          config
        );
      } catch (error) {
        await options.onExchangeError?.({
          stage: 'page-batch',
          filePath: batch.filePath,
          fileName: batchFileName,
          startPage: batch.startPage,
          pageCount: batch.pageCount,
          byteSize: batch.byteSize,
          merged: batch.merged,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : 'Failed to detect structure.'
        });
        throw error;
      }
      completed.set(batch.startPage, {
        startPage: batch.startPage,
        pageCount: batch.pageCount,
        result: batchResult
      });
      completedPages += batch.pageCount;
      await options.onExchange?.({
        stage: 'page-batch',
        filePath: batch.filePath,
        fileName: batchFileName,
        startPage: batch.startPage,
        pageCount: batch.pageCount,
        byteSize: batch.byteSize,
        merged: batch.merged,
        durationMs: Date.now() - startedAt,
        result: batchResult
      });
      console.log(
        `[structured-detect] batch-done pages=${formatPageRange(batch.startPage, batch.pageCount)} bytes=${batch.byteSize} ${formatDurationFields(Date.now() - startedAt)} model=${batchResult.model}`
      );
      await publishProgress();
    }
  };

  try {
    await publishProgress();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return mergeStructuredDetectUnitResults(collectPublishedUnits(completed, totalPages));
  } finally {
    await split.cleanup();
  }
}

function collectPublishedUnits(
  completed: Map<number, StructuredDetectUnitResult>,
  publishedPages: number
): StructuredDetectUnitResult[] {
  const units: StructuredDetectUnitResult[] = [];
  let nextPage = 1;
  while (nextPage <= publishedPages) {
    const unit = completed.get(nextPage);
    if (!unit) {
      break;
    }
    units.push(unit);
    nextPage += unit.pageCount;
  }
  return units;
}

function formatPageRange(startPage: number, pageCount: number): string {
  return pageCount <= 1 ? String(startPage) : `${startPage}-${startPage + pageCount - 1}`;
}
