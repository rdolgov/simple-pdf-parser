import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  createCodexResponsesPayload,
  parseCodexResponsesRequest,
  suggestedCodexAttachmentFilename,
  type CodexPromptMessage,
  type MaterializedCodexAttachment
} from './codexResponses.js';
import { createCodexExecPlan } from './codexExecPlan.js';
import type { CodexRequestIntent } from './codexRequestIntents.js';

export type CodexReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export type CodexExecConfig = {
  enabled: boolean;
  command: string;
  workspaceParentDir?: string;
  defaultModel?: string;
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  profile?: string;
  reasoningEffort: CodexReasoningEffort;
  fullAuto: boolean;
  dangerouslyBypassApprovals: boolean;
  skipGitRepoCheck: boolean;
  additionalWritableDirs: string[];
  keepInteractiveWidgetWorkspaces: boolean;
  timeoutMs: number;
};

export type CodexExecutionEvent =
  | { type: 'workspace'; workspaceDir: string; intent: CodexRequestIntent; artifactPaths: string[]; keepWorkspace: boolean }
  | { type: 'progress'; stream: 'stdout' | 'stderr'; line: string }
  | { type: 'phase'; message: string };

export type CodexExecutionDebug = {
  workspaceDir: string;
  keptWorkspace: boolean;
  artifactPaths: string[];
  intent: CodexRequestIntent;
};

export type CodexProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  debug: CodexExecutionDebug;
};

export async function executeCodexResponses(
  body: Buffer,
  config: CodexExecConfig,
  onEvent?: (event: CodexExecutionEvent) => void
): Promise<CodexProxyResponse> {
  if (!config.enabled) {
    throw new Error('Codex proxy is not enabled on this server.');
  }

  const request = parseCodexResponsesRequest(body);
  const workspaceParentDir = config.workspaceParentDir ? resolve(config.workspaceParentDir) : tmpdir();
  if (config.workspaceParentDir) {
    await mkdir(workspaceParentDir, { recursive: true });
  }
  const tempDir = await mkdtemp(join(workspaceParentDir, 'llm-proxy-codex-'));
  let keepWorkspace = false;
  let debug: CodexExecutionDebug | null = null;
  try {
    const materializedMessages = await materializeMessageAttachments(request.messages, tempDir);
    const plan = createCodexExecPlan({
      request,
      materializedMessages,
      workspaceDir: tempDir
    });
    keepWorkspace = config.keepInteractiveWidgetWorkspaces && plan.preserveWorkspaceByDefault;
    debug = {
      workspaceDir: tempDir,
      keptWorkspace: keepWorkspace,
      artifactPaths: plan.artifactPaths.slice(),
      intent: plan.intent
    };
    onEvent?.({
      type: 'workspace',
      workspaceDir: tempDir,
      intent: plan.intent,
      artifactPaths: plan.artifactPaths.slice(),
      keepWorkspace
    });
    const resolvedModel = request.model ?? config.defaultModel ?? 'gpt-5-codex';
    const args = buildCodexExecArgs({
      config,
      model: resolvedModel,
      workspaceDir: tempDir,
      outputFile: plan.outputLastMessagePath,
      imageAttachments: materializedMessages.flatMap((message) => message.attachments.filter((item) => item.kind === 'image'))
    });

    await runCodexExec({
      command: config.command,
      args,
      prompt: plan.prompt,
      cwd: tempDir,
      timeoutMs: config.timeoutMs,
      onEvent
    });

    const text = (await plan.readResponseText()).trim();
    onEvent?.({ type: 'phase', message: 'response artifacts read successfully' });

    return {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: Buffer.from(JSON.stringify(createCodexResponsesPayload(text, resolvedModel)), 'utf8'),
      debug: debug ?? {
        workspaceDir: tempDir,
        keptWorkspace: keepWorkspace,
        artifactPaths: [],
        intent: plan.intent
      }
    };
  } finally {
    if (keepWorkspace) {
      onEvent?.({ type: 'phase', message: `preserving workspace at ${tempDir}` });
    } else {
      await rm(tempDir, { recursive: true, force: true });
      onEvent?.({ type: 'phase', message: `removed workspace ${tempDir}` });
    }
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
  workspaceDir: string;
  outputFile: string;
  imageAttachments: MaterializedCodexAttachment[];
}): string[] {
  const args = ['exec', '--color', 'never', '--ephemeral', '-C', resolve(input.workspaceDir)];

  if (input.config.profile) {
    args.push('--profile', input.config.profile);
  }

  args.push('--model', input.model);
  args.push('-c', `model_reasoning_effort="${input.config.reasoningEffort}"`);

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

  const addDirs = new Set<string>(input.config.additionalWritableDirs.map((entry) => resolve(entry)));
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
  onEvent?: (event: CodexExecutionEvent) => void;
}): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    input.onEvent?.({ type: 'phase', message: `starting codex exec in ${input.cwd}` });
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
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill('SIGTERM');
    }, Math.max(1_000, input.timeoutMs));
    const hardKillTimer = setTimeout(() => {
      if (didTimeout) {
        child.kill('SIGKILL');
      }
    }, Math.max(6_000, input.timeoutMs + 5_000));

    const logStdoutLine = createLineEmitter((line) => {
      input.onEvent?.({ type: 'progress', stream: 'stdout', line });
    });
    const logStderrLine = createLineEmitter((line) => {
      input.onEvent?.({ type: 'progress', stream: 'stderr', line });
    });

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      logStdoutLine(text);
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      logStderrLine(text);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      clearTimeout(hardKillTimer);
      rejectPromise(new Error(`Unable to start codex exec: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(hardKillTimer);
      logStdoutLine.flush();
      logStderrLine.flush();
      if (didTimeout) {
        const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        rejectPromise(
          new Error(
            details
              ? `codex exec timed out after ${input.timeoutMs}ms: ${details}`
              : `codex exec timed out after ${input.timeoutMs}ms`
          )
        );
        return;
      }
      if (code === 0) {
        input.onEvent?.({ type: 'phase', message: 'codex exec finished successfully' });
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

function createLineEmitter(onLine: (line: string) => void): { (chunk: string): void; flush: () => void } {
  let buffer = '';
  const emit = ((chunk: string) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        onLine(line);
      }
    }
  }) as { (chunk: string): void; flush: () => void };
  emit.flush = () => {
    const line = buffer.trim();
    buffer = '';
    if (line.length > 0) {
      onLine(line);
    }
  };
  return emit;
}
