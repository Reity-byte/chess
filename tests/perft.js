// Move-generation correctness: counts every legal move sequence to a fixed depth
// ("perft") from standard test positions and compares with the published
// reference numbers. Checks both move generators — the real board (engine.js,
// used by the UI) and the search board (ai.js) — plus the search board's
// incremental Zobrist hash against a from-scratch recomputation at every node.
//
//   node tests/perft.js          (quick, ~10 s)
//   node tests/perft.js --deep   (one ply deeper, ~1 min)
const { loadEngine, makeChecker } = require('./lib');

const deep = process.argv.includes('--deep');
const SUITES = [
    ['start position', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281, 4865609]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
    ['endgame / en passant', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
    ['promotions + checks', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
    ['castling edge cases', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
];

const { run } = loadEngine();
run(`
// Real-board perft: uses movePiece()-style application via a board snapshot.
function __snapshot() {
    return { board: gameState.map(r => r.map(p => p && { type: p.type, color: p.color, hasMoved: p.hasMoved })),
             turn: currentTurn, last: lastMove && { ...lastMove, piece: null, pieceAt: [lastMove.toX, lastMove.toY] }, half: halfMoveClock };
}
function __restore(s) {
    gameState = s.board.map(r => r.map(p => { if (!p) return null; const c = new ChessPiece(p.type, p.color); c.hasMoved = p.hasMoved; return c; }));
    currentTurn = s.turn; halfMoveClock = s.half;
    lastMove = s.last && { ...s.last, piece: gameState[s.last.pieceAt[1]][s.last.pieceAt[0]] };
}
function __gamePerft(d) {
    const moves = getAllValidMoves(currentTurn);
    if (d === 1) return moves.reduce((n, m) => n + (gameState[m.fromY][m.fromX].type === 'pawn' && (m.toY === 0 || m.toY === 7) ? 4 : 1), 0);
    let n = 0;
    const snap = __snapshot();
    for (const m of moves) {
        const promo = gameState[m.fromY][m.fromX].type === 'pawn' && (m.toY === 0 || m.toY === 7);
        for (const t of promo ? ['queen', 'rook', 'bishop', 'knight'] : [null]) {
            applyMoveWithPromotion(m, t);
            n += __gamePerft(d - 1);
            __restore(snap);
        }
    }
    return n;
}
let __hashErrors = 0;
function __scratchHashOk() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 120; sq++) { if (sq & 0x88) { sq += 7; continue; } const p = sb[sq]; if (p) { lo ^= SZ_LO[p * 128 + sq]; hi ^= SZ_HI[p * 128 + sq]; } }
    lo ^= Z_CASTLE_LO[sbCastle]; hi ^= Z_CASTLE_HI[sbCastle];
    if (sbEp >= 0) { lo ^= Z_EP_LO[sbEp & 7]; hi ^= Z_EP_HI[sbEp & 7]; }
    if (sbSide) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    return lo === sbLo && hi === sbHi;
}
function __searchPerft(d, ply) {
    if (!__scratchHashOk()) __hashErrors++;
    const base = ply * MOVE_SLOTS, n = sbGenerate(base, false);
    let total = 0;
    for (let i = base; i < base + n; i++) {
        const m = moveBuf[i];
        if (!sbMakeLegal(m)) continue;
        total += d === 1 ? 1 : __searchPerft(d - 1, ply + 1);
        sbUnmake(m);
    }
    return total;
}`);

const t = makeChecker();
for (const [name, fen, expected] of SUITES) {
    // The real-board generator is ~10x slower, so it runs one ply shallower.
    const searchDepth = Math.min(expected.length, deep ? 5 : 4);
    const gameDepth = Math.min(expected.length, deep ? 4 : 3);

    run(`__loadFEN(${JSON.stringify(fen)}); loadSearchBoard(); stSp = 0;`);
    const hashOk = run('(() => { const h = computeHash(); return h.lo === sbLo && h.hi === sbHi; })()');
    t.check(hashOk, `${name}: search-board hash matches engine.js computeHash()`);

    let t0 = Date.now();
    const s = run(`__searchPerft(${searchDepth}, 0)`);
    t.check(s === expected[searchDepth - 1], `${name}: search board perft(${searchDepth}) = ${s} (expected ${expected[searchDepth - 1]}, ${Date.now() - t0} ms)`);

    run(`__loadFEN(${JSON.stringify(fen)})`);
    t0 = Date.now();
    const g = run(`__gamePerft(${gameDepth})`);
    t.check(g === expected[gameDepth - 1], `${name}: real board perft(${gameDepth}) = ${g} (expected ${expected[gameDepth - 1]}, ${Date.now() - t0} ms)`);
}
t.check(run('__hashErrors') === 0, `incremental hash matched a full recomputation at every node (${run('__hashErrors')} mismatches)`);
t.done('perft');
