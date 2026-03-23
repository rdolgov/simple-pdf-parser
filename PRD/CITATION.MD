# PRD: Document-Grounded Citation Service

## Summary

Build a document-grounded citation system for PDF chat so assistant answers can include clickable citations that jump back to the exact source text in the PDF.

This PRD covers two chat surfaces:

- selection-bound chat
- whole-document chat

The system is document-only for this feature:
- if the PDF does not support a claim, the assistant must say so
- it must not silently use outside knowledge
- grounded claims should carry citations
- direct quotes must carry citations

## User Problem

Today the chat can answer questions about selected PDF content, but it does not provide reliable, clickable source attribution back into the document.

Users need:
- trust in the answer
- a way to inspect where the answer came from
- a click path from answer text back to the exact source location in the PDF
- the same citation behavior in both selection chat and whole-document chat

## Product Goals

- Make answers auditable against the loaded PDF.
- Let users click a citation and jump to the source text.
- Support both chat surfaces with one shared citation backend.
- Keep citation grounding tied to actual PDF geometry, not browser approximations.
- Require structured grounding rather than prompt-only best effort.

## Non-Goals

First pass does not need to support:
- external web citations
- mixed document + web answers
- figure/image citations without text evidence
- fully general scholarly bibliography linking
- OCR redesign
- free-form plain-text responses with optional citations bolted on afterward

## Success Criteria

A successful implementation must allow all of the following:

1. A user asks a whole-document question and receives an answer with clickable citations.
2. Clicking a citation navigates to the source page and highlights the exact text span when recoverable.
3. A user asks a selection-scoped question and receives citations from the relevant document context.
4. If the document does not support the answer, the assistant says so instead of fabricating support.
5. The same core backend powers both chat surfaces.

## Key Decisions

### Grounding policy

Use document-only grounding.

The assistant must answer only from the PDF evidence supplied by the system for this feature.

### Citation coverage

Require citations for:
- direct quotes
- grounded factual claims

### Anchor precision

Default target is exact text span.

If exact span recovery is impossible after safe normalization, allow fallback to the containing block bounds, but record that fallback explicitly.

### Shared backend

Selection chat and whole-document chat must share:
- evidence indexing
- retrieval
- model contract
- citation validation
- anchor resolution
- response schema

### Separate API

Do not overload the existing generic `ask-question` endpoint.

Introduce a dedicated grounded QA endpoint with a structured cited-answer response.

## Proposed Architecture

### End-to-end flow

1. Build a canonical evidence index for the PDF.
2. Retrieve relevant evidence blocks for the question.
3. Send only retrieved evidence to the model with stable evidence ids.
4. Require structured JSON output with answer segments and citations.
5. Require each citation to include a short verbatim support quote.
6. Validate citations locally against the evidence text.
7. Resolve each validated quote back to PDF bounds.
8. Return a cited-answer payload to the client.
9. Render citations in chat UI.
10. On click, navigate and highlight the source in the viewer.

## Why this architecture

### Why not plain-text chat with optional citations

That approach is too weak because:
- the model can invent support
- there is no durable citation contract
- exact anchors cannot be trusted
- client rendering becomes ad hoc

### Why block-level evidence + text-item anchoring

Use:
- block-level evidence for retrieval quality
- text-item substring geometry for precise anchors

Reason:
- retrieval works better on paragraphs/headings than on tiny text fragments
- exact citation targets require raw PDF text geometry

### Why support quotes

The model should return:
- evidence id
- short verbatim support quote

The system should not ask the model for coordinates.

Reason:
- quotes can be validated deterministically
- coordinates can be derived locally from the PDF model
- this keeps trust in local code, not model guesses

## Existing Repo Capabilities to Reuse

The repo already has useful components:

- `src/textItemSubstringBounds.ts`
  Exact substring-to-bounds recovery inside a `PDFTextItem`

- `src/html/htmlLayoutConverter.ts`
  Block-level layout suitable for semantic evidence units

- `server/src/taskSemanticSearch.ts`
  Existing semantic indexing/search path that can be reused for retrieval

- `server/src/taskStore.ts`
  Server-side task-document persistence that can host evidence sidecars

- `testApp/src/components/MiniChatView.tsx`
  Existing selection-bound chat UI to upgrade

- `testApp/src/storage/annotationStorage.ts`
  Existing selection-chat persistence model

## New Backend Components

Suggested new modules:

