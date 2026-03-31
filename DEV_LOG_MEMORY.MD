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

### 2026-03-27: Ultra-tight title fragments should merge before lexical repair, and cased joins need a dedicated path

- Some PDFs emit adjacent title/front-matter words as separate same-font runs with effectively zero geometric gap, so leaving them separate causes HTML text concatenation to drop spaces even though the visual canvas positions look continuous.
- Merge those ultra-tight fragments in `textSmoother` so the shared lexical repair sees the whole token, then repair internal `lowercaseUppercase` joins and attached connector suffixes before the generic segmentation scorer runs.
- Reason: the reduced-paper title needed `Ingressing Minds`, `Patterns Beyond`, `Genetics and`, and `Hybrid Embodiments` restored without adding PDF-specific exceptions, and the generic scorer alone produced bad splits like `Pattern sBeyond`.

### 2026-03-28: Canvas text selection should follow highlight geometry, not browser text-layer layout

- The canvas viewer should expose real browser text selection through a DOM layer, but that layer must be built from our own per-character geometry derived from highlight line/span bounds, including synthetic gap boxes for spaces between spans.
- Do not rely on generic browser line layout or an approximate text layer; render transparent character boxes at PDF-backed positions so drag selection, copied text, and overlay actions stay aligned.
- Reason: the first custom drag-highlighter did not behave like actual text selection, while the DOM layer backed by our own character widths keeps native selection behavior without giving up PDF-grounded geometry.

### 2026-03-28: Hide native per-character selection fill when the viewer paints merged selection bars

- If the DOM selection layer uses one span per character for precise hit geometry, the browser's own `::selection` background will appear as letter-by-letter blocks.
- Keep the native selection fill transparent and render the visible selection state from merged same-line client rects instead.
- Reason: this preserves accurate copying/drag selection while making the visible highlight read like a normal continuous text selection.

### 2026-03-28: Transparent custom selection fills need drag-time repaint independent of browser selection timing

- Once the browser's native `::selection` fill is hidden, the viewer cannot wait until mouseup to repaint the custom merged selection bars.
- During an active drag, schedule selection publication from document-level mouse movement with `requestAnimationFrame`, and use document-level mouseup to finalize even if the drag ends outside the block.
- Reason: some browser/event combinations do not surface a timely enough `selectionchange` for this overlay, which leaves users with no visible feedback until they release the mouse.

### 2026-03-28: Selection actions should anchor and persist against the selected range, not the whole paragraph block

- When a text range inside a highlighted block becomes active, show its action toolbar next to the selected fragments and convert those fragment rects back into PDF bounds for chat/image/widget annotations and popup placement.
- For selection chat, structure the context so the selected excerpt is explicitly primary and the surrounding logical-unit text is explicitly secondary.
- Reason: otherwise the UI looks like it still acts on the full paragraph and saved artifacts from multiple different selections inside one block overwrite each other.

### 2026-03-28: Selection-anchored toolbars should not be cleared before the replacement range is published

- If a toolbar is anchored to the current text range, do not clear that range immediately on `mousedown` when the user starts adjusting the selection.
- Keep the previous range alive until the next DOM selection is published, then animate the toolbar's `left` and `top` to the new anchor.
- Reason: clearing first makes the toolbar disappear and snap back in, which feels visually harsh even when the selection logic itself is correct.

### 2026-03-28: Range-action toolbars should stay hidden while the user is actively dragging a selection

- The selection overlay should report drag start/end explicitly so the parent can suppress the range-anchored toolbar until the mouse is released.
- Keep the selected text highlight itself live during the drag, but do not show the anchored action chrome until selection interaction has stopped.
- Reason: otherwise the toolbar appears to chase the mouse while the user is still selecting, which is visually distracting even if the final anchor is correct.

### 2026-03-28: Client-side API error parsing should understand both `{ error: "..." }` and `{ error: { message: ... } }`

- The task proxy commonly returns top-level string errors like `{ "error": "GEMINI_API_KEY is not configured on the proxy server." }`.
- Keep the error parsing shared across direct task helpers and the global fetch error dialog so local misconfiguration surfaces the real backend message instead of a generic `HTTP 500 - Internal Server Error`.
- Reason: without that shared parser, the UI hides the actionable cause of local task failures and makes provider/env issues look like opaque server bugs.

### 2026-03-28: Compact punctuation preservation must not treat lowercase-to-Uppercase sentence joins as domains

- When repairing punctuation spacing, only preserve dot-joined domain-like tokens when the post-punctuation segment still looks like an in-token continuation, not the start of a new capitalized sentence word.
- Preserve real abbreviations like `U.S.A` separately, and let paragraph assembly collapse `letter-` plus lowercase continuation lines without inserting a space.
- Reason: the Transformer abstract needed `mechanism. We`, `entirely. Experiments`, and `English-to-German` restored without breaking genuine compact punctuation tokens.

### 2026-03-28: Mixed prose items should still repair around embedded emails, and front-matter joins need multi-word capitalized recovery

- Do not skip lexical repair for an entire text item just because it contains an email or URL somewhere inside it; only standalone compact tokens should bypass the repair pass.
- Preserve embedded emails with token-local punctuation guards, then recover merged front-matter labels and affiliations with a combination of connector-aware TitleCase splitting, leading-capitalized-plus-lowercase segmentation, and uppercase-letter-plus-ZIP-code spacing.
- Reason: `pdfs/Paper reduced size (2).pdf` page 1 needed `Wyss Institute for Biologically Inspired Engineering`, `Corresponding author: michael.levin@tufts.edu`, `Running title`, and `MA 02155` restored from one shared parser path.

### 2026-03-29: Unknown merged tokens must not self-validate, and long prose chains need anchored segmentation

