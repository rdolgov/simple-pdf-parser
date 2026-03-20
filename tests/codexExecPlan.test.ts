import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCodexExecPlan } from '../server/src/codexExecPlan';
import type { ParsedCodexResponsesRequest } from '../server/src/codexResponses';

describe('codexExecPlan', () => {
  it('reads the plain last assistant message for generic requests', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'codex-plan-test-'));
    try {
      const plan = createCodexExecPlan({
        request: {
          messages: [
            {
              role: 'user',
              textParts: ['Reply with exactly: ok'],
              attachments: []
            }
          ]
        } satisfies ParsedCodexResponsesRequest,
        materializedMessages: [
          {
            role: 'user',
            textParts: ['Reply with exactly: ok'],
            attachments: []
          }
        ],
        workspaceDir
      });

      await writeFile(plan.outputLastMessagePath, 'ok\n', 'utf8');

      await expect(plan.readResponseText()).resolves.toBe('ok');
      expect(plan.intent).toBe('generic');
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('reads widget response.json for interactive widget requests', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'codex-plan-test-'));
    try {
      const plan = createCodexExecPlan({
        request: {
          messages: [
            {
              role: 'user',
              textParts: ['Create widget.\nProtocol marker: interactive_widget_v1'],
              attachments: []
            }
          ]
        } satisfies ParsedCodexResponsesRequest,
        materializedMessages: [
          {
            role: 'user',
            textParts: ['Create widget.\nProtocol marker: interactive_widget_v1'],
            attachments: []
          }
        ],
        workspaceDir
      });

      await writeFile(join(workspaceDir, 'response.json'), JSON.stringify({
        title: 'Attention explorer',
        html: '<div>demo</div>',
        css: '.demo { color: red; }',
        js: 'console.log("ok");'
      }), 'utf8');

      await expect(plan.readResponseText()).resolves.toBe(
        JSON.stringify({
          title: 'Attention explorer',
          html: '<div>demo</div>',
          css: '.demo { color: red; }',
          js: 'console.log("ok");'
        })
      );
      expect(plan.intent).toBe('interactive-widget');
      expect(plan.prompt).toContain('response.json');
      expect(plan.prompt).toContain('widget.html');
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('falls back to widget artifact files when response.json is missing', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'codex-plan-test-'));
    try {
      const plan = createCodexExecPlan({
        request: {
          messages: [
            {
              role: 'user',
              textParts: ['Create widget.\nProtocol marker: interactive_widget_v1'],
              attachments: []
            }
          ]
        } satisfies ParsedCodexResponsesRequest,
        materializedMessages: [
          {
            role: 'user',
            textParts: ['Create widget.\nProtocol marker: interactive_widget_v1'],
            attachments: []
          }
        ],
        workspaceDir
      });

      await writeFile(join(workspaceDir, 'widget.html'), '<div>demo</div>', 'utf8');
      await writeFile(join(workspaceDir, 'widget.css'), '.demo { color: red; }', 'utf8');
      await writeFile(join(workspaceDir, 'widget.js'), 'console.log("ok");', 'utf8');
      await writeFile(plan.outputLastMessagePath, 'WROTE response.json', 'utf8');

      await expect(plan.readResponseText()).resolves.toBe(
        JSON.stringify({
          title: 'Interactive explainer',
          html: '<div>demo</div>',
          css: '.demo { color: red; }',
          js: 'console.log("ok");'
        })
      );
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
