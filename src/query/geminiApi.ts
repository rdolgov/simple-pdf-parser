import { GoogleGenAI } from '@google/genai';
import { normalizeProviderApiError } from './apiErrorUtils.js';

export type GeminiContent = string | GeminiContentParts | GeminiContentParts[];

export interface GeminiContentParts {
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineDataInput;
}

export interface GeminiInlineDataInput {
  mimeType: string;
  data: string;
}

export interface GeminiToolConfig {
  googleSearch?: Record<string, unknown>;
}

/**
 * Creates a tool config that enables Google Search grounding.
 * When used, Gemini can search the web to find relevant information.
 */
export function createGoogleSearchTool(): GeminiToolConfig {
  return { googleSearch: {} };
}

export interface GeminiApiConfig {
  apiKey: string;
  model?: string;
  imageModel?: string;
  apiVersion?: string;
  imageApiVersion?: string;
  endpoint?: string;
  generationConfig?: Record<string, unknown>;
  safetySettings?: Array<Record<string, unknown>>;
  tools?: GeminiToolConfig[];
}

export interface GeminiGenerateRequest {
  contents: GeminiContent;
  model?: string;
  generationConfig?: Record<string, unknown>;
  safetySettings?: Array<Record<string, unknown>>;
  tools?: GeminiToolConfig[];
}

export interface GeminiGenerateResult {
  text: string;
  raw: GeminiGenerateContentResponse;
  model: string;
}

export interface GeminiGeneratedImage {
  data: string;
  mimeType?: string;
}

export interface GeminiGenerateImageResult {
  images: GeminiGeneratedImage[];
  text?: string;
  raw: GeminiGenerateContentResponse;
  model: string;
}

export interface GeminiGenerateContentResponse {
  text?: string;
  response?: GeminiInnerResponse;
  candidates?: GeminiCandidate[];
}

const DEFAULT_GEMINI_MODEL = 'gemini-3-pro-preview';
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_GEMINI_API_VERSION = 'v1beta';
const DEFAULT_GEMINI_IMAGE_API_VERSION = 'v1alpha';

interface GeminiInnerResponse {
  text?: string;
  candidates?: GeminiCandidate[];
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiContentPartResponse[];
  };
}

interface GeminiContentPartResponse {
  text?: string;
  inlineData?: GeminiInlineDataResponse;
}

interface GeminiInlineDataResponse {
  data: string;
  mimeType?: string;
}

interface GoogleGenAiClient {
  models: {
    generateContent(request: GeminiGenerateContentRequest): Promise<GeminiGenerateContentResponse>;
  };
}

interface GeminiGenerateContentRequest {
  model: string;
  contents: GeminiContent;
  config?: Record<string, unknown>;
  safetySettings?: Array<Record<string, unknown>>;
  tools?: GeminiToolConfig[];
}

export class GeminiAPI {
  private readonly client?: GoogleGenAiClient;
  private readonly clientAlpha?: GoogleGenAiClient;
  private readonly apiKey: string;
  private readonly endpoint?: string;
  private readonly defaultApiVersion: string;
  private readonly defaultImageApiVersion: string;
  private readonly useRestTransport: boolean;
  private readonly defaultModel: string;
  private readonly defaultImageModel: string;
  private readonly defaultGenerationConfig?: Record<string, unknown>;
  private readonly defaultSafetySettings?: Array<Record<string, unknown>>;
  private readonly defaultTools?: GeminiToolConfig[];

  constructor(config: GeminiApiConfig) {
    if (!config.apiKey) {
      throw new Error('GeminiAPI requires an apiKey');
    }
    this.apiKey = config.apiKey;
    this.endpoint = normalizeOptionalGeminiEndpointBase(config.endpoint);
    this.defaultApiVersion = normalizeGeminiApiVersion(config.apiVersion, DEFAULT_GEMINI_API_VERSION);
    this.defaultImageApiVersion = normalizeGeminiApiVersion(
      config.imageApiVersion,
      DEFAULT_GEMINI_IMAGE_API_VERSION
    );
    this.useRestTransport = Boolean(this.endpoint);

    if (!this.useRestTransport) {
      // Standard client for text generation
      this.client = new GoogleGenAI({
        apiKey: config.apiKey,
        ...(config.apiVersion ? { apiVersion: config.apiVersion } : {})
      }) as unknown as GoogleGenAiClient;
      // Alpha client for image generation and high-res image input
      this.clientAlpha = new GoogleGenAI({
        apiKey: config.apiKey,
        apiVersion: config.imageApiVersion ?? DEFAULT_GEMINI_IMAGE_API_VERSION
      }) as unknown as GoogleGenAiClient;
    }

    this.defaultModel = config.model ?? DEFAULT_GEMINI_MODEL;
    this.defaultImageModel = config.imageModel ?? DEFAULT_GEMINI_IMAGE_MODEL;
    this.defaultGenerationConfig = config.generationConfig;
    this.defaultSafetySettings = config.safetySettings;
    this.defaultTools = config.tools;
  }

