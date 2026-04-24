/**
 * fix-encoding.js
 * Repairs UTF-8 mojibake in App.tsx caused by:
 *   original UTF-8 bytes → misread as Windows-1252 → re-saved as UTF-8
 *
 * Fix: for every character in the file that can be mapped back to a CP1252 byte,
 * collect the raw bytes and re-decode as UTF-8, restoring the original Unicode text.
 */
const fs = require('fs');
const path = require('path');

// Windows-1252 special characters (0x80-0x9F) → Unicode code point mapping
const cp1252ToUnicode = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178,
};

// Reverse: Unicode code point → CP1252 byte
const unicodeToCp1252Byte = {};
for (const [byte, uni] of Object.entries(cp1252ToUnicode)) {
  unicodeToCp1252Byte[uni] = parseInt(byte);
}
// Latin-1 supplement 0xA0-0xFF maps directly to its code point
for (let i = 0xA0; i <= 0xFF; i++) unicodeToCp1252Byte[i] = i;
// C1 control characters 0x80-0x9F that are undefined in CP1252 map to their byte value directly
// (e.g. U+008D = 0x8D, used for Kannada virama third byte E0 B3 8D = ್)
for (let i = 0x80; i <= 0x9F; i++) {
  if (unicodeToCp1252Byte[i] === undefined) unicodeToCp1252Byte[i] = i;
}

function fixMojibake(content) {
  // Walk codepoints; accumulate bytes for chars that are CP1252-encodable,
  // flush through Buffer.toString('utf8') to recover the original text.
  let fixed = '';
  const byteBuffer = [];

  const flush = () => {
    if (byteBuffer.length === 0) return;
    // Try decoding as UTF-8; if invalid, fall back to latin1 as-is
    const decoded = Buffer.from(byteBuffer).toString('utf8');
    fixed += decoded;
    byteBuffer.length = 0;
  };

  const chars = [...content]; // iterate by Unicode code point
  for (const ch of chars) {
    const cp = ch.codePointAt(0);

    if (cp <= 0x7F) {
      // Plain ASCII — flush any pending bytes first, then append directly
      flush();
      fixed += ch;
    } else if (unicodeToCp1252Byte[cp] !== undefined) {
      // This character has a CP1252 byte equivalent — it's part of the mojibake
      byteBuffer.push(unicodeToCp1252Byte[cp]);
    } else {
      // True Unicode character outside CP1252 range — keep as-is
      flush();
      fixed += ch;
    }
  }
  flush();
  return fixed;
}

const filePath = path.resolve(__dirname, '../App.tsx');
console.log(`Reading: ${filePath}`);
const original = fs.readFileSync(filePath, 'utf8');

// Backup
const backupPath = filePath + '.bak';
fs.writeFileSync(backupPath, original, 'utf8');
console.log(`Backup saved to: ${backupPath}`);

const fixed = fixMojibake(original);

// Quick sanity check – count Kannada characters in fixed output
const kannadaCount = (fixed.match(/[\u0C80-\u0CFF]/g) || []).length;
console.log(`Kannada characters found after fix: ${kannadaCount}`);

if (kannadaCount < 10) {
  console.error('ERROR: Too few Kannada characters found after fix. Aborting – original file unchanged.');
  process.exit(1);
}

fs.writeFileSync(filePath, fixed, 'utf8');
console.log('Done! App.tsx encoding repaired.');

// Show a before/after sample
const sampleBefore = original.slice(original.indexOf("à²¸à²¾à²ªà³à²¤"), original.indexOf("à²¸à²¾à²ªà³à²¤") + 30);
const sampleAfter  = fixed.slice(fixed.indexOf('ಸಾಪ್') !== -1 ? fixed.indexOf('ಸಾಪ್') : 0, (fixed.indexOf('ಸಾಪ್') || 0) + 20);
if (sampleBefore) console.log(`\nSample BEFORE: ${sampleBefore}`);
if (sampleAfter)  console.log(`Sample AFTER:  ${sampleAfter}`);
