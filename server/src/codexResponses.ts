import { createHash } from 'node:crypto';
import { extname } from 'node:path';

type JsonRecord = Record<string, unknown>;

export type CodexResponsesRequest = {
  model?: string;
  input?: string | CodexResponseMessage[];
  instructions?: string;
};

export type CodexResponseMessage = {
  role?: string;
  content?: string | CodexResponseInputPart[];
};

export type CodexResponseInputPart =
  | { type?: 'input_text'; text?: string }
  | { type?: 'input_image'; image_url?: string }
  | { type?: 'input_file'; filename?: string; file_data?: string };

export type CodexPromptAttachment = {
  id: string;
  kind: 'image' | 'file';
  mimeType: string;
  filename: string;
  data: Buffer;
};

export type CodexPromptMessage = {
  role: string;
  textParts: string[];
  attachments: CodexPromptAttachment[];
};

export type ParsedCodexResponsesRequest = {
  model?: string;
  instructions?: string;
  messages: CodexPromptMessage[];
};

export type MaterializedCodexAttachment = {
  id: string;
  kind: 'image' | 'file';
  filename: string;
  mimeType: string;
  path: string;
};

export function parseCodexResponsesRequest(body: Buffer): ParsedCodexResponsesRequest {
  const raw = body.length > 0 ? safeParseJson(body.toString('utf8')) : {};
  const request = isRecord(raw) ? raw as CodexResponsesRequest : {};

  return {
    model: normalizeNonEmptyString(request.model),
    instructions: normalizeNonEmptyString(request.instructions),
    messages: normalizeInputMessages(request.input)
  };
}

export function buildCodexExecPrompt(
  request: ParsedCodexResponsesRequest,
  materializedMessages: CodexPromptMessageWithPaths[]
): string {
  if (
    !request.instructions &&
    materializedMessages.length === 1 &&
    materializedMessages[0]?.role === 'user' &&
    materializedMessages[0].attachments.length === 0 &&
    materializedMessages[0].textParts.length === 1
  ) {
    return materializedMessages[0].textParts[0]!;
  }

  const sections: string[] = [];

  if (request.instructions) {
    sections.push(`System instructions:\n${request.instructions}`);
  }

  materializedMessages.forEach((message, index) => {
    const lines: string[] = [];
    if (message.textParts.length > 0) {
      lines.push(message.textParts.join('\n\n'));
    }

    if (message.attachments.length > 0) {
      const attachmentLines = message.attachments.map((attachment) => {
        const prefix = attachment.kind === 'image' ? 'Image' : 'File';
        return `- ${prefix}: ${attachment.path} (${attachment.filename}, ${attachment.mimeType})`;
      });
      lines.push(
        [
          'Attached local inputs:',
          ...attachmentLines,
          'Use the local paths above directly when they are relevant to the request.'
        ].join('\n')
      );
    }

    sections.push(`${formatRoleLabel(message.role)} message ${index + 1}:\n${lines.join('\n\n')}`.trim());
  });

  return sections.join('\n\n');
}

export function createCodexResponsesPayload(text: string, model: string): JsonRecord {
  const created = Math.floor(Date.now() / 1000);
  return {
    id: `codex-resp-${createHash('sha1').update(`${created}:${model}:${text}`).digest('hex').slice(0, 12)}`,
    object: 'response',
    created,
    model,
    status: 'completed',
    output_text: text,
    output: [
      {
        id: `msg_${created}`,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text
          }
        ]
      }
    ]
  };
}

export function suggestedCodexAttachmentFilename(attachment: CodexPromptAttachment, index: number): string {
  const normalizedBase = sanitizeFilename(stripExtension(attachment.filename)) || `${attachment.kind}-${index + 1}`;
  const extension = normalizeExtension(attachment.filename, attachment.mimeType, attachment.kind);
  return `${normalizedBase}${extension}`;
}

type CodexPromptMessageWithPaths = {
  role: string;
  textParts: string[];
  attachments: MaterializedCodexAttachment[];
};