  /**
   * Generate text from a simple prompt string
   */
  async generateText(prompt: string, options?: Omit<GeminiGenerateRequest, 'contents'>): Promise<GeminiGenerateResult> {
    return this.generateContent({
      contents: prompt,
      ...options
    });
  }

  /**
   * Generate text from an image (vision)
   * @param imageData Base64 encoded image data
   * @param mimeType Image MIME type (e.g., 'image/jpeg', 'image/png')
   * @param prompt Text prompt to accompany the image
   * @param options Additional generation options
   */
  async generateFromImage(
    imageData: string,
    mimeType: string,
    prompt: string,
    options?: {
      model?: string;
      mediaResolution?: 'low' | 'medium' | 'high';
      generationConfig?: Record<string, unknown>;
      safetySettings?: Array<Record<string, unknown>>;
    }
  ): Promise<GeminiGenerateResult> {
    const contents: GeminiContentParts = {
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: imageData
          }
        }
      ]
    };

    // Use alpha client for high-res image input
    const useAlpha = options?.mediaResolution === 'high';
    return this.generateContent(
      {
        contents,
        model: options?.model,
        generationConfig: options?.generationConfig,
        safetySettings: options?.safetySettings
      },
      useAlpha
    );
  }

  /**
   * Generate content with full control over the request
   */
  async generateContent(
    request: GeminiGenerateRequest,
    useAlphaClient = false
  ): Promise<GeminiGenerateResult> {
    const payload = this.buildRequest(request);
    let response: GeminiGenerateContentResponse;
    try {
      if (this.useRestTransport) {
        response = await this.sendRestGenerateContent(
          payload,
          useAlphaClient ? this.defaultImageApiVersion : this.defaultApiVersion
        );
      } else {
        const client = useAlphaClient ? this.clientAlpha : this.client;
        if (!client) {
          throw new Error('Gemini client is not initialized');
        }
        response = await client.models.generateContent(payload);
      }
    } catch (error) {
      throw normalizeProviderApiError('Gemini', error);
    }
    const text = extractText(response);
    if (!text) {
      throw new Error('Gemini response did not include text content');
    }
    return { text, raw: response, model: payload.model };
  }

  /**
   * Generate an image from a text prompt
   */
  async generateImage(
    prompt: string,
    options?: Omit<GeminiGenerateRequest, 'contents'>
  ): Promise<GeminiGenerateImageResult> {
    const model = options?.model ?? this.defaultImageModel;
    // Config with required responseModalities for image output
    const config = {
      ...options?.generationConfig,
      responseModalities: ['IMAGE']
      // responseModalities: ['IMAGE', 'TEXT']
    };

    // Contents must be in the structured format with role and parts
    const contents = [
      {
        role: 'user',
        parts: [{ text: `create image for the text: ${prompt}` }]
      }
    ];

    const payload = {
      model,
      config,
      contents
    };

    // Use alpha client for image generation
    let response: GeminiGenerateContentResponse;
    try {
      if (this.useRestTransport) {
        response = await this.sendRestGenerateContent(
          payload as unknown as GeminiGenerateContentRequest,
          this.defaultImageApiVersion
        );
      } else {
        if (!this.clientAlpha) {
          throw new Error('Gemini image client is not initialized');
        }
        response = await this.clientAlpha.models.generateContent(
          payload as unknown as GeminiGenerateContentRequest
        );
      }
    } catch (error) {
      throw normalizeProviderApiError('Gemini', error);
    }
    const images = extractInlineImages(response);
    if (images.length === 0) {
      throw new Error('Gemini response did not include inline image data');
    }

    return { images, text: extractText(response), raw: response, model };
  }

  private async sendRestGenerateContent(
    payload: GeminiGenerateContentRequest,
    apiVersion: string
  ): Promise<GeminiGenerateContentResponse> {
    const fetchImpl = resolveFetch();
    let response: Response;
    try {
      response = await fetchImpl(buildGeminiGenerateContentUrl(this.endpoint, apiVersion, payload.model, this.apiKey), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(toGeminiRestGenerateContentRequest(payload))
      });
    } catch (error) {
      throw normalizeProviderApiError('Gemini', error);
    }

    if (!response.ok) {
      const message = normalizeProviderApiError('Gemini', await safeReadText(response)).message;
      throw new Error(`Gemini request failed with status ${response.status}: ${message}`);
    }

    return (await response.json()) as GeminiGenerateContentResponse;
  }

  private buildRequest(request: GeminiGenerateRequest): GeminiGenerateContentRequest {
    const model = request.model ?? this.defaultModel;
    const config = request.generationConfig ?? this.defaultGenerationConfig;
    const safetySettings = request.safetySettings ?? this.defaultSafetySettings;
    const tools = request.tools ?? this.defaultTools;

    const payload: GeminiGenerateContentRequest = {
      model,
      contents: request.contents
    };

    if (config) {
      payload.config = config;
    }
    if (safetySettings) {
      payload.safetySettings = safetySettings;
    }
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    return payload;
  }
}

