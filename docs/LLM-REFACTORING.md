# LLM-Friendly Refactoring Guide

This document outlines recommendations for restructuring the codebase to work better with LLM-based development tools (Claude, GPT, etc.). The goal is to create smaller, focused modules that fit within context windows and are easier to debug/swap.

---

## Current State (Updated: December 2024)

### Completed Refactoring

**Phase 1 (Partial): pdfParser.ts Split**

The monolithic `pdfParser.ts` has been reduced from **3,715 lines to 2,639 lines** (29% reduction) by extracting focused modules:

| Module | Lines | Purpose |
|--------|-------|---------|
| `parserTypes.ts` | 100 | Type definitions (FontResource, ImageResource, etc.) |
| `parserConstants.ts` | 192 | Constants (glyph maps, control char fallbacks) |
| `xrefParser.ts` | 126 | Cross-reference table parsing |
| `parserUtils.ts` | 118 | Shared utilities (skipWhitespace, readDictionary, hex conversions) |
| `fontEncoding.ts` | 279 | CMap parsing, encoding maps, glyph name resolution |
| `imageDecoder.ts` | 288 | PNG predictor, Flate image decoding, CMYK conversion |
| `textDecoder.ts` | 206 | Text decoding with ToUnicode/encoding fallbacks |

**Existing modules** (unchanged):
| Module | Lines | Purpose |
|--------|-------|---------|
| `mathUtils.ts` | 82 | Matrix operations |
| `streamDecoder.ts` | 46 | FlateDecode wrapper |
| `textSmoother.ts` | 242 | Text run merging |
| `textTokenizer.ts` | 252 | Content stream tokenization |
| `ccittDecoder.ts` | 1,148 | CCITT Group 4 fax decoder |

### Remaining Pain Points

| File | Lines | Issue |
|------|-------|-------|
| `pdfParser.ts` | 2,639 | Still large but manageable - orchestrator role |
| `App.tsx` | 879 | Mixes too many concerns (down from 1,166) |
| `CanvasPageWithOverlay.tsx` | 579 | Complex interaction logic (down from ~1,000) |
| `ccittDecoder.ts` | 1,148 | Self-contained algorithm, acceptable |

### Assessment

The `pdfParser.ts` is still above the 500-line target but is now the **orchestrator** coordinating extracted modules. The remaining code consists of:
- Object extraction and stream resolution (~600 lines)
- Page building and content stream parsing (~800 lines)
- Resource context extraction (~500 lines)
- Text block parsing and operator handling (~500 lines)
- Utility methods (~200 lines)

**Recommendation**: The current structure is reasonable. Further splitting would fragment the parsing logic without clear benefit. The extracted modules handle specific responsibilities well.

### Tight Coupling (Improved)
- `App.tsx` manages 20+ state variables (still needs hook extraction)
- `pdfParser.ts` now delegates to specialized modules ✓

### Testability (Improved)
- Extracted modules can be unit tested independently ✓
- State still spread across App.tsx components

---

## Recommended Refactoring

### Phase 1: Split pdfParser.ts (Priority: High) - PARTIALLY COMPLETE ✓

**Completed Structure:**
```
src/parser/
├── pdfParser.ts          # Orchestrator (2,639 lines - reduced from 3,715)
├── parserTypes.ts        # Type definitions ✓
├── parserConstants.ts    # Constants and mappings ✓
├── parserUtils.ts        # Shared utilities ✓
├── xrefParser.ts         # Cross-reference table parsing ✓
├── fontEncoding.ts       # CMap + encoding parsing ✓
├── imageDecoder.ts       # Image decoding utilities ✓
├── textDecoder.ts        # Text decoding with font maps ✓
├── textTokenizer.ts      # Content stream tokenization (existing)
├── textSmoother.ts       # Text run merging (existing)
├── mathUtils.ts          # Matrix operations (existing)
├── streamDecoder.ts      # FlateDecode wrapper (existing)
└── ccittDecoder.ts       # CCITT Group 4 fax (existing)
```

**Original Plan (Optional Further Splits):**
```
# These could be extracted if pdfParser.ts needs further reduction:
├── content/
│   ├── contentStreamParser.ts  # BT/ET block parsing
│   ├── operatorHandlers.ts     # Text operator implementations
│   └── graphicsState.ts        # CTM and graphics state
├── objectResolver.ts           # Indirect object resolution
└── resourceContext.ts          # Resource extraction logic
```