function normalizeInputMessages(input: CodexResponsesRequest['input']): CodexPromptMessage[] {
  if (typeof input === 'string') {
    return [
      {
        role: 'user',
        textParts: input.trim().length > 0 ? [input] : [],
        attachments: []
      }
    ];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((message) => normalizeMessage(message))
    .filter((message): message is CodexPromptMessage => Boolean(message));
}

function normalizeMessage(value: unknown): CodexPromptMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = normalizeNonEmptyString(value.role) ?? 'user';
  const rawContent = value.content;
  if (typeof rawContent === 'string') {
    return {
      role,
      textParts: rawContent.trim().length > 0 ? [rawContent] : [],
      attachments: []
    };
  }

  const textParts: string[] = [];
  const attachments: CodexPromptAttachment[] = [];
  if (Array.isArray(rawContent)) {
    rawContent.forEach((part, index) => {
      const normalized = normalizePart(part, attachments.length + index);
      if (!normalized) {
        return;
      }
      if (typeof normalized === 'string') {
        textParts.push(normalized);
        return;
      }
      attachments.push(normalized);
    });
  }

  return { role, textParts, attachments };
}

function normalizePart(value: unknown, index: number): string | CodexPromptAttachment | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = normalizeNonEmptyString(value.type);
  if (type === 'input_text') {
    const text = normalizeNonEmptyString(value.text);
    return text ?? '';
  }

  if (type === 'input_image') {
    const imageUrl = normalizeNonEmptyString(value.image_url);
    if (!imageUrl) {
      return null;
    }
    const parsed = parseDataUrl(imageUrl);
    return {
      id: `image-${index + 1}`,
      kind: 'image',
      filename: inferFilename(parsed.mimeType, 'image'),
      mimeType: parsed.mimeType,
      data: parsed.data
    };
  }

  if (type === 'input_file') {
    const fileData = normalizeNonEmptyString(value.file_data);
    if (!fileData) {
      return null;
    }
    const parsed = parseDataUrl(fileData);
    return {
      id: `file-${index + 1}`,
      kind: 'file',
      filename: sanitizeFilename(normalizeNonEmptyString(value.filename) ?? inferFilename(parsed.mimeType, 'file')),
      mimeType: parsed.mimeType,
      data: parsed.data
    };
  }

  return null;
}

function parseDataUrl(value: string): { mimeType: string; data: Buffer } {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(value.trim());
  if (!match) {
    throw new Error('Codex proxy supports only base64 data URLs for inline images/files.');
  }
  return {
    mimeType: match[1]?.trim() || 'application/octet-stream',
    data: Buffer.from(match[2]!, 'base64')
  };
}

function inferFilename(mimeType: string, kind: 'image' | 'file'): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === 'application/pdf') {
    return 'document.pdf';
  }
  if (normalized === 'application/json') {
    return 'document.json';
  }
  if (normalized.startsWith('image/')) {
    return `image.${normalized.slice('image/'.length)}`;
  }
  return kind === 'image' ? 'image.bin' : 'attachment.bin';
}

function formatRoleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized.length === 0) {
    return 'User';
  }
  return normalized[0]!.toUpperCase() + normalized.slice(1);
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function stripExtension(value: string): string {
  const extension = extname(value);
  return extension.length > 0 ? value.slice(0, -extension.length) : value;
}

function normalizeExtension(filename: string, mimeType: string, kind: 'image' | 'file'): string {
  const existing = extname(filename).toLowerCase();
  if (existing.length > 0) {
    return existing;
  }

  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime === 'application/pdf') {
    return '.pdf';
  }
  if (normalizedMime === 'application/json') {
    return '.json';
  }
  if (normalizedMime.startsWith('image/')) {
    return `.${normalizedMime.slice('image/'.length)}`;
  }
  return kind === 'image' ? '.img' : '.bin';
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON request body for Codex proxy: ${(error as Error).message}`);
  }
}
