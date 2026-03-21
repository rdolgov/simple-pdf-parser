import type { ChartConfiguration } from 'chart.js';
import { resolveGeminiBinaryInputModel } from '../../../src/query/geminiModelSelection';
import type { StructuredExtractProvider } from '../../../src/query/structuredExtractApi';
import type { ExtractedTable } from '../types';
import { createTransportedGeminiApi, createTransportedOpenAiApi } from './llmClients';
import { isOpenAiCompatibleAppProvider, type ImageCapableProvider } from './providerMetadata';
import {
  buildAiChartImagePrompt,
  buildAiInteractiveChartPrompt,
  buildChartConfiguration,
  parseAiTableChartSpec,
  tableToRows
} from './tableChartSpec';

export interface AiInteractiveTableChartResult {
  title?: string;
  note?: string;
  config: ChartConfiguration;
  text: string;
  raw: unknown;
  model: string;
}

export interface AiTableChartImageResult {
  dataUri: string;
  mimeType?: string;
  prompt?: string;
  raw: unknown;
  model: string;
}

export async function generateAiInteractiveTableChart(params: {
  table: ExtractedTable;
  provider: StructuredExtractProvider;
  apiKey: string;
  model?: string;
}): Promise<AiInteractiveTableChartResult> {
  const rows = tableToRows(params.table);
  if (rows.length < 2) {
    throw new Error('Not enough table data to generate a chart.');
  }

  const prompt = buildAiInteractiveChartPrompt(rows);
  if (isOpenAiCompatibleAppProvider(params.provider)) {
    const client = createTransportedOpenAiApi(
      {
        apiKey: params.apiKey,
        ...(params.model ? { model: params.model } : {})
      },
      params.provider
    );
    const response = await client.generateText(prompt, {
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1800,
        responseFormat: { type: 'json_object' }
      }
    });
    const spec = parseAiTableChartSpec(response.text);
    return {
      title: spec.title,
      note: spec.note,
      config: buildChartConfiguration(spec),
      text: response.text,
      raw: response.raw,
      model: response.model
    };
  }

  const client = createTransportedGeminiApi({
    apiKey: params.apiKey,
    ...(params.model ? { model: params.model } : {})
  });
  const response = await client.generateText(prompt, {
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json'
    }
  });
  const spec = parseAiTableChartSpec(response.text);
  return {
    title: spec.title,
    note: spec.note,
    config: buildChartConfiguration(spec),
    text: response.text,
    raw: response.raw,
    model: response.model
  };
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
    const client = createTransportedOpenAiApi({
      apiKey: params.apiKey,
      ...(params.model ? { model: params.model } : {})
    }, 'openai');
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
    throw new Error('Gemini image response did not include image data.');
  }
  return {
    dataUri,
    mimeType,
    prompt: response.text,
    raw: response.raw,
    model: response.model
  };
}
