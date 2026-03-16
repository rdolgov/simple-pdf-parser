# PDF Rendering Architecture

## Goals

This project is a PDF parser and renderer first. Everything else in the repo only matters if the parser can preserve page structure closely enough that the browser render matches a reference PDF rasterizer.

Current priorities:

- follow PDF text, graphics, and image semantics closely
- keep parser and renderer concerns separated
- add regression tests at the parser layer and renderer layer
- verify visually with an automated reference-render compare loop

## System Map

```text
PDF bytes
  |
  v
+-------------------+
| PDFParser         |
| src/parser/*      |
+-------------------+
  |  text items
  |  image items
  |  path items
  v
+-------------------+
| PDFLayout         |
| src/types.ts      |
+-------------------+
  |                    \
  |                     \
  v                      v
+-------------------+   +----------------------+
| CanvasRenderer    |   | Html/Query pipeline  |
| src/viewer/*      |   | src/html, src/query  |
+-------------------+   +----------------------+
  |
  v
browser canvas
  |
  v
compare against pdftocairo/ghostscript reference
```

## Core Modules

### Parsing

- `src/parser/pdfParser.ts`
  - owns object extraction, resource resolution, stream walking, text operator execution, image extraction, and page assembly
  - builds `PDFPage` objects with `textItems`, `imageItems`, `lineItems`, `rectItems`, and `pathItems`
- `src/parser/textTokenizer.ts`
  - low-level token and operator scanning for content streams
- `src/parser/textSmoother.ts`
  - geometric merging of adjacent text runs
- `src/parser/textBoundaryModel.ts`
  - document/font-aware lexical repair after geometry merge
  - used for split words and hyphenated line joins
- `src/parser/pathUtils.ts`
  - path command construction, close-path handling, path transforms, and line-cap/join mapping
- `src/parser/imageDecoder.ts`
  - Flate image decode, indexed color expansion, 1-bit sample decode, CCITT mask conversion helpers
- `src/parser/ccittDecoder.ts`
  - CCITT fax decode used by image masks and scanned images
- `src/parser/mathUtils.ts`
  - matrix math and bounds transforms used across text, images, and vector paths

### Rendering

- `src/viewer/canvasRenderer.ts`
  - draws page vector paths, raster/mask images, and text
  - handles Type3 path glyphs and bitmap glyphs
  - recognizes CMEX brace-construction fragments and renders them as font-independent vector braces
  - applies a small thin-stroke floor so canvas output matches PDF rasterizers more closely than raw subpixel stroke widths do
- `src/viewer/fontFallback.ts`
  - browser font-family fallback choices for decoded PDF fonts
- `src/viewer/cmexComposite.ts`
  - groups TeX `CMEX` brace-construction runs such as `z}|` + `{` and `{z` + `|` + `}`
  - keeps composite math ornament handling out of the generic text layout path

### Public API

- `src/pdfDocument.ts`
  - stable API entry point
  - wraps parser output and exposes `getPage`, `getText`, `getTextItems`, `getImageItems`

## Rendering Pipeline

```text
1. Parse xref/object graph
2. Resolve page resources
3. Decode streams
4. Walk page/Form content streams
5. Emit:
   - text items from text operators
   - image items from XObjects and BI...EI inline images
   - vector path items from graphics operators
6. Merge text geometrically
7. Repair lexical boundaries
8. Render layout to canvas
9. Compare canvas output to a reference raster
```

## Spec-Oriented Design Rules

The engine tries to stay close to PDF semantics instead of baking in document-specific hacks.

### Text

- text position comes from the text matrix and text line matrix
- spacing uses `Tc`, `Tw`, `TJ`, `Tj`, `Td`, `TD`, `Tm`, `T*`
- simple-font decode prefers `ToUnicode`, then `/Encoding`, then controlled font-specific fallbacks
- TeX math-extension construction fragments are treated as semantic ornaments when they are not printable text
- style inference is separate from content decode
  - for example `CMMI`, `CMTI`, and `CMSL` should render as italic/slanted families