function extractText(response: GeminiGenerateContentResponse): string | undefined {
  const directText = normalizeText(response.text);
  if (directText) {
    return directText;
  }

  const nestedText = normalizeText(response.response?.text);
  if (nestedText) {
    return nestedText;
  }

  for (const part of collectContentParts(response)) {
    const text = normalizeText(part.text);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractInlineImages(response: GeminiGenerateContentResponse): GeminiGeneratedImage[] {
  const images: GeminiGeneratedImage[] = [];
  for (const part of collectContentParts(response)) {
    const inlineData = part.inlineData;
    if (inlineData?.data) {
      images.push({ data: inlineData.data, mimeType: inlineData.mimeType });
    }
  }
  return images;
}

function collectContentParts(response: GeminiGenerateContentResponse): GeminiContentPartResponse[] {
  const parts: GeminiContentPartResponse[] = [];
  const candidateSets = [response.response?.candidates ?? [], response.candidates ?? []];
  for (const candidates of candidateSets) {
    for (const candidate of candidates) {
      const contentParts = candidate.content?.parts ?? [];
      for (const part of contentParts) {
        parts.push(part);
      }
    }
  }
  return parts;
}

function normalizeText(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildGeminiGenerateContentUrl(
  endpoint: string | undefined,
  apiVersion: string,
  model: string,
  apiKey: string
): string {
  const base = normalizeGeminiEndpointBase(endpoint);
  const normalizedVersion = normalizeGeminiApiVersion(apiVersion, DEFAULT_GEMINI_API_VERSION);
  const normalizedModel = normalizeGeminiModelId(model);
  const url = new URL(`${base}/${normalizedVersion}/models/${encodeURIComponent(normalizedModel)}:generateContent`);
  if (apiKey.trim().length > 0) {
    url.searchParams.set('key', apiKey.trim());
  }
  return url.toString();
}

function normalizeGeminiEndpointBase(endpoint?: string): string {
  return normalizeOptionalGeminiEndpointBase(endpoint) ?? 'https://generativelanguage.googleapis.com';
}

function normalizeOptionalGeminiEndpointBase(endpoint?: string): string | undefined {
  const trimmed = endpoint?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, '');
}

function normalizeGeminiApiVersion(apiVersion: string | undefined, fallback: string): string {
  const trimmed = apiVersion?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/^\/+|\/+$/g, '');
}

function normalizeGeminiModelId(model: string): string {
  const trimmed = model.trim();
  if (trimmed.startsWith('models/')) {
    return trimmed.slice('models/'.length);
  }
  return trimmed;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function toGeminiRestGenerateContentRequest(payload: GeminiGenerateContentRequest): Record<string, unknown> {
  const request: Record<string, unknown> = {
    contents: normalizeGeminiRestContents(payload.contents)
  };

  if (payload.config) {
    request.generationConfig = payload.config;
  }
  if (payload.safetySettings && payload.safetySettings.length > 0) {
    request.safetySettings = payload.safetySettings;
  }
  if (payload.tools && payload.tools.length > 0) {
    request.tools = payload.tools;
  }

  return request;
}

function normalizeGeminiRestContents(contents: GeminiContent): Array<Record<string, unknown>> {
  if (typeof contents === 'string') {
    return [
      {
        role: 'user',
        parts: [{ text: contents }]
      }
    ];
  }

  if (Array.isArray(contents)) {
    return contents.map((content) => normalizeGeminiRestContent(content));
  }

  return [normalizeGeminiRestContent(contents)];
}

function normalizeGeminiRestContent(content: unknown): Record<string, unknown> {
  if (typeof content === 'string') {
    return {
      role: 'user',
      parts: [{ text: content }]
    };
  }

  if (!isRecord(content)) {
    throw new Error('Gemini REST transport received an unsupported content payload.');
  }

  const rawParts = Array.isArray(content.parts) ? content.parts : [];
  if (rawParts.length === 0) {
    throw new Error('Gemini REST transport requires each content item to include at least one part.');
  }

  return {
    role: typeof content.role === 'string' ? content.role : 'user',
    parts: rawParts.map((part) => normalizeGeminiRestPart(part))
  };
}

function normalizeGeminiRestPart(part: unknown): Record<string, unknown> {
  if (!isRecord(part)) {
    throw new Error('Gemini REST transport received an invalid content part.');
  }

  const normalized: Record<string, unknown> = {};
  if (typeof part.text === 'string') {
    normalized.text = part.text;
  }
  if (isRecord(part.inlineData)) {
    normalized.inlineData = {
      mimeType: part.inlineData.mimeType,
      data: part.inlineData.data
    };
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('Gemini REST transport requires each part to include text or inlineData.');
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveFetch(): typeof fetch {
  if (typeof fetch === 'function') {
    return fetch;
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch;
  }
  throw new Error('A global fetch implementation is required to call the Gemini API.');
}
