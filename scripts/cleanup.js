const fs = require('fs');
let c = fs.readFileSync('App.tsx', 'utf8');
const before = c.split('\n').length;

// 1. Remove FsPaths from import
c = c.replace(', Paths as FsPaths', '');

// 2. Remove buildFilter function + surrounding comments
c = c.replace(/\n\n\/\/ ── Multi-layer filter builder ──[^\n]*\n\/\/[^\n]*\n\/\/[^\n]*\nconst buildFilter[\s\S]*?\};\n/, '\n');

// 3. Remove PREMIUM_FILTER_IDS block
c = c.replace(/\nconst PREMIUM_FILTER_IDS[\s\S]*?\);\n/, '\n');

// 4. Remove FILM_STOCK_FILTERS block (comment + array)
c = c.replace(/\n\/\/ Cinematic Film Stock Presets[\s\S]*?\n\];\n/, '\n');

// 5. Remove CLOUD_PREMIUM_FILTERS_URL line
c = c.replace(/\nconst CLOUD_PREMIUM_FILTERS_URL = '[^']*';\n/, '\n');

// 6. Remove cloudPremiumFilters useState line
c = c.replace(/\n  const \[cloudPremiumFilters, setCloudPremiumFilters\] = useState<typeof FILTERS>\(\[\]\);\n/, '\n');

// 7. Remove entire cachedFetch CLOUD_PREMIUM block
const fetchStart = c.indexOf("cachedFetch(CLOUD_PREMIUM_FILTERS_URL, '@cache_premium_filters'");
if (fetchStart !== -1) {
  // Find the preceding newline+spaces
  let blockStart = fetchStart;
  while (blockStart > 0 && c[blockStart-1] !== '\n') blockStart--;
  // Find the closing '}),\n'
  let depth = 0;
  let pos = fetchStart;
  let blockEnd = -1;
  while (pos < c.length) {
    if (c[pos] === '{') depth++;
    if (c[pos] === '}') { depth--; if (depth === 0) { blockEnd = pos; break; } }
    pos++;
  }
  if (blockEnd !== -1) {
    // eat '),\n'
    let end = blockEnd + 1;
    while (end < c.length && (c[end] === ')' || c[end] === ',' || c[end] === '\n')) { end++; break; }
    // find next newline
    end = c.indexOf('\n', blockEnd) + 1;
    c = c.substring(0, blockStart) + c.substring(end);
  }
}

// 8. Simplify allFilters useMemo body
c = c.replace(
  /const freeFilters\s+=\s+cloudFreeFilters\.length > 0\s+\? cloudFreeFilters\s+: FILTERS\.filter\(f => !f\.id\.startsWith\('pro_'\) && f\.id !== 'none'\)\.concat\(FILTERS\.filter\(f => f\.id === 'none'\)\);\s+const proFilters\s+=\s+cloudProFilters\.length > 0\s+\? cloudProFilters\s+: \(cloudPremiumFilters\.length > 0 \? cloudPremiumFilters : FILTERS\.filter\(f => f\.id\.startsWith\('pro_'\)\)\);\s+const noneFilter\s+=.*?;\s+const freeWithoutNone = freeFilters\.filter\(f => f\.id !== 'none'\);\s+return \[\.\.\.noneFilter, \.\.\.freeWithoutNone, \.\.\.proFilters, \.\.\.FILM_STOCK_FILTERS\];/s,
  `const freeFilters = cloudFreeFilters.length > 0 ? cloudFreeFilters : FILTERS.filter(f => !f.id.startsWith('pro_'));
    const proFilters  = cloudProFilters.length > 0  ? cloudProFilters  : FILTERS.filter(f => f.id.startsWith('pro_'));
    return [...freeFilters, ...proFilters];`
);

// 9. Fix allFilters deps
c = c.replace('}, [cloudFreeFilters, cloudProFilters, cloudPremiumFilters]);', '}, [cloudFreeFilters, cloudProFilters]);');

// 10. Fix allPremiumFilterIds body  
c = c.replace(
  /const proSource = cloudProFilters\.length > 0 \? cloudProFilters : \(cloudPremiumFilters\.length > 0 \? cloudPremiumFilters : FILTERS\.filter\(f => f\.id\.startsWith\('pro_'\)\)\);[\s\S]*?FILM_STOCK_FILTERS\.forEach\(f => ids\.add\(f\.id\)\);/,
  `const proSource = cloudProFilters.length > 0 ? cloudProFilters : FILTERS.filter(f => f.id.startsWith('pro_'));
    const ids = new Set(proSource.map(f => f.id));`
);

// 11. Fix allPremiumFilterIds deps
c = c.replace('}, [cloudProFilters, cloudPremiumFilters]);', '}, [cloudProFilters]);');

fs.writeFileSync('App.tsx', c, 'utf8');
const after = c.split('\n').length;
console.log(`Done. ${before} -> ${after} lines (removed ${before - after})`);

// Verify nothing remains
const checks = ['FILM_STOCK_FILTERS','cloudPremiumFilters','PREMIUM_FILTER_IDS','CLOUD_PREMIUM_FILTERS_URL','buildFilter','FsPaths'];
checks.forEach(k => {
  const n = (c.match(new RegExp(k,'g')) || []).length;
  console.log(k + ': ' + n + ' refs' + (n > 0 ? ' ⚠️' : ' ✓'));
});
