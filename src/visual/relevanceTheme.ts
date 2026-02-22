import type { AnnotatedHtmlDocumentLayout } from '../query/relevanceTypes.js';
import type { RelevanceState } from '../query/relevanceTypes.js';

export interface RelevanceVisualLayer {
  className: string;
  accentColor?: string;
  borderColor?: string;
  glow?: {
    color: string;
    blurPx: number;
    spreadPx: number;
  };
  overlay?: {
    color: string;
    opacity: number;
  };
  mask?: {
    assetId: string;
    featherPx?: number;
  };
  elevation?: number;
}

export interface RelevanceVisualTheme {
  highlight: RelevanceVisualLayer;
  dim: RelevanceVisualLayer;
  hidden: RelevanceVisualLayer;
  animation?: {
    durationMs: number;
    easing: string;
  };
  tornEdgeAssetId?: string;
}

export interface RelevanceRendererOptions {
  theme?: RelevanceVisualTheme;
  scale?: number;
  animate?: boolean;
}

export interface RelevanceRenderPlan {
  layout: AnnotatedHtmlDocumentLayout;
  theme: RelevanceVisualTheme;
  scale: number;
  animate: boolean;
}

export const DEFAULT_THEME: RelevanceVisualTheme = {
  highlight: {
    className: 'relevance-highlight',
    accentColor: '#f59e0b',
    borderColor: 'rgba(245, 158, 11, 0.6)',
    glow: { color: 'rgba(245, 158, 11, 0.45)', blurPx: 22, spreadPx: 4 },
    elevation: 2
  },
  dim: {
    className: 'relevance-dim',
    overlay: { color: '#0f172a', opacity: 0.35 },
    elevation: -1
  },
  hidden: {
    className: 'relevance-hidden',
    overlay: { color: '#0f172a', opacity: 0.65 },
    mask: { assetId: 'torn-edge', featherPx: 12 },
    elevation: -2
  },
  animation: {
    durationMs: 320,
    easing: 'cubic-bezier(0.33, 1, 0.68, 1)'
  },
  tornEdgeAssetId: 'torn-edge'
};

export function createRelevanceRenderPlan(
  layout: AnnotatedHtmlDocumentLayout,
  options: RelevanceRendererOptions = {}
): RelevanceRenderPlan {
  return {
    layout,
    theme: options.theme ?? DEFAULT_THEME,
    scale: options.scale ?? 1,
    animate: options.animate ?? true
  };
}

export function resolveLayerForState(theme: RelevanceVisualTheme, state: RelevanceState): RelevanceVisualLayer {
  switch (state) {
    case 'highlight':
      return theme.highlight;
    case 'dim':
      return theme.dim;
    case 'hidden':
    default:
      return theme.hidden;
  }
}

export function collectClassNames(theme: RelevanceVisualTheme, state: RelevanceState): string[] {
  const layer = resolveLayerForState(theme, state);
  const classes = [layer.className];
  if (state === 'hidden' && theme.tornEdgeAssetId) {
    classes.push(`relevance-mask-${theme.tornEdgeAssetId}`);
  }
  return classes;
}
