import type {
  ParseOptions,
  ParseSource,
  PDFImageItem,
  PDFLayout,
  PDFLineItem,
  PDFPage,
  PDFPageSize,
  PDFRectItem,
  PDFTextItem,
  Type3Glyph,
  Type3PathCommand,
  Vector2D
} from '../types.js';
import { mergeTextRuns } from './textSmoother.js';
import type { Matrix } from './mathUtils.js';
import {
  identityMatrix,
  cloneMatrix,
  multiplyMatrices,
  transformPoint,
  computeImageBounds,
  transformImageItem
} from './mathUtils.js';
import { decodeCcitt } from './ccittDecoder.js';
import type { CcittMask } from './ccittDecoder.js';
import { decodeFlate } from './streamDecoder.js';
import {
  OperatorToken,
  tokenize,
  readLiteralString,
  readHexString,
  readName,
  readToken,
  consumeComment,
  isWhitespace,
  isDelimiter,
  isNumberToken,
  isOctalDigit
} from './textTokenizer.js';
import { bufferToLatin1, latin1ToUint8, uint8ToBase64 } from '../utils/buffer.js';

// Import types from parserTypes module
import type {
  PDFRawObject,
  ContentRef,
  FontResource,
  FontMap,
  ImageResource,
  ImageMap,
  ResourceContext,
  ParseContext,
  StreamLengthInfo,
  XRefEntry,
  TextState,
  PDFNameValue,
  PDFOperatorValue
} from './parserTypes.js';

// Import constants from parserConstants module
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_PAGE_WIDTH,
  DEFAULT_PAGE_HEIGHT,
  INLINE_IMAGE_OPERATOR_REGEX,
  DO_OPERATOR_REGEX,
  BASIC_GLYPH_MAP,
  CONTROL_CHAR_MATH_OVERRIDES,
  CONTROL_CHAR_FALLBACK
} from './parserConstants.js';

// Import xref parsing functions
import { parseXRefTable, parseXRefSection, objectKey } from './xrefParser.js';

// Import parser utilities
import {
  skipWhitespace,
  readDictionary,
  hexToBytes,
  bytesToKey,
  intToBytes,
  hexToUnicodeString
} from './parserUtils.js';

// Import font encoding functions
import {
  parseToUnicodeCMap,
  buildEncodingMap,
  extractEncodingInfo,
  glyphNameToUnicode
} from './fontEncoding.js';

// Import image decoding functions
import {
  paethPredictor,
  applyImagePredictor,
  resolveColorComponentCount,
  decodeFlateImage,
  ccittMaskToPixels,
  trimPixelBounds
} from './imageDecoder.js';

// Import text decoding functions
import {
  decodeText,
  decodeByteWithEncoding,
  applyControlCharFallback,
  controlCharOverrides,
  extractGlyphCodes,
  lookupGlyphWidth,
  bytesToCid,
  countSpaces
} from './textDecoder.js';

export class PDFParser {
  constructor(private readonly options: ParseOptions = {}) {}

  parse(source: ParseSource): PDFLayout {
    const content = this.ensureString(source);
    this.validateHeader(content);
    const objects = this.extractObjects(content);
    const pages = this.buildPages(objects, content);
    return { pages };
  }

  private ensureString(source: ParseSource): string {
    if (typeof source === 'string') {
      return source;
    }

    if (source instanceof Uint8Array) {
      return bufferToLatin1(source);
    }

    if (source instanceof ArrayBuffer) {
      return bufferToLatin1(new Uint8Array(source));
    }

    throw new TypeError('Unsupported PDF input source.');
  }

  private validateHeader(content: string): void {
    if (!content.trimStart().startsWith('%PDF-')) {
      throw new Error('Input does not appear to be a valid PDF document.');
    }
  }

  private extractObjects(content: string): Map<string, PDFRawObject> {
    const objects = new Map<string, PDFRawObject>();
    const xrefEntries = parseXRefTable(content);

    if (xrefEntries.size > 0) {
      // First pass: extract normal (type 1) objects
      for (const entry of xrefEntries.values()) {
        if (!entry.inUse) {
          continue;
        }
        // Skip type-2 entries (objects inside ObjStm) - they'll be unpacked below
        if (entry.containingObjStm !== undefined) {
          continue;
        }
        const parsed = this.parseObjectAt(content, entry.offset);
        if (parsed) {
          const key = objectKey(parsed.id, parsed.generation);
          objects.set(key, parsed);
        }
      }

      // Second pass: unpack objects from ObjStm containers
      if (objects.size > 0) {
        this.unpackObjectStreams(xrefEntries, objects, content);
      }

      if (objects.size > 0) {
        return objects;
      }
    }

    // Fallback for documents without a readable xref table.
    const regexMap = new Map<string, PDFRawObject>();
    const objectRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
    let match: RegExpExecArray | null;

    while ((match = objectRegex.exec(content)) !== null) {
      const [_, idRaw, genRaw, bodyRaw] = match;
      const id = Number(idRaw);
      const generation = Number(genRaw);
      const raw = bodyRaw.trim();
      const { dictionarySource, stream, streamLength, streamLengthRef } = this.splitDictionaryAndStream(raw);
      const key = objectKey(id, generation);

      regexMap.set(key, {
        id,
        generation,
        raw,
        dictionarySource,
        stream,
        streamLength,
        streamLengthRef,
        offset: match.index
      });
    }

    return regexMap;
  }

  private parseObjectAt(content: string, offset: number): PDFRawObject | undefined {
    if (!Number.isFinite(offset) || offset < 0 || offset >= content.length) {
      return undefined;
    }

    const slice = content.slice(offset);
    const headerMatch = /^(\d+)\s+(\d+)\s+obj\b/.exec(slice);
    if (!headerMatch) {
      return undefined;
    }

    const id = Number(headerMatch[1]);
    const generation = Number(headerMatch[2]);
    const bodyStart = headerMatch[0].length;
    const endIndex = slice.indexOf('endobj', bodyStart);

    if (endIndex === -1) {
      return undefined;
    }

    const raw = slice.slice(bodyStart, endIndex).trim();
    const { dictionarySource, stream, streamLength, streamLengthRef } = this.splitDictionaryAndStream(raw);

    return {
      id,
      generation,
      raw,
      dictionarySource,
      stream,
      streamLength,
      streamLengthRef,
      offset
    };
  }

  /**
   * Unpack objects stored inside Object Streams (ObjStm).
   * ObjStm is a PDF 1.5+ feature that stores multiple objects in a single
   * compressed stream for better compression.
   */
  private unpackObjectStreams(
    xrefEntries: Map<string, { containingObjStm?: number; indexInObjStm?: number; objectNumber: number }>,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): void {
    // Collect which ObjStm containers we need to unpack
    const objStmIds = new Set<number>();
    for (const entry of xrefEntries.values()) {
      if (entry.containingObjStm !== undefined) {
        objStmIds.add(entry.containingObjStm);
      }
    }

    if (objStmIds.size === 0) {
      return;
    }

    // Build a cache of unpacked ObjStm contents: objStmId -> Map<index, {id, content}>
    for (const objStmId of objStmIds) {
      const objStmKey = objectKey(objStmId, 0);
      const objStmObject = objects.get(objStmKey);
      if (!objStmObject) {
        continue;
      }

      // Verify it's an ObjStm
      if (!/\/Type\s*\/ObjStm/.test(objStmObject.dictionarySource)) {
        continue;
      }

      // Get /First (byte offset of first object's data) and /N (number of objects)
      const firstMatch = objStmObject.dictionarySource.match(/\/First\s+(\d+)/);
      const nMatch = objStmObject.dictionarySource.match(/\/N\s+(\d+)/);
      if (!firstMatch || !nMatch) {
        continue;
      }
      const first = Number(firstMatch[1]);
      const n = Number(nMatch[1]);

      // Decompress the ObjStm stream
      const streamContent = this.resolveStreamContent(objStmObject, objects, rawContent);
      if (!streamContent) {
        continue;
      }

      // Parse the header: N pairs of (objectId byteOffset)
      // The header occupies the first `first` bytes
      const header = streamContent.slice(0, first);
      const headerTokens = header.trim().split(/\s+/).map(Number);

      if (headerTokens.length < n * 2) {
        continue;
      }

      // Extract each object
      for (let i = 0; i < n; i++) {
        const objId = headerTokens[i * 2];
        const objOffset = headerTokens[i * 2 + 1];

        // Determine the end of this object's content
        const contentStart = first + objOffset;
        let contentEnd: number;
        if (i + 1 < n) {
          contentEnd = first + headerTokens[(i + 1) * 2 + 1];
        } else {
          contentEnd = streamContent.length;
        }

        const objContent = streamContent.slice(contentStart, contentEnd).trim();
        const key = objectKey(objId, 0);

        if (!objects.has(key)) {
          objects.set(key, {
            id: objId,
            generation: 0,
            raw: objContent,
            dictionarySource: objContent,
            offset: 0
          });
        }
      }
    }
  }

  private splitDictionaryAndStream(
    raw: string
  ): { dictionarySource: string; stream?: string; streamLength?: number; streamLengthRef?: ContentRef } {
    const streamKeywordIndex = raw.indexOf('stream');

    if (streamKeywordIndex === -1) {
      return { dictionarySource: raw.trim() };
    }

    const dictionarySource = raw.slice(0, streamKeywordIndex).trim();
    const lengthInfo = this.extractStreamLengthInfo(dictionarySource);
    let streamLength: number | undefined;
    let streamLengthRef: ContentRef | undefined;

    if (lengthInfo?.kind === 'number') {
      streamLength = lengthInfo.value;
    } else if (lengthInfo?.kind === 'ref') {
      streamLengthRef = { id: lengthInfo.id, generation: lengthInfo.generation };
    }

    const streamStart = streamKeywordIndex + 'stream'.length;
    let contentStart = streamStart;

    if (raw[contentStart] === '\r' && raw[contentStart + 1] === '\n') {
      contentStart += 2;
    } else if (raw[contentStart] === '\n') {
      contentStart += 1;
    }

    let streamContent: string | undefined;
    if (typeof streamLength === 'number' && streamLength >= 0 && contentStart + streamLength <= raw.length) {
      streamContent = raw.slice(contentStart, contentStart + streamLength);
    } else {
      const endKeywordIndex = raw.lastIndexOf('endstream');
      if (endKeywordIndex !== -1 && endKeywordIndex >= contentStart) {
        streamContent = raw.slice(contentStart, endKeywordIndex);
      } else {
        streamContent = raw.slice(contentStart);
      }
    }

    return {
      dictionarySource,
      stream: streamContent,
      streamLength,
      streamLengthRef
    };
  }

  private extractStreamLengthInfo(dictionarySource: string): StreamLengthInfo | undefined {
    const refMatch = dictionarySource.match(/\/Length(?!\d)\s+(\d+)\s+(\d+)\s+R\b/);
    if (refMatch) {
      return {
        kind: 'ref',
        id: Number(refMatch[1]),
        generation: Number(refMatch[2])
      };
    }

    const numberMatch = dictionarySource.match(/\/Length(?!\d)\s+(\d+)(?!\s+\d+\s+R)/);
    if (numberMatch) {
      const value = Number(numberMatch[1]);
      if (Number.isFinite(value)) {
        return {
          kind: 'number',
          value
        };
      }
    }

    return undefined;
  }

  private resolveStreamLength(
    info: StreamLengthInfo | undefined,
    objects: Map<string, PDFRawObject>
  ): number | undefined {
    if (!info) {
      return undefined;
    }

    if (info.kind === 'number') {
      return info.value;
    }

    const key = objectKey(info.id, info.generation);
    const referenced = objects.get(key);
    if (!referenced) {
      return undefined;
    }

    const trimmed = referenced.raw.trim();
    const direct = Number(trimmed);
    if (Number.isFinite(direct)) {
      return direct;
    }

    const fallbackMatch = trimmed.match(/^-?\d+/);
    if (fallbackMatch) {
      const fallback = Number(fallbackMatch[0]);
      if (Number.isFinite(fallback)) {
        return fallback;
      }
    }

    return undefined;
  }

  private locateStreamOffsets(
    object: PDFRawObject,
    rawContent: string
  ): { keywordIndex: number; contentStart: number } | undefined {
    const keywordIndex = rawContent.indexOf('stream', object.offset);
    if (keywordIndex === -1) {
      return undefined;
    }

    let contentStart = keywordIndex + 'stream'.length;
    const firstChar = rawContent[contentStart];
    const secondChar = rawContent[contentStart + 1];

    if (firstChar === '\r' && secondChar === '\n') {
      contentStart += 2;
    } else if (firstChar === '\n') {
      contentStart += 1;
    }

    return { keywordIndex, contentStart };
  }

  private readRawStreamContent(
    object: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string,
    preferStored = true
  ): string | undefined {
    if (preferStored && object.stream) {
      if (typeof object.streamLength === 'number' && object.streamLength >= 0) {
        if (object.stream.length >= object.streamLength) {
          return object.stream;
        }
      } else if (!object.streamLengthRef) {
        return object.stream;
      }
    }

    const offsets = this.locateStreamOffsets(object, rawContent);
    if (!offsets) {
      return object.stream;
    }

    const { contentStart } = offsets;
    let length = object.streamLength;

    if (length === undefined) {
      const info =
        object.streamLengthRef !== undefined
          ? ({ kind: 'ref', id: object.streamLengthRef.id, generation: object.streamLengthRef.generation } as StreamLengthInfo)
          : this.extractStreamLengthInfo(object.dictionarySource);
      length = this.resolveStreamLength(info, objects);
    }

    if (typeof length === 'number' && Number.isFinite(length) && length >= 0) {
      const slice = rawContent.slice(contentStart, contentStart + length);
      if (slice.length === length) {
        object.stream = slice;
        object.streamLength = length;
        return slice;
      }
    }

    const endIndex = rawContent.indexOf('endstream', contentStart);
    if (endIndex !== -1) {
      const slice = rawContent.slice(contentStart, endIndex);
      object.stream = slice;
      return slice;
    }

    return object.stream;
  }

