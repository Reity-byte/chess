// Checks the generated puzzle library (main/game/puzzle-library.js): every
// prefix and solution replays legally, the solver is the side after the
// prefix, mate puzzles end in checkmate, ids are unique and ratings ordered.
const fs = require('fs');
const path = require('path');
const { GAME_DIR, loadEngine, makeChecker } = require('./lib');

const { run } = loadEngine();
run(fs.readFileSync(path.join(GAME_DIR, 'puzzle-library.js'), 'utf8') + '\n;globalThis.__lib = PUZZLE_LIBRARY;');
const lib = run('__lib');
const t = makeChecker();

t.check(lib.length >= 100, `library has ${lib.length} puzzles`);
t.check(new Set(lib.map(p => p.id)).size === lib.length, 'ids are unique');
t.check(lib.every((p, i) => i === 0 || p.rating >= lib[i - 1].rating), 'sorted by rating');

const bad = [];
for (const p of lib) {
    const prefix = p.prefix.split(' '), solution = p.solution.split(' ');
    const ok = run(`(() => {
        const prefix = ${JSON.stringify(prefix)}, solution = ${JSON.stringify(solution)};
        if (replaySANFromStart(prefix) !== prefix.length) return 'prefix';
        const all = prefix.concat(solution);
        if (replaySANFromStart(all) !== all.length) return 'solution';
        if (solution.length % 2 === 0) return 'ends on a reply';
        const status = getGameStatus();
        if (${p.themes.includes('mate')} && !(status && status.reason === 'checkmate')) return 'no mate';
        if (status && status.result === '1/2-1/2') return 'draw';
        return true;
    })()`);
    if (ok !== true) bad.push(`${p.id}: ${ok}`);
}
t.check(bad.length === 0, `every puzzle replays${bad.length ? ' — ' + bad.slice(0, 5).join(', ') : ''}`);

const themes = {};
for (const p of lib) for (const th of p.themes) themes[th] = (themes[th] || 0) + 1;
t.check((themes.mate || 0) >= 20 && (themes.fork || 0) >= 10, `theme spread: ${JSON.stringify(themes)}`);
t.done('puzzles');
