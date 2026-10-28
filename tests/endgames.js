// Checks the Endgame Trainer (main/game/endgame-lessons.js, endgame-tables.js):
// every lesson loads and is legal, its goal is really reachable (3-piece
// endings exactly by the solver in tools/endgame-tables.js, the rest by the
// engine), every par is right, and the browser's K+P bitbase agrees with the
// solver.
const fs = require('fs');
const path = require('path');
const { GAME_DIR, loadEngine, makeChecker } = require('./lib');
const tables = require('../tools/endgame-tables');

const { ctx, run } = loadEngine(GAME_DIR, ['engine.js', 'ai.js', 'notation.js', 'endgame-lessons.js', 'endgame-tables.js']);
ctx.atob = atob;
run('globalThis.__lessons = ENDGAME_LESSONS; globalThis.__chapters = ENDGAME_CHAPTERS;');
const lessons = run('__lessons'), chapters = run('__chapters');
const t = makeChecker();

const ids = new Set();
for (const l of lessons) {
    const problems = [];
    if (ids.has(l.id)) problems.push('duplicate id');
    ids.add(l.id);
    if (!chapters.some(c => c.id === l.chapter)) problems.push(`unknown chapter ${l.chapter}`);
    if (!['mate', 'promote', 'draw'].includes(l.goal)) problems.push(`unknown goal ${l.goal}`);
    if (l.goal === 'draw' && !(l.hold > 0)) problems.push('a draw lesson needs hold');
    if (!run(`loadFEN(${JSON.stringify(l.fen)})`)) { t.check(false, `${l.id}: FEN loads`); continue; }
    const other = run('currentTurn === "white" ? "black" : "white"');
    if (run(`isInCheck(${JSON.stringify(other)})`)) problems.push('the side not to move is in check');
    if (!run('hasAnyLegalMove(currentTurn)')) problems.push('no legal move');
    if (!l.intro || !l.tip) problems.push('missing intro or tip');
    t.check(problems.length === 0, `${l.id}: legal lesson${problems.length ? ' — ' + problems.join('; ') : ''}`);

    const plies = tables.probe(l.fen);
    if (plies !== null) {
        // 3-piece ending: exact verdict.
        const pos = tables.fromFEN(l.fen);
        const userStrong = pos.stm === 0;
        if (l.goal === 'draw') t.check(!userStrong && plies === -1, `${l.id}: drawn with best defence (solver)`);
        else t.check(userStrong && plies >= 0, `${l.id}: won for you (solver, mate in ${Math.ceil(plies / 2)})`);
        if (l.goal === 'mate') t.check(l.par === Math.ceil(plies / 2), `${l.id}: par ${l.par} = exact mate in ${Math.ceil(plies / 2)}`);
        if (pos.type === 'P') t.check(run(`kpkWins(gameState, currentTurn)`) === (plies >= 0), `${l.id}: browser bitbase agrees`);
        continue;
    }
    // Bigger endings: the engine's verdict from the side to move. Theory it
    // can't see to the end (Lucena, Philidor) reads as "a pawn up", so: a win
    // must score clearly better, a draw must not be a decisive loss.
    run('clearSearchMemory()');
    const r = run('(() => { const r = searchRoot(currentTurn, { timeMs: 6000, maxDepth: 64, contempt: 0 }); return { score: r.score, depth: r.depth }; })()');
    const mateIn = r.score >= 99000 ? Math.ceil((100000 - r.score) / 2) : null;
    if (l.goal === 'draw') t.check(r.score > -400, `${l.id}: engine finds no win against you (${r.score} cp, depth ${r.depth})`);
    else t.check(r.score > 250, `${l.id}: engine sees a win (${mateIn ? 'mate in ' + mateIn : r.score + ' cp'}, depth ${r.depth})`);
    if (l.par) t.check(mateIn === l.par, `${l.id}: par ${l.par} = engine's forced mate in ${mateIn}`);

    // The textbook line: legal, and none of your moves in it gives the opponent
    // a decisive advantage; a 'promote' line ends with the promotion in sight.
    if (l.line) {
        const line = l.line.split(/\s+/);
        run(`loadFEN(${JSON.stringify(l.fen)}); recordPosition();`);
        const worst = [];
        let legal = true;
        line.forEach((san, i) => {
            if (!legal) return;
            if (!run(`(() => { const r = resolveSAN(currentTurn, ${JSON.stringify(san)}); if (!r) return false; applyMoveWithPromotion(r.move, r.promo); recordPosition(); return true; })()`)) { legal = false; worst.push(`illegal ${san}`); return; }
            if (i % 2 === 1) return; // only after your moves
            run('clearSearchMemory()');
            const s = run('searchRoot(currentTurn, { timeMs: 1500, maxDepth: 64, contempt: 0 }).score');
            if (s > 400) worst.push(`${san}: ${s} cp for the opponent`);
        });
        t.check(!worst.length, `${l.id}: textbook line (${line.length} moves) is legal and sound${worst.length ? ' — ' + worst.join('; ') : ''}`);
        if (legal && l.goal === 'promote') {
            run('clearSearchMemory()');
            const end = run('-searchRoot(currentTurn, { timeMs: 3000, maxDepth: 64, contempt: 0 }).score');
            t.check(end > 600, `${l.id}: after the line the promotion is in sight (${end} cp for you)`);
        }
    }
}

// Bitbase vs solver on random K+P vs K positions (both colours, both sides to move).
const { P } = tables.solveAll();
let checked = 0, wrong = 0;
const sq = (s) => ({ x: s & 7, y: s >> 3 });
for (let n = 0; n < 40000; n++) {
    const wk = Math.floor(Math.random() * 64), bk = Math.floor(Math.random() * 64), p = 8 + Math.floor(Math.random() * 48), stm = n & 1;
    const v = P[tables.idx(stm, wk, bk, p)];
    if (v === -2) continue;
    const black = n & 2; // mirror the position so Black has the pawn
    const at = (s) => { const c = sq(s); return black ? { x: c.x, y: 7 - c.y } : c; };
    const strong = black ? 'black' : 'white', weak = black ? 'white' : 'black';
    const pieces = [[at(wk), 'king', strong], [at(bk), 'king', weak], [at(p), 'pawn', strong]];
    const got = run(`(() => { const b = Array.from({ length: 8 }, () => Array(8).fill(null));
        for (const [c, type, color] of ${JSON.stringify(pieces)}) b[c.y][c.x] = { type, color };
        return kpkWins(b, ${JSON.stringify(stm === 0 ? strong : weak)}); })()`);
    checked++;
    if (got !== (v >= 0)) wrong++;
}
t.check(wrong === 0, `browser K+P bitbase matches the solver on ${checked} random positions (${wrong} wrong)`);
t.done('endgames');
