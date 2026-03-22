import type {
  HtmlContentBlock,
  HtmlDocumentLayout,
  HtmlHeadingBlock,
  HtmlParagraphBlock,
  HtmlTableBlock
} from 'pdf-layout-parser';
import type { GeminiDocumentExtraction, GeminiElement } from '../storage/geminiExtractionStorage';

interface BuildDocumentChatFullContextInput {
  documentText: string;
  htmlLayout: HtmlDocumentLayout | null;
  geminiExtraction?: GeminiDocumentExtraction | null;
}

type SerializableBlock = Record<string, unknown>;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function serializeTextBlock(block: HtmlParagraphBlock | HtmlHeadingBlock): SerializableBlock | null {
  const text = normalizeText(block.text ?? '');
  if (!text) {
    return null;
  }

  if (block.type === 'heading') {
    return {
      type: 'heading',
      level: block.level,
      text
    };
  }

  return {
    type: 'paragraph',
    text
  };
}

function serializeTableBlock(block: HtmlTableBlock): SerializableBlock | null {
  const rows = (block.rows ?? [])
    .map((row) =>
      (row.cells ?? [])
        .map((cell) => normalizeText(cell.text ?? ''))
        .filter((cellText) => cellText.length > 0)
        .join(' | ')
    )
    .filter((rowText) => rowText.length > 0);

  if (rows.length === 0) {
    return null;
  }

  return {
    type: 'table',
    rows
  };
}

function serializeHtmlBlock(block: HtmlContentBlock): SerializableBlock | null {
  if (block.type === 'paragraph' || block.type === 'heading') {
    return serializeTextBlock(block);
  }

  if (block.type === 'table') {
    return serializeTableBlock(block);
  }

  if (block.type === 'image') {
    return {
      type: 'image'
    };
  }

  return null;
}

function shouldIncludeSemanticElement(element: GeminiElement): boolean {
  if (element.type === 'paragraph' || element.type === 'heading' || element.type === 'title' || element.type === 'authors') {
    return false;
  }

  if (typeof element.description === 'string' && element.description.trim().length > 0) {
    return true;
  }

  if (typeof element.content === 'string') {
    return element.content.trim().length > 0;
  }

  return element.content && Object.keys(element.content).length > 0;
}

function serializeSemanticElement(element: GeminiElement): SerializableBlock | null {
  if (!shouldIncludeSemanticElement(element)) {
    return null;
  }

  const content = typeof element.content === 'string'
    ? normalizeText(element.content)
    : element.content;
  const serialized: SerializableBlock = {
    type: element.type,
    content
  };

  if (typeof element.description === 'string' && element.description.trim().length > 0) {
    serialized.description = normalizeText(element.description);
  }

  return serialized;
}

export function buildDocumentChatFullContext(input: BuildDocumentChatFullContextInput): string {
  const normalizedDocumentText = normalizeText(input.documentText);
  const pages = input.htmlLayout?.pages.map((page) => {
    const blocks = page.content
      .map((block) => serializeHtmlBlock(block))
      .filter((block): block is SerializableBlock => block !== null);
    const semanticElements = input.geminiExtraction?.pages
      .find((extractedPage) => extractedPage.page_number === page.number)
      ?.elements.map((element) => serializeSemanticElement(element))
      .filter((element): element is SerializableBlock => element !== null) ?? [];

    return {
      page_number: page.number,
      blocks,
      ...(semanticElements.length > 0 ? { semantic_elements: semanticElements } : {})
    };
  }) ?? [];

  const payload: Record<string, unknown> = {
    page_count: input.htmlLayout?.pages.length ?? 0,
    ...(input.geminiExtraction?.document_title ? { document_title: input.geminiExtraction.document_title } : {}),
    ...(pages.length > 0 ? { pages } : {}),
    ...(pages.length === 0 && normalizedDocumentText.length > 0 ? { full_text: normalizedDocumentText } : {})
  };

  return JSON.stringify(payload);
}