- `server/src/documentEvidenceIndex.ts`
- `server/src/documentQaCitations.ts`
- `server/src/documentCitationValidation.ts`
- `server/src/documentCitationAnchors.ts`

### `documentEvidenceIndex.ts`

Responsibilities:
- build/load/store canonical document evidence index
- create stable evidence ids
- preserve mapping from semantic block text to underlying text items

### `documentQaCitations.ts`

Responsibilities:
- retrieve candidate evidence
- construct grounded model prompt
- parse structured model response
- orchestrate validation and anchor resolution

### `documentCitationValidation.ts`

Responsibilities:
- verify cited evidence ids exist
- verify support quotes occur in evidence text
- reject unsupported factual segments
- optionally run a repair pass for invalid structured output

### `documentCitationAnchors.ts`

Responsibilities:
- map support quote to evidence-local offsets
- map offsets to text-item substrings
- merge bounds across text items
- provide fallback block anchors when exact quote recovery fails

## Evidence Index Design

### Evidence unit

Primary unit should be a semantic text block such as:
- paragraph
- heading
- table text grouping
- bibliography/reference block when naturally available

Each evidence record must also preserve:
- ordered source text runs
- text item references
- enough offset mapping to recover quote bounds exactly

### Suggested shape

```ts
type EvidenceBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type EvidenceTextRunRef = {
  pageNumber: number;
  textItemIndex: number;
  text: string;
  bounds: EvidenceBounds;
  blockCharStart: number;
  blockCharEnd: number;
};

type DocumentEvidenceRecord = {
  evidenceId: string;
  pageNumber: number;
  kind: 'paragraph' | 'heading' | 'table-cell-group' | 'table-row' | 'reference';
  text: string;
  normalizedText: string;
  bounds: EvidenceBounds;
  textRuns: EvidenceTextRunRef[];
};

type DocumentEvidenceIndex = {
  schemaVersion: number;
  documentId: string;
  documentHash?: string;
  createdAt: string;
  records: DocumentEvidenceRecord[];
};
```

### Stability requirement

Evidence ids must be deterministic for the same document content.

Recommended approach:
- derive from page number
- block order
- normalized text hash

## Retrieval Design

### Retrieval mode

Use hybrid retrieval:
- lexical scoring
- semantic scoring

Do not rely on only one.

### Selection-scoped chat

When chat scope is selection:
- strongly bias retrieval toward overlapping or nearby evidence
- still allow adjacent/section evidence when needed for disambiguation

### Whole-document chat

When scope is document:
- retrieve from the full evidence index with no region bias

## Model Contract

### Request requirements

The model must receive:
- user question
- explicit instruction to answer only from provided evidence
- evidence blocks with stable ids
- explicit response schema

### Output requirements

Return structured JSON only.

Each grounded answer segment must include:
- text
- one or more citations

Each citation must include:
- `evidenceId`
- short verbatim support quote

### Example response shape

```json
{
  "segments": [
    {
      "text": "The model uses multi-head attention to attend to information from different representation subspaces.",
      "citations": [
        {
          "evidenceId": "E12",
          "quote": "Multi-head attention allows the model to jointly attend to information from different representation subspaces"
        }
      ]
    }
  ]
}
```

### Forbidden model behavior

The model must not:
- invent evidence ids
- output coordinates
- cite evidence not in prompt
- answer unsupported factual questions as if grounded

## Validation Rules

After model output is parsed:

1. Every cited `evidenceId` must exist.
2. Every citation quote must occur in the cited evidence text.
3. Every grounded factual segment must retain at least one valid citation.
4. Unsupported segments must not be emitted as grounded facts.
5. Invalid citations must be dropped or repaired before returning to client.

If quote validation fails:
- attempt safe normalized matching
- if that still fails, drop citation
- if that makes a factual segment unsupported, repair or mark unsupported

## Anchor Resolution

### Goal

Resolve each validated citation to:
- `pageNumber`
- `bounds`
- `matchStrategy`

### Resolution order

1. Exact quote match within cited evidence record
2. Safe normalized quote match
3. Fallback to evidence block bounds

### Exact geometry source

Use PDF-native text geometry and existing substring-bound logic.
Do not use DOM ranges or screenshot approximations.

### Suggested anchor type

```ts
type CitationAnchor = {
  documentId: string;
  pageNumber: number;
  quote: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  evidenceId: string;
  matchStrategy: 'exact-quote' | 'normalized-quote' | 'block-fallback';
};
```

## API Contract

### New endpoint

Add:
- `POST /api/tasks/answer-document-question`

### Suggested request