  /**
   * Resolve page order by walking the page tree /Kids arrays.
   * Returns pages in document order, or undefined if the tree can't be resolved.
   */
  private resolvePageOrder(
    pageObjects: PDFRawObject[],
    objects: Map<string, PDFRawObject>
  ): PDFRawObject[] | undefined {
    // Find the /Type /Pages root (the node with /Kids that is NOT /Type /Page)
    const pagesNodes = Array.from(objects.values()).filter(
      (obj) => /\/Type\s*\/Pages\b/.test(obj.dictionarySource)
    );

    if (pagesNodes.length === 0) {
      return undefined;
    }

    // The root /Pages node is typically the one without a /Parent, or the one
    // referenced by the catalog. Find it by looking for the node with the highest /Count
    // or simply the one without /Parent.
    let root = pagesNodes.find(
      (node) => !/\/Parent\s+\d+\s+\d+\s+R/.test(node.dictionarySource)
    );
    if (!root) {
      root = pagesNodes[0];
    }

    // Build a set of page object keys for quick lookup
    const pageObjectMap = new Map<string, PDFRawObject>();
    for (const page of pageObjects) {
      pageObjectMap.set(objectKey(page.id, page.generation), page);
    }

    // Recursively walk /Kids arrays to collect pages in order
    const orderedPages: PDFRawObject[] = [];
    const visited = new Set<string>();

    const walkKids = (node: PDFRawObject): void => {
      const nodeKey = objectKey(node.id, node.generation);
      if (visited.has(nodeKey)) {
        return;
      }
      visited.add(nodeKey);

      // Extract /Kids array references
      const kidsMatch = node.dictionarySource.match(/\/Kids\s*\[([^\]]*)\]/);
      if (!kidsMatch) {
        return;
      }

      const refRegex = /(\d+)\s+(\d+)\s+R/g;
      let refMatch: RegExpExecArray | null;
      while ((refMatch = refRegex.exec(kidsMatch[1])) !== null) {
        const id = Number(refMatch[1]);
        const gen = Number(refMatch[2]);
        const key = objectKey(id, gen);

        // Check if this is a leaf page
        const page = pageObjectMap.get(key);
        if (page) {
          orderedPages.push(page);
          continue;
        }

        // Otherwise it might be an intermediate /Pages node
        const child = objects.get(key);
        if (child && /\/Type\s*\/Pages\b/.test(child.dictionarySource)) {
          walkKids(child);
        }
      }
    };

    walkKids(root);

    // Verify we found all pages
    if (orderedPages.length !== pageObjects.length) {
      return undefined;
    }

