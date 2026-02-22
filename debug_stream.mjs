/**
 * Debug script: inspect raw bytes in the content stream of the first page
 * of the "Leadership, Trust, And AI" PDF.
 *
 * Usage:  node debug_stream.mjs
 *
 * Outputs every text-showing operator (Tj, TJ, ', ") found in BT..ET blocks
 * for the first page, with hex dumps of the raw string bytes being drawn.
 * Also dumps the raw decompressed content stream and provides a summary
 * reconstruction of text from glyph names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import parser internals from dist/
import { PDFParser } from './dist/parser/pdfParser.js';
import { objectKey } from './dist/parser/xrefParser.js';
import { tokenize } from './dist/parser/textTokenizer.js';
import { bufferToLatin1, latin1ToUint8 } from './dist/utils/buffer.js';
import { parseToUnicodeCMap, buildEncodingMap, extractEncodingInfo } from './dist/parser/fontEncoding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(__dirname, 'pdfs', "Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf");

// ── helpers ──────────────────────────────────────────────────────────────

function hexDump(str) {
    const bytes = latin1ToUint8(str);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function printableAscii(str) {
    const bytes = latin1ToUint8(str);
    return Array.from(bytes).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
}

// ── main ─────────────────────────────────────────────────────────────────

const pdfBytes = fs.readFileSync(pdfPath);
const pdfUint8 = new Uint8Array(pdfBytes);
const content = bufferToLatin1(pdfUint8);

console.log(`PDF size: ${pdfUint8.length} bytes`);
console.log('');

// Create parser and extract objects
const parser = new PDFParser();

parser.validateHeader(content);
const objects = parser.extractObjects(content);

console.log(`Total objects: ${objects.size}`);
console.log('');

// Find the first page object
const allPageObjects = Array.from(objects.values())
    .filter(obj => /\/Type\s*\/Page\b/.test(obj.dictionarySource));

const orderedPages = parser.resolvePageOrder(allPageObjects, objects) ??
    allPageObjects.sort((a, b) => a.id - b.id);

if (orderedPages.length === 0) {
    console.error('No pages found!');
    process.exit(1);
}

const firstPage = orderedPages[0];
console.log(`First page object ID: ${firstPage.id} gen ${firstPage.generation}`);
console.log('');

// ── Extract font resources for this page ─────────────────────────────────
const resourceContext = parser.extractResourceContext(firstPage, objects, content);
const fonts = resourceContext.fonts;

console.log('=== FONTS ON PAGE 1 ===');
for (const [name, resource] of fonts) {
    console.log(`  /${name}:`);
    console.log(`    subtype:       ${resource.subtype ?? '(unknown)'}`);
    console.log(`    baseFontName:  ${resource.baseFontName ?? '(none)'}`);
    console.log(`    maxCodeLength: ${resource.maxCodeLength}`);
    console.log(`    hasToUnicode:  ${resource.toUnicodeMap ? `yes (${resource.toUnicodeMap.size} entries)` : 'no'}`);
    console.log(`    hasEncoding:   ${resource.encodingMap ? `yes (${resource.encodingMap.size} entries)` : 'no'}`);
    console.log(`    hasGlyphWidths:${resource.glyphWidths ? `yes (${resource.glyphWidths.size} entries)` : 'no'}`);
    if (resource.glyphNameMap) {
        console.log(`    glyphNameMap (Differences):`);
        const sorted = [...resource.glyphNameMap.entries()].sort((a, b) => a[0] - b[0]);
        for (const [code, glyphName] of sorted) {
            console.log(`      code ${code} (0x${code.toString(16).padStart(2,'0')}) -> glyph "${glyphName}"`);
        }
    }
    if (resource.fontMatrix) {
        console.log(`    fontMatrix: [${resource.fontMatrix.join(', ')}]`);
    }
    if (resource.charProcs) {
        console.log(`    charProcs: ${resource.charProcs.size} glyphs`);
        for (const [glyphName, glyph] of resource.charProcs) {
            console.log(`      "${glyphName}": width=${glyph.width}, commands=${glyph.commands?.length ?? 0}`);
        }
    }
    if (resource.toUnicodeMap && resource.toUnicodeMap.size <= 50) {
        console.log(`    ToUnicode entries:`);
        const sorted = [...resource.toUnicodeMap.entries()].sort();
        for (const [key, value] of sorted) {
            const keyBytes = latin1ToUint8(key);
            const keyHex = Array.from(keyBytes).map(b => b.toString(16).padStart(2,'0')).join('');
            const charCodes = [];
            for (let i = 0; i < value.length; i++) {
                charCodes.push('U+' + value.charCodeAt(i).toString(16).padStart(4, '0'));
            }
            console.log(`      <${keyHex}> -> "${value}" (${charCodes.join(' ')})`);
        }
    }
    if (resource.encodingMap) {
        // Only show non-identity mappings (where the encoding differs from the raw byte)
        const nonIdentity = [];
        for (const [code, char] of resource.encodingMap) {
            if (char !== String.fromCharCode(code)) {
                nonIdentity.push([code, char]);
            }
        }
        if (nonIdentity.length > 0 && nonIdentity.length <= 60) {
            console.log(`    Non-identity encoding entries:`);
            for (const [code, char] of nonIdentity.sort((a,b) => a[0] - b[0])) {
                const charCodes = [];
                for (let i = 0; i < char.length; i++) {
                    charCodes.push('U+' + char.charCodeAt(i).toString(16).padStart(4, '0'));
                }
                console.log(`      byte 0x${code.toString(16).padStart(2,'0')} (${code}) -> "${char}" (${charCodes.join(' ')})`);
            }
        }
    }
    console.log('');
}

// ── Extract and decompress the content stream ────────────────────────────
const contentRefs = parser.extractContentRefs(firstPage.dictionarySource);
console.log(`Content stream refs: ${contentRefs.map(r => `${r.id} ${r.generation} R`).join(', ')}`);
console.log('');

for (const ref of contentRefs) {
    const key = objectKey(ref.id, ref.generation);
    const contentObject = objects.get(key);
    if (!contentObject) {
        console.log(`  Object ${ref.id} ${ref.generation} NOT FOUND`);
        continue;
    }

    console.log(`=== CONTENT STREAM: object ${ref.id} ${ref.generation} ===`);
    console.log(`  Dictionary: ${contentObject.dictionarySource.slice(0, 200)}...`);

    const streamContent = parser.resolveStreamContent(contentObject, objects, content);
    if (!streamContent) {
        console.log('  FAILED to decompress stream');
        continue;
    }

    console.log(`  Decompressed stream length: ${streamContent.length} chars`);
    console.log('');

    // ── Dump the raw decompressed content stream (first 2000 chars) ──────
    console.log('=== RAW DECOMPRESSED CONTENT STREAM (first 2000 chars) ===');
    console.log(streamContent.slice(0, 2000));
    console.log('...');
    console.log('');

    // Tokenize the entire content stream
    const tokens = tokenize(streamContent);

    // Walk through tokens to find BT..ET blocks with full operator context
    let insideBT = false;
    let currentFont = null;
    let currentFontSize = null;
    let operandStack = [];
    let textBlockIndex = 0;

    // Collect per-BT-block summaries
    const btBlocks = [];
    let currentBlock = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token.type === 'command' && token.value === 'BT') {
            insideBT = true;
            textBlockIndex++;
            operandStack = [];
            currentBlock = {
                index: textBlockIndex,
                font: currentFont,
                fontSize: currentFontSize,
                operators: [],
                glyphSequence: [],
                positions: []
            };
            continue;
        }

        if (token.type === 'command' && token.value === 'ET') {
            insideBT = false;
            if (currentBlock) {
                currentBlock.font = currentFont;
                currentBlock.fontSize = currentFontSize;
                btBlocks.push(currentBlock);
            }
            currentBlock = null;
            operandStack = [];
            continue;
        }

        if (token.type === 'number' || token.type === 'string') {
            operandStack.push(token);
            continue;
        }

        if (token.type === 'name') {
            operandStack.push(token);
            continue;
        }

        if (token.type === 'arrayStart') {
            const arr = [];
            let j = i + 1;
            while (j < tokens.length && tokens[j].type !== 'arrayEnd') {
                arr.push(tokens[j]);
                j++;
            }
            operandStack.push({ type: 'array', items: arr });
            i = j;
            continue;
        }

        if (token.type === 'command') {
            const op = token.value;

            // Track font selection (Tf operator)
            if (op === 'Tf' && operandStack.length >= 2) {
                const sizeToken = operandStack[operandStack.length - 1];
                const nameToken = operandStack[operandStack.length - 2];
                if (nameToken.type === 'name') {
                    currentFont = nameToken.value;
                }
                if (sizeToken.type === 'number') {
                    currentFontSize = sizeToken.value;
                }
            }

            // Track positioning operators for context
            if (currentBlock && (op === 'Td' || op === 'TD' || op === 'Tm' || op === 'cm')) {
                const nums = operandStack.filter(t => t.type === 'number').map(t => t.value);
                currentBlock.positions.push({ op, values: nums });
            }

            // Text-showing operators
            if (op === 'Tj' || op === "'" || op === '"') {
                const strToken = operandStack[operandStack.length - 1];
                if (strToken && strToken.type === 'string') {
                    const rawStr = strToken.value;
                    const bytes = latin1ToUint8(rawStr);

                    console.log(`  [BT block #${textBlockIndex}] font=/${currentFont} size=${currentFontSize}`);
                    console.log(`    operator: ${op}`);
                    console.log(`    raw bytes (${bytes.length}): ${hexDump(rawStr)}`);
                    console.log(`    printable: ${printableAscii(rawStr)}`);
                    console.log(`    byte values: [${Array.from(bytes).join(', ')}]`);

                    // Decode using font resources
                    if (currentFont && fonts.has(currentFont)) {
                        const font = fonts.get(currentFont);
                        const decoded = [];
                        if (font.toUnicodeMap && font.toUnicodeMap.size > 0) {
                            const maxLen = Math.max(1, font.maxCodeLength);
                            for (let bi = 0; bi < bytes.length;) {
                                let matched = false;
                                const available = bytes.length - bi;
                                for (let len = Math.min(maxLen, available); len > 0; len--) {
                                    let keyStr = '';
                                    for (let k = bi; k < bi + len; k++) {
                                        keyStr += String.fromCharCode(bytes[k]);
                                    }
                                    const mapped = font.toUnicodeMap.get(keyStr);
                                    if (mapped !== undefined) {
                                        decoded.push(`0x${bytes[bi].toString(16).padStart(2,'0')}->"${mapped}"`);
                                        bi += len;
                                        matched = true;
                                        break;
                                    }
                                }
                                if (!matched) {
                                    decoded.push(`0x${bytes[bi].toString(16).padStart(2,'0')}->(unmapped)`);
                                    bi++;
                                }
                            }
                            console.log(`    ToUnicode decoded: ${decoded.join(' ')}`);
                        } else if (font.encodingMap) {
                            for (const b of bytes) {
                                const mapped = font.encodingMap.get(b & 0xff);
                                if (mapped !== undefined && mapped !== String.fromCharCode(b)) {
                                    decoded.push(`0x${b.toString(16).padStart(2,'0')}->"${mapped}"`);
                                } else {
                                    decoded.push(`0x${b.toString(16).padStart(2,'0')}->"${String.fromCharCode(b)}"`);
                                }
                            }
                            console.log(`    Encoding decoded: ${decoded.join(' ')}`);
                        }
                        if (font.glyphNameMap) {
                            const glyphNames = [];
                            for (const b of bytes) {
                                const name = font.glyphNameMap.get(b & 0xff);
                                glyphNames.push(`0x${b.toString(16).padStart(2,'0')}->glyph:"${name ?? '(none)'}"`);
                            }
                            console.log(`    Glyph names:   ${glyphNames.join(' ')}`);
                            // Add to block summary
                            if (currentBlock) {
                                for (const b of bytes) {
                                    const name = font.glyphNameMap.get(b & 0xff);
                                    currentBlock.glyphSequence.push({ byte: b, glyphName: name ?? '?' });
                                }
                            }
                        }
                    }
                    console.log('');
                }
            }

            if (op === 'TJ') {
                const arrToken = operandStack[operandStack.length - 1];
                if (arrToken && arrToken.type === 'array') {
                    console.log(`  [BT block #${textBlockIndex}] font=/${currentFont} size=${currentFontSize}`);
                    console.log(`    operator: TJ (array with ${arrToken.items.length} elements)`);

                    let fullRawStr = '';
                    for (const item of arrToken.items) {
                        if (item.type === 'string') {
                            fullRawStr += item.value;
                            const bytes = latin1ToUint8(item.value);
                            console.log(`    string element: hex=[${hexDump(item.value)}] printable=[${printableAscii(item.value)}] bytes=[${Array.from(bytes).join(',')}]`);
                        } else if (item.type === 'number') {
                            console.log(`    number element: ${item.value} (kerning adjustment)`);
                        }
                    }

                    if (currentFont && fonts.has(currentFont) && fullRawStr.length > 0) {
                        const font = fonts.get(currentFont);
                        const bytes = latin1ToUint8(fullRawStr);
                        const decoded = [];

                        if (font.toUnicodeMap && font.toUnicodeMap.size > 0) {
                            const maxLen = Math.max(1, font.maxCodeLength);
                            for (let bi = 0; bi < bytes.length;) {
                                let matched = false;
                                const available = bytes.length - bi;
                                for (let len = Math.min(maxLen, available); len > 0; len--) {
                                    let keyStr = '';
                                    for (let k = bi; k < bi + len; k++) {
                                        keyStr += String.fromCharCode(bytes[k]);
                                    }
                                    const mapped = font.toUnicodeMap.get(keyStr);
                                    if (mapped !== undefined) {
                                        decoded.push(mapped);
                                        bi += len;
                                        matched = true;
                                        break;
                                    }
                                }
                                if (!matched) {
                                    decoded.push(`[0x${bytes[bi].toString(16).padStart(2,'0')}?]`);
                                    bi++;
                                }
                            }
                            console.log(`    Full decoded text: "${decoded.join('')}"`);
                        } else if (font.encodingMap) {
                            for (const b of bytes) {
                                const mapped = font.encodingMap.get(b & 0xff);
                                decoded.push(mapped ?? String.fromCharCode(b));
                            }
                            console.log(`    Full decoded text: "${decoded.join('')}"`);
                        }

                        if (font.glyphNameMap) {
                            const glyphNames = [];
                            for (const b of bytes) {
                                const name = font.glyphNameMap.get(b & 0xff);
                                glyphNames.push(`0x${b.toString(16).padStart(2,'0')}->"${name ?? '?'}"`);
                            }
                            console.log(`    Glyph names:   ${glyphNames.join(' ')}`);
                            if (currentBlock) {
                                for (const b of bytes) {
                                    const name = font.glyphNameMap.get(b & 0xff);
                                    currentBlock.glyphSequence.push({ byte: b, glyphName: name ?? '?' });
                                }
                            }
                        }
                    }
                    console.log('');
                }
            }

            operandStack = [];
        }
    }

    // ── SUMMARY: Reconstruct text per BT block using glyph names ─────────
    console.log('');
    console.log('========================================================');
    console.log('=== SUMMARY: BT BLOCKS WITH GLYPH NAME RECONSTRUCTION ===');
    console.log('========================================================');
    console.log('');

    for (const block of btBlocks) {
        const glyphStr = block.glyphSequence.map(g => g.glyphName).join(', ');
        const byteStr = block.glyphSequence.map(g => '0x' + g.byte.toString(16).padStart(2, '0')).join(' ');
        const posStr = block.positions.map(p => `${p.op}(${p.values.join(',')})`).join(' ');

        console.log(`  BT block #${block.index}  font=/${block.font}  size=${block.fontSize}`);
        if (posStr) {
            console.log(`    positioning: ${posStr}`);
        }
        console.log(`    raw bytes:   ${byteStr}`);
        console.log(`    glyph names: [${glyphStr}]`);
        console.log('');
    }

    // ── Show the font object's actual dictionary for T1 ─────────────────
    console.log('');
    console.log('=== T1 FONT OBJECT DICTIONARY (raw) ===');
    // Find the T1 font object
    const fontSection = firstPage.dictionarySource.match(/\/Font\s*<<([\s\S]*?)>>/);
    if (fontSection) {
        const t1Match = fontSection[1].match(/\/T1\s+(\d+)\s+(\d+)\s+R/);
        if (t1Match) {
            const fontKey = objectKey(Number(t1Match[1]), Number(t1Match[2]));
            const fontObj = objects.get(fontKey);
            if (fontObj) {
                console.log(`  Object ${fontObj.id} ${fontObj.generation}:`);
                console.log(fontObj.dictionarySource);
                console.log('');

                // Also look for the Encoding object
                const encRef = fontObj.dictionarySource.match(/\/Encoding\s+(\d+)\s+(\d+)\s+R/);
                if (encRef) {
                    const encKey = objectKey(Number(encRef[1]), Number(encRef[2]));
                    const encObj = objects.get(encKey);
                    if (encObj) {
                        console.log(`  Encoding object ${encObj.id} ${encObj.generation}:`);
                        console.log(encObj.dictionarySource);
                    }
                }
            }
        }
    }
    // If not found in page dict, check via Resources reference
    if (!fontSection) {
        const resourceRef = firstPage.dictionarySource.match(/\/Resources\s+(\d+)\s+(\d+)\s+R/);
        if (resourceRef) {
            const resKey = objectKey(Number(resourceRef[1]), Number(resourceRef[2]));
            const resObj = objects.get(resKey);
            if (resObj) {
                console.log('  Resources object:');
                console.log(resObj.dictionarySource.slice(0, 500));
                const fontSec2 = resObj.dictionarySource.match(/\/Font\s*<<([\s\S]*?)>>/);
                if (fontSec2) {
                    const t1Match2 = fontSec2[1].match(/\/T1\s+(\d+)\s+(\d+)\s+R/);
                    if (t1Match2) {
                        const fontKey = objectKey(Number(t1Match2[1]), Number(t1Match2[2]));
                        const fontObj = objects.get(fontKey);
                        if (fontObj) {
                            console.log(`\n  T1 Font Object ${fontObj.id} ${fontObj.generation}:`);
                            console.log(fontObj.dictionarySource);

                            const encRef = fontObj.dictionarySource.match(/\/Encoding\s+(\d+)\s+(\d+)\s+R/);
                            if (encRef) {
                                const encKey = objectKey(Number(encRef[1]), Number(encRef[2]));
                                const encObj = objects.get(encKey);
                                if (encObj) {
                                    console.log(`\n  Encoding object ${encObj.id} ${encObj.generation}:`);
                                    console.log(encObj.dictionarySource);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Also show what the parser extracts for page 1 text ──────────────────
console.log('\n=== PARSER TEXT OUTPUT FOR PAGE 1 ===');
const { PDFDocument } = await import('./dist/pdfDocument.js');
const pdfDoc = PDFDocument.from(pdfUint8);
const page1 = pdfDoc.getPage(1);
if (page1) {
    console.log(`Page 1: ${page1.textItems.length} text items`);
    // Show first 30 text items
    for (const item of page1.textItems.slice(0, 30)) {
        console.log(`  text="${item.text}" x=${item.x?.toFixed(1)} y=${item.y?.toFixed(1)} fontSize=${item.fontSize?.toFixed(1)} font=${item.fontFamily ?? ''}`);
    }
}