**Benefits Achieved:**
- Extracted modules are 100-288 lines each ✓
- Clear single responsibility for extracted modules ✓
- Modules can be unit tested independently ✓
- pdfParser.ts reduced by 29% ✓

**Assessment**: Further splitting is optional. The remaining 2,639 lines in pdfParser.ts represent tightly coupled parsing orchestration that would be fragmented by additional extraction.

### Phase 2: Split App.tsx (Priority: High)

Extract state and logic into custom hooks:

```
testApp/src/
├── App.tsx               # Shell component (~200 lines)
├── hooks/
│   ├── useDocumentLoader.ts    # File loading, caching
│   ├── useZoom.ts              # Zoom state and handlers
│   ├── useFocusQuery.ts        # Relevance query state
│   ├── useViewMode.ts          # View mode switching
│   ├── useRecordings.ts        # Focus recording management
│   └── useTableExtraction.ts   # Structured Extract (Gemini) integration
├── context/
│   └── DocumentContext.tsx     # Shared document state
└── components/
    └── ... (existing)
```

**Example: useDocumentLoader.ts**
```typescript
interface UseDocumentLoaderResult {
  state: LoadState;
  loadFile: (file: File) => Promise<void>;
  loadCached: (hash: string) => Promise<void>;
  document: PDFDocument | null;
  htmlLayout: HtmlDocumentLayout | null;
}

export function useDocumentLoader(): UseDocumentLoaderResult {
  // All file loading logic extracted here
}
```

### Phase 3: Split CanvasPageWithOverlay.tsx (Priority: Medium)

```
testApp/src/components/canvas/
├── CanvasPage.tsx              # Core canvas rendering
├── CanvasOverlay.tsx           # Overlay container
├── overlays/
│   ├── TextHighlight.tsx       # Text selection highlight
│   ├── SemanticHighlight.tsx   # Search result highlight
│   ├── TableHighlight.tsx      # Table detection highlight
│   └── FocusHighlight.tsx      # Relevance highlight
├── handlers/
│   ├── useCanvasClick.ts       # Click detection logic
│   ├── useBlockSelection.ts    # Block selection state
│   └── useTooltip.ts           # Tooltip positioning
└── utils/
    └── coordinateUtils.ts      # PDF to canvas coordinate conversion
```

### Phase 4: Create Service Layer (Priority: Medium)

Abstract external service calls:

```
src/services/
├── types.ts                    # Common service interfaces
├── ai/
│   ├── AIService.ts            # Abstract interface
│   ├── OpenAIService.ts        # OpenAI implementation
│   ├── GeminiService.ts        # Gemini implementation
│   └── LMStudioService.ts      # Local LLM implementation
├── extraction/
│   ├── ExtractionService.ts    # Abstract interface
│   └── StructuredExtractService.ts  # Structured Extract (Gemini) implementation
└── embedding/
    ├── EmbeddingService.ts     # Abstract interface
    └── LocalEmbeddingService.ts # LM Studio embeddings
```

---

## Module Size Guidelines

For optimal LLM interaction:

| Type | Recommended Size | Max Size |
|------|-----------------|----------|
| Component | 100-200 lines | 300 lines |
| Hook | 50-150 lines | 200 lines |
| Utility | 50-100 lines | 150 lines |
| Service | 100-200 lines | 300 lines |
| Types | 50-100 lines | 150 lines |

---

## File Naming Conventions

### Clear, Descriptive Names
```
Good:
  xrefTableParser.ts
  toUnicodeMapDecoder.ts
  semanticSearchHighlight.tsx

Avoid:
  parser.ts (too generic)
  utils.ts (unclear purpose)
  helpers.ts (vague)
```

### Consistent Suffixes
```
*.types.ts     - Type definitions only
*.utils.ts     - Pure utility functions
*.service.ts   - External service wrappers
*.hook.ts      - React hooks
*.context.tsx  - React context providers
```

---

## Interface-First Design

Define clear interfaces for swappable components:

```typescript
// src/parser/interfaces/StreamDecoder.ts
export interface StreamDecoder {
  readonly filterName: string;
  decode(data: Uint8Array, params?: Record<string, unknown>): Uint8Array;
  canDecode(filterName: string): boolean;
}

// src/parser/decoders/FlateDecoder.ts
export class FlateDecoder implements StreamDecoder {
  readonly filterName = 'FlateDecode';
  
  decode(data: Uint8Array, params?: Record<string, unknown>): Uint8Array {
    // Implementation
  }
  
  canDecode(filterName: string): boolean {
    return filterName === 'FlateDecode';
  }
}
```

