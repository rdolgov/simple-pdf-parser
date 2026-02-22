# PDF Layout Parser

Lightweight TypeScript library for extracting text runs and basic layout metadata from PDF files without third-party parsing dependencies. The focus is on a modular architecture that can evolve toward full PDF specification coverage.

## Getting Started

```bash
npm install
npm run build
```

## Usage

```ts
import { readFileSync } from 'node:fs';
import { PDFDocument, CanvasRenderer } from 'pdf-layout-parser';

const bytes = readFileSync('invoice.pdf');
const document = PDFDocument.from(bytes);

for (const page of document.pages) {
  for (const item of page.textItems) {
    console.log(page.number, item.bounds.minX, item.bounds.minY, item.text);
  }
}

// Debug viewer (browser)
const canvas = document.getElementById('preview') as HTMLCanvasElement;
const renderer = new CanvasRenderer({ scale: 1.25 });
renderer.render(canvas, document, 1);
```

### Gemini API Helper

```ts
import { GeminiAPI } from 'pdf-layout-parser';

const gemini = new GeminiAPI({ apiKey: process.env.GEMINI_API_KEY ?? '', model: 'gemini-3-pro-image-preview' });
const result = await gemini.generateText('Explain how AI works in a few words');

console.log(result.text);

const imageResult = await gemini.generateImage(
  'Create a picture of a nano banana dish in a fancy restaurant with a Gemini theme'
);

// imageResult.images[0].data contains the base64 payload for the rendered image
```

### Structured Extract (Gemini or OpenAI Provider)

```ts
import { StructuredExtractAPI } from 'pdf-layout-parser';
import { renderStructuredData } from './testApp/src/viewer/htmlStructuredDataRenderer';

const extractor = new StructuredExtractAPI({
  provider: 'gemini', // or 'openai'
  apiKey: process.env.GEMINI_API_KEY ?? '',
  model: 'gemini-3-pro-preview'
});

const pdfFile = new File([bytes], 'document.pdf');
const { document, assetMap } = await extractor.extractStructuredData(pdfFile);

renderStructuredData(container, document, { assetMap });
```

## Development

- `npm run build` – compile TypeScript to `dist/`.
- `npm test` – execute the Vitest suite.
- `npm run lint` – run type-checking.

### Debug Web App

`testApp/` hosts a minimal React playground for manual inspection.

```bash
cd testApp
npm install
npm run dev
```

Upload a PDF and the viewer will render the currently selected page via `CanvasRenderer`.
Use the tabs to switch between the canvas overlay and the raw `PDFDocument` JSON payload.

The current implementation resolves objects via the cross-reference table, decodes `/FlateDecode` streams, walks ancestor resource dictionaries, and applies `/ToUnicode` CMaps so Latin text survives custom fonts. The debugging `CanvasRenderer` module uses the HTML Canvas 2D API to visualize text runs and baselines so contributors can quickly validate positions. Additional parsing stages—extra filters, DecodeParms, graphics state tracking—can be layered in as the project grows.
