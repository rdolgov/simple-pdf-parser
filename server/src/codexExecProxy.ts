import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildCodexExecPrompt,
  createCodexResponsesPayload,
  parseCodexResponsesRequest,
  suggestedCodexAttachmentFilename,
  type CodexPromptMessage,
  type MaterializedCodexAttachment
} from './codexResponses.js';

export type CodexExecConfig = {
  enabled: boolean;
  command: string;
  workdir: string;
  defaultModel?: string;
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  profile?: string;
  fullAuto: boolean;
  dangerouslyBypassApprovals: boolean;
  skipGitRepoCheck: boolean;
  additionalWritableDirs: string[];
  timeoutMs: number;
};

export type CodexProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export async function executeCodexResponses(body: Buffer, config: CodexExecConfig): Promise<CodexProxyResponse> {
  if (!config.enabled) {
    throw new Error('Codex proxy is not enabled on this server.');
  }

  const request = parseCodexResponsesRequest(body);
  const tempDir = await mkdtemp(join(tmpdir(), 'llm-proxy-codex-'));
  try {
    const materializedMessages = await materializeMessageAttachments(request.messages, tempDir);
    const prompt = buildCodexExecPrompt(request, materializedMessages);
    const outputFile = join(tempDir, 'last-message.txt');
    const resolvedModel = request.model ?? config.defaultModel ?? 'gpt-5-codex';
    const args = buildCodexExecArgs({
      config,
      model: resolvedModel,
      outputFile,
      imageAttachments: materializedMessages.flatMap((message) => message.attachments.filter((item) => item.kind === 'image')),
      tempDir
    });

    await runCodexExec({
      command: config.command,
      args,
      prompt,
      cwd: resolve(config.workdir),
      timeoutMs: config.timeoutMs
    });

    const text = (await readFile(outputFile, 'utf8')).trim();
    if (text.length === 0) {
      throw new Error('codex exec completed without writing a final message.');
    }

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: Buffer.from(JSON.stringify(createCodexResponsesPayload(text, resolvedModel)), 'utf8')
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function materializeMessageAttachments(
  messages: CodexPromptMessage[],
  tempDir: string
): Promise<Array<Omit<CodexPromptMessage, 'attachments'> & { attachments: MaterializedCodexAttachment[] }>> {
  const results: Array<Omit<CodexPromptMessage, 'attachments'> & { attachments: MaterializedCodexAttachment[] }> = [];

  for (const message of messages) {
    const attachments: MaterializedCodexAttachment[] = [];
    for (const [index, attachment] of message.attachments.entries()) {
      const filename = suggestedCodexAttachmentFilename(attachment, index);
      const path = join(tempDir, filename);
      await writeFile(path, attachment.data);
      attachments.push({
        id: attachment.id,
        kind: attachment.kind,
        filename,
        mimeType: attachment.mimeType,
        path
      });
    }
    results.push({
      role: message.role,
      textParts: message.textParts,
      attachments
    });
  }

  return results;
}

function buildCodexExecArgs(input: {
  config: CodexExecConfig;
  model: string;
  outputFile: string;
  imageAttachments: MaterializedCodexAttachment[];
  tempDir: string;
}): string[] {
  const args = ['exec', '--color', 'never', '--ephemeral', '-C', resolve(input.config.workdir)];

  if (input.config.profile) {
    args.push('--profile', input.config.profile);
  }

  args.push('--model', input.model);

  if (input.config.dangerouslyBypassApprovals) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    if (input.config.fullAuto) {
      args.push('--full-auto');
    } else {
      args.push('--sandbox', input.config.sandboxMode);
    }
  }

  if (input.config.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }

  const addDirs = new Set<string>([resolve(input.tempDir), ...input.config.additionalWritableDirs.map((entry) => resolve(entry))]);
  addDirs.forEach((directory) => {
    args.push('--add-dir', directory);
  });

  input.imageAttachments.forEach((attachment) => {
    args.push('--image', attachment.path);
  });

  args.push('--output-last-message', input.outputFile, '-');
  return args;
}

async function runCodexExec(input: {
  command: string;
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
}): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        NO_COLOR: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, Math.max(1_000, input.timeoutMs));

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      rejectPromise(new Error(`Unable to start codex exec: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
      const failure = signal
        ? `codex exec terminated by signal ${signal}`
        : `codex exec exited with status ${code ?? 'unknown'}`;
      rejectPromise(new Error(details ? `${failure}: ${details}` : failure));
    });

    child.stdin.end(input.prompt);
  });
}