---

## Configuration Extraction

Move magic numbers and defaults to config:

```typescript
// src/config/parserConfig.ts
export const PARSER_CONFIG = {
  maxStreamRetries: 3,
  defaultFontSize: 12,
  textMergeGapThreshold: 0.3,
  lineHeightTolerance: 0.1,
} as const;

// src/config/rendererConfig.ts
export const RENDERER_CONFIG = {
  defaultScale: 1,
  maxScale: 5,
  minScale: 0.1,
  pagePadding: 16,
} as const;
```

---

## Error Handling Strategy

Create typed errors for better debugging:

```typescript
// src/errors/ParseError.ts
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly code: ParseErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export enum ParseErrorCode {
  INVALID_HEADER = 'INVALID_HEADER',
  XREF_NOT_FOUND = 'XREF_NOT_FOUND',
  STREAM_DECODE_FAILED = 'STREAM_DECODE_FAILED',
  FONT_NOT_FOUND = 'FONT_NOT_FOUND',
}
```

---

## Testing Strategy

### Unit Test Structure
```
tests/
├── parser/
│   ├── xrefParser.test.ts
│   ├── contentStreamParser.test.ts
│   ├── cmapParser.test.ts
│   └── imageExtractor.test.ts
├── html/
│   ├── htmlLayoutConverter.test.ts
│   └── blockDetection.test.ts
└── __fixtures__/
    ├── xref/
    ├── streams/
    └── fonts/
```

### Mock-Friendly Interfaces
```typescript
// Easy to mock for testing
interface PDFObjectResolver {
  resolve(ref: string): PDFRawObject | null;
  resolveStream(ref: string): Uint8Array | null;
}

// In tests:
const mockResolver: PDFObjectResolver = {
  resolve: vi.fn().mockReturnValue(mockObject),
  resolveStream: vi.fn().mockReturnValue(mockStream),
};
```

---

## Migration Path

### Step 1: Create New Module Structure (No Breaking Changes)
1. Create new directory structure
2. Extract code into new files
3. Re-export from original locations for compatibility

### Step 2: Update Imports Gradually
1. Update internal imports to new locations
2. Keep public API unchanged
3. Add deprecation warnings to old imports

### Step 3: Remove Legacy Code
1. Remove re-exports after transition period
2. Update documentation
3. Bump major version

---

## LLM Prompting Tips

### When Working with This Codebase

1. **Reference specific files**: "In `src/parser/fonts/cmapParser.ts`, update the..."
2. **Provide context**: "The CMap parser is used by pdfParser.ts to decode..."
3. **Small, focused changes**: "Add a new StreamDecoder for ASCII85"
4. **Test-first**: "Write tests for the new decoder, then implement"

### Ideal Prompt Structure
```
Context: [Which module/feature area]
Current behavior: [What it does now]
Desired behavior: [What you want]
Constraints: [Size limits, compatibility requirements]
Files to modify: [Specific file paths]
```

---

## Priority Order

1. ~~**High**: Split `pdfParser.ts`~~ - **PARTIALLY COMPLETE** (29% reduction, 7 modules extracted)
2. **High**: Extract App.tsx hooks - Improves testability (NEXT PRIORITY)
3. **Medium**: Split CanvasPageWithOverlay - Reduces complexity
4. **Medium**: Create service abstractions - Enables swapping
5. **Low**: Extract configuration - Nice to have
6. **Low**: Typed errors - Polish

---

## Progress Summary

| Task | Status | Files Created | Result |
|------|--------|---------------|--------|
| Split pdfParser.ts | ✓ Partial | 7 new modules | 3,715 → 2,639 lines (29% reduction) |
| Extract App.tsx hooks | Pending | 0 | 1,166 → 879 lines (25% reduction, UI changes only) |
| Split CanvasPageWithOverlay | Pending | 0 | ~1,000 → 579 lines (42% reduction, UI changes only) |

## Remaining Effort

| Task | Files to Create | Estimated Time |
|------|-----------------|----------------|
| ~~Split pdfParser.ts (further)~~ | Optional | Optional |
| Extract App.tsx hooks | ~8 new files | 1-2 days |
| Split CanvasPageWithOverlay | ~10 new files | 1-2 days |
| Service abstractions | ~8 new files | 1 day |
| Configuration extraction | ~3 new files | 0.5 day |
| Typed errors | ~2 new files | 0.5 day |

Remaining: ~31 new files, ~5-7 days of focused work
