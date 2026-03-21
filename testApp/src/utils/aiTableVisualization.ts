import { resolveGeminiBinaryInputModel } from '../../../src/query/geminiModelSelection';
import type { ExtractedTable } from '../types';
import { createTransportedGeminiApi, createTransportedOpenAiApi } from './llmClients';
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
  provider: ImageCapableProvider;
  apiKey: string;
  model?: string;
}): Promise<AiTableChartImageResult> {
  const rows = tableToRows(params.table);
  if (rows.length < 2) {
    throw new Error('Not enough table data to generate a chart image.');
  }

  const prompt = buildAiChartImagePrompt(rows);
  if (params.provider === 'openai') {
    const client = createTransportedOpenAiApi(
      {
        apiKey: params.apiKey,
        ...(params.model ? { model: params.model } : {})
      },
      'openai'
    );
    const response = await client.generateImage({
      prompt,
      size: '1536x1024',
      background: 'opaque'
    });
    const image = response.images[0];
    const mimeType = image?.mimeType ?? 'image/png';
    const dataUri = image?.data ? `data:${mimeType};base64,${image.data}` : image?.url;
    if (!dataUri) {
      throw new Error('OpenAI image response did not include image data.');
    }
    return {
      dataUri,
      mimeType,
      prompt: response.text,
      raw: response.raw,
      model: response.model
    };
  }

  const geminiModel = resolveGeminiBinaryInputModel(params.model);
  const client = createTransportedGeminiApi({
    apiKey: params.apiKey,
    model: geminiModel,
    imageModel: geminiModel
  });
  const response = await client.generateImage(prompt);
  const image = response.images[0];
  const mimeType = image?.mimeType ?? 'image/png';
  const dataUri = image?.data ? `data:${mimeType};base64,${image.data}` : null;
  if (!dataUri) {
    throw new Error('Gemini image response did not include inline image data.');
  }
  return {
    dataUri,
    mimeType,
    prompt: response.text,
    raw: response.raw,
    model: response.model
  };
}