    return orderedPages;
  }

  private buildPages(objects: Map<string, PDFRawObject>, rawContent: string): PDFPage[] {
    const pages: PDFPage[] = [];
    const allPageObjects = Array.from(objects.values())
      .filter((object) => this.isPageObject(object.dictionarySource));

    // Try to order pages using the page tree /Kids arrays for correct document order
    const pageObjects = this.resolvePageOrder(allPageObjects, objects) ??
      allPageObjects.sort((a, b) => a.id - b.id);

    if (pageObjects.length === 0) {
      // Fallback for extremely small PDFs without structured objects.
      const fallbackContext: ResourceContext = {
        fonts: new Map(),
        forms: new Map(),
        images: new Map()
      };
      const extracted = this.parseTextStream(rawContent, fallbackContext, objects, rawContent);
      if (extracted.textItems.length === 0 && extracted.imageItems.length === 0) {
        return [];
      }

      pages.push({
        number: 1,
        textItems: extracted.textItems,
        imageItems: extracted.imageItems,
        lineItems: extracted.lineItems,
        rectItems: extracted.rectItems,
        size: this.defaultPageSize()
      });

      return pages;
    }

    let pageNumber = 1;
    for (const pageObject of pageObjects) {
      const contentRefs = this.extractContentRefs(pageObject.dictionarySource);
      const resourceContext = this.extractResourceContext(pageObject, objects, rawContent);
      const textItems: PDFTextItem[] = [];
      const imageItems: PDFImageItem[] = [];
      const lineItems: PDFLineItem[] = [];
      const rectItems: PDFRectItem[] = [];
      const pageSize = this.resolvePageSize(pageObject, objects) ?? this.defaultPageSize();

      for (const ref of contentRefs) {
        const key = objectKey(ref.id, ref.generation);
        const contentObject = objects.get(key);
        if (!contentObject) {
          continue;
        }

        const streamContent = this.resolveStreamContent(contentObject, objects, rawContent);
        if (!streamContent) {
          continue;
        }

        const extracted = this.parseTextStream(streamContent, resourceContext, objects, rawContent);
        textItems.push(...extracted.textItems);
        imageItems.push(...extracted.imageItems);
        lineItems.push(...extracted.lineItems);
        rectItems.push(...extracted.rectItems);
      }

      pages.push({
        number: pageNumber,
        textItems,
        imageItems,
        lineItems,
        rectItems,
        size: pageSize
      });

      pageNumber += 1;
    }

    return pages;
  }

  private parseTextStream(
    streamContent: string,
    context: ParseContext,
    objects: Map<string, PDFRawObject>,
    rawContent: string,
    visitedForms: Set<string> = new Set()
  ): { textItems: PDFTextItem[]; imageItems: PDFImageItem[]; lineItems: PDFLineItem[]; rectItems: PDFRectItem[] } {
    const textItems: PDFTextItem[] = [];
    const imageItems: PDFImageItem[] = [];
    const lineItems: PDFLineItem[] = [];
    const rectItems: PDFRectItem[] = [];
    const stack: PDFOperatorValue[] = [];
    const graphicsStack: Matrix[] = [identityMatrix()];
    const length = streamContent.length;
    let index = 0;
    const clampColor = (value: number | undefined): number => {
      if (!Number.isFinite(value)) {
        return 0;
      }
      if (value! < 0) {
        return 0;
      }
      if (value! > 1) {
        return 1;
      }
      return value as number;
    };
    let currentFillColor: [number, number, number, number] = [0, 0, 0, 1];
    let currentStrokeColor: [number, number, number, number] = [0, 0, 0, 1];
    let currentLineWidth = 1;

    // Graphics state stack for stroke/fill state
    interface GraphicsState {
      matrix: Matrix;
      fillColor: [number, number, number, number];
      strokeColor: [number, number, number, number];
      lineWidth: number;
    }
    const gStateStack: GraphicsState[] = [{
      matrix: identityMatrix(),
      fillColor: [0, 0, 0, 1],
      strokeColor: [0, 0, 0, 1],
      lineWidth: 1
    }];

    // Path construction state
    interface PathPoint { x: number; y: number }
    let currentPath: PathPoint[] = [];
    let pathStartPoint: PathPoint | null = null;

    while (index < length) {
      const char = streamContent[index];

      if (char === '%') {
        index = consumeComment(streamContent, index);
        continue;
      }

      if (char === '(') {
        const { nextIndex } = readLiteralString(streamContent, index);
        index = nextIndex + 1;
        continue;
      }

      if (char === '<') {
        if (streamContent[index + 1] === '<') {
          const { nextIndex } = readDictionary(streamContent, index);
          index = nextIndex;
          continue;
        }
        const { nextIndex } = readHexString(streamContent, index);
        index = nextIndex + 1;
        continue;
      }

      if (char === '[') {
        index = this.skipArray(streamContent, index);
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'BT')) {
        const blockEnd = this.findTextBlockEnd(streamContent, index + 2);
        if (blockEnd === -1) {
          break;
        }
        const blockContent = streamContent.slice(index + 2, blockEnd);
        const items = this.parseTextBlock(blockContent, context.fonts);
        const currentMatrix = graphicsStack[graphicsStack.length - 1];
        textItems.push(...this.transformTextItems(items, currentMatrix));
        index = blockEnd + 2;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'BI')) {
        const currentMatrix = graphicsStack[graphicsStack.length - 1];
        const inlineInfo = this.parseInlineImage(streamContent, index + 2);
        const bounds = computeImageBounds(currentMatrix);
        imageItems.push({
          name: `inline:${imageItems.length + 1}`,
          bounds,
          width: inlineInfo.width,
          height: inlineInfo.height,
          sourceWidth: inlineInfo.width,
          sourceHeight: inlineInfo.height
        });
        index = inlineInfo.nextIndex;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'q')) {
        const current = graphicsStack[graphicsStack.length - 1];
        graphicsStack.push(cloneMatrix(current));
        // Save full graphics state
        gStateStack.push({
          matrix: cloneMatrix(current),
          fillColor: [...currentFillColor] as [number, number, number, number],
          strokeColor: [...currentStrokeColor] as [number, number, number, number],
          lineWidth: currentLineWidth
        });
        index += 1;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'Q')) {
        if (graphicsStack.length > 1) {
          graphicsStack.pop();
        }
        // Restore full graphics state
        if (gStateStack.length > 1) {
          gStateStack.pop();
          const restored = gStateStack[gStateStack.length - 1];
          currentFillColor = [...restored.fillColor] as [number, number, number, number];
          currentStrokeColor = [...restored.strokeColor] as [number, number, number, number];
          currentLineWidth = restored.lineWidth;
        }
        // When stack underflows (extra Q without matching q), ignore the Q
        // rather than resetting to identity - preserves transformation state
        // for malformed PDFs with q/Q mismatches
        index += 1;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'cm')) {
        const f = this.popNumber(stack);
        const e = this.popNumber(stack);
        const d = this.popNumber(stack);
        const c = this.popNumber(stack);
        const b = this.popNumber(stack);
        const a = this.popNumber(stack);
        const operand: Matrix = [
          typeof a === 'number' ? a : 1,
          typeof b === 'number' ? b : 0,
          typeof c === 'number' ? c : 0,
          typeof d === 'number' ? d : 1,
          typeof e === 'number' ? e : 0,
          typeof f === 'number' ? f : 0
        ];
        const current = graphicsStack[graphicsStack.length - 1];
        graphicsStack[graphicsStack.length - 1] = multiplyMatrices(current, operand);
        index += 2;
        stack.length = 0;
        continue;
      }

      // RGB color - lowercase 'rg' = fill, uppercase 'RG' = stroke
      if (this.isOperatorAt(streamContent, index, 'rg')) {
        const b = clampColor(this.popNumber(stack));
        const g = clampColor(this.popNumber(stack));
        const r = clampColor(this.popNumber(stack));
        currentFillColor = [r, g, b, 1];
        index += 2;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'RG')) {
        const b = clampColor(this.popNumber(stack));
        const g = clampColor(this.popNumber(stack));
        const r = clampColor(this.popNumber(stack));
        currentStrokeColor = [r, g, b, 1];
        index += 2;
        stack.length = 0;
        continue;
      }

      // Gray color - lowercase 'g' = fill, uppercase 'G' = stroke
      if (this.isOperatorAt(streamContent, index, 'G')) {
        const gray = clampColor(this.popNumber(stack));
        currentStrokeColor = [gray, gray, gray, 1];
        index += 1;
        stack.length = 0;
        continue;
      }

      // Note: lowercase 'g' is handled later with path operators due to operator matching order

      // CMYK color - lowercase 'k' = fill, uppercase 'K' = stroke
      if (this.isOperatorAt(streamContent, index, 'K')) {
        const kValue = clampColor(this.popNumber(stack));
        const y = clampColor(this.popNumber(stack));
        const m = clampColor(this.popNumber(stack));
        const c = clampColor(this.popNumber(stack));
        const r = 1 - Math.min(1, c + kValue);
        const g = 1 - Math.min(1, m + kValue);
        const b = 1 - Math.min(1, y + kValue);
        currentStrokeColor = [r, g, b, 1];
        index += 1;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'k')) {
        const kValue = clampColor(this.popNumber(stack));
        const y = clampColor(this.popNumber(stack));
        const m = clampColor(this.popNumber(stack));
        const c = clampColor(this.popNumber(stack));
        const r = 1 - Math.min(1, c + kValue);
        const g = 1 - Math.min(1, m + kValue);
        const b = 1 - Math.min(1, y + kValue);
        currentFillColor = [r, g, b, 1];
        index += 1;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'Do')) {
        const name = this.popName(stack);
        if (name) {
          const formObject = context.forms.get(name);
          if (formObject) {
            const key = objectKey(formObject.id, formObject.generation);
            if (!visitedForms.has(key)) {
              const formStream = this.resolveStreamContent(formObject, objects, rawContent);
              if (formStream) {
                visitedForms.add(key);
                try {
                  const formContext = this.extractResourceContext(formObject, objects, rawContent);
                  const mergedFonts = new Map(context.fonts);
                  for (const [fontName, resource] of formContext.fonts.entries()) {
                    mergedFonts.set(fontName, resource);
                  }
                  const mergedForms = new Map(context.forms);
                  for (const [formName, resource] of formContext.forms.entries()) {
                    mergedForms.set(formName, resource);
                  }
                  const mergedImages = new Map(context.images);
                  for (const [imageName, resource] of formContext.images.entries()) {
                    mergedImages.set(imageName, resource);
                  }
                  const combinedContext: ParseContext = {
                    fonts: mergedFonts,
                    forms: mergedForms,
                    images: mergedImages
                  };
                  const currentMatrix = graphicsStack[graphicsStack.length - 1];
                  const nested = this.parseTextStream(formStream, combinedContext, objects, rawContent, visitedForms);
                  const transformedText = this.transformTextItems(nested.textItems, currentMatrix);
                  textItems.push(...transformedText);
                  if (nested.imageItems.length > 0) {
                    for (const item of nested.imageItems) {
                      imageItems.push(transformImageItem(item, currentMatrix));
                    }
                  }
                } finally {
                  visitedForms.delete(key);
                }
              }
            }
          } else {
            const imageResource = context.images.get(name);
            if (imageResource) {
              const currentMatrix = graphicsStack[graphicsStack.length - 1];
              const originalBounds = computeImageBounds(currentMatrix);
              const rendered = this.renderImageResource(imageResource, objects, rawContent);
              if (rendered) {
                let bounds = { ...originalBounds };
                let pixels = rendered.pixels;
                if (pixels) {
                  const originalWidth = pixels.originalWidth ?? imageResource.width ?? rendered.width ?? 1;
                  const originalHeight = pixels.originalHeight ?? imageResource.height ?? rendered.height ?? 1;
                  const scaleX = originalWidth ? (originalBounds.maxX - originalBounds.minX) / originalWidth : 1;
                  const scaleY = originalHeight ? (originalBounds.maxY - originalBounds.minY) / originalHeight : 1;
                  const offsetX = pixels.offsetX ?? 0;
                  const offsetY = pixels.offsetY ?? 0;
                  bounds = {
                    minX: originalBounds.minX + offsetX * scaleX,
                    maxX: originalBounds.minX + (offsetX + pixels.width) * scaleX,
                    minY: originalBounds.minY + offsetY * scaleY,
                    maxY: originalBounds.minY + (offsetY + pixels.height) * scaleY
                  };
                  pixels = {
                    width: pixels.width,
                    height: pixels.height,
                    data: pixels.data
                  };
                }

                const imageItem: PDFImageItem = {
                  name,
                  bounds,
                  width: bounds.maxX - bounds.minX,
                  height: bounds.maxY - bounds.minY,
                  sourceWidth: rendered.width ?? imageResource.width,
                  sourceHeight: rendered.height ?? imageResource.height,
                  mimeType: rendered.mimeType,
                  dataUri: rendered.dataUri,
                  fillColor: [...currentFillColor]
                };
                if (rendered.mask) {
                  Object.defineProperty(imageItem, 'mask', {
                    value: rendered.mask,
                    enumerable: false,
                    configurable: false
                  });
                }
                if (pixels) {
                  Object.defineProperty(imageItem, 'pixels', {
                    value: pixels,
                    enumerable: false,
                    configurable: false
                  });
                }
                imageItems.push(imageItem);
              }
            }
          }
        }
        index += 2;
        stack.length = 0;
        continue;
      }

      if (this.isOperatorAt(streamContent, index, 'gs')) {
        index += 2;
        stack.length = 0;
        continue;
      }

      // Line width operator
      if (this.isOperatorAt(streamContent, index, 'w')) {
        const width = this.popNumber(stack);
        if (typeof width === 'number' && width >= 0) {
          currentLineWidth = width;
        }
        index += 1;
        stack.length = 0;
        continue;
      }

      // Gray fill color (lowercase 'g')
      if (this.isOperatorAt(streamContent, index, 'g')) {
        const gray = clampColor(this.popNumber(stack));
        currentFillColor = [gray, gray, gray, 1];
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path construction: moveto
      if (this.isOperatorAt(streamContent, index, 'm')) {
        const y = this.popNumber(stack) ?? 0;
        const x = this.popNumber(stack) ?? 0;
        currentPath = [{ x, y }];
        pathStartPoint = { x, y };
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path construction: lineto
      if (this.isOperatorAt(streamContent, index, 'l')) {
        const y = this.popNumber(stack) ?? 0;
        const x = this.popNumber(stack) ?? 0;
        currentPath.push({ x, y });
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path construction: rectangle
      if (this.isOperatorAt(streamContent, index, 're')) {
        const h = this.popNumber(stack) ?? 0;
        const w = this.popNumber(stack) ?? 0;
        const y = this.popNumber(stack) ?? 0;
        const x = this.popNumber(stack) ?? 0;
        // Rectangle adds a closed subpath
        currentPath = [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
          { x, y } // close
        ];
        pathStartPoint = { x, y };
        index += 2;
        stack.length = 0;
        continue;
      }

      // Path construction: curveto (cubic Bezier) - approximate with line to endpoint
      if (this.isOperatorAt(streamContent, index, 'c')) {
        const y3 = this.popNumber(stack) ?? 0;
        const x3 = this.popNumber(stack) ?? 0;
        this.popNumber(stack); // y2 - control point, ignored
        this.popNumber(stack); // x2 - control point, ignored
        this.popNumber(stack); // y1 - control point, ignored
        this.popNumber(stack); // x1 - control point, ignored
        currentPath.push({ x: x3, y: y3 });
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path construction: closepath
      if (this.isOperatorAt(streamContent, index, 'h')) {
        if (pathStartPoint && currentPath.length > 0) {
          currentPath.push({ ...pathStartPoint });
        }
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path painting: stroke
      if (this.isOperatorAt(streamContent, index, 'S')) {
        const currentMatrix = graphicsStack[graphicsStack.length - 1];
        // Convert path to line items
        for (let i = 0; i < currentPath.length - 1; i++) {
          const p1 = currentPath[i];
          const p2 = currentPath[i + 1];
          const start = transformPoint(currentMatrix, p1.x, p1.y);
          const end = transformPoint(currentMatrix, p2.x, p2.y);
          lineItems.push({
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            lineWidth: currentLineWidth,
            strokeColor: [...currentStrokeColor] as [number, number, number, number]
          });
        }
        currentPath = [];
        pathStartPoint = null;
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path painting: close and stroke
      if (this.isOperatorAt(streamContent, index, 's')) {
        // Close path first
        if (pathStartPoint && currentPath.length > 0) {
          currentPath.push({ ...pathStartPoint });
        }
        // Then stroke
        const currentMatrix = graphicsStack[graphicsStack.length - 1];
        for (let i = 0; i < currentPath.length - 1; i++) {
          const p1 = currentPath[i];
          const p2 = currentPath[i + 1];
          const start = transformPoint(currentMatrix, p1.x, p1.y);
          const end = transformPoint(currentMatrix, p2.x, p2.y);
          lineItems.push({
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            lineWidth: currentLineWidth,
            strokeColor: [...currentStrokeColor] as [number, number, number, number]
          });
        }
        currentPath = [];
        pathStartPoint = null;
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path painting: fill (f, F, f*)
      if (this.isOperatorAt(streamContent, index, 'f') || this.isOperatorAt(streamContent, index, 'F')) {
        // For fill, we extract rectangles if the path is rectangular
        if (currentPath.length === 5) {
          const currentMatrix = graphicsStack[graphicsStack.length - 1];
          const p0 = transformPoint(currentMatrix, currentPath[0].x, currentPath[0].y);
          const p2 = transformPoint(currentMatrix, currentPath[2].x, currentPath[2].y);
          const minX = Math.min(p0.x, p2.x);
          const maxX = Math.max(p0.x, p2.x);
          const minY = Math.min(p0.y, p2.y);
          const maxY = Math.max(p0.y, p2.y);
          rectItems.push({
            bounds: { minX, minY, maxX, maxY },
            lineWidth: 0,
            strokeColor: null,
            fillColor: [...currentFillColor] as [number, number, number, number]
          });
        }
        currentPath = [];
        pathStartPoint = null;
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path painting: fill and stroke (B, B*)
      if (this.isOperatorAt(streamContent, index, 'B')) {
        const currentMatrix = graphicsStack[graphicsStack.length - 1];
        // For fill+stroke, extract rectangle if path is rectangular
        if (currentPath.length === 5) {
          const p0 = transformPoint(currentMatrix, currentPath[0].x, currentPath[0].y);
          const p2 = transformPoint(currentMatrix, currentPath[2].x, currentPath[2].y);
          const minX = Math.min(p0.x, p2.x);
          const maxX = Math.max(p0.x, p2.x);
          const minY = Math.min(p0.y, p2.y);
          const maxY = Math.max(p0.y, p2.y);
          rectItems.push({
            bounds: { minX, minY, maxX, maxY },
            lineWidth: currentLineWidth,
            strokeColor: [...currentStrokeColor] as [number, number, number, number],
            fillColor: [...currentFillColor] as [number, number, number, number]
          });
        } else {
          // Stroke the path
          for (let i = 0; i < currentPath.length - 1; i++) {
            const p1 = currentPath[i];
            const p2 = currentPath[i + 1];
            const start = transformPoint(currentMatrix, p1.x, p1.y);
            const end = transformPoint(currentMatrix, p2.x, p2.y);
            lineItems.push({
              start: { x: start.x, y: start.y },
              end: { x: end.x, y: end.y },
              lineWidth: currentLineWidth,
              strokeColor: [...currentStrokeColor] as [number, number, number, number]
            });
          }
        }
        currentPath = [];
        pathStartPoint = null;
        index += 1;
        stack.length = 0;
        continue;
      }

      // Path painting: end path without painting (n)
      if (this.isOperatorAt(streamContent, index, 'n')) {
        currentPath = [];
        pathStartPoint = null;
        index += 1;
        stack.length = 0;
        continue;
      }

      if (streamContent[index] === '/') {
        const { value, nextIndex } = readName(streamContent, index + 1);
        stack.push({ kind: 'name', value });
        index = nextIndex + 1;
        continue;
      }

      const { value, nextIndex } = readToken(streamContent, index);
      if (value === '') {
        index = nextIndex + 1;
        continue;
      }

      if (isNumberToken(value)) {
        stack.push(Number(value));
        index = nextIndex + 1;
        continue;
      }

      stack.length = 0;
      index = nextIndex + 1;
    }

    const mergedTextItems = this.shouldSmoothText() ? mergeTextRuns(textItems) : textItems;
    const refinedTextItems = this.refineTextBounds(mergedTextItems);
    return { textItems: refinedTextItems, imageItems, lineItems, rectItems };
  }

  private findTextBlockEnd(source: string, startIndex: number): number {
    let index = startIndex;
    let depth = 1;
    const length = source.length;

    while (index < length) {
      const char = source[index];

      if (char === '%') {
        index = consumeComment(source, index);
        continue;
      }

      if (char === '(') {
        const { nextIndex } = readLiteralString(source, index);
        index = nextIndex + 1;
        continue;
      }

      if (char === '<') {
        if (source[index + 1] === '<') {
          const { nextIndex } = readDictionary(source, index);
          index = nextIndex;
          continue;
        }
        const { nextIndex } = readHexString(source, index);
        index = nextIndex + 1;
        continue;
      }

      if (char === '[') {
        index = this.skipArray(source, index);
        continue;
      }

      if (this.isOperatorAt(source, index, 'BT')) {
        depth += 1;
        index += 2;
        continue;
      }

      if (this.isOperatorAt(source, index, 'ET')) {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
        index += 2;
        continue;
      }

      index += 1;
    }

    return -1;
  }

  private isOperatorAt(source: string, index: number, operator: string): boolean {
    if (!source.startsWith(operator, index)) {
      return false;
    }

    const beforeIndex = index - 1;
    const afterIndex = index + operator.length;
    const beforeChar = beforeIndex >= 0 ? source[beforeIndex] : ' ';
    const afterChar = afterIndex < source.length ? source[afterIndex] : ' ';

    const beforeDelimiter = beforeIndex < 0 || isWhitespace(beforeChar) || isDelimiter(beforeChar);
    const afterDelimiter = afterIndex >= source.length || isWhitespace(afterChar) || isDelimiter(afterChar);

    return beforeDelimiter && afterDelimiter;
  }

  private skipArray(source: string, startIndex: number): number {
    let index = startIndex + 1;
    let depth = 1;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '[') {
        depth += 1;
        index += 1;
        continue;
      }
      if (char === ']') {
        depth -= 1;
        index += 1;
        continue;
      }
      if (char === '(') {
        const { nextIndex } = readLiteralString(source, index);
        index = nextIndex + 1;
        continue;
      }
      if (char === '<') {
        if (source[index + 1] === '<') {
          const { nextIndex } = readDictionary(source, index);
          index = nextIndex;
          continue;
        }
        const { nextIndex } = readHexString(source, index);
        index = nextIndex + 1;
        continue;
      }
      index += 1;
    }

    return index;
  }

  private parseInlineImage(
    streamContent: string,
    startIndex: number
  ): { nextIndex: number; width?: number; height?: number } {
    const length = streamContent.length;
    let index = skipWhitespace(streamContent, startIndex);

    let dictionaryEnd = -1;
    for (let position = index; position < length - 1; position += 1) {
      if (streamContent[position] === 'I' && streamContent[position + 1] === 'D') {
        const after = streamContent[position + 2];
        if (position + 2 >= length || isWhitespace(after)) {
          dictionaryEnd = position;
          break;
        }
      }
    }

    if (dictionaryEnd === -1) {
      return { nextIndex: length };
    }

    const dictionarySource = streamContent.slice(index, dictionaryEnd);
    const widthMatch = dictionarySource.match(/\/(?:Width|W)\s+(-?\d+(?:\.\d+)?)/);
    const heightMatch = dictionarySource.match(/\/(?:Height|H)\s+(-?\d+(?:\.\d+)?)/);
    const widthValue = widthMatch ? Number(widthMatch[1]) : undefined;
    const heightValue = heightMatch ? Number(heightMatch[1]) : undefined;

    let dataStart = dictionaryEnd + 2;
    while (dataStart < length && isWhitespace(streamContent[dataStart])) {
      dataStart += 1;
    }

    for (let position = dataStart; position < length - 1; position += 1) {
      if (streamContent[position] === 'E' && streamContent[position + 1] === 'I') {
        const after = streamContent[position + 2];
        if (position + 2 >= length || isWhitespace(after)) {
          return {
            nextIndex: position + 2,
            width: Number.isFinite(widthValue) ? widthValue : undefined,
            height: Number.isFinite(heightValue) ? heightValue : undefined
          };
        }
      }
    }

    return {
      nextIndex: length,
      width: Number.isFinite(widthValue) ? widthValue : undefined,
      height: Number.isFinite(heightValue) ? heightValue : undefined
    };
  }

  private resolveStreamContent(
    object: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): string | undefined {
    const filters = this.extractFilters(object.dictionarySource);
    const initialStream = this.readRawStreamContent(object, objects, rawContent, true);

    if (!initialStream) {
      return undefined;
    }

    if (filters.length === 0) {
      return this.stripStreamPadding(initialStream);
    }

    const attemptDecode = (source: string): { success: true; value: string } | { success: false; error: unknown } => {
      let data: Uint8Array = latin1ToUint8(this.stripStreamPadding(source));

      try {
        for (const filter of filters) {
          const normalized = filter.toLowerCase();
          switch (normalized) {
            case 'flatedecode':
            case 'flate':
            case 'fl':
              data = decodeFlate(data);
              break;
            default:
              throw new Error(`Unsupported filter: ${filter}`);
          }
        }
      } catch (error) {
        return { success: false, error };
      }

      return { success: true, value: bufferToLatin1(data) };
    };

    const firstAttempt = attemptDecode(initialStream);
    if (firstAttempt.success) {
      return firstAttempt.value;
    }

    const refreshedStream = this.readRawStreamContent(object, objects, rawContent, false);
    if (!refreshedStream || refreshedStream === initialStream) {
      if (this.options.strict && firstAttempt.error instanceof Error) {
        throw firstAttempt.error;
      }
      return undefined;
    }

    const secondAttempt = attemptDecode(refreshedStream);
    if (secondAttempt.success) {
      return secondAttempt.value;
    }

    if (this.options.strict && secondAttempt.error instanceof Error) {
      throw secondAttempt.error;
    }

    return undefined;
  }

  private stripStreamPadding(stream: string): string {
    let end = stream.length;
    while (end > 0) {
      const code = stream.charCodeAt(end - 1);
      if (code === 0x0d || code === 0x0a) {
        end -= 1;
        continue;
      }
      break;
    }
    return stream.slice(0, end);
  }

  private parseTextBlock(content: string, fonts: FontMap): PDFTextItem[] {
    const tokens = tokenize(content);
    const items: PDFTextItem[] = [];
    const state: TextState = {
      textMatrix: identityMatrix(),
      textLineMatrix: identityMatrix(),
      font: undefined,
      fontSize: DEFAULT_FONT_SIZE,
      leading: DEFAULT_FONT_SIZE,
      charSpacing: 0,
      wordSpacing: 0,
      horizontalScale: 1,
      textRise: 0
    };

    const stack: PDFOperatorValue[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];

      switch (token.type) {
        case 'number':
          stack.push(token.value);
          break;
        case 'string':
          stack.push(token.value);
          break;
        case 'name':
          stack.push({ kind: 'name', value: token.value });
          break;
        case 'arrayStart': {
          const result = this.parseArray(tokens, index);
          stack.push(result.value);
          index = result.nextIndex;
          break;
        }
        case 'arrayEnd':
          // Handled in parseArray; should not reach here.
          break;
        case 'command':
          this.applyOperator(token.value, stack, state, items, fonts);
          break;
        default:
          break;
      }
    }

    return items;
  }

  private parseArray(tokens: OperatorToken[], startIndex: number): { value: PDFOperatorValue[]; nextIndex: number } {
    const values: PDFOperatorValue[] = [];

    for (let index = startIndex + 1; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (token.type === 'arrayEnd') {
        return { value: values, nextIndex: index };
      }

      if (token.type === 'arrayStart') {
        const nested = this.parseArray(tokens, index);
        values.push(nested.value);
        index = nested.nextIndex;
        continue;
      }

      if (token.type === 'number') {
        values.push(token.value);
        continue;
      }

      if (token.type === 'string') {
        values.push(token.value);
        continue;
      }

      if (token.type === 'name') {
        values.push({ kind: 'name', value: token.value });
        continue;
      }

      if (token.type === 'command') {
        values.push({ kind: 'name', value: token.value });
      }
    }

    throw new Error('Unterminated array in text stream.');
  }

  private applyOperator(
    op: string,
    stack: PDFOperatorValue[],
    state: TextState,
    items: PDFTextItem[],
    fonts: FontMap
  ): void {
    switch (op) {
      case 'Tf': {
        const size = this.popNumber(stack);
        const font = this.popName(stack);
        if (font) {
          state.font = font;
        }
        if (typeof size === 'number' && !Number.isNaN(size)) {
          state.fontSize = size;
          state.leading = size;
        }
        stack.length = 0;
        break;
      }

      case 'Tc': {
        const value = this.popNumber(stack);
        if (typeof value === 'number' && Number.isFinite(value)) {
          state.charSpacing = value;
        }
        stack.length = 0;
        break;
      }

      case 'Tw': {
        const value = this.popNumber(stack);
        if (typeof value === 'number' && Number.isFinite(value)) {
          state.wordSpacing = value;
        }
        stack.length = 0;
        break;
      }

      case 'Tz': {
        const value = this.popNumber(stack);
        if (typeof value === 'number' && Number.isFinite(value)) {
          state.horizontalScale = value / 100;
        }
        stack.length = 0;
        break;
      }

      case 'TL': {
        const value = this.popNumber(stack);
        if (typeof value === 'number' && Number.isFinite(value)) {
          state.leading = value;
        }
        stack.length = 0;
        break;
      }

      case 'Ts': {
        const value = this.popNumber(stack);
        if (typeof value === 'number' && Number.isFinite(value)) {
          state.textRise = value;
        }
        stack.length = 0;
        break;
      }

      case 'BT': {
        state.textMatrix = identityMatrix();
        state.textLineMatrix = identityMatrix();
        state.charSpacing = 0;
        state.wordSpacing = 0;
        state.horizontalScale = 1;
        state.textRise = 0;
        stack.length = 0;
        break;
      }

      case 'ET': {
        stack.length = 0;
        break;
      }

      case 'Td': {
        const ty = this.popNumber(stack);
        const tx = this.popNumber(stack);
        const moveX = Number.isFinite(tx) ? (tx as number) : 0;
        const moveY = Number.isFinite(ty) ? (ty as number) : 0;
        state.textLineMatrix = this.translateMatrix(state.textLineMatrix, moveX, moveY);
        state.textMatrix = cloneMatrix(state.textLineMatrix);
        stack.length = 0;
        break;
      }

      case 'TD': {
        const ty = this.popNumber(stack);
        const tx = this.popNumber(stack);
        const moveX = Number.isFinite(tx) ? (tx as number) : 0;
        const moveY = Number.isFinite(ty) ? (ty as number) : 0;
        if (Number.isFinite(ty)) {
          state.leading = -(ty as number);
        }
        state.textLineMatrix = this.translateMatrix(state.textLineMatrix, moveX, moveY);
        state.textMatrix = cloneMatrix(state.textLineMatrix);
        stack.length = 0;
        break;
      }

      case 'Tm': {
        const f = this.popNumber(stack);
        const e = this.popNumber(stack);
        const d = this.popNumber(stack);
        const c = this.popNumber(stack);
        const b = this.popNumber(stack);
        const a = this.popNumber(stack);
        state.textMatrix = this.buildTextMatrix(a, b, c, d, e, f);
        state.textLineMatrix = cloneMatrix(state.textMatrix);
        stack.length = 0;
        break;
      }

      case 'T*': {
        state.textLineMatrix = this.translateMatrix(state.textLineMatrix, 0, -state.leading);
        state.textMatrix = cloneMatrix(state.textLineMatrix);
        stack.length = 0;
        break;
      }

      case '"': {
        const text = this.popString(stack);
        const charSpacing = this.popNumber(stack);
        const wordSpacing = this.popNumber(stack);
        if (typeof wordSpacing === 'number' && Number.isFinite(wordSpacing)) {
          state.wordSpacing = wordSpacing;
        }
        if (typeof charSpacing === 'number' && Number.isFinite(charSpacing)) {
          state.charSpacing = charSpacing;
        }
        if (text !== undefined) {
          state.textLineMatrix = this.translateMatrix(state.textLineMatrix, 0, -state.leading);
          state.textMatrix = cloneMatrix(state.textLineMatrix);
          this.appendTextItem(text, state, fonts, items);
        }
        stack.length = 0;
        break;
      }

      case '\'': {
        // Apostrophe operator => T* followed by Tj.
        const text = this.popString(stack);
        if (text !== undefined) {
          state.textLineMatrix = this.translateMatrix(state.textLineMatrix, 0, -state.leading);
          state.textMatrix = cloneMatrix(state.textLineMatrix);
          this.appendTextItem(text, state, fonts, items);
        }
        stack.length = 0;
        break;
      }

      case 'Tj': {
        const text = this.popString(stack);
        if (text !== undefined) {
          this.appendTextItem(text, state, fonts, items);
        }
        stack.length = 0;
        break;
      }

      case 'TJ': {
        const arrayValue = stack.pop();
        if (Array.isArray(arrayValue)) {
          for (const value of arrayValue) {
            if (typeof value === 'string') {
              this.appendTextItem(value, state, fonts, items);
              continue;
            }
            if (typeof value === 'number') {
              this.applyTextAdjustment(value, state);
            }
          }
        }
        stack.length = 0;
        break;
      }

      default:
        // For unhandled operators we simply clear the operand stack to avoid
        // leaking values into subsequent operations.
        stack.length = 0;
        break;
    }
  }

  private appendTextItem(rawText: string, state: TextState, fonts: FontMap, items: PDFTextItem[]): void {
    if (rawText.length === 0) {
      return;
    }

    // For Type3 fonts, split multi-character strings into individual characters.
    // Each character gets its own item with correct positioning from the text matrix.
    // This is necessary because Tc (char spacing) affects inter-character positioning
    // and the renderer needs each glyph at its exact text position.
    const fontResource = state.font ? fonts.get(state.font) : undefined;
    const isType3 = fontResource?.subtype === 'Type3';
    if (isType3 && rawText.length > 1) {
      for (let i = 0; i < rawText.length; i++) {
        this.appendTextItem(rawText[i], state, fonts, items);
      }
      return;
    }

    const metrics = this.computeTextRunMetrics(rawText, state, fonts);
    if (!metrics) {
      return;
    }

    const startMatrix = cloneMatrix(state.textMatrix);
    state.textMatrix = this.translateMatrix(state.textMatrix, metrics.advance, 0);


    if (!metrics.text || metrics.text.trim().length === 0) {
      // For Type3 fonts, decoded text may be empty/null but glyphs are still valid.
      // Use a placeholder so the item isn't dropped.
      if (!isType3) {
        return;
      }
      metrics.text = '\u00A0'.repeat(rawText.length); // non-breaking space placeholder
    }

    const { ascenderHeight, descenderDepth } = this.resolveTextVerticalExtents(
      fontResource,
      metrics.text,
      metrics.fontSize
    );

    const textStart = transformPoint(startMatrix, 0, state.textRise);
    const textEnd = transformPoint(startMatrix, metrics.advance, state.textRise);
    const baselineStart = transformPoint(startMatrix, 0, state.textRise - descenderDepth);
    const baselineEnd = transformPoint(startMatrix, metrics.advance, state.textRise - descenderDepth);
    const topStart = transformPoint(startMatrix, 0, state.textRise + ascenderHeight);
    const topEnd = transformPoint(startMatrix, metrics.advance, state.textRise + ascenderHeight);

    const xs = [baselineStart.x, baselineEnd.x, topStart.x, topEnd.x];
    const ys = [baselineStart.y, baselineEnd.y, topStart.y, topEnd.y];

    const fontFamily = this.resolveFontFamily(state.font, fonts);
    const baseFontName = fontResource?.baseFontName;

    const item: PDFTextItem = {
      text: metrics.text,
      bounds: {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys)
      },
      baselineStart: textStart,
      baselineEnd: textEnd,
      font: fontFamily,
      fontSize: state.fontSize,
      fontWeight: this.extractFontWeight(baseFontName),
      fontStyle: this.extractFontStyle(baseFontName)
    };

    // Attach Type3 glyph path data for canvas rendering
    if (isType3 && fontResource?.charProcs) {
      const type3Glyphs = this.resolveType3Glyphs(rawText, fontResource);
      if (type3Glyphs.length > 0) {
        item.type3Glyphs = type3Glyphs;
        if (fontResource.fontMatrix) {
          item.fontMatrix = fontResource.fontMatrix;
        }
      }
    }

    items.push(item);
  }

  private resolveTextVerticalExtents(
    fontResource: FontResource | undefined,
    text: string,
    fontSize: number
  ): { ascenderHeight: number; descenderDepth: number } {
    const baseFontName = fontResource?.baseFontName ?? '';

    // TeX radical glyphs in CMSY/CMEX fonts descend much further below the baseline
    // than normal text. Using standard text ratios makes the glyph render too high
    // across multiple PDFs, so give radicals deeper parsed bounds up front.
    if (text === '√' && /(CMSY|CMEX)/i.test(baseFontName)) {
      return {
        ascenderHeight: fontSize * 0.05,
        descenderDepth: fontSize * 0.95
      };
    }

    if (/[∑∏∫⋃⋂⋁⋀]/.test(text) && /(CMEX|CMSY)/i.test(baseFontName)) {
      return {
        ascenderHeight: fontSize * 0.1,
        descenderDepth: fontSize * 0.9
      };
    }

    return {
      ascenderHeight: fontSize * 0.8,
      descenderDepth: fontSize * 0.2
    };
  }

  /**
   * Resolve Type3 glyph paths for a raw text string.
   * Maps each byte through the font's encoding to a glyph name,
   * then looks up the pre-parsed CharProc path commands.
   */
  private resolveType3Glyphs(rawText: string, fontResource: FontResource): Type3Glyph[] {
    const glyphs: Type3Glyph[] = [];
    const charProcs = fontResource.charProcs;
    if (!charProcs) {
      return glyphs;
    }

    // Use the raw glyph name map (code → glyph name from /Differences) for Type3 fonts.
    // The regular encodingMap stores unicode characters which don't match CharProc keys.
    const glyphNameMap = fontResource.glyphNameMap;

    for (let i = 0; i < rawText.length; i++) {
      const code = rawText.charCodeAt(i) & 0xFF;
      let glyphName: string | undefined;
      if (glyphNameMap) {
        glyphName = glyphNameMap.get(code);
      }
      if (!glyphName) {
        // Fall back to using the code as glyph name
        glyphName = String(code);
      }

      const glyph = charProcs.get(glyphName);
      if (glyph) {
        glyphs.push(glyph);
      }
    }

    return glyphs;
  }

  private computeTextRunMetrics(
    rawText: string,
    state: TextState,
    fonts: FontMap
  ): { text: string; advance: number; fontSize: number } | undefined {
    if (rawText.length === 0) {
      return undefined;
    }

    const decoded = decodeText(rawText, state.font, fonts);
    const fontSize = state.fontSize ?? DEFAULT_FONT_SIZE;
    const font = state.font ? fonts.get(state.font) : undefined;

    const glyphCodes = extractGlyphCodes(rawText, font);
    const glyphCount = glyphCodes.length > 0 ? glyphCodes.length : decoded.length;
    const isType3 = font?.subtype === 'Type3';

    if (glyphCount === 0 && decoded.length === 0) {
      return undefined;
    }

    let glyphUnits = 0;
    for (const code of glyphCodes) {
      glyphUnits += isType3
        ? this.resolveType3AdvanceWidth(font, code)
        : lookupGlyphWidth(font, code);
    }

    if (glyphCodes.length === 0 && decoded.length > 0) {
      glyphUnits = decoded.length * 500;
    }

    const spaceCount = countSpaces(decoded);
    // Type3 font widths are in the font's own coordinate system (not thousandths of em).
    // For standard fonts, widths are in thousandths, so we divide by 1000.
    // For Type3, the width is multiplied by FontMatrix to get text-space units.
    const glyphAdvance = isType3
      ? glyphUnits * fontSize * (font?.fontMatrix?.[0] ?? 1)
      : (glyphUnits * fontSize) / 1000;
    const spacingAdvance = state.charSpacing * glyphCount + state.wordSpacing * spaceCount;
    const advanceTextSpace = (glyphAdvance + spacingAdvance) * state.horizontalScale;
    const advance = Number.isFinite(advanceTextSpace) ? advanceTextSpace : 0;
    const normalizedFontSize = Number.isFinite(fontSize) ? Math.abs(fontSize) : DEFAULT_FONT_SIZE;

    return {
      text: decoded,
      advance,
      fontSize: normalizedFontSize
    };
  }

  private resolveType3AdvanceWidth(font: FontResource | undefined, code: number): number {
    if (!font) {
      return 0;
    }

    const glyphName = font.glyphNameMap?.get(code) ?? String(code);
    const charProcWidth = font.charProcs?.get(glyphName)?.width;
    if (typeof charProcWidth === 'number' && Number.isFinite(charProcWidth) && charProcWidth > 0) {
      return charProcWidth;
    }

    return lookupGlyphWidth(font, code);
  }

  private translateMatrix(matrix: Matrix, tx: number, ty: number): Matrix {
    const moveX = Number.isFinite(tx) ? (tx as number) : 0;
    const moveY = Number.isFinite(ty) ? (ty as number) : 0;
    const translation: Matrix = [1, 0, 0, 1, moveX, moveY];
    return multiplyMatrices(matrix, translation);
  }

  private buildTextMatrix(
    a: number | undefined,
    b: number | undefined,
    c: number | undefined,
    d: number | undefined,
    e: number | undefined,
    f: number | undefined
  ): Matrix {
    const safe = (value: number | undefined, fallback: number): number =>
      Number.isFinite(value) ? (value as number) : fallback;

    return [
      safe(a, 1),
      safe(b, 0),
      safe(c, 0),
      safe(d, 1),
      safe(e, 0),
      safe(f, 0)
    ];
  }

  private applyTextAdjustment(adjustment: number, state: TextState): void {
    if (!Number.isFinite(adjustment)) {
      return;
    }

    const fontSize = state.fontSize ?? DEFAULT_FONT_SIZE;
    const delta = (-adjustment / 1000) * fontSize * state.horizontalScale;

    if (Number.isFinite(delta)) {
      state.textMatrix = this.translateMatrix(state.textMatrix, delta, 0);
    }
  }

  private extractFilters(dictionarySource: string): string[] {
    const filters: string[] = [];
    const filterIndex = dictionarySource.indexOf('/Filter');

    if (filterIndex === -1) {
      return filters;
    }

    let index = filterIndex + '/Filter'.length;
    index = skipWhitespace(dictionarySource, index);

    if (dictionarySource[index] === '[') {
      index += 1;
      while (index < dictionarySource.length) {
        index = skipWhitespace(dictionarySource, index);
        const char = dictionarySource[index];
        if (char === ']') {
          break;
        }
        if (char === '/') {
      const { value, nextIndex } = readName(dictionarySource, index + 1);
          filters.push(value);
          index = nextIndex + 1;
          continue;
        }
        break;
      }
    } else if (dictionarySource[index] === '/') {
      const { value } = readName(dictionarySource, index + 1);
      filters.push(value);
    }

    return filters;
  }

  private extractResourceContext(
    pageObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): ResourceContext {
    const fonts: FontMap = new Map();
    const forms: Map<string, PDFRawObject> = new Map();
    const images: ImageMap = new Map();
    const resourceQueue: string[] = [];
    const visitedResourceKeys = new Set<string>();
    const visitedInlineResources = new Set<string>();
    const visitedFontKeys = new Set<string>();
    const visitedFormKeys = new Set<string>();
    const visitedImageKeys = new Set<string>();
    const visitedPageKeys = new Set<string>();

    visitedPageKeys.add(objectKey(pageObject.id, pageObject.generation));

    let current: PDFRawObject | undefined = pageObject;
    while (current) {
      this.extractResourcesFromDictionary(
        current.dictionarySource,
        objects,
        rawContent,
        fonts,
        forms,
        images,
        resourceQueue,
        visitedResourceKeys,
        visitedInlineResources,
        visitedFontKeys,
        visitedFormKeys,
        visitedImageKeys
      );

      const parentRef = this.extractParentReference(current.dictionarySource);
      if (!parentRef) {
        break;
      }

      const parentKey = objectKey(parentRef.id, parentRef.generation);
      if (visitedPageKeys.has(parentKey)) {
        break;
      }
      visitedPageKeys.add(parentKey);
      current = objects.get(parentKey);
    }

    while (resourceQueue.length > 0) {
      const dictionary = resourceQueue.pop();
      if (!dictionary) {
        continue;
      }
      this.extractResourcesFromDictionary(
        dictionary,
        objects,
        rawContent,
        fonts,
        forms,
        images,
        resourceQueue,
        visitedResourceKeys,
        visitedInlineResources,
        visitedFontKeys,
        visitedFormKeys,
        visitedImageKeys
      );
    }

    return { fonts, forms, images };
  }

  private extractResourcesFromDictionary(
    dictionarySource: string,
    objects: Map<string, PDFRawObject>,
    rawContent: string,
    fonts: FontMap,
    forms: Map<string, PDFRawObject>,
    images: ImageMap,
    resourceQueue: string[],
    visitedResourceKeys: Set<string>,
    visitedInlineResources: Set<string>,
    visitedFontKeys: Set<string>,
    visitedFormKeys: Set<string>,
    visitedImageKeys: Set<string>
  ): void {
    const fontSection = dictionarySource.match(/\/Font\s*<<([\s\S]*?)>>/);

    if (fontSection) {
      const entryRegex = /\/([^\s\/]+)\s+(\d+)\s+(\d+)\s+R/g;
      let match: RegExpExecArray | null;

      while ((match = entryRegex.exec(fontSection[1])) !== null) {
        const resourceName = match[1];
        const id = Number(match[2]);
        const generation = Number(match[3]);
        const key = objectKey(id, generation);

        if (visitedFontKeys.has(key)) {
          continue;
        }
        visitedFontKeys.add(key);

        const fontObject = objects.get(key);
        if (!fontObject) {
          continue;
        }

        const resource = this.buildFontResource(fontObject, objects, rawContent);
        if (!fonts.has(resourceName)) {
          fonts.set(resourceName, resource);
        }
      }
    }

    const xobjectSection = dictionarySource.match(/\/XObject\s*<<([\s\S]*?)>>/);
    if (xobjectSection) {
      const entryRegex = /\/([^\s\/]+)\s+(\d+)\s+(\d+)\s+R/g;
      let match: RegExpExecArray | null;

      while ((match = entryRegex.exec(xobjectSection[1])) !== null) {
        const resourceName = match[1];
        const id = Number(match[2]);
        const generation = Number(match[3]);
        const key = objectKey(id, generation);

        const resourceObject = objects.get(key);
        if (!resourceObject) {
          continue;
        }

        if (this.isFormXObject(resourceObject.dictionarySource)) {
          if (visitedFormKeys.has(key)) {
            continue;
          }
          visitedFormKeys.add(key);
          forms.set(resourceName, resourceObject);
          continue;
        }

        if (this.isImageXObject(resourceObject.dictionarySource)) {
          if (visitedImageKeys.has(key)) {
            continue;
          }
          visitedImageKeys.add(key);
          if (!images.has(resourceName)) {
            images.set(resourceName, this.buildImageResource(resourceObject, objects, rawContent));
          }
        }
      }
    }

    this.enqueueResourceDictionaries(
      dictionarySource,
      objects,
      resourceQueue,
      visitedResourceKeys,
      visitedInlineResources
    );
  }

  private enqueueResourceDictionaries(
    dictionarySource: string,
    objects: Map<string, PDFRawObject>,
    resourceQueue: string[],
    visitedResourceKeys: Set<string>,
    visitedInlineResources: Set<string>
  ): void {
    const resourcesRegex = /\/Resources\s+/g;
    let match: RegExpExecArray | null;

    while ((match = resourcesRegex.exec(dictionarySource)) !== null) {
      let index = match.index + match[0].length;
      index = skipWhitespace(dictionarySource, index);
      const char = dictionarySource[index];

      if (char === '<' && dictionarySource[index + 1] === '<') {
        const { dictionary, nextIndex } = readDictionary(dictionarySource, index);
        const canonical = dictionary.trim();
        if (!visitedInlineResources.has(canonical)) {
          visitedInlineResources.add(canonical);
          resourceQueue.push(canonical);
        }
        resourcesRegex.lastIndex = nextIndex;
        continue;
      }

      const referenceMatch = dictionarySource.slice(index).match(/^(\d+)\s+(\d+)\s+R/);
      if (referenceMatch) {
        const id = Number(referenceMatch[1]);
        const generation = Number(referenceMatch[2]);
        const key = objectKey(id, generation);
        if (!visitedResourceKeys.has(key)) {
          visitedResourceKeys.add(key);
          const resourceObject = objects.get(key);
          if (resourceObject) {
            resourceQueue.push(resourceObject.dictionarySource.trim());
          }
        }
      }
    }
  }

  private extractParentReference(dictionarySource: string): ContentRef | undefined {
    const match = dictionarySource.match(/\/Parent\s+(\d+)\s+(\d+)\s+R/);
    if (!match) {
      return undefined;
    }
    return {
      id: Number(match[1]),
      generation: Number(match[2])
    };
  }

  private defaultPageSize(): PDFPageSize {
    return { width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT };
  }

  private resolvePageSize(pageObject: PDFRawObject, objects: Map<string, PDFRawObject>): PDFPageSize | undefined {
    let current: PDFRawObject | undefined = pageObject;
    const visited = new Set<string>();

    while (current) {
      const bounds = this.extractBoundsFromDictionary(current.dictionarySource);
      if (bounds) {
        return bounds;
      }

      const parentRef = this.extractParentReference(current.dictionarySource);
      if (!parentRef) {
        break;
      }

      const parentKey = objectKey(parentRef.id, parentRef.generation);
      if (visited.has(parentKey)) {
        break;
      }
      visited.add(parentKey);
      current = objects.get(parentKey);
    }

    return undefined;
  }

  private extractBoundsFromDictionary(dictionarySource: string): PDFPageSize | undefined {
    const cropBox = this.matchBoundsArray(dictionarySource, 'CropBox');
    if (cropBox) {
      return cropBox;
    }
    const mediaBox = this.matchBoundsArray(dictionarySource, 'MediaBox');
    if (mediaBox) {
      return mediaBox;
    }
    return undefined;
  }

  private matchBoundsArray(dictionarySource: string, key: string): PDFPageSize | undefined {
    const pattern = new RegExp(`/${key}\\s*\\[([^\\]]+)\\]`);
    const match = pattern.exec(dictionarySource);
    if (!match) {
      return undefined;
    }
    return this.parseBoundsArray(match[1]);
  }

  private parseBoundsArray(content: string): PDFPageSize | undefined {
    const numbers = content.match(/-?\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length < 4) {
      return undefined;
    }

    const [x0Raw, y0Raw, x1Raw, y1Raw] = numbers;
    const x0 = Number(x0Raw);
    const y0 = Number(y0Raw);
    const x1 = Number(x1Raw);
    const y1 = Number(y1Raw);

    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      return undefined;
    }

    const width = x1 - x0;
    const height = y1 - y0;

    if (!(width > 0) || !(height > 0)) {
      return undefined;
    }

    return { width, height };
  }

  private isFormXObject(dictionarySource: string): boolean {
    return /\/Subtype\s*\/Form\b/.test(dictionarySource);
  }

  private isImageXObject(dictionarySource: string): boolean {
    return /\/Subtype\s*\/Image\b/.test(dictionarySource);
  }

  private buildImageResource(
    imageObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): ImageResource {
    const widthMatch = imageObject.dictionarySource.match(/\/Width\s+([0-9]+(?:\.[0-9]+)?)/);
    const heightMatch = imageObject.dictionarySource.match(/\/Height\s+([0-9]+(?:\.[0-9]+)?)/);
    const widthValue = widthMatch ? Number(widthMatch[1]) : undefined;
    const heightValue = heightMatch ? Number(heightMatch[1]) : undefined;

    const bitsMatch = imageObject.dictionarySource.match(/\/BitsPerComponent\s+(\d+)/);
    const { colorSpace, indexedColorSpace } = this.resolveImageColorSpace(
      imageObject.dictionarySource,
      objects,
      rawContent
    );
    const imageMask = /\/ImageMask\s+true\b/.test(imageObject.dictionarySource);
    let decodeParms: Record<string, number | boolean> | undefined;
    const decodeMatch = imageObject.dictionarySource.match(/\/DecodeParms\s*<<([\s\S]*?)>>/);
    if (decodeMatch) {
      const source = decodeMatch[1];
      const pairs = source.matchAll(/\/([A-Za-z0-9]+)\s+(-?\d+(?:\.\d+)?|true|false)/g);
      for (const match of pairs) {
        if (!decodeParms) {
          decodeParms = {};
        }
        const key = match[1];
        const valueRaw = match[2];
        if (valueRaw === 'true') {
          decodeParms[key] = true;
        } else if (valueRaw === 'false') {
          decodeParms[key] = false;
        } else {
          decodeParms[key] = Number(valueRaw);
        }
      }
    }

    let softMask: ContentRef | undefined;
    const smaskMatch = imageObject.dictionarySource.match(/\/SMask\s+(\d+)\s+(\d+)\s+R/);
    if (smaskMatch) {
      softMask = {
        id: Number(smaskMatch[1]),
        generation: Number(smaskMatch[2])
      };
    }

    let decode: number[] | undefined;
    const decodeArrayMatch = imageObject.dictionarySource.match(/\/Decode\s*\[([^\]]+)\]/);
    if (decodeArrayMatch) {
      const values = decodeArrayMatch[1]
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      if (values.length > 0) {
        decode = values;
      }
    }

    return {
      object: imageObject,
      width: Number.isFinite(widthValue) ? widthValue : undefined,
      height: Number.isFinite(heightValue) ? heightValue : undefined,
      bitsPerComponent: bitsMatch ? Number(bitsMatch[1]) : undefined,
      colorSpace,
      indexedColorSpace,
      filters: this.extractFilters(imageObject.dictionarySource),
      imageMask,
      decodeParms,
      decode,
      softMask
    };
  }

  private resolveImageColorSpace(
    dictionarySource: string,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): Pick<ImageResource, 'colorSpace' | 'indexedColorSpace'> {
    const directColorSpace = this.parseImageColorSpaceSource(dictionarySource, objects, rawContent);
    if (directColorSpace.colorSpace || directColorSpace.indexedColorSpace) {
      return directColorSpace;
    }

    const refMatch = dictionarySource.match(/\/ColorSpace\s+(\d+)\s+(\d+)\s+R\b/);
    if (!refMatch) {
      return {};
    }

    const key = objectKey(Number(refMatch[1]), Number(refMatch[2]));
    const colorSpaceObject = objects.get(key);
    if (!colorSpaceObject) {
      return {};
    }

    return this.parseImageColorSpaceSource(colorSpaceObject.dictionarySource, objects, rawContent);
  }

  private parseImageColorSpaceSource(
    source: string,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): Pick<ImageResource, 'colorSpace' | 'indexedColorSpace'> {
    const trimmed = source.trim();
    const indexedColorSpace = this.parseIndexedColorSpace(
      trimmed.includes('/ColorSpace') ? trimmed : `/ColorSpace ${trimmed}`,
      objects,
      rawContent
    );
    if (indexedColorSpace) {
      return {
        colorSpace: 'Indexed',
        indexedColorSpace
      };
    }

    const inlineMatch = trimmed.match(/\/ColorSpace\s+\/([A-Za-z0-9]+)/);
    if (inlineMatch) {
      return { colorSpace: inlineMatch[1] };
    }

    const directNameMatch = trimmed.match(/^\/([A-Za-z0-9]+)/);
    if (directNameMatch) {
      return { colorSpace: directNameMatch[1] };
    }

    return {};
  }

  private parseIndexedColorSpace(
    dictionarySource: string,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): ImageResource['indexedColorSpace'] | undefined {
    const match = dictionarySource.match(
      /\/ColorSpace\s*\[\s*\/Indexed\s*\/([A-Za-z0-9]+)\s+(\d+)\s+((?:\d+\s+\d+\s+R)|(?:<[^>]*>))\s*\]/
    );
    if (!match) {
      return undefined;
    }

    const base = match[1];
    const highValue = Number(match[2]);
    const lookupToken = match[3];

    if (!Number.isFinite(highValue) || highValue < 0) {
      return undefined;
    }

    let lookup: Uint8Array | undefined;

    const refMatch = lookupToken.match(/^(\d+)\s+(\d+)\s+R$/);
    if (refMatch) {
      const key = objectKey(Number(refMatch[1]), Number(refMatch[2]));
      const lookupObject = objects.get(key);
      if (lookupObject) {
        const resolved = this.resolveStreamContent(lookupObject, objects, rawContent);
        if (resolved) {
          lookup = latin1ToUint8(resolved);
        }
      }
    } else {
      const hexMatch = lookupToken.match(/^<([0-9A-Fa-f]*)>$/);
      if (hexMatch) {
        lookup = hexToBytes(hexMatch[1]);
      }
    }

    if (!lookup || lookup.length === 0) {
      return undefined;
    }

    return { base, highValue, lookup };
  }

  private buildFontResource(
    fontObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): FontResource {
    const resource: FontResource = {
      toUnicodeMap: undefined,
      encodingMap: undefined,
      maxCodeLength: 1
    };

    const baseFontName = this.extractBaseFontName(fontObject, objects);
    if (baseFontName) {
      resource.baseFontName = baseFontName;
      const cssFont = this.mapBaseFontToCss(baseFontName);
      if (cssFont) {
        resource.cssFontFamily = cssFont;
      }
    }

    const toUnicodeMatch = fontObject.dictionarySource.match(/\/ToUnicode\s+(\d+)\s+(\d+)\s+R/);
    if (toUnicodeMatch) {
      const objectId = Number(toUnicodeMatch[1]);
      const generation = Number(toUnicodeMatch[2]);
      const cmapKey = objectKey(objectId, generation);
      const cmapObject = objects.get(cmapKey);
      if (cmapObject) {
        const cmapStream = this.resolveStreamContent(cmapObject, objects, rawContent);
        if (cmapStream) {
          const toUnicodeMap = parseToUnicodeCMap(cmapStream);
          if (toUnicodeMap.size > 0) {
            resource.toUnicodeMap = toUnicodeMap;
            resource.maxCodeLength = this.calculateMaxCodeLength(toUnicodeMap);
          }
        }
      }
    }

    if (!resource.toUnicodeMap) {
      const encodingInfo = extractEncodingInfo(fontObject.dictionarySource, objects);
      const encodingMap = buildEncodingMap(fontObject, objects);

      if (!encodingInfo) {
        const embeddedType1Encoding = this.extractEmbeddedType1EncodingMap(fontObject, objects, rawContent);
        if (embeddedType1Encoding) {
          for (const [code, value] of embeddedType1Encoding.entries()) {
            encodingMap.set(code, value);
          }
        }
      }

      if (encodingMap.size > 0) {
        resource.encodingMap = encodingMap;
        resource.maxCodeLength = Math.max(resource.maxCodeLength, 1);
      }
    }

    const widthInfo = this.extractFontWidths(fontObject, objects, rawContent);
    if (widthInfo) {
      if (widthInfo.glyphWidths.size > 0) {
        resource.glyphWidths = widthInfo.glyphWidths;
      }
      if (widthInfo.defaultWidth !== undefined) {
        resource.defaultWidth = widthInfo.defaultWidth;
      }
    }

    // Detect Type3 fonts and parse CharProc glyph paths
    const subtypeMatch = fontObject.dictionarySource.match(/\/Subtype\s*\/([A-Za-z0-9]+)/);
    const subtype = subtypeMatch?.[1];
    if (subtype) {
      resource.subtype = subtype;
    }

    if (subtype === 'Type3') {
      // Parse /FontMatrix (defaults to identity)
      const fmMatch = fontObject.dictionarySource.match(
        /\/FontMatrix\s*\[\s*([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s*\]/
      );
      if (fmMatch) {
        resource.fontMatrix = [
          Number(fmMatch[1]), Number(fmMatch[2]),
          Number(fmMatch[3]), Number(fmMatch[4]),
          Number(fmMatch[5]), Number(fmMatch[6])
        ];
      }

      // Parse /CharProcs
      resource.charProcs = this.parseType3CharProcs(fontObject, objects, rawContent);

      // Build raw glyph name map (code → glyph name) for Type3 glyph resolution.
      // The encodingMap stores unicode characters, but Type3 fonts use custom glyph
      // names (often numeric like "0", "1", "2") that glyphNameToUnicode doesn't recognize.
      const encodingInfo = extractEncodingInfo(fontObject.dictionarySource, objects);
      if (encodingInfo?.differences) {
        resource.glyphNameMap = encodingInfo.differences;
      }
    }

    return resource;
  }

  private extractEmbeddedType1EncodingMap(
    fontObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): Map<number, string> | undefined {
    const subtypeMatch = fontObject.dictionarySource.match(/\/Subtype\s*\/([A-Za-z0-9]+)/);
    const subtype = subtypeMatch?.[1];
    if (subtype !== 'Type1' && subtype !== 'MMType1') {
      return undefined;
    }

    const descriptor = this.resolveFontDescriptorObject(fontObject, objects);
    if (!descriptor) {
      return undefined;
    }

    const fontFileMatch = descriptor.dictionarySource.match(/\/FontFile\s+(\d+)\s+(\d+)\s+R/);
    if (!fontFileMatch) {
      return undefined;
    }

    const fontFileKey = objectKey(Number(fontFileMatch[1]), Number(fontFileMatch[2]));
    const fontFileObject = objects.get(fontFileKey);
    if (!fontFileObject) {
      return undefined;
    }

    const fontProgram = this.resolveStreamContent(fontFileObject, objects, rawContent);
    if (!fontProgram) {
      return undefined;
    }

    const eexecIndex = fontProgram.indexOf('eexec');
    const cleartextSource = eexecIndex === -1 ? fontProgram : fontProgram.slice(0, eexecIndex);
    const normalizedCleartextSource = cleartextSource.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const encodingBlockMatch = normalizedCleartextSource.match(/\/Encoding\b([\s\S]*?)\n(?:readonly\s+)?def\b/);
    if (!encodingBlockMatch) {
      return undefined;
    }

    const map = new Map<number, string>();
    const entryRegex = /dup\s+(\d+)\s+\/([^\s/]+)\s+put\b/g;
    let entryMatch: RegExpExecArray | null;

    while ((entryMatch = entryRegex.exec(encodingBlockMatch[1])) !== null) {
      const code = Number(entryMatch[1]);
      const glyphName = entryMatch[2];
      if (!Number.isFinite(code) || !glyphName) {
        continue;
      }

      const value = glyphNameToUnicode(glyphName);
      if (value !== undefined) {
        map.set(code & 0xff, value);
      }
    }

    return map.size > 0 ? map : undefined;
  }

  /**
   * Parse Type3 font CharProcs into pre-parsed glyph path commands.
   */
  private parseType3CharProcs(
    fontObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): Map<string, Type3Glyph> | undefined {
    // CharProcs can be an indirect ref or inline dict
    const charProcsRefMatch = fontObject.dictionarySource.match(/\/CharProcs\s+(\d+)\s+(\d+)\s+R/);
    let charProcsDict: string | undefined;

    if (charProcsRefMatch) {
      const cpKey = objectKey(Number(charProcsRefMatch[1]), Number(charProcsRefMatch[2]));
      const cpObj = objects.get(cpKey);
      if (cpObj) {
        charProcsDict = cpObj.dictionarySource;
      }
    } else {
      const inlineMatch = fontObject.dictionarySource.match(/\/CharProcs\s*<<([\s\S]*?)>>/);
      if (inlineMatch) {
        charProcsDict = inlineMatch[1];
      }
    }

    if (!charProcsDict) {
      return undefined;
    }

    const glyphs = new Map<string, Type3Glyph>();
    const entryRegex = /\/([^\s/<>[\]()]+)\s+(\d+)\s+(\d+)\s+R/g;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(charProcsDict)) !== null) {
      const glyphName = match[1];
      const id = Number(match[2]);
      const gen = Number(match[3]);
      const key = objectKey(id, gen);
      const glyphObj = objects.get(key);
      if (!glyphObj) {
        continue;
      }

      const stream = this.resolveStreamContent(glyphObj, objects, rawContent);
      if (!stream) {
        continue;
      }

      const glyph = this.parseCharProcStream(glyphName, stream);
      if (glyph) {
        glyphs.set(glyphName, glyph);
      }
    }

    return glyphs.size > 0 ? glyphs : undefined;
  }

  /**
   * Parse a single Type3 CharProc content stream into path commands.
   * CharProcs contain a d0/d1 operator followed by path construction/painting operators.
   */
  private parseCharProcStream(glyphName: string, stream: string): Type3Glyph | undefined {
    const commands: Type3PathCommand[] = [];
    const nums: number[] = [];
    let glyphWidth = 0;
    let currentMatrix = identityMatrix();
    const matrixStack: Matrix[] = [];
    let currentPoint: Vector2D | undefined;
    let subpathStart: Vector2D | undefined;

    // Tokenize the stream
    const tokens = stream.trim().split(/\s+/);

    const transformGlyphPoint = (x: number, y: number): Vector2D => transformPoint(currentMatrix, x, y);

    for (const token of tokens) {
      const num = Number(token);
      if (Number.isFinite(num)) {
        nums.push(num);
        continue;
      }

      switch (token) {
        case 'd0':
          // d0 wx wy — set glyph width
          if (nums.length >= 2) {
            glyphWidth = nums[nums.length - 2];
          }
          nums.length = 0;
          break;
        case 'd1':
          // d1 wx wy llx lly urx ury — set glyph width and bbox
          if (nums.length >= 6) {
            glyphWidth = nums[nums.length - 6];
          }
          nums.length = 0;
          break;
        case 'm':
          if (nums.length >= 2) {
            const x = nums[nums.length - 2];
            const y = nums[nums.length - 1];
            const point = transformGlyphPoint(x, y);
            commands.push({ op: 'M', x: point.x, y: point.y });
            currentPoint = { x, y };
            subpathStart = { x, y };
          }
          nums.length = 0;
          break;
        case 'l':
          if (nums.length >= 2) {
            const x = nums[nums.length - 2];
            const y = nums[nums.length - 1];
            const point = transformGlyphPoint(x, y);
            commands.push({ op: 'L', x: point.x, y: point.y });
            currentPoint = { x, y };
          }
          nums.length = 0;
          break;
        case 'c':
          if (nums.length >= 6) {
            const x1 = nums[nums.length - 6];
            const y1 = nums[nums.length - 5];
            const x2 = nums[nums.length - 4];
            const y2 = nums[nums.length - 3];
            const x3 = nums[nums.length - 2];
            const y3 = nums[nums.length - 1];
            const p1 = transformGlyphPoint(x1, y1);
            const p2 = transformGlyphPoint(x2, y2);
            const p3 = transformGlyphPoint(x3, y3);
            commands.push({
              op: 'C',
              x1: p1.x, y1: p1.y,
              x2: p2.x, y2: p2.y,
              x3: p3.x, y3: p3.y
            });
            currentPoint = { x: x3, y: y3 };
          }
          nums.length = 0;
          break;
        case 'v':
          // v x2 y2 x3 y3 — current point is first control point
          if (nums.length >= 4 && currentPoint) {
            const x2 = nums[nums.length - 4];
            const y2 = nums[nums.length - 3];
            const x3 = nums[nums.length - 2];
            const y3 = nums[nums.length - 1];
            const p1 = transformGlyphPoint(currentPoint.x, currentPoint.y);
            const p2 = transformGlyphPoint(x2, y2);
            const p3 = transformGlyphPoint(x3, y3);
            commands.push({
              op: 'C',
              x1: p1.x, y1: p1.y,
              x2: p2.x, y2: p2.y,
              x3: p3.x, y3: p3.y
            });
            currentPoint = { x: x3, y: y3 };
          }
          nums.length = 0;
          break;
        case 'y':
          // y x1 y1 x3 y3 — endpoint is second control point
          if (nums.length >= 4) {
            const x1 = nums[nums.length - 4];
            const y1 = nums[nums.length - 3];
            const x3 = nums[nums.length - 2];
            const y3 = nums[nums.length - 1];
            const p1 = transformGlyphPoint(x1, y1);
            const p3 = transformGlyphPoint(x3, y3);
            commands.push({
              op: 'C',
              x1: p1.x, y1: p1.y,
              x2: p3.x, y2: p3.y,
              x3: p3.x, y3: p3.y
            });
            currentPoint = { x: x3, y: y3 };
          }
          nums.length = 0;
          break;
        case 'h':
          commands.push({ op: 'Z' });
          if (subpathStart) {
            currentPoint = { ...subpathStart };
          }
          nums.length = 0;
          break;
        case 're':
          if (nums.length >= 4) {
            const x = nums[nums.length - 4];
            const y = nums[nums.length - 3];
            const w = nums[nums.length - 2];
            const h = nums[nums.length - 1];
            const p0 = transformGlyphPoint(x, y);
            const p1 = transformGlyphPoint(x + w, y);
            const p2 = transformGlyphPoint(x + w, y + h);
            const p3 = transformGlyphPoint(x, y + h);
            commands.push({ op: 'M', x: p0.x, y: p0.y });
            commands.push({ op: 'L', x: p1.x, y: p1.y });
            commands.push({ op: 'L', x: p2.x, y: p2.y });
            commands.push({ op: 'L', x: p3.x, y: p3.y });
            commands.push({ op: 'Z' });
            currentPoint = { x, y };
            subpathStart = { x, y };
          }
          nums.length = 0;
          break;
        case 'f':
        case 'F':
          commands.push({ op: 'f' });
          nums.length = 0;
          break;
        case 'f*':
          commands.push({ op: 'f*' });
          nums.length = 0;
          break;
        case 'S':
          commands.push({ op: 'S' });
          nums.length = 0;
          break;
        case 'B':
        case 'B*':
          commands.push({ op: 'B' });
          nums.length = 0;
          break;
        case 'b':
        case 'b*':
          commands.push({ op: 'Z' });
          commands.push({ op: 'B' });
          nums.length = 0;
          break;
        case 'n':
          commands.push({ op: 'n' });
          currentPoint = undefined;
          subpathStart = undefined;
          nums.length = 0;
          break;
        case 'q':
          matrixStack.push(cloneMatrix(currentMatrix));
          nums.length = 0;
          break;
        case 'Q':
          currentMatrix = matrixStack.pop() ?? identityMatrix();
          nums.length = 0;
          break;
        case 'cm':
          if (nums.length >= 6) {
            const matrix: Matrix = [
              nums[nums.length - 6],
              nums[nums.length - 5],
              nums[nums.length - 4],
              nums[nums.length - 3],
              nums[nums.length - 2],
              nums[nums.length - 1]
            ];
            currentMatrix = multiplyMatrices(currentMatrix, matrix);
          }
          nums.length = 0;
          break;
        case 'i':
        case 'W':
        case 'W*':
          // Graphics state operators — consume but don't produce path commands
          nums.length = 0;
          break;
        case 'rg':
        case 'RG':
        case 'g':
        case 'G':
        case 'k':
        case 'K':
        case 'cs':
        case 'CS':
        case 'sc':
        case 'SC':
          // Color operators — consume
          nums.length = 0;
          break;
        default:
          nums.length = 0;
          break;
      }
    }

    return { glyphName, pathCommands: commands, width: glyphWidth };
  }

  private extractFontWidths(
    fontObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): { glyphWidths: Map<number, number>; defaultWidth?: number } | undefined {
    const glyphWidths = new Map<number, number>();
    let defaultWidth: number | undefined;

    const subtypeMatch = fontObject.dictionarySource.match(/\/Subtype\s*\/([A-Za-z0-9]+)/);
    const subtype = subtypeMatch?.[1];

    if (subtype === 'Type0') {
      const descendants = this.extractDescendantFontRefs(fontObject.dictionarySource);
      if (descendants.length === 0) {
        return undefined;
      }

      for (const ref of descendants) {
        const key = objectKey(ref.id, ref.generation);
        const descendant = objects.get(key);
        if (!descendant) {
          continue;
        }
        const info = this.parseCidFontWidthDictionary(descendant, objects, rawContent);
        if (!info) {
          continue;
        }
        for (const [cid, width] of info.glyphWidths.entries()) {
          if (!glyphWidths.has(cid)) {
            glyphWidths.set(cid, width);
          }
        }
        if (info.defaultWidth !== undefined) {
          defaultWidth = info.defaultWidth;
        }
      }

      if (glyphWidths.size === 0 && defaultWidth === undefined) {
        return undefined;
      }

      return { glyphWidths, defaultWidth };
    }

    const firstCharMatch = fontObject.dictionarySource.match(/\/FirstChar\s+(-?\d+(?:\.\d+)?)/);
    const rawWidths = this.extractRawArrayContent(fontObject.dictionarySource, 'Widths', objects, rawContent);

    if (!firstCharMatch || !rawWidths) {
      return undefined;
    }

    const firstChar = Number(firstCharMatch[1]);
    if (!Number.isFinite(firstChar)) {
      return undefined;
    }

    const values = this.parseNumberList(rawWidths);
    if (values.length === 0) {
      return undefined;
    }

    for (let index = 0; index < values.length; index += 1) {
      const width = values[index];
      if (Number.isFinite(width)) {
        glyphWidths.set(firstChar + index, width);
      }
    }

    if (glyphWidths.size === 0) {
      return undefined;
    }

    return { glyphWidths };
  }

  private extractDescendantFontRefs(dictionarySource: string): ContentRef[] {
    const refs: ContentRef[] = [];
    const arrayMatch = dictionarySource.match(/\/DescendantFonts\s*\[([\s\S]*?)\]/);

    if (arrayMatch) {
      const regex = /(\d+)\s+(\d+)\s+R/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(arrayMatch[1])) !== null) {
        refs.push({ id: Number(match[1]), generation: Number(match[2]) });
      }
      return refs;
    }

    const singleMatch = dictionarySource.match(/\/DescendantFonts\s+(\d+)\s+(\d+)\s+R/);
    if (singleMatch) {
      refs.push({ id: Number(singleMatch[1]), generation: Number(singleMatch[2]) });
    }

    return refs;
  }

  private parseCidFontWidthDictionary(
    fontObject: PDFRawObject,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): { glyphWidths: Map<number, number>; defaultWidth?: number } | undefined {
    const glyphWidths = new Map<number, number>();
    let defaultWidth: number | undefined;

    const dwMatch = fontObject.dictionarySource.match(/\/DW\s+(-?\d+(?:\.\d+)?)/);
    if (dwMatch) {
      const value = Number(dwMatch[1]);
      if (Number.isFinite(value)) {
        defaultWidth = value;
      }
    }

    const raw = this.extractRawArrayContent(fontObject.dictionarySource, 'W', objects, rawContent);
    if (raw) {
      const entries = this.parseCidWidthTable(raw);
      for (const [cid, width] of entries.entries()) {
        glyphWidths.set(cid, width);
      }
    }

    if (glyphWidths.size === 0 && defaultWidth === undefined) {
      return undefined;
    }

    return { glyphWidths, defaultWidth };
  }

  private extractRawArrayContent(
    dictionarySource: string,
    key: string,
    objects: Map<string, PDFRawObject>,
    rawContent: string
  ): string | undefined {
    const keyIndex = dictionarySource.indexOf(`/${key}`);
    if (keyIndex !== -1) {
      const bracketIndex = dictionarySource.indexOf('[', keyIndex);
      if (bracketIndex !== -1) {
        const inline = this.readBracketContent(dictionarySource, bracketIndex);
        if (inline) {
          return inline.content;
        }
      }
    }

    const refPattern = new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`);
    const refMatch = refPattern.exec(dictionarySource);
    if (refMatch) {
      const objKey = objectKey(Number(refMatch[1]), Number(refMatch[2]));
      const refObject = objects.get(objKey);
      if (!refObject) {
        return undefined;
      }
      const dictContent = refObject.dictionarySource;
      if (dictContent) {
        const bracketIndex = dictContent.indexOf('[');
        if (bracketIndex !== -1) {
          const inline = this.readBracketContent(dictContent, bracketIndex);
          if (inline) {
            return inline.content;
          }
        }
      }
      const source =
        refObject.stream ?? this.readRawStreamContent(refObject, objects, rawContent, true) ?? refObject.raw;
      if (!source) {
        return undefined;
      }
      const bracketIndex = source.indexOf('[');
      if (bracketIndex !== -1) {
        const inline = this.readBracketContent(source, bracketIndex);
        if (inline) {
          return inline.content;
        }
      }
      return source.trim();
    }

    return undefined;
  }

  private readBracketContent(source: string, startIndex: number): { content: string; endIndex: number } | undefined {
    let depth = 0;
    let index = startIndex;
    let contentStart = -1;

    while (index < source.length) {
      const char = source[index];
      if (char === '[') {
        if (depth === 0) {
          contentStart = index + 1;
        }
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0 && contentStart !== -1) {
          return {
            content: source.slice(contentStart, index),
            endIndex: index + 1
          };
        }
      }
      index += 1;
    }

    return undefined;
  }

  private parseNumberList(content: string): number[] {
    const matches = content.match(/-?\d+(?:\.\d+)?/g);
    if (!matches) {
      return [];
    }
    return matches
      .map((value) => Number(value))
      .filter((num) => Number.isFinite(num));
  }

  private parseCidWidthTable(content: string): Map<number, number> {
    const map = new Map<number, number>();
    const tokens = content.match(/-?\d+(?:\.\d+)?|\[|\]/g);
    if (!tokens) {
      return map;
    }

    for (let index = 0; index < tokens.length; ) {
      const token = tokens[index];
      if (token === '[' || token === ']') {
        index += 1;
        continue;
      }

      const startCode = Number(token);
      index += 1;
      if (!Number.isFinite(startCode)) {
        continue;
      }

      const nextToken = tokens[index];
      if (nextToken === '[') {
        index += 1;
        let currentCode = startCode;
        while (index < tokens.length && tokens[index] !== ']') {
          const widthValue = Number(tokens[index]);
          if (Number.isFinite(widthValue)) {
            map.set(currentCode, widthValue);
            currentCode += 1;
          }
          index += 1;
        }
        if (tokens[index] === ']') {
          index += 1;
        }
        continue;
      }

      const endToken = tokens[index];
      index += 1;
      const widthToken = tokens[index];
      index += 1;

      const endCode = Number(endToken);
      const widthValue = Number(widthToken);
      if (!Number.isFinite(endCode) || !Number.isFinite(widthValue)) {
        continue;
      }

      for (let code = startCode; code <= endCode; code += 1) {
        map.set(code, widthValue);
      }
    }

    return map;
  }

  private refineTextBounds(items: PDFTextItem[]): PDFTextItem[] {
    if (items.length <= 1) {
      return items;
    }

    const lineTolerance = 0.75;
    const overlapTolerance = 0.75;
    const epsilon = 0.5;

    interface LineGroup {
      baseline: number;
      indices: number[];
    }

    const groups: LineGroup[] = [];
    const baseline = (item: PDFTextItem): number =>
      Math.min(item.bounds.minY, item.bounds.maxY);

    const sortedIndices = items
      .map((_, index) => index)
      .sort((a, b) => baseline(items[a]) - baseline(items[b]));

    for (const index of sortedIndices) {
      const item = items[index];
      if (!item?.bounds) {
        continue;
      }

      const itemBaseline = baseline(item);
      let group = groups.find((candidate) => Math.abs(candidate.baseline - itemBaseline) <= lineTolerance);
      if (!group) {
        group = { baseline: itemBaseline, indices: [] };
        groups.push(group);
      } else {
        group.baseline =
          (group.baseline * group.indices.length + itemBaseline) / (group.indices.length + 1);
      }
      group.indices.push(index);
    }

    for (const group of groups) {
      const ordered = group.indices
        .slice()
        .sort((a, b) => items[a].bounds.minX - items[b].bounds.minX);

      for (let i = 0; i < ordered.length - 1; i += 1) {
        const current = items[ordered[i]];
        const next = items[ordered[i + 1]];
        if (!current?.bounds || !next?.bounds) {
          continue;
        }


        const overlap = current.bounds.maxX - next.bounds.minX;
        if (overlap <= overlapTolerance) {
          continue;
        }

        const candidateMax = Math.max(current.bounds.minX, next.bounds.minX - epsilon);
        if (candidateMax < current.bounds.maxX) {
          current.bounds.maxX = candidateMax;
        }
      }
    }

    return items;
  }

  private shouldSmoothText(): boolean {
    if (typeof this.options.smoothText === 'boolean') {
      return this.options.smoothText;
    }
    return true;
  }

  private resolveFontFamily(fontKey: string | undefined, fonts: FontMap): string | undefined {
    if (!fontKey) {
      return undefined;
    }
    const resource = fonts.get(fontKey);
    if (!resource) {
      return fontKey;
    }
    if (!resource.cssFontFamily && resource.baseFontName) {
      const mapped = this.mapBaseFontToCss(resource.baseFontName);
      resource.cssFontFamily = mapped ?? resource.baseFontName;
    }
    return resource.cssFontFamily ?? resource.baseFontName ?? fontKey;
  }

  private extractBaseFontName(fontObject: PDFRawObject, objects: Map<string, PDFRawObject>): string | undefined {
    const direct = this.findBaseFontName(fontObject.dictionarySource);
    if (direct) {
      return direct;
    }

    const descriptorMatch = fontObject.dictionarySource.match(/\/FontDescriptor\s+(\d+)\s+(\d+)\s+R/);
    if (descriptorMatch) {
      const key = objectKey(Number(descriptorMatch[1]), Number(descriptorMatch[2]));
      const descriptor = objects.get(key);
      if (descriptor) {
        const descriptorName = this.findBaseFontName(descriptor.dictionarySource);
        if (descriptorName) {
          return descriptorName;
        }
      }
    }

    if (/\/Subtype\s*\/Type0\b/.test(fontObject.dictionarySource)) {
      const descendants = this.extractDescendantFontRefs(fontObject.dictionarySource);
      for (const ref of descendants) {
        const key = objectKey(ref.id, ref.generation);
        const descendant = objects.get(key);
        if (!descendant) {
          continue;
        }
        const descendantName = this.findBaseFontName(descendant.dictionarySource);
        if (descendantName) {
          return descendantName;
        }
        const descDescriptorMatch = descendant.dictionarySource.match(/\/FontDescriptor\s+(\d+)\s+(\d+)\s+R/);
        if (descDescriptorMatch) {
          const descKey = objectKey(Number(descDescriptorMatch[1]), Number(descDescriptorMatch[2]));
          const descDescriptor = objects.get(descKey);
          if (descDescriptor) {
            const nested = this.findBaseFontName(descDescriptor.dictionarySource);
            if (nested) {
              return nested;
            }
          }
        }
      }
    }

    return undefined;
  }

  private resolveFontDescriptorObject(
    fontObject: PDFRawObject,
    objects: Map<string, PDFRawObject>
  ): PDFRawObject | undefined {
    const directDescriptor = this.lookupFontDescriptorObject(fontObject.dictionarySource, objects);
    if (directDescriptor) {
      return directDescriptor;
    }

    if (/\/Subtype\s*\/Type0\b/.test(fontObject.dictionarySource)) {
      const descendants = this.extractDescendantFontRefs(fontObject.dictionarySource);
      for (const ref of descendants) {
        const descendant = objects.get(objectKey(ref.id, ref.generation));
        if (!descendant) {
          continue;
        }

        const descendantDescriptor = this.lookupFontDescriptorObject(descendant.dictionarySource, objects);
        if (descendantDescriptor) {
          return descendantDescriptor;
        }
      }
    }

    return undefined;
  }

  private lookupFontDescriptorObject(
    dictionarySource: string,
    objects: Map<string, PDFRawObject>
  ): PDFRawObject | undefined {
    const descriptorMatch = dictionarySource.match(/\/FontDescriptor\s+(\d+)\s+(\d+)\s+R/);
    if (!descriptorMatch) {
      return undefined;
    }

    const descriptorKey = objectKey(Number(descriptorMatch[1]), Number(descriptorMatch[2]));
    return objects.get(descriptorKey);
  }

  private findBaseFontName(dictionarySource: string): string | undefined {
    if (!dictionarySource) {
      return undefined;
    }
    const baseMatch = dictionarySource.match(/\/BaseFont\s+\/([^\s\/]+)/);
    if (baseMatch) {
      return this.normalizeFontName(baseMatch[1]);
    }
    const nameMatch = dictionarySource.match(/\/FontName\s+\/([^\s\/]+)/);
    if (nameMatch) {
      return this.normalizeFontName(nameMatch[1]);
    }
    return undefined;
  }

  private normalizeFontName(fontName: string): string {
    const withoutSubset = fontName.replace(/^[A-Z]{6}\+/, '');
    return withoutSubset.replace(/#([0-9A-F]{2})/gi, (_match, hex) => {
      const value = Number.parseInt(hex, 16);
      return Number.isFinite(value) ? String.fromCharCode(value) : '';
    });
  }

  private mapBaseFontToCss(baseFontName: string): string | undefined {
    const normalized = baseFontName.toLowerCase();
    if (normalized.includes('times') || normalized.includes('roman')) {
      return 'Times New Roman';
    }
    if (normalized.includes('helvetica')) {
      return 'Helvetica';
    }
    if (normalized.includes('courier')) {
      return 'Courier New';
    }
    if (normalized.includes('symbol')) {
      return 'Symbol';
    }
    if (normalized.includes('zapf') && normalized.includes('ding')) {
      return 'Zapf Dingbats';
    }
    if (normalized.includes('palatino')) {
      return 'Palatino';
    }
    if (normalized.includes('nimbusrom') || normalized.includes('urw') || normalized.includes('liberationserif')) {
      return 'Times New Roman';
    }
    if (normalized.includes('nimbussan') || normalized.includes('liberationsans')) {
      return 'Helvetica';
    }
    if (normalized.includes('garamond')) {
      return 'Garamond';
    }
    if (normalized.includes('cmr')) {
      return 'Times New Roman';
    }
    if (normalized.includes('cmss')) {
      return 'Arial';
    }
    if (normalized.includes('cmtt') || normalized.includes('typewriter')) {
      return 'Courier New';
    }
    if (normalized.includes('georgia')) {
      return 'Georgia';
    }
    if (normalized.includes('verdana')) {
      return 'Verdana';
    }
    if (normalized.includes('tahoma')) {
      return 'Tahoma';
    }
    if (normalized.includes('arial')) {
      return 'Arial';
    }
    if (normalized.includes('calibri')) {
      return 'Calibri';
    }
    if (normalized.includes('cambria')) {
      return 'Cambria';
    }
    if (normalized.includes('consolas')) {
      return 'Consolas';
    }
    if (normalized.includes('monaco')) {
      return 'Monaco';
    }
    return baseFontName;
  }

  private extractFontWeight(fontName: string | undefined): 'normal' | 'bold' {
    if (!fontName) {
      return 'normal';
    }
    const normalized = fontName.toLowerCase();
    // Check for bold indicators in font name
    if (
      normalized.includes('bold') ||
      normalized.includes('-bd') ||
      normalized.includes('_bd') ||
      normalized.includes('heavy') ||
      normalized.includes('black') ||
      normalized.includes('demi') ||
      normalized.includes('semibold') ||
      normalized.includes('extrabold') ||
      normalized.includes('ultrabold') ||
      // Computer Modern bold fonts (CMBX = bold extended, CMBSY = bold symbols)
      /cmbx\d/.test(normalized) ||
      /cmbsy\d/.test(normalized) ||
      /cmmib\d/.test(normalized) ||
      // Nimbus Roman Medium (Medi) is typically used for bold
      normalized.includes('-medi') ||
      normalized.includes('medi-')
    ) {
      return 'bold';
    }
    return 'normal';
  }

  private extractFontStyle(fontName: string | undefined): 'normal' | 'italic' {
    if (!fontName) {
      return 'normal';
    }
    const normalized = fontName.toLowerCase();
    // Check for italic indicators in font name
    if (
      normalized.includes('italic') ||
      normalized.includes('oblique') ||
      normalized.includes('-it') ||
      normalized.includes('_it') ||
      normalized.includes('inclined') ||
      normalized.includes('ital') ||
      // Computer Modern Math Italic fonts (CMMI, CMMIB)
      /cmmi\d/.test(normalized) ||
      /cmmib\d/.test(normalized) ||
      // Nimbus Roman Italic
      normalized.includes('reguital')
    ) {
      return 'italic';
    }
    return 'normal';
  }

  private transformTextItems(items: PDFTextItem[], matrix: Matrix): PDFTextItem[] {
    if (items.length === 0) {
      return items;
    }

    const isIdentity =
      matrix[0] === 1 &&
      matrix[1] === 0 &&
      matrix[2] === 0 &&
      matrix[3] === 1 &&
      matrix[4] === 0 &&
      matrix[5] === 0;

    if (isIdentity) {
      return items.map((item) => ({
        ...item,
        bounds: { ...item.bounds },
        baselineStart: item.baselineStart ? { ...item.baselineStart } : undefined,
        baselineEnd: item.baselineEnd ? { ...item.baselineEnd } : undefined
      }));
    }

    return items.map((item) => {
      const corners = [
        transformPoint(matrix, item.bounds.minX, item.bounds.minY),
        transformPoint(matrix, item.bounds.minX, item.bounds.maxY),
        transformPoint(matrix, item.bounds.maxX, item.bounds.minY),
        transformPoint(matrix, item.bounds.maxX, item.bounds.maxY)
      ];
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      const height = Math.abs(Math.max(...ys) - Math.min(...ys));
      return {
        ...item,
        bounds: {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys)
        },
        baselineStart: item.baselineStart
          ? transformPoint(matrix, item.baselineStart.x, item.baselineStart.y)
          : undefined,
        baselineEnd: item.baselineEnd
          ? transformPoint(matrix, item.baselineEnd.x, item.baselineEnd.y)
          : undefined,
        fontSize: Number.isFinite(height) && height > 0 ? height : item.fontSize
      };
    });
  }

  private renderImageResource(
    resource: ImageResource,
    objects: Map<string, PDFRawObject>,
    rawContent: string,
    isSoftMask = false
  ): {
    mimeType?: string;
    dataUri?: string;
    width?: number;
    height?: number;
    mask?: CcittMask;
    pixels?: {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      offsetX?: number;
      offsetY?: number;
      originalWidth?: number;
      originalHeight?: number;
    };
  } | undefined {
    const filters = resource.filters?.map((filter) => filter.toLowerCase()) ?? [];
    const rawStream =
      resource.object.stream ?? this.readRawStreamContent(resource.object, objects, rawContent, true);

    if (!rawStream) {
      return undefined;
    }

    let bytes = latin1ToUint8(rawStream);
    let isJpeg = false;
    let isCcitt = false;

    for (const filter of filters) {
      switch (filter) {
        case 'flatedecode':
        case 'flate':
        case 'fl':
          bytes = decodeFlate(bytes);
          break;
        case 'dctdecode':
        case 'dct':
          isJpeg = true;
          break;
        case 'ccittfaxdecode':
        case 'ccittfax':
          isCcitt = true;
          break;
        default:
          return undefined;
      }
    }

    if (isCcitt && resource.imageMask) {
      const columns =
        typeof resource.decodeParms?.Columns === 'number'
          ? resource.decodeParms.Columns
          : resource.width ?? 0;
      const rows =
        typeof resource.decodeParms?.Rows === 'number' ? resource.decodeParms.Rows : resource.height ?? 0;

      if (!(columns > 0) || !(rows > 0)) {
        return undefined;
      }

      let blackIs1 = Boolean(resource.decodeParms?.BlackIs1);
      if (Array.isArray(resource.decode) && resource.decode.length >= 2) {
        const [decodeStart, decodeEnd] = resource.decode;
        if (Number.isFinite(decodeStart) && Number.isFinite(decodeEnd) && decodeStart > decodeEnd) {
          blackIs1 = !blackIs1;
        }
      }

      const mask = decodeCcitt(bytes, columns, rows, {
        columns,
        rows,
        blackIs1,
        k: typeof resource.decodeParms?.K === 'number' ? Number(resource.decodeParms.K) : -1,
        endOfLine:
          typeof resource.decodeParms?.EndOfLine === 'boolean' ? Boolean(resource.decodeParms.EndOfLine) : undefined,
        encodedByteAlign:
          typeof resource.decodeParms?.EncodedByteAlign === 'boolean'
            ? Boolean(resource.decodeParms.EncodedByteAlign)
            : undefined,
        endOfBlock:
          typeof resource.decodeParms?.EndOfBlock === 'boolean'
            ? Boolean(resource.decodeParms.EndOfBlock)
            : undefined
      });

      return {
        width: resource.width,
        height: resource.height,
        mask: {
          width: mask.width,
          height: mask.height,
          data: mask.data,
          blackIs1: mask.blackIs1
        }
      };
    }

    if (isJpeg) {
      const base64 = uint8ToBase64(bytes);
      return {
        mimeType: 'image/jpeg',
        dataUri: `data:image/jpeg;base64,${base64}`,
        width: resource.width,
        height: resource.height
      };
    }

    const decodedPixels = decodeFlateImage(bytes, resource);
    if (decodedPixels) {
      if (resource.softMask && !isSoftMask) {
        const maskKey = objectKey(resource.softMask.id, resource.softMask.generation);
        const maskObject = objects.get(maskKey);
        if (maskObject) {
          const maskResource = this.buildImageResource(maskObject, objects, rawContent);
          if (maskResource) {
            const renderedMask = this.renderImageResource(maskResource, objects, rawContent, true);
            let maskPixels: { width: number; height: number; data: Uint8ClampedArray } | undefined =
              renderedMask?.pixels;
            if (!maskPixels && renderedMask?.mask) {
              maskPixels = ccittMaskToPixels(renderedMask.mask);
            }
            if (
              maskPixels &&
              maskPixels.width === decodedPixels.width &&
              maskPixels.height === decodedPixels.height
            ) {
              const alphaSource = maskPixels.data;
              const rgba = decodedPixels.data;
              for (let i = 0; i < decodedPixels.width * decodedPixels.height; i += 1) {
                rgba[i * 4 + 3] = alphaSource[i * 4] ?? 255;
              }
            }
          }
        }
      }

      const trimmed = trimPixelBounds(decodedPixels);
      return {
        width: resource.width,
        height: resource.height,
        pixels: {
          width: trimmed.width,
          height: trimmed.height,
          data: trimmed.data,
          offsetX: trimmed.offsetX,
          offsetY: trimmed.offsetY,
          originalWidth: decodedPixels.width,
          originalHeight: decodedPixels.height
        }
      };
    }

    return undefined;
  }

  private calculateMaxCodeLength(map: Map<string, string>): number {
    let max = 1;
    for (const key of map.keys()) {
      if (key.length > max) {
        max = key.length;
      }
    }
    return Math.max(1, max);
  }

  private extractContentRefs(dictionarySource: string): ContentRef[] {
    const refs: ContentRef[] = [];
    const arrayMatch = dictionarySource.match(/\/Contents\s*\[([\s\S]*?)\]/);

    if (arrayMatch) {
      const referenceRegex = /(\d+)\s+(\d+)\s+R/g;
      let refMatch: RegExpExecArray | null;
      while ((refMatch = referenceRegex.exec(arrayMatch[1])) !== null) {
        refs.push({ id: Number(refMatch[1]), generation: Number(refMatch[2]) });
      }
      return refs;
    }

    const singleMatch = dictionarySource.match(/\/Contents\s*(\d+)\s+(\d+)\s+R/);
    if (singleMatch) {
      refs.push({ id: Number(singleMatch[1]), generation: Number(singleMatch[2]) });
    }

    return refs;
  }

  private isPageObject(dictionarySource: string): boolean {
    return /\/Type\s*\/Page\b/.test(dictionarySource);
  }

  private popNumber(stack: PDFOperatorValue[]): number | undefined {
    const value = stack.pop();
    if (typeof value === 'number') {
      return value;
    }
    return undefined;
  }

  private popString(stack: PDFOperatorValue[]): string | undefined {
    const value = stack.pop();
    if (typeof value === 'string') {
      return value;
    }
    return undefined;
  }

  private popName(stack: PDFOperatorValue[]): string | undefined {
    const value = stack.pop();
    if (value && typeof value === 'object' && !Array.isArray(value) && 'kind' in value) {
      return value.value;
    }
    return undefined;
  }
}
