import { useEffect, useMemo, useState } from 'react';
import {
  buildHtmlLogicalStructure,
  type HtmlDocumentLayout,
  type HtmlDocumentLogicalStructure
} from 'pdf-layout-parser';
import {
  createLogicalStructureCacheKey,
  loadCachedLogicalStructure,
  saveCachedLogicalStructure
} from '../storage/logicalStructureCache';
import {
  canExtractLogicalStructureWithLlm,
  createLogicalStructureCacheFingerprint,
  extractLlmLogicalStructure,
  loadLogicalStructureRuntimeSettings
} from '../utils/llmLogicalStructure';
import { LLM_TRANSPORT_SETTINGS_CHANGED_EVENT } from '../utils/llmTransportSettings';
import { STRUCTURED_EXTRACT_SETTINGS_CHANGED_EVENT } from '../utils/structuredExtractSettings';

interface UseLogicalStructureOptions {
  fileHash: string;
  taskDocumentId?: string | null;
  htmlLayout: HtmlDocumentLayout | null;
  enabled?: boolean;
}

export function useLogicalStructure({
  fileHash,
  taskDocumentId,
  htmlLayout,
  enabled = true
}: UseLogicalStructureOptions): HtmlDocumentLogicalStructure | null {
  const heuristicStructure = useMemo(() => {
    if (!enabled || !htmlLayout) {
      return null;
    }
    return buildHtmlLogicalStructure(htmlLayout);
  }, [enabled, htmlLayout]);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [resolvedStructure, setResolvedStructure] = useState<HtmlDocumentLogicalStructure | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleSettingsChange = () => {
      setSettingsRevision((revision) => revision + 1);
    };

    window.addEventListener(STRUCTURED_EXTRACT_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    window.addEventListener(LLM_TRANSPORT_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    window.addEventListener('storage', handleSettingsChange);
    return () => {
      window.removeEventListener(STRUCTURED_EXTRACT_SETTINGS_CHANGED_EVENT, handleSettingsChange);
      window.removeEventListener(LLM_TRANSPORT_SETTINGS_CHANGED_EVENT, handleSettingsChange);
      window.removeEventListener('storage', handleSettingsChange);
    };
  }, []);

  const runtimeSettings = useMemo(() => loadLogicalStructureRuntimeSettings(), [settingsRevision]);
  const cacheKey = useMemo(() => {
    if (!enabled || !fileHash) {
      return '';
    }
    return createLogicalStructureCacheKey(fileHash, createLogicalStructureCacheFingerprint(runtimeSettings));
  }, [enabled, fileHash, runtimeSettings]);

  useEffect(() => {
    if (!enabled) {
      setResolvedStructure(null);
      return;
    }

    setResolvedStructure(heuristicStructure);
    if (!fileHash || !htmlLayout || !heuristicStructure || !cacheKey) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const cached = await loadCachedLogicalStructure(cacheKey);
      if (cancelled) {
        return;
      }
      if (isCompatibleStructure(cached)) {
        setResolvedStructure(cached);
        return;
      }

      if (!canExtractLogicalStructureWithLlm(runtimeSettings)) {
        setResolvedStructure(heuristicStructure);
        return;
      }

      try {
        const extracted = await extractLlmLogicalStructure(htmlLayout, runtimeSettings, taskDocumentId ?? undefined);
        if (cancelled) {
          return;
        }
        if (!isCompatibleStructure(extracted)) {
          setResolvedStructure(heuristicStructure);
          return;
        }
        setResolvedStructure(extracted);
        void saveCachedLogicalStructure(cacheKey, fileHash, extracted);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.warn('Failed to build LLM logical structure; using heuristic fallback.', error);
        setResolvedStructure(heuristicStructure);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, fileHash, heuristicStructure, htmlLayout, runtimeSettings, taskDocumentId]);

  return resolvedStructure ?? heuristicStructure;
}

function isCompatibleStructure(value: unknown): value is HtmlDocumentLogicalStructure {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const structure = value as Partial<HtmlDocumentLogicalStructure>;
  return (
    structure.schemaVersion === 1 &&
    (structure.strategy === 'heuristic-v1' || structure.strategy === 'llm-v1') &&
    Array.isArray(structure.units) &&
    typeof structure.blockAssignments === 'object' &&
    structure.blockAssignments !== null
  );
}
