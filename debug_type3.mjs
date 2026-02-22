import { readFileSync } from 'fs';
import { PDFDocument } from './dist/pdfDocument.js';

const buffer = readFileSync("pdfs/Leadership, Trust, And AI_ Dan Durn\u2019s Journey As Adobe\u2019s CFO.pdf");
const doc = PDFDocument.from(buffer, { smoothText: false });
const page = doc.pages[0];

// Check for glyph "0" items
const withGlyph0 = page.textItems.filter(i => i.type3Glyphs?.some(g => g.glyphName === '0'));
console.log('Items using glyph "0":', withGlyph0.length);
if (withGlyph0.length > 0) {
  console.log('  First:', JSON.stringify(withGlyph0[0].text), 'at x=', withGlyph0[0].bounds.minX.toFixed(1));
}

// Show all header items sorted by x
const header = page.textItems.filter(i => i.bounds.maxY > 760);
header.sort((a, b) => a.bounds.minX - b.bounds.minX);
console.log('\nHeader items:', header.length);

const expected = "2/10/25, 7:55 PM";
let expIdx = 0;
for (const item of header.slice(0, 20)) {
  const g = item.type3Glyphs?.[0];
  const expChar = expIdx < expected.length ? expected[expIdx] : '?';
  if (expChar === ' ') expIdx++; // skip spaces in expected
  const expChar2 = expIdx < expected.length ? expected[expIdx] : '?';
  console.log(`  x=${item.bounds.minX.toFixed(1).padEnd(7)} glyph="${(g?.glyphName ?? 'none').padEnd(5)}" cmds=${String(g?.pathCommands.length ?? 0).padEnd(3)} expected="${expChar2}" text=${JSON.stringify(item.text)}`);
  expIdx++;
}

// Show footer items
const footer = page.textItems.filter(i => i.bounds.minY < 30);
footer.sort((a, b) => a.bounds.minX - b.bounds.minX);
console.log('\nFooter items:', footer.length);
for (const item of footer.slice(0, 20)) {
  const g = item.type3Glyphs?.[0];
  console.log(`  x=${item.bounds.minX.toFixed(1).padEnd(7)} glyph="${(g?.glyphName ?? 'none').padEnd(5)}" cmds=${String(g?.pathCommands.length ?? 0).padEnd(3)} text=${JSON.stringify(item.text)}`);
}

// Verify all glyph names have commands
const allGlyphs = new Map();
for (const item of page.textItems) {
  if (item.type3Glyphs) {
    for (const g of item.type3Glyphs) {
      if (!allGlyphs.has(g.glyphName)) {
        allGlyphs.set(g.glyphName, g.pathCommands.length);
      }
    }
  }
}
console.log('\nAll glyph names and command counts:');
for (const [name, count] of [...allGlyphs.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric: true}))) {
  console.log(`  "${name}": ${count} commands${count === 0 ? ' *** EMPTY ***' : ''}`);
}
