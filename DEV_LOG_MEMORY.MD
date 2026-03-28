# Dev Log Memory

This file is the repo-local working memory for architectural decisions, recurring debugging patterns, and verification rules.

Use it as follows:
- Read it at the start of any non-trivial change so new work stays consistent with earlier decisions.
- Append to it at the end of each iteration when a decision, debugging lesson, or verification pattern is important enough to reuse.
- Keep entries short, concrete, and biased toward why a decision was made, not just what changed.

## Working Style

- Prefer first-principles PDF parsing and rendering. Do not paper over rendering defects with browser APIs or screenshot-level hacks.
- When a problem is systemic, fix the shared parser/viewer model instead of adding PDF-specific exceptions.
- Prefer small shared modules in `src/common/` when multiple pipelines need the same logic.

## Verification Rules

- For PDF rendering or layout changes, always run `npx vitest run tests/pdfLayout.integration.test.ts`.
- Rebuild `dist/` and `testApp/dist/` before any browser-based or compare-script visual verification.
- For user-reported tiny render defects, verify the exact region with `./scripts/compare_pdf_region_render.mjs`.
- Store visual artifacts in repo-local `tmp/`, not `/tmp`.

## Architectural Memory

### 2026-03-22: Effective render font size must be derived in user space

- Some PDFs use `Tm` scaling with raw PDF `fontSize = 1` while the actual rendered text is much larger.
- The renderer must not treat that raw `fontSize` as the final canvas font size.
- We now preserve `renderFontSize` on `PDFTextItem` and use shared logic from `src/common/textItemFontSize.ts`.
- Reason: this keeps canvas rendering, layout logic, and future consumers aligned with the PDF text transform instead of ad hoc heuristics.

### 2026-03-22: Outer text transforms must rescale explicit `renderFontSize`

- When a text item is emitted inside a scaled Form XObject or other outer transform, updating only `bounds` and `fontSize` is not enough.
- The parser must also rescale any explicit `renderFontSize` using the transformed text geometry, otherwise the renderer will paint with the pre-transform size and massively overlap the page.
- Reason: `pdfs/2401.05375v1.pdf` page 1 carried 50pt inner-form text that should have rendered as roughly 12pt after the outer placement transform.

### 2026-03-22: Invisible text layers must remain extractable but not paint

- Some PDFs contain searchable text overlays with `Tr 3` or `Tr 7` while the visible page content is drawn separately as vector outlines.
- We now preserve `textRenderMode` on `PDFTextItem` and skip painting invisible text layers in the viewer.
- Reason: extraction/search should still work, but rendering both layers causes doubled glyphs and streaking.

### 2026-03-22: Clip paths are stored in current user space

- Active clip paths captured during stream parsing are already resolved into the current user-space coordinates at the time the clip is established.
- Do not re-transform those clip paths again when emitting the same path item in that stream.
- Additional transforms should only be applied when moving already-emitted items through an outer transform, such as a Form XObject placement.
- Reason: double-transforming clips can crop glyphs incorrectly; this caused the missing leading `R` in `pdfs/IRA contribution IRS.pdf`.

### 2026-03-22: PDF-native compare beats whole-page metrics

- Page-wide RMSE can miss or hide small but important defects.
- When a user points to a specific word, symbol, or figure, compare that exact crop against the PDF-native reference.
- Reason: targeted region comparison caught the IRS header clipping issue and validated the Claire invitation center text fix more reliably than page-wide comparison.

### 2026-03-22: Whole-document chat should be retrieval-backed, not full-text prompt stuffing

- The current `ask-question` proxy path accepts `documentId` for authorization/logging, but it does not automatically inject the stored document into the LLM prompt.
- Document-wide chat therefore needs explicit retrieval over the existing semantic index instead of assuming the backend already has document context.
- Reason: this keeps prompts bounded for large PDFs and uses the same chunking/indexing model already used by semantic search.

### 2026-03-22: Whole-document chat should send complete document grounding plus retrieval hints

- Retrieval excerpts alone are not sufficient for whole-document chat; they can bias the model toward sparse headings or table headers.
- The prompt should include a complete structured document context for the whole PDF, while semantic-search excerpts remain secondary hints that point the model toward likely relevant sections faster.
- Reason: this avoids false "insufficient context" answers caused by partial retrieval while preserving the benefits of semantic search.

### 2026-03-22: Document chat history lives in annotation storage with an explicit document scope

- Reuse the existing IndexedDB annotation store for chat history, but distinguish whole-document chat with dedicated helpers instead of ad hoc dummy bounds in component code.
- The UI can still share the same chat message model as paragraph-bound chats while keeping document-level persistence stable across reopen/close cycles.
- Reason: this avoids inventing a second chat persistence format and keeps chat history behavior consistent.

### 2026-03-22: Toolbar-docked panels should render from the toolbar container

- If a panel is supposed to open "under the toolbar on the left", render it as a child of the fixed toolbar container rather than trying to approximate its position from elsewhere in the app.
- Give the toolbar row its own dock slot above the panel so the controls remain clickable while the panel is open.
- Reason: this keeps positioning stable across responsive layouts and avoids syncing magic offsets with toolbar height changes.

### 2026-03-22: Icon-only toolbar actions still need tooltip and aria label