- When deciding whether to split an untrusted merged token, do not let raw within-document frequency counts for that same merged token outweigh a strong segmentation into trusted or lexically anchored words.
- Leading `I` joins and capitalized common-word joins should use prefix-aware lexical checks (`I propose`, `In contrast`, `The latent`) rather than greedy fixed regex grouping, and long all-letter chains can be split safely when many of their candidate words are anchored by common/trusted vocabulary.
- Reason: `pdfs/Paper reduced size (2).pdf` still had body-text joins like `Ipresent`, `Ihypothesize`, `Incontrast`, `Thelatent`, `Platonicspace`, `latentspace`, `fishinginregionsofPlatonicspacewehaveneverexploredbefore`, and `interfacesandthestructurestowhichtheypointinthePlatonicspace` after the front-matter fixes; damping self-reinforcing merged-word evidence plus anchored DP segmentation fixed them from one shared parser path.

### 2026-03-29: Large-gap split-word repair must be conservative, and `A`/`I` prefix splits cannot trust document-frequency fragments

- Some PDFs emit broken words with large internal advances (`A ffiliations`, `Regulariz at i on`) rather than tiny suspicious gaps, so the non-suspicious path needs a separate weak-fragment run repair instead of blindly reusing the tiny-gap cluster logic.
- That repair must skip title-case phrases and ordinary two-word prose unless there is explicit lexical evidence, otherwise it will collapse valid spacing such as `Kai Chen` or `Experiments on two machine`.
- The `resolveLeadingArticleWords` heuristic should only split `A...` / `I...` forms when the candidate continuation is explicitly trusted, not just count-backed inside the current document; otherwise noisy fragments like `ngressing` can self-validate and re-break `Ingressing`.
- Reason: the reduced-paper front matter needed `Affiliations`, `Allen`, and `Ingressing` restored without regressing normal prose or author-name spacing, while the same shared path also had to recover NIPS-style fragment runs such as `Regulariz at i on`.

### 2026-03-29: Visible canvas rendering must use a PDF-faithful display text stream, not the semantic repair stream

- Keep two page-level text streams: `displayTextItems` for canvas painting and embedded-font prep, and `textItems` for semantic consumers such as search, selection, and HTML/reflow reconstruction.
- `displayTextItems` should stop after paint-order assignment and geometric bound refinement; do not run smoothing or lexical boundary repair on the stream used for visible rendering.
- Reason: PDFs rarely encode explicit word boundaries, so semantic cleanup is inherently heuristic. If the renderer paints the repaired text model, missing/extra-space heuristics become visible rendering defects instead of staying confined to copy/search/reflow behavior.

### 2026-03-29: Visible word-gap fidelity depends on embedded-font activation and family-correct fallback

- Some PDFs use narrow real inter-run gaps that only look like spaces when painted with the original embedded font; if the browser falls back to a wider sans font, those gaps visually collapse even though the raw PDF item positions are unchanged.
- After adding an embedded `FontFace` to the browser font set, wait briefly for `document.fonts.load(...)` and `document.fonts.ready` before treating the face as ready for canvas painting, but bound that wait so rendering cannot hang indefinitely.
- If embedded activation still fails, route known serif families such as `Cambria` to a serif fallback stack instead of the generic canvas sans default.
- Reason: `pdfs/Paper reduced size (2).pdf` page 2 rendered `paradigmholds` and `livingbeings` only because fallback sans glyph shapes erased small but real PDF word gaps; Poppler's native render showed the spaces correctly.

### 2026-03-30: Multi-glyph display runs should use per-glyph placement, not whole-word scale fitting

- For ordinary document text with preserved `glyphSpans`, prefer the glyph-span renderer over whole-word `fillText` scaling even when the font is not in the special exact-outline path.
- Whole-word `projectedWidth / measuredWidth` scaling can compress the terminal and leading side bearings that visually separate adjacent PDF runs, which makes copied text look correct while the canvas collapses spaces like `Thisisastrue...`.
- Reason: on `pdfs/Paper reduced size (2).pdf` page 4, the semantic text already had `This is as true...`, but the visible canvas lost the spaces because word-by-word browser layout squeezed already-tight Cambria runs; per-glyph placement matches the PDF advance model more closely.

### 2026-03-30: Display glyph spans must preserve invisible PDF glyph slots, while semantic spans should strip them

- Some PDFs encode visual spacing or undecoded glyph positions as hidden glyph codes inside ordinary text-show strings instead of plain Unicode spaces. Those slots still consume advance in the PDF text matrix even when they decode to `''`.
- The display stream must keep those empty-text glyph spans so canvas rendering can leave real gaps at the original PDF positions. Dropping them makes the renderer stretch visible letters across the hidden slot or collapse the gap entirely.
- The semantic stream should strip those empty glyph spans before smoothing and lexical repair so search, selection, and HTML reconstruction do not inherit invisible PDF noise.
- Reason: `pdfs/Paper reduced size (2).pdf` page 1 and page 4 use hidden Cambria glyph slots inside runs like `alc` and `This`; preserving those slots on `displayTextItems` fixed visible word spacing without letting raw PDF control codes leak into semantic text consumers.

## Recent Examples

- `pdfs/IRA contribution IRS.pdf`
  - Required three linked fixes: user-space `renderFontSize`, invisible text suppression, and no double-transform of top-level path clip paths.
- `pdfs/Claires7thBday.pdf`
  - The missing center text was another `fontSize = 1` / transformed-text issue; fixing the shared render-size model restored visibility without a PDF-specific special case.
- `pdfs/2401.05375v1.pdf`
  - Required two layers of shared fixes: outer-transform rescaling of `renderFontSize`, then conservative text-boundary/smoothing heuristics so author/front-matter wording stayed intact.
