import { Buffer } from 'node:buffer';
import {
  OpenAiRelevanceService,
  type HtmlDocumentLayout,
  type OpenAiCompatibleProvider,
  type RelevanceResponse
} from '../../src/index.js';
import { executeCodexResponses, type CodexExecConfig } from './codexExecProxy.js';

export interface TaskRelevanceConfig {
  openAiBaseUrl: string;
  openAiApiKey?: string;
  codexExec: CodexExecConfig;
}

export async function executeRelevanceTask(
  input: {
    provider?: OpenAiCompatibleProvider;
    model?: string;
    query: string;
    document: HtmlDocumentLayout;
    maxContextTokens?: number;
  },
  config: TaskRelevanceConfig
): Promise<RelevanceResponse> {
  const provider = input.provider ?? 'openai';
  if (provider === 'codex') {
    if (!config.codexExec.enabled) {
      throw new Error('CODEX_EXEC_ENABLED is not configured on the proxy server.');
    }
    const service = new OpenAiRelevanceService(
      {
        provider: 'codex',
        apiKey: 'proxy-codex',
        model: input.model
      },
      async () => ({
        responses: {
          create: async (payload: Record<string, unknown>) => {
            const response = await executeCodexResponses(Buffer.from(JSON.stringify(payload), 'utf8'), config.codexExec);
            const rawText = response.body.toString('utf8');
            if (response.status < 200 || response.status >= 300) {
              throw new Error(rawText || `Codex relevance request failed with status ${response.status}.`);
            }
            return JSON.parse(rawText) as Record<string, unknown>;
          }
        }
      })
    );
    return service.analyze({
      query: input.query,
      document: input.document,
      maxContextTokens: input.maxContextTokens
    });
  }

  if (!config.openAiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured on the proxy server.');
  }

  const service = new OpenAiRelevanceService({
    provider: 'openai',
    apiKey: config.openAiApiKey,
    endpoint: config.openAiBaseUrl,
    ...(input.model?.trim() ? { model: input.model.trim() } : {})
  });
  return service.analyze({
    query: input.query,
    document: input.document,
    maxContextTokens: input.maxContextTokens
  });
}
