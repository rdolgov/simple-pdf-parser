import type { ExtractedTable } from '../types';
import { generateTableInfographicTask } from '../api/proxyTaskApi';
import { type ImageCapableProvider } from './providerMetadata';
import { buildAiChartImagePrompt, tableToRows } from './tableChartSpec';

export interface AiTableChartImageResult {
  dataUri: string;
  mimeType?: string;
  prompt?: string;
  raw: unknown;
  model: string;
}

export async function generateAiTableChartImage(params: {
  table: ExtractedTable;
  taskDocumentId?: string | null;
  provider: ImageCapableProvider;
  model?: string;
}): Promise<AiTableChartImageResult> {
  const rows = tableToRows(params.table);
  if (rows.length < 2) {
    throw new Error('Not enough table data to generate a chart image.');
  }

  const prompt = buildAiChartImagePrompt(rows);
  const response = await generateTableInfographicTask({
    ...(params.taskDocumentId ? { documentId: params.taskDocumentId } : {}),
    prompt,
    provider: params.provider,
    ...(params.model ? { model: params.model } : {})
  });
  return {
    dataUri: response.dataUri,
    mimeType: response.mimeType,
    prompt: response.prompt,
    raw: response,
    model: response.model
  };
}
