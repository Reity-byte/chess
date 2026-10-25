// Prepares a release of the site in main/:
//   1. bumps the cache-busting number (?v=N -> ?v=N+1) in every HTML and JS file,
//      so browsers fetch the new CSS/JS instead of reusing cached copies;
//   2. writes main/precache.js, the list of every file the offline app (sw.js)
//      caches on install — with the new ?v= on CSS and JS, as the pages ask for them.
//
//   npm run release            bump and regenerate
//   npm run release -- --keep  regenerate the list without bumping
const fs = require('fs');
const path = require('path');

const MAIN = path.resolve(__dirname, '..', 'main');
const keep = process.argv.includes('--keep');

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
        const full = path.join(dir, d.name);
        return d.isDirectory() ? walk(full) : [full];
    });
}

const files = walk(MAIN).map(f => path.relative(MAIN, f).split(path.sep).join('/'));
const sources = files.filter(f => /\.(html|js)$/.test(f) && f !== 'precache.js');

// The current release number: the highest ?v= in use.
let version = 0;
for (const f of sources) {
    for (const m of fs.readFileSync(path.join(MAIN, f), 'utf8').matchAll(/\?v=(\d+)/g)) version = Math.max(version, +m[1]);
}
const next = keep ? version : version + 1;

if (!keep) {
    let changed = 0;
    for (const f of sources) {
        const full = path.join(MAIN, f);
        const src = fs.readFileSync(full, 'utf8');
        const out = src.replace(/\?v=\d+\b/g, `?v=${next}`);
        if (out !== src) { fs.writeFileSync(full, out); changed++; }
    }
    console.log(`?v=${version} -> ?v=${next} in ${changed} files`);
}

// Everything the site needs offline. Pages are listed bare (navigations ignore
// the query); CSS and JS with the release number; images and the rest as-is.
const offline = files
    .filter(f => !/\.md$/.test(f) && f !== 'sw.js')
    .sort()
    .map(f => (/\.(css|js)$/.test(f) ? `${f}?v=${next}` : f));
fs.writeFileSync(path.join(MAIN, 'precache.js'),
    '// Written by tools/release.js — every file the offline app caches. Do not edit by hand.\n'
    + `const PRECACHE_VERSION = ${next};\n`
    + `const PRECACHE = ${JSON.stringify(offline, null, 4)};\n`);
console.log(`precache.js: ${offline.length} files, release ${next}`);
