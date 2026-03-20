import { describe, expect, it } from 'vitest';

import { getAiExtractionStatusView } from '../testApp/src/utils/aiExtractionStatus';

describe('aiExtractionStatus', () => {
  it('reports parser-only when no AI extraction has run', () => {
    const status = getAiExtractionStatusView({
      extractState: { status: 'idle' },
      geminiExtractionState: { status: 'idle', extraction: null },
      aiDetectionSupport: { supported: true }
    });

    expect(status).toMatchObject({
      label: 'Parser only',
      tone: 'neutral'
    });
  });

  it('reports full AI extracted when both extraction stages are ready', () => {
    const status = getAiExtractionStatusView({
      extractState: { status: 'ready' },
      geminiExtractionState: { status: 'ready', extraction: { documentTitle: '', pages: [] } },
      aiDetectionSupport: { supported: true }
    });

    expect(status).toMatchObject({
      label: 'AI extracted',
      tone: 'ready'
    });
  });

  it('reports partial states when only one AI extraction stage is ready', () => {
    const structuredOnly = getAiExtractionStatusView({
      extractState: { status: 'ready' },
      geminiExtractionState: { status: 'idle', extraction: null },
      aiDetectionSupport: { supported: true }
    });
    const layoutOnly = getAiExtractionStatusView({
      extractState: { status: 'idle' },
      geminiExtractionState: { status: 'ready', extraction: { documentTitle: '', pages: [] } },
      aiDetectionSupport: { supported: true }
    });

    expect(structuredOnly).toMatchObject({
      label: 'AI tables/images',
      tone: 'partial'
    });
    expect(layoutOnly).toMatchObject({
      label: 'AI layout',
      tone: 'partial'
    });
  });
});
