import { readFileSync, writeFileSync } from 'fs';
import { PDFDocument } from './dist/pdfDocument.js';

const buffer = readFileSync("pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf");
const doc = PDFDocument.from(buffer); // with smoothing
const page = doc.pages[0];

// Get ALL Type3 items from header and title
const allType3 = page.textItems.filter(i => i.bounds.maxY > 760 && i.type3Glyphs?.length > 0);
allType3.sort((a, b) => a.bounds.minX - b.bounds.minX);

// Generate SVG
const scale = 3;
const baseMinX = allType3[0]?.bounds.minX || 0;
const maxX = allType3[allType3.length - 1]?.bounds.maxX || 600;
const svgWidth = (maxX - baseMinX + 20) * scale;
const svgHeight = 20 * scale;

let svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${svgWidth}' height='${svgHeight}' viewBox='0 0 ${svgWidth} ${svgHeight}'>\n`;
svg += `<rect width='100%' height='100%' fill='white'/>\n`;

for (const item of allType3) {
  if (!item.type3Glyphs || item.type3Glyphs.length === 0) continue;

  const bw = item.bounds.maxX - item.bounds.minX;
  const bh = item.bounds.maxY - item.bounds.minY;
  if (bh <= 0) continue;

  // Match canvas renderer logic exactly
  const glyphScale = bh * scale;
  const advancePerGlyph = item.type3Glyphs.length > 0 ? (bw * scale) / item.type3Glyphs.length : 0;

  const baselineRatio = 0.2;
  const rx = (item.bounds.minX - baseMinX) * scale;
  const ry = 2 * scale; // top padding
  const originY = ry + bh * scale - bh * baselineRatio * scale;

  let cursorX = 0;
  for (const glyph of item.type3Glyphs) {
    if (glyph.pathCommands.length === 0) {
      cursorX += advancePerGlyph;
      continue;
    }

    let path = '';
    for (const cmd of glyph.pathCommands) {
      const tx = rx + cursorX;
      const ty = originY;
      switch (cmd.op) {
        case 'M': path += `M ${tx + cmd.x * glyphScale} ${ty - cmd.y * glyphScale} `; break;
        case 'L': path += `L ${tx + cmd.x * glyphScale} ${ty - cmd.y * glyphScale} `; break;
        case 'C': path += `C ${tx + cmd.x1 * glyphScale} ${ty - cmd.y1 * glyphScale} ${tx + cmd.x2 * glyphScale} ${ty - cmd.y2 * glyphScale} ${tx + cmd.x3 * glyphScale} ${ty - cmd.y3 * glyphScale} `; break;
        case 'Z': path += 'Z '; break;
        case 're': path += `M ${tx + cmd.x * glyphScale} ${ty - cmd.y * glyphScale} h ${cmd.w * glyphScale} v ${-cmd.h * glyphScale} h ${-cmd.w * glyphScale} Z `; break;
        default: break;
      }
    }
    if (path) {
      svg += `<path d='${path}' fill='black'/>\n`;
    }

    cursorX += advancePerGlyph;
  }
}

svg += '</svg>';
writeFileSync('debug_type3_glyphs.svg', svg);
console.log('Wrote debug_type3_glyphs.svg');
console.log(`Items rendered: ${allType3.length}`);