### Vector graphics

- page graphics are preserved as path commands, not flattened to line segments when avoidable
- Bezier curves are kept through parse and render
- fill and stroke colors remain distinct
- line cap, line join, miter limit, fill rule, and stroke width travel with the path item
- zero-width PDF strokes are rendered as one device pixel
- very thin positive strokes use a small floor because raw canvas output under-renders them relative to PDF rasterizers

### Images

- image XObjects and inline `BI ... EI` images share the same decode path
- supported decode paths currently include:
  - Flate
  - CCITT fax
  - JPEG passthrough
  - indexed color expansion
  - 1-bit image masks
- image masks stay as masks when possible so the renderer can paint them crisply

### Type3 fonts

Type3 glyphs are now split into two categories:

- path glyphs
  - parsed from CharProc drawing operators into reusable path commands
- bitmap glyphs
  - parsed from CharProc inline images (`BI ... EI`) into glyph-local image layers

That matters for scanned/diagram-heavy PDFs because some symbol fonts and chapter markers are bitmap-backed Type3 glyphs rather than vector outlines.

## Important Layout Types

```text
PDFPage
  - textItems[]
  - imageItems[]
  - lineItems[]
  - rectItems[]
  - pathItems[]
  - size

PDFTextItem
  - text
  - bounds
  - baselineStart / baselineEnd
  - font, fontSize, fontWeight, fontStyle
  - type3Glyphs[]

Type3Glyph
  - pathCommands[]
  - imageLayers[]
  - width
```

## Compare and Verification Workflow

The renderer should be checked against a reference rasterizer, not just by reading extracted text.

Current workflow:

```text
PDF page
  |
  +--> our browser canvas render
  |
  +--> pdftocairo reference PNG
          |
          v
     magick compare
          |
          v
    actual / reference / diff artifacts
```

Key scripts:

- `scripts/capture_formula_region.mjs`
  - render a selected page or crop through the browser path
- `scripts/compare_pdf_page_render.mjs`
  - render selected pages through both paths
  - compute RMSE
  - emit `actual`, `reference`, and `diff` PNGs

Recommended debugging order:

1. identify worst pages by compare output
2. classify the failure as text, vector, image, or font-glyph
3. fix parser semantics first when the extracted layout is wrong
4. fix renderer behavior when parser output is already correct
5. add a regression test at the narrowest sensible layer
6. rerun `tests/pdfLayout.integration.test.ts`
7. rerun the compare script on the affected pages

## Current Testing Strategy

Use small, layered regressions instead of one giant golden test.

- `tests/pdfParser.test.ts`
  - parser correctness
  - decode behavior
  - page fixtures for known regressions
- `tests/canvasRenderer.test.ts`
  - renderer mechanics
  - path drawing
  - stroke behavior
  - Type3 rendering rules
- `tests/pdfLayout.integration.test.ts`
  - required regression gate for parser/rendering changes
  - checks end-to-end page render behavior on representative PDFs

## Recent Architectural Changes

The current renderer differs from the older version in a few important ways:

- preserved page Bezier paths instead of flattening them to straight segments
- unified XObject and inline-image decode path
- added indexed-color image decode
- added CCITT grayscale decode for scanned/bitmap figures
- added Type3 bitmap glyph support for CharProc inline images
- added lexical boundary repair after geometric text merge
- added a dedicated CMEX composite-brace layer so TeX brace pieces render as stable vector overbraces/underbraces
- added reference-raster comparison scripts based on `pdftocairo` and `magick`

## Known Limits

These are the main areas still under active refinement:

- canvas thin-stroke fidelity still differs from mature PDF rasterizers on some dense vector figures
- some custom embedded symbol fonts still require better semantic mapping
- Type3 glyph rendering is much better than before, but mixed path/image CharProcs can still need more precise paint-order handling

## Practical Rule

If a fix only makes one PDF look better but weakens the parser's alignment with PDF operators or graphics state, it is probably the wrong fix.