```ts
type AnswerDocumentQuestionRequest = {
  documentId: string;
  question: string;
  provider?: 'gemini' | 'openai' | 'codex';
  model?: string | null;
  scope?: {
    kind: 'document' | 'selection';
    pageNumber?: number;
    bounds?: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
    contextText?: string;
  };
};
```

### Suggested response

```ts
type AnswerCitation = {
  id: string;
  evidenceId: string;
  label: string;
  quote: string;
  anchor: CitationAnchor;
};

type CitedAnswerSegment = {
  text: string;
  citationIds: string[];
};

type CitedAnswerResponse = {
  answerText: string;
  segments: CitedAnswerSegment[];
  citations: AnswerCitation[];
  model: string;
};
```

## Client Changes

### Selection chat

Upgrade the existing mini chat to:
- call the new grounded endpoint
- render structured assistant messages
- show clickable citation markers
- jump to source on citation click

### Whole-document chat

Add a new document-level chat panel:
- keyed by `documentId`
- not bound to annotation coordinates
- uses the same cited-answer rendering and API

### Viewer behavior

On citation click:
- switch to cited page
- scroll it into view
- overlay a citation highlight on the resolved bounds
- visually distinguish citation highlights from search/focus overlays

## Persistence Changes

### Selection chat persistence

Current annotation storage is bounds-scoped and text-only.
It needs to support structured assistant messages.

Requirement:
- old saved plain-text chats must still load without crashing

### Whole-document chat persistence

Store whole-document chat separately from annotation storage.

Recommended:
- a dedicated document-chat IndexedDB store keyed by `documentId`

Reason:
- whole-document chat is not a page/bounds annotation
- cleaner storage model

## Suggested Client Modules

- `testApp/src/chat/citedAnswerTypes.ts`
- `testApp/src/chat/renderCitedAnswer.tsx`
- `testApp/src/chat/documentChatStorage.ts`
- `testApp/src/chat/citationNavigation.ts`

## Testing Requirements

Do not run the full suite.

Use focused tests only.
If PDF rendering/layout behavior is touched, run:

```bash
npx vitest run tests/pdfLayout.integration.test.ts
```

### Required backend tests

- evidence index is deterministic
- evidence ids are stable
- quote validation works
- invalid evidence ids are rejected
- unsupported questions remain unsupported
- exact and fallback anchor modes behave correctly

### Required anchor tests

- quote within one text item resolves exact bounds
- quote across multiple text items resolves merged bounds
- normalized whitespace matching works when safe
- repeated quote resolves within cited evidence context
- fallback block anchor is explicit when exact recovery fails

### Required client tests

- structured cited answers render correctly
- citation click triggers navigation/highlight
- old plain-text chats still load
- whole-document chat persistence works

## Acceptance Scenarios

1. Whole-document chat returns grounded answer with clickable citations.
2. Selection chat returns grounded answer with clickable citations.
3. Clicking a citation highlights the correct source location in the PDF.
4. Unsupported questions do not produce fabricated citations.
5. Same grounding backend powers both chat surfaces.

## Risks

### Quote normalization mismatch

Mitigation:
- keep normalized-text mapping
- use safe normalized matching only
- explicit fallback strategy

### Ambiguous repeated quotes

Mitigation:
- resolve inside cited evidence block first
- avoid global page search unless necessary

### Divergent implementations for the two chats

Mitigation:
- one endpoint
- one cited-answer schema
- one evidence index

## Defaults Locked By This PRD

- both chat surfaces supported by one shared backend
- document-only grounding
- citations for all grounded claims
- exact text-span anchors as default target
- dedicated grounded QA endpoint
- text-backed citations only in first pass
- model returns evidence ids and support quotes, never coordinates

## Recommended Implementation Order

1. Add evidence index builder and persistence.
2. Add hybrid retrieval over evidence records.
3. Add grounded QA endpoint and strict structured prompt contract.
4. Add citation validation.
5. Add quote-to-anchor resolution.
6. Add cited-answer rendering on client.
7. Migrate selection chat.
8. Add whole-document chat.
9. Add citation navigation overlay.
10. Add focused regression tests.

## Handoff Notes For Future Agent

Before implementation:
- read `DEV_LOG_MEMORY.MD`
- keep the solution first-principles and PDF-native
- avoid browser hacks for source anchoring
- keep changes modular
- do not run the full test suite
- run focused tests only
- if rendering/layout code changes, run `npx vitest run tests/pdfLayout.integration.test.ts`
