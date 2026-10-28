// Checks the Opening Trainer repertoires (main/game/opening-repertoires.js):
// every line replays legally and ends on your move, each position where it's
// your move has exactly one repertoire move, ids are unique, and none of your
// moves is an engine-judged blunder.
const fs = require('fs');
const path = require('path');
const { GAME_DIR, loadEngine, makeChecker } = require('./lib');

const { run } = loadEngine();
run(fs.readFileSync(path.join(GAME_DIR, 'opening-repertoires.js'), 'utf8') + '\n;globalThis.__reps = OPENING_REPERTOIRES;');
const reps = run('__reps');
const t = makeChecker();
const MAX_LOSS = 150; // cp the engine may prefer another move by

const ids = new Set();
let lineCount = 0;
for (const rep of reps) {
    const lines = rep.lines.map(l => ({ ...l, moves: run(`parseOpeningLine(${JSON.stringify(l.moves)})`).map(m => m.san) }));
    const userParity = rep.color === 'white' ? 0 : 1;
    const problems = [];
    const choice = new Map(); // position prefix where it's your move -> your move
    for (const l of lines) {
        lineCount++;
        if (ids.has(l.id)) problems.push(`${l.id}: duplicate id`);
        ids.add(l.id);
        if (l.moves[0] !== rep.first) problems.push(`${l.id}: starts with ${l.moves[0]}, not ${rep.first}`);
        const applied = run(`replaySANFromStart(${JSON.stringify(l.moves)})`);
        if (applied !== l.moves.length) { problems.push(`${l.id}: illegal move ${l.moves[applied]} (ply ${applied + 1})`); continue; }
        if ((l.moves.length - 1) % 2 !== userParity) problems.push(`${l.id}: ends on the opponent's move`);
        l.moves.forEach((san, i) => {
            if (i % 2 !== userParity) return;
            const key = l.moves.slice(0, i).join(' ');
            if (choice.has(key) && choice.get(key) !== san) problems.push(`${l.id}: ${san} vs ${choice.get(key)} after "${key}"`);
            choice.set(key, san);
        });
        for (const o of lines) if (o !== l && o.moves.length > l.moves.length && l.moves.every((s, i) => o.moves[i] === s)) problems.push(`${l.id} is a prefix of ${o.id}`);
    }
    t.check(problems.length === 0, `${rep.name}: ${lines.length} lines legal and consistent${problems.length ? ' — ' + problems.join('; ') : ''}`);

    // Engine check of every distinct position where it's your move.
    const losses = [];
    for (const [key, san] of choice) {
        const prefix = key ? key.split(' ') : [];
        const r = run(`(() => {
            replaySANFromStart(${JSON.stringify(prefix)});
            const m = resolveSAN(currentTurn, ${JSON.stringify(san)});
            const res = searchRoot(currentTurn, { timeMs: 600, maxDepth: 14, contempt: 0, includeMove: m.move, includePromo: m.promo, withLines: true });
            return { loss: res.score - res.includedScore, best: res.lines[0] && res.lines[0].san };
        })()`);
        if (r.loss > MAX_LOSS) losses.push(`${san} after "${key}" (-${r.loss}, engine: ${r.best})`);
    }
    t.check(losses.length === 0, `${rep.name}: no move of yours loses over ${MAX_LOSS} cp${losses.length ? ' — ' + losses.join('; ') : ''}`);
}
t.check(lineCount >= 20, `${lineCount} lines in ${reps.length} repertoires`);

// repertoireCheck(): the review page's "where did the game leave my repertoire" note.
const it1 = run(`parseOpeningLine(OPENING_REPERTOIRES[0].lines[0].moves).map(m => m.san)`);
const cases = [
    ['a whole line played', it1.concat(['h6']), 'white', { kind: 'end', rep: 'italian', line: 'it1' }],
    ['you deviate', ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'white', { kind: 'you', rep: 'italian', ply: 4, expected: 'Bc4', line: true }],
    ['the opponent deviates', ['e4', 'c5', 'Nf3'], 'white', { kind: 'opponent', rep: 'italian', ply: 1 }],
    ['no repertoire on move 1', ['c4', 'e5'], 'white', { kind: 'you', rep: null, ply: 0, expected: 'e4,d4' }],
    ['the game ends inside', ['e4', 'c6', 'd4', 'd5'], 'black', { kind: 'inside', rep: 'caro' }],
    ['black deviates on move 1', ['e4', 'e5'], 'black', { kind: 'you', rep: 'caro', ply: 1, expected: 'c6' }],
    ['checks and annotations ignored', ['d4', 'd5', 'c4+', 'e6!'], 'black', { kind: 'inside', rep: 'qgd' }],
];
for (const [label, moves, color, want] of cases) {
    const r = run(`(() => { const r = repertoireCheck(${JSON.stringify(moves)}, ${JSON.stringify(color)});
        return r && { kind: r.kind, rep: r.rep && r.rep.id, ply: r.ply, expected: r.expected.join(','), line: r.line && r.line.id }; })()`);
    const ok = r && Object.entries(want).every(([k, v]) => (v === true ? !!r[k] : r[k] === v));
    t.check(ok, `repertoireCheck: ${label} (${JSON.stringify(r)})`);
}
t.done('openings');
