# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

- **docs/ARCHITECTURE.md** - Comprehensive architecture overview, module breakdown, data flow diagrams
- **docs/LLM-REFACTORING.md** - Recommendations for splitting code into smaller LLM-friendly modules

## Project Overview

PDF Layout Parser is a lightweight TypeScript library for extracting text runs and layout metadata from PDF files without third-party parsing dependencies. The architecture is modular and designed to evolve toward full PDF specification coverage.

## Development Commands

### Library Development
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm test             # Run Vitest suite
npm run lint         # Run type-checking (tsc --noEmit)
npm run clean        # Remove dist/ directory
```

### Running Single Tests
```bash
npm test -- pdfParser.test.ts           # Run specific test file
npm test -- -t "extracts text items"    # Run test matching pattern
```

### Debug Web App (testApp/)
The testApp/ directory contains a React-based visual debugging tool for manual PDF inspection:
```bash
cd testApp
npm install
npm run dev          # Start Vite dev server
```

The debug app allows uploading PDFs to visualize text runs via CanvasRenderer and inspect the raw PDFDocument JSON structure.

## Architecture

### Core Modules

**src/pdfDocument.ts** - Main API entry point
- `PDFDocument.from(source, options)` factory method creates documents from ArrayBuffer/Uint8Array/string
- Provides convenience methods: `getText()`, `getPage(number)`, `getTextItems()`, `getImageItems()`

**src/parser/pdfParser.ts** - PDF parsing engine (3700+ lines)
- `PDFParser` class handles the heavy lifting of PDF specification parsing
- Resolves objects via cross-reference (xref) table
- Decodes `/FlateDecode` streams using pako (zlib)
- Walks ancestor `/Resources` dictionaries to inherit fonts from parent pages
- Applies `/ToUnicode` CMaps for custom font encodings (Type0/CIDFont support)
- Handles indirect object references (`N M R` syntax)
- Stores declared stream lengths (including indirect refs) and rehydrates raw stream bytes when needed
- Retries Flate decoding with stricter data boundaries to handle malformed PDFs
- Text state machine tracks cursor position, font, fontSize, and leading for text operators (Tj, TJ, Td, TD, T*, etc.)
- Graphics state tracking with CTM (Current Transformation Matrix) for proper positioning
- Form XObject recursion for nested content streams
- Image XObject extraction supporting JPEG (DCTDecode), FlateDecode, and CCITT Group 4 fax compression
- Soft mask and alpha channel support for images

**src/viewer/canvasRenderer.ts** - Debug visualization (515 lines)
- `CanvasRenderer` uses HTML Canvas 2D API to render text items and images
- Draws text runs with proper font sizing and horizontal scaling
- Handles both ascending (bottom-up) and descending (top-down) Y-axis orientations
- Renders images (JPEG data URIs, decoded pixels, CCITT masks)
- Supports zoom in/out with configurable scale
- Configurable colors, padding, and font fallbacks

**src/html/htmlLayoutConverter.ts** - HTML structure conversion
- Converts PDF layout to semantic HTML blocks (paragraphs, headings, tables, images)
- Groups text items into lines and blocks based on spatial relationships
- Detects tables by analyzing column alignment and row patterns
- Infers heading hierarchy from font sizes

**src/html/htmlRenderer.ts** - HTML DOM rendering
- Renders HtmlDocumentLayout to HTML elements
- Supports both flow and absolute positioning modes
- Configurable styling via CSS classes

**src/query/relevanceAugmenter.ts** - Relevance annotation system
- Augments HTML layouts with relevance annotations (highlight, dim, remove states)
- Used to highlight search results or relevant content
- Supports match ranges, summaries, and confidence scores

**src/query/openaiRelevanceService.ts** - OpenAI integration
- Queries OpenAI API to determine content relevance for a given query
- Returns structured annotations for document blocks

**src/visual/relevanceRenderer.ts** - Relevance visualization
- Renders annotated layouts with visual highlighting
- Applies theme classes for highlighted/dimmed content

**src/parser/textSmoother.ts** - Text run merging
- Merges adjacent text runs on the same baseline with minimal gaps
- Improves readability when PDFs split words across multiple text operators

**src/parser/mathUtils.ts** - Matrix operations
- Matrix multiplication, transformations, and point projection
- Image bounds computation from transformation matrices

**src/parser/textTokenizer.ts** - Content stream tokenization
- Tokenizes PDF content streams into numbers, strings, names, arrays, and operators
- Handles literal strings `(...)`, hex strings `<...>`, and names `/Name`

**src/parser/streamDecoder.ts** - Stream decompression
- FlateDecode (zlib) wrapper using pako library

**src/parser/ccittDecoder.ts** - CCITT Group 4 fax decoder
- Decodes 1-bit fax-compressed image masks

**src/types.ts** - Core type definitions
- `PDFLayout`, `PDFPage`, `PDFTextItem`, `PDFImageItem`, `PDFPageSize`, `PDFImageBounds`, `Vector2D`
- `ParseOptions`, `ParseSource`

**src/utils/buffer.ts** - Encoding utilities
- `bufferToLatin1()`, `latin1ToUint8()`, `uint8ToBase64()` for Latin-1/binary/base64 conversions

### Key Parsing Features

1. **Cross-reference Table Resolution**: Parses xref tables to locate indirect objects by ID, follows `/Prev` chains
2. **Stream Decompression**: Handles FlateDecode (zlib) streams, retrying with adjusted boundaries for malformed PDFs
3. **Resource Inheritance**: Walks `/Parent` references up the page tree to collect inherited fonts and resources
4. **Font Encoding**: Decodes ToUnicode CMaps (beginbfchar/beginbfrange) to map glyph codes to Unicode strings
5. **Text Operators**: Implements PDF text-showing operators (Tj, TJ, ', ") and text-positioning operators (Td, TD, Tm, T*)
6. **Indirect Length Handling**: Resolves indirect object references for stream lengths before decompression
7. **Graphics State Stack**: Tracks `q`/`Q` operators for save/restore and `cm` for CTM transformations
8. **Form XObjects**: Recursively parses nested Form XObjects with merged resource contexts
9. **Image Extraction**: Extracts and decodes images (JPEG, FlateDecode with PNG predictors, CCITT masks)
10. **Color Space Handling**: Converts DeviceRGB, DeviceCMYK, DeviceGray to RGBA for rendering
11. **Font Metrics**: Extracts glyph widths from `/Widths`, `/W`, `/DW` for accurate text positioning
12. **Encoding Maps**: Builds encoding maps from `/Encoding` dictionaries with `/Differences` arrays

### Test Structure

**tests/** directory contains Vitest test files:
- `pdfParser.test.ts` - Core parser functionality tests
- `canvasRenderer.test.ts` - Renderer tests
- `__fixtures__/` - Sample PDF files for testing:
  - `simple.pdf` - Basic two-text-item PDF
  - `compressed.pdf` - FlateDecode stream test
  - `latin_encoding.pdf` - Latin-1 encoding test
  - `unicode.pdf` - ToUnicode CMap test
  - `unicode_inherited.pdf` - Inherited font resources test

**Example from pdfParser.test.ts:114-121**: Regression test loading `pdfs/InformationTheoryByMacKay.pdf` to verify indirect stream length handling extracts "Cambridge University Press" text.

### Recent Parser Enhancements (from git log)

- Stores declared stream lengths (including indirect refs), rehydrates raw stream bytes from source PDF when needed (pdfParser.ts:552-601)
- Retries Flate decoding with stricter data boundaries (pdfParser.ts:1221-1283)
- Guards against pako returning undefined for image-heavy PDFs
- Pulls font resources from ancestor `/Resources` dictionaries for page tree inheritance (pdfParser.ts:1919-1989)
- Resolves indirect resource objects and parses nested dictionaries (pdfParser.ts:2080-2120)
- Reuses ToUnicode maps for custom Type0 fonts
- Added helpers for reading inline dictionaries, tracking visited resource objects, and walking `/Parent` references to avoid cycles (pdfParser.ts:1954-1965)
- Image rendering with soft masks, decode arrays, and predictor filters (pdfParser.ts:2910-3055)
- CCITT Group 4 fax decoding for monochrome image masks (pdfParser.ts:2959-3006)
- Text bounds refinement to fix overlapping characters on the same line (pdfParser.ts:2650-2715)

## Development Notes

- The parser uses a state machine approach for tracking text position as it processes PDF content streams
- FlateDecode is the primary filter; additional filters (ASCII85Decode, LZWDecode, etc.) can be added as needed. JPEG (DCTDecode) and CCITT are supported for images.
- Graphics state tracking (CTM transformations) is implemented for proper positioning of text and images
- The library exports all core types and classes from `src/index.ts`
- TypeScript compilation target preserves `.js` extensions in imports for ESM compatibility
- Test fixtures in `tests/__fixtures__/` and `pdfs/` cover various PDF features and edge cases
