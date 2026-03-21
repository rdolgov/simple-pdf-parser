import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { TaskStore } from '../server/src/taskStore';

describe('TaskStore llm exchange archive', () => {
  it('writes a per-document exchange artifact and redacts binary-like payloads', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'simple-pdf-parser-task-store-'));

    try {
      const store = new TaskStore(dataDir);
      const document = await store.createOrUpdateDocument({
        actor: 'vesperz',
        fileHash: 'abc123',
        fileName: 'Biology.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('%PDF-test')
      });

      const artifactPath = await store.recordLlmExchange({
        actor: 'vesperz',
        documentId: document.id,
        taskType: 'document-detect-structure',
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        status: 'succeeded',
        stage: 'page-batch',
        request: {
          prompt: 'Extract this PDF into structured JSON.',
          filePath: '/tmp/page-1.pdf'
        },
        response: {
          rawText: '{"pages":[{"page_number":1,"elements":[]}]}',
          dataUri: 'data:image/png;base64,' + 'A'.repeat(3000)
        }
      });

      const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Record<string, unknown>;
      expect(artifact.documentFileName).toBe('Biology.pdf');
      expect(artifact.documentFilePath).toContain(document.id);
      expect((artifact.request as Record<string, unknown>).prompt).toBe('Extract this PDF into structured JSON.');
      expect((artifact.response as Record<string, unknown>).rawText).toBe('{"pages":[{"page_number":1,"elements":[]}]}');
      expect((artifact.response as Record<string, unknown>).dataUri).toContain('<redacted binary-like string');

      const exchangeFiles = await readdir(join(dataDir, 'llm-exchanges', document.id));
      expect(exchangeFiles.length).toBe(1);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
