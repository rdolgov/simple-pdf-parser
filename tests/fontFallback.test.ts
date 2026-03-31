import { describe, expect, it } from 'vitest';

import { resolveCanvasFontFallback } from '../src/viewer/fontFallback.js';

describe('resolveCanvasFontFallback', () => {
  it('routes Cambria-like document fonts to a serif fallback stack', () => {
    const resolved = resolveCanvasFontFallback('Cambria', '12px sans-serif');

    expect(resolved).toContain("'Times New Roman'");
    expect(resolved).toContain('serif');
    expect(resolved).not.toBe('sans-serif');
  });
});
