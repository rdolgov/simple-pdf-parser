import { canUseLocalStorage } from './storage';

export type ReaderKnowledgeLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface RewriteProfileSettings {
  mathLevel: ReaderKnowledgeLevel;
  scienceLevel: ReaderKnowledgeLevel;
  otherKnowledge: string;
  rewritePreference: string;
  memoryNotes: string;
}

const STORAGE_KEYS = {
  mathLevel: 'rewrite-profile-math-level',
  scienceLevel: 'rewrite-profile-science-level',
  otherKnowledge: 'rewrite-profile-other-knowledge',
  rewritePreference: 'rewrite-profile-preference',
  memoryNotes: 'rewrite-profile-memory-notes'
} as const;

const DEFAULT_SETTINGS: RewriteProfileSettings = {
  mathLevel: 'intermediate',
  scienceLevel: 'intermediate',
  otherKnowledge: '',
  rewritePreference: '',
  memoryNotes: ''
};

export function loadRewriteProfileSettings(): RewriteProfileSettings {
  if (!canUseLocalStorage()) {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    mathLevel: readEnum(STORAGE_KEYS.mathLevel) ?? DEFAULT_SETTINGS.mathLevel,
    scienceLevel: readEnum(STORAGE_KEYS.scienceLevel) ?? DEFAULT_SETTINGS.scienceLevel,
    otherKnowledge: readString(STORAGE_KEYS.otherKnowledge) ?? DEFAULT_SETTINGS.otherKnowledge,
    rewritePreference: readString(STORAGE_KEYS.rewritePreference) ?? DEFAULT_SETTINGS.rewritePreference,
    memoryNotes: readString(STORAGE_KEYS.memoryNotes) ?? DEFAULT_SETTINGS.memoryNotes
  };
}

export function saveRewriteProfileSettings(settings: RewriteProfileSettings): void {
  if (!canUseLocalStorage()) {
    return;
  }

  writeString(STORAGE_KEYS.mathLevel, settings.mathLevel);
  writeString(STORAGE_KEYS.scienceLevel, settings.scienceLevel);
  writeString(STORAGE_KEYS.otherKnowledge, settings.otherKnowledge);
  writeString(STORAGE_KEYS.rewritePreference, settings.rewritePreference);
  writeString(STORAGE_KEYS.memoryNotes, settings.memoryNotes);
}

export function buildRewriteHighlightPrompt(input: {
  paragraphText: string;
  documentTitle?: string;
  profile: RewriteProfileSettings;
}): string {
  const { paragraphText, documentTitle, profile } = input;
  const docTitle = documentTitle?.trim() || 'the document';
  const optionalLines: string[] = [];

  if (profile.otherKnowledge.trim().length > 0) {
    optionalLines.push(`- Other relevant background knowledge: ${profile.otherKnowledge.trim()}`);
  }
  if (profile.rewritePreference.trim().length > 0) {
    optionalLines.push(`- Rewrite preference/style: ${profile.rewritePreference.trim()}`);
  }
  if (profile.memoryNotes.trim().length > 0) {
    optionalLines.push(`- Persistent memory/context notes (user-provided; future conversation memory placeholder): ${profile.memoryNotes.trim()}`);
  }

  return [
    `Rewrite the following paragraph from ${docTitle} for a reader with this profile:`,
    `- Math level: ${profile.mathLevel}`,
    `- Science level: ${profile.scienceLevel}`,
    ...optionalLines,
    '',
    'Requirements:',
    '- Preserve all facts, claims, quantities, equations, and uncertainty exactly (no hallucinations).',
    '- Preserve citation markers exactly as written (e.g., [1], [2-4]).',
    '- Keep technical meaning intact; simplify wording and add brief clarifications only when helpful.',
    '- Return only the rewritten paragraph (no bullets, no preface, no explanation).',
    '',
    'Paragraph:',
    paragraphText.trim()
  ].join('\n');
}

function readString(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value ?? null;
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  const normalized = value.trim();
  try {
    if (normalized.length > 0) {
      window.localStorage.setItem(key, normalized);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access issues.
  }
}

function readEnum(key: string): ReaderKnowledgeLevel | null {
  const value = readString(key)?.trim().toLowerCase();
  if (value === 'beginner' || value === 'intermediate' || value === 'advanced' || value === 'expert') {
    return value;
  }
  return null;
}
