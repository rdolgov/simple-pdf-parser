import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  buildCodexExecPrompt,
  type MaterializedCodexAttachment,
  type ParsedCodexResponsesRequest
} from './codexResponses.js';
import { summarizeCodexRequest, type CodexRequestIntent } from './codexRequestIntents.js';

export interface CodexExecPlanInput {
  request: ParsedCodexResponsesRequest;
  materializedMessages: Array<{
    role: string;
    textParts: string[];
    attachments: MaterializedCodexAttachment[];
  }>;
  workspaceDir: string;
}

export interface CodexExecPlan {
  intent: CodexRequestIntent;
  prompt: string;
  outputLastMessagePath: string;
  artifactPaths: string[];
  preserveWorkspaceByDefault: boolean;
  readResponseText: () => Promise<string>;
}

const INTERACTIVE_WIDGET_LAST_MESSAGE = 'WROTE response.json';

export function createCodexExecPlan(input: CodexExecPlanInput): CodexExecPlan {
  const intent = summarizeCodexRequest(input.request).intent;
  const outputLastMessagePath = join(input.workspaceDir, 'last-message.txt');
  const basePrompt = buildCodexExecPrompt(input.request, input.materializedMessages);

  if (intent === 'interactive-widget') {
    return createInteractiveWidgetPlan({
      workspaceDir: input.workspaceDir,
      outputLastMessagePath,
      basePrompt
    });
  }

  return {
    intent,
    prompt: basePrompt,
    outputLastMessagePath,
    artifactPaths: [],
    preserveWorkspaceByDefault: false,
    readResponseText: async () => {
      const text = (await readFile(outputLastMessagePath, 'utf8')).trim();
      if (text.length === 0) {
        throw new Error('codex exec completed without writing a final message.');
      }
      return text;
    }
  };
}

function createInteractiveWidgetPlan(input: {
  workspaceDir: string;
  outputLastMessagePath: string;
  basePrompt: string;
}): CodexExecPlan {
  const responseJsonPath = join(input.workspaceDir, 'response.json');
  const htmlPath = join(input.workspaceDir, 'widget.html');
  const cssPath = join(input.workspaceDir, 'widget.css');
  const jsPath = join(input.workspaceDir, 'widget.js');

  return {
    intent: 'interactive-widget',
    prompt: [
      'You are running inside an isolated temporary workspace that contains only files for this request.',
      'Create the final deliverable by writing these files in the current working directory:',
      `- ${basename(htmlPath)}: HTML fragment only, not a full document`,
      `- ${basename(cssPath)}: CSS styles only`,
      `- ${basename(jsPath)}: JavaScript behavior only`,
      `- ${basename(responseJsonPath)}: JSON object with exactly { "title": string, "html": string, "css": string, "js": string }`,
      'The html/css/js values in response.json must exactly match the file contents you wrote to widget.html, widget.css, and widget.js.',
      'Do not rely on your final chat message for the deliverable.',
      `After writing the files, reply with exactly: ${INTERACTIVE_WIDGET_LAST_MESSAGE}`,
      'Original request:',
      input.basePrompt
    ].join('\n\n'),
    outputLastMessagePath: input.outputLastMessagePath,
    artifactPaths: [responseJsonPath, htmlPath, cssPath, jsPath],
    preserveWorkspaceByDefault: true,
    readResponseText: async () =>
      await readInteractiveWidgetResponse({
        responseJsonPath,
        htmlPath,
        cssPath,
        jsPath,
        lastMessagePath: input.outputLastMessagePath
      })
  };
}

async function readInteractiveWidgetResponse(input: {
  responseJsonPath: string;
  htmlPath: string;
  cssPath: string;
  jsPath: string;
  lastMessagePath: string;
}): Promise<string> {
  const lastMessage = await safeReadText(input.lastMessagePath);
  const responseJson = await safeReadText(input.responseJsonPath);
  const normalizedJson = normalizeInteractiveWidgetJson(responseJson);
  if (normalizedJson) {
    return normalizedJson;
  }

  const html = (await safeReadText(input.htmlPath)).trim();
  if (!html) {
    const suffix = lastMessage.trim().length > 0 ? `; last message: ${lastMessage.trim()}` : '';
    throw new Error(`codex exec completed without writing a valid interactive widget response${suffix}.`);
  }

  return JSON.stringify({
    title: 'Interactive explainer',
    html,
    css: await safeReadText(input.cssPath),
    js: await safeReadText(input.jsPath)
  });
}

function normalizeInteractiveWidgetJson(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const html = normalizeString(record.html).trim();
  if (!html) {
    return null;
  }

  return JSON.stringify({
    title: normalizeString(record.title).trim() || 'Interactive explainer',
    html,
    css: normalizeString(record.css),
    js: normalizeString(record.js)
  });
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function safeReadText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
