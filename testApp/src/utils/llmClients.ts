import {
  GeminiAPI,
  OpenAiAPI,
  StructuredExtractAPI,
  type EmbeddingApiConfig,
  type EmbeddingProvider,
  type GeminiApiConfig,
  type OpenAiApiConfig,
  type RelevanceServiceConfig,
  type StructuredExtractApiConfig,
  type StructuredExtractProvider
} from 'pdf-layout-parser';
import {
  DEFAULT_PROXY_RUNTIME_TOKEN,
  getLlmProxyAuthToken,
  getLlmProxyBaseUrl,
  isProxyTransportEnabled
} from './llmTransportSettings';

type RemoteProvider = Extract<EmbeddingProvider, 'gemini' | 'openai'>;

export function hasRuntimeProviderAccess(
  provider: StructuredExtractProvider,
  directApiKey?: string | null
): boolean {
  if (isProxyTransportEnabled()) {
    return true;
  }
  return normalizeNonEmpty(directApiKey).length > 0;
}

export function resolveRuntimeProviderApiKey(
  provider: StructuredExtractProvider,
  directApiKey?: string | null
): string {
  if (!isProxyTransportEnabled()) {
    return normalizeNonEmpty(directApiKey);
  }

  const proxyToken = normalizeNonEmpty(getLlmProxyAuthToken());
  if (proxyToken.length > 0) {
    return proxyToken;
  }

  return `${DEFAULT_PROXY_RUNTIME_TOKEN}-${provider}`;
}

export function resolveProxyProviderBaseUrl(provider: RemoteProvider): string {
  return joinUrl(getLlmProxyBaseUrl(), provider);
}

export function createTransportedOpenAiApi(
  config: Omit<OpenAiApiConfig, 'apiKey' | 'endpoint'> & { apiKey?: string | null; endpoint?: string }
): OpenAiAPI {
  return new OpenAiAPI({
    ...config,
    apiKey: resolveRuntimeProviderApiKey('openai', config.apiKey),
    endpoint: isProxyTransportEnabled() ? resolveProxyProviderBaseUrl('openai') : config.endpoint
  });
}

export function createTransportedGeminiApi(
  config: Omit<GeminiApiConfig, 'apiKey' | 'endpoint'> & { apiKey?: string | null; endpoint?: string }
): GeminiAPI {
  const endpoint = isProxyTransportEnabled() ? resolveProxyProviderBaseUrl('gemini') : config.endpoint;
  return new GeminiAPI({
    ...config,
    apiKey: resolveRuntimeProviderApiKey('gemini', config.apiKey),
    ...(endpoint ? { endpoint } : {})
  });
}

export function createTransportedStructuredExtractApi(config: StructuredExtractApiConfig): StructuredExtractAPI {
  const provider = config.provider ?? 'gemini';
  const endpoint = isProxyTransportEnabled() ? resolveProxyProviderBaseUrl(provider) : config.endpoint;
  return new StructuredExtractAPI({
    ...config,
    provider,
    apiKey: resolveRuntimeProviderApiKey(provider, config.apiKey),
    ...(endpoint ? { endpoint } : {})
  });
}

export function applyTransportToEmbeddingConfig(config: EmbeddingApiConfig): EmbeddingApiConfig {
  if (config.provider !== 'openai' && config.provider !== 'gemini') {
    return config;
  }

  return {
    ...config,
    apiKey: resolveRuntimeProviderApiKey(config.provider, config.apiKey),
    endpoint: isProxyTransportEnabled() ? resolveProxyProviderBaseUrl(config.provider) : config.endpoint
  };
}

export function applyTransportToRelevanceConfig(config: RelevanceServiceConfig): RelevanceServiceConfig {
  return {
    ...config,
    apiKey: resolveRuntimeProviderApiKey('openai', config.apiKey),
    endpoint: isProxyTransportEnabled() ? resolveProxyProviderBaseUrl('openai') : config.endpoint
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = toAbsoluteBrowserUrl(baseUrl).replace(/\/+$/, '');
  return `${normalizedBase}/${path.replace(/^\/+/, '')}`;
}

function normalizeNonEmpty(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function toAbsoluteBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${trimmed}`;
  }
  return trimmed;
}