- When compressing a toolbar action to icon-only, keep the semantic text in `title` and `aria-label` instead of leaving the control unlabeled.
- Apply the same compact square button treatment so icon-only actions do not leave label-sized padding behind.
- Reason: this preserves discoverability and accessibility while reducing horizontal clutter.

### 2026-03-22: Toolbar labels should stay stable across active state changes

- Avoid swapping button labels like `Lasso` to `Draw` when the underlying action is still the same tool mode.
- Put state-specific guidance in the tooltip instead of changing the visible control text.
- Reason: stable labels reduce visual jitter and make the toolbar easier to scan.

### 2026-03-22: Docked panel headers should be concise

- Keep docked toolbar panel titles and subtitles to a few words when the surrounding control already establishes the context.
- Prefer a single-line header when the message can be compressed without losing meaning.
- Reason: long copy in a compact utility panel adds clutter and competes with the toolbar.

### 2026-03-22: Status copy should be direct

- For transient task banners and dialogs, prefer short action-oriented copy over explanatory sentences when the title and progress detail already provide context.
- Reason: verbose status text slows scanning and repeats information already visible elsewhere in the UI.

### 2026-03-22: Citation answers should be grounded by evidence ids plus local quote anchoring

- For document chat citations, do not ask the model for PDF coordinates or trust free-form source references.
- The backend should retrieve semantic evidence blocks, require the model to cite stable `evidenceId`s plus verbatim support quotes, then resolve those quotes back to PDF geometry locally.
- Reason: this keeps citations auditable, lets both selection chat and whole-document chat share one grounding pipeline, and preserves exact anchors from PDF-native text geometry instead of browser heuristics.

### 2026-03-22: Chat history stores cited answers as structured assistant metadata

- Keep `ChatMessage.content` as plain text for backward compatibility and prompt history, but attach the structured cited-answer payload separately on assistant turns.
- Reason: old saved chats still render, prompt construction stays simple, and the UI can progressively enhance cited messages without a breaking storage migration.

### 2026-03-22: Evidence indexing should reuse HTML blocks but preserve merged PDF text runs

- Build citation retrieval units from paragraph/heading/table-row layout blocks, then map those spans back to merged `PDFTextItem` runs for quote anchoring.
- Reason: retrieval works better at block granularity, while exact substring bounds still need the underlying PDF text geometry.

### 2026-03-22: Suspicious PDF spaces must be measured against glyph advances, not raw font size

- PDF glyph advances inside `glyphSpans` are often normalized font-space units like `0.25`, so comparing them directly to the page-space `fontSize` badly overflags normal word spaces as suspicious.
- Use the item’s observed space/letter advance distribution to detect only truly tiny synthetic spaces.
- Reason: the old threshold deleted legitimate spaces in front matter like `Biologically Inspired Engineering` and `Corresponding author`.

### 2026-03-22: Do not lexically split protected TitleCase single words

- Proper nouns and front-matter TitleCase words such as `Goldstein` or `Astonishing` should not go through aggressive single-token word-splitting unless there is strong article-style evidence.
- Keep TitleCase tokens intact by default, and only allow the `A...` article split when the remainder is lexically backed.
- Reason: whole-page lexicon noise was turning correct front-matter words into `Goldste in` and `As to nishi`.

### 2026-03-22: Text smoothing must preserve compact punctuation tokens across run boundaries

- When adjacent runs form an email local-part, domain, or similar compact punctuation token, treat that boundary like an in-word continuation and do not insert a space.
- Reason: the smoother was inventing spaces in `michael.levin@tufts.edu`, which then survived lexical repair because email-like text is intentionally protected.

### 2026-03-23: Interactive chat should use dedicated streaming task routes, not async-job polling

- Keep the existing `/api/tasks/*` async-job endpoints for non-interactive work, but add parallel `/stream` routes for chat so the browser can render deltas immediately.
- Stream browser-facing events as NDJSON over `fetch`, not EventSource, because chat requests are POST bodies and need auth headers.
- For whole-document grounded chat, reuse the same evidence retrieval/materialization pipeline as the non-streaming cited-answer path; only the transport changes.
- Reason: polling is fine for background tasks, but it cannot provide token-by-token UI updates or a stable single-message chat history model.

### 2026-03-23: Whole-document streaming should separate preview text from final cited structure

- Do not stream raw citation JSON into the chat bubble.
- Use a streaming-specific prompt that returns an `ANSWER:` section first and a `JSON:` section second, then stream only the preview answer while still parsing the final structured citation payload at completion.
- The final assistant turn should be replaced with the validated cited-answer object once the stream completes.
- Reason: users need readable partial text immediately, but the product still needs exact grounded citations and stable anchor resolution at the end.

## Recent Examples

- `pdfs/IRA contribution IRS.pdf`
  - Required three linked fixes: user-space `renderFontSize`, invisible text suppression, and no double-transform of top-level path clip paths.
- `pdfs/Claires7thBday.pdf`
  - The missing center text was another `fontSize = 1` / transformed-text issue; fixing the shared render-size model restored visibility without a PDF-specific special case.
- `pdfs/2401.05375v1.pdf`
  - Required two layers of shared fixes: outer-transform rescaling of `renderFontSize`, then conservative text-boundary/smoothing heuristics so author/front-matter wording stayed intact.
