// ─── 3-PIECE ENDGAME TABLES ────────────────────────────────────────────────────
// Exact retrograde solutions of K+Q vs K, K+R vs K and K+P vs K (forward
// iteration: each pass resolves the positions that win in one more ply).
//   - KQK / KRK give the par (fewest moves to mate) of the trainer's mate lessons.
//   - KPK becomes a win/draw bitbase shipped to the browser (main/game/endgame-tables.js),
//     so the trainer knows the moment a king-and-pawn move throws away the win.
//
//   node tools/endgame-tables.js           solve, write the bitbase, check the lessons
//
// Squares are 0..63 = y * 8 + x with y = 0 on the 8th rank (like gameState).
// The strong side is always "White" here; its pawn moves towards y = 0.
// Index = stm * 262144 + wk * 4096 + bk * 64 + piece, stm 0 = strong to move.
// Table values: plies to mate (>= 0) for a win, -1 = draw / not a win, -2 = illegal.
const fs = require('fs');
const path = require('path');

const N = 2 * 64 * 64 * 64;
const QUEEN = 'Q', ROOK = 'R', PAWN = 'P';
const sx = (s) => s & 7, sy = (s) => s >> 3;
const adjacent = (a, b) => a !== b && Math.abs(sx(a) - sx(b)) <= 1 && Math.abs(sy(a) - sy(b)) <= 1;
const idx = (stm, wk, bk, p) => stm * 262144 + wk * 4096 + bk * 64 + p;

const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const QUEEN_DIRS = KING_STEPS;

function kingTargets(s) {
    const out = [];
    for (const [dx, dy] of KING_STEPS) {
        const x = sx(s) + dx, y = sy(s) + dy;
        if (x >= 0 && x < 8 && y >= 0 && y < 8) out.push(y * 8 + x);
    }
    return out;
}
const KING_TARGETS = Array.from({ length: 64 }, (_, s) => kingTargets(s));

// Squares a piece on `p` slides to; `block` squares stop it (not included).
function slides(p, dirs, block1, block2) {
    const out = [];
    for (const [dx, dy] of dirs) {
        let x = sx(p) + dx, y = sy(p) + dy;
        while (x >= 0 && x < 8 && y >= 0 && y < 8) {
            const s = y * 8 + x;
            if (s === block1 || s === block2) break;
            out.push(s);
            x += dx; y += dy;
        }
    }
    return out;
}

// Does the strong piece on `p` attack `t`? (`block` = a square that blocks rays.)
function attacks(type, p, t, block) {
    if (type === PAWN) return sy(t) === sy(p) - 1 && Math.abs(sx(t) - sx(p)) === 1;
    const dx = Math.sign(sx(t) - sx(p)), dy = Math.sign(sy(t) - sy(p));
    if (p === t) return false;
    const straight = sx(t) === sx(p) || sy(t) === sy(p);
    const diagonal = Math.abs(sx(t) - sx(p)) === Math.abs(sy(t) - sy(p));
    if (!(straight || (type === QUEEN && diagonal))) return false;
    let x = sx(p) + dx, y = sy(p) + dy;
    while (y * 8 + x !== t) {
        if (y * 8 + x === block) return false;
        x += dx; y += dy;
    }
    return true;
}

function illegal(type, wk, bk, p, stm) {
    if (wk === bk || wk === p || bk === p || adjacent(wk, bk)) return true;
    if (type === PAWN && (sy(p) === 0 || sy(p) === 7)) return true;
    // Strong side to move with the weak king in check: impossible.
    return stm === 0 && attacks(type, p, bk, wk);
}

// Strong side's moves from (wk, bk, p): [{ wk, p, promo? }] (promo = 'Q' | 'R' onto p).
function strongMoves(type, wk, bk, p) {
    const out = [];
    for (const t of KING_TARGETS[wk]) if (t !== p && !adjacent(t, bk) && t !== bk) out.push({ wk: t, p });
    if (type === PAWN) {
        const one = p - 8;
        if (one !== wk && one !== bk) {
            if (sy(one) === 0) { out.push({ wk, p: one, promo: QUEEN }); out.push({ wk, p: one, promo: ROOK }); }
            else out.push({ wk, p: one });
            const two = p - 16;
            if (sy(p) === 6 && two !== wk && two !== bk) out.push({ wk, p: two });
        }
    } else {
        for (const t of slides(p, type === QUEEN ? QUEEN_DIRS : ROOK_DIRS, wk, bk)) out.push({ wk, p: t });
    }
    return out;
}

// Weak king's moves: { bk } or { capture: true } (takes the piece -> draw).
function weakMoves(type, wk, bk, p) {
    const out = [];
    for (const t of KING_TARGETS[bk]) {
        if (t === wk || adjacent(t, wk)) continue;
        if (t === p) { out.push({ capture: true }); continue; }
        // The king leaves bk, so rays through bk are not blocked by it.
        if (attacks(type, p, t, wk)) continue;
        out.push({ bk: t });
    }
    return out;
}

function solve(type, sub = {}) {
    const t = new Int16Array(N).fill(-1);
    // Pass 0: illegal positions, mates; stalemates and captures stay -1 (draw).
    for (let stm = 0; stm < 2; stm++)
        for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 0; p < 64; p++) {
            const i = idx(stm, wk, bk, p);
            if (illegal(type, wk, bk, p, stm)) { t[i] = -2; continue; }
            if (stm === 1 && weakMoves(type, wk, bk, p).length === 0 && attacks(type, p, bk, wk)) t[i] = 0;
        }
    const final = new Uint8Array(N); // weak-to-move positions known to be draws
    let quiet = 0;
    for (let ply = 1; ; ply++) {
        let changed = 0;
        const stm = ply % 2 === 1 ? 0 : 1;
        for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 0; p < 64; p++) {
            const i = idx(stm, wk, bk, p);
            if (t[i] !== -1 || final[i]) continue;
            if (stm === 0) {
                for (const m of strongMoves(type, wk, bk, p)) {
                    const v = m.promo ? sub[m.promo][idx(1, m.wk, bk, m.p)] : t[idx(1, m.wk, bk, m.p)];
                    if (v >= 0 && v <= ply - 1) { t[i] = ply; changed++; break; }
                }
            } else {
                const moves = weakMoves(type, wk, bk, p);
                if (!moves.length || moves.some(m => m.capture)) { final[i] = 1; continue; }
                let all = true;
                for (const m of moves) {
                    const v = t[idx(0, wk, m.bk, p)];
                    if (v < 0 || v > ply - 1) { all = false; break; }
                }
                if (all) { t[i] = ply; changed++; }
            }
        }
        // Two quiet passes in a row (one per side): nothing more can resolve.
        quiet = changed ? 0 : quiet + 1;
        if (quiet >= 2) break;
    }
    return t;
}

let cache = null;
function solveAll() {
    if (cache) return cache;
    const Q = solve(QUEEN), R = solve(ROOK);
    const P = solve(PAWN, { Q, R });
    cache = { Q, R, P };
    return cache;
}

// ─── POSITIONS FROM FEN ────────────────────────────────────────────────────────
// -> { type, wk, bk, p, stm, strong: 'white'|'black' } in table coordinates, or
// null when the FEN isn't one of the three endings.
function fromFEN(fen) {
    const [placement, side] = fen.split(/\s+/);
    const pieces = [];
    placement.split('/').forEach((row, y) => {
        let x = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) x += +ch;
            else { pieces.push({ ch, sq: y * 8 + x }); x++; }
        }
    });
    if (pieces.length !== 3) return null;
    const extra = pieces.find(q => !/k/i.test(q.ch));
    if (!extra || !/[qrp]/i.test(extra.ch)) return null;
    const strong = extra.ch === extra.ch.toUpperCase() ? 'white' : 'black';
    const flip = (s) => (strong === 'white' ? s : (7 - sy(s)) * 8 + sx(s));
    const king = (white) => pieces.find(q => q.ch === (white ? 'K' : 'k')).sq;
    return {
        type: extra.ch.toUpperCase(),
        wk: flip(king(strong === 'white')), bk: flip(king(strong !== 'white')), p: flip(extra.sq),
        stm: (side === 'w') === (strong === 'white') ? 0 : 1, strong,
    };
}

// Plies to mate (>= 0), -1 draw, -2 illegal, null if not a 3-piece ending.
function probe(fen) {
    const pos = fromFEN(fen);
    if (!pos) return null;
    return solveAll()[pos.type][idx(pos.stm, pos.wk, pos.bk, pos.p)];
}

// ─── KPK BITBASE FOR THE BROWSER ───────────────────────────────────────────────
// One bit per (stm, pawn square on ranks 2-7 of files a-d, wk, bk): 1 = win.
// Pawns on files e-h are mirrored. Same layout as kpkWins() in endgame-tables.js.
function kpkBitbase() {
    const { P } = solveAll();
    const bits = new Uint8Array(2 * 24 * 4096 / 8);
    for (let stm = 0; stm < 2; stm++) for (let pi = 0; pi < 24; pi++) {
        const p = (1 + (pi >> 2)) * 8 + (pi & 3);
        for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) {
            if (P[idx(stm, wk, bk, p)] >= 0) {
                const n = ((stm * 24 + pi) * 64 + wk) * 64 + bk;
                bits[n >> 3] |= 1 << (n & 7);
            }
        }
    }
    return Buffer.from(bits).toString('base64');
}

module.exports = { solveAll, probe, fromFEN, kpkBitbase, idx };

if (require.main === module) {
    const t0 = Date.now();
    const { Q, R, P } = solveAll();
    const max = (t) => t.reduce((m, v) => Math.max(m, v), 0);
    console.log(`Solved in ${((Date.now() - t0) / 1000).toFixed(1)} s — longest mates (moves): KQK ${Math.ceil(max(Q) / 2)}, KRK ${Math.ceil(max(R) / 2)}, KPK ${Math.ceil(max(P) / 2)}`);

    const out = path.join(__dirname, '..', 'main', 'game', 'endgame-tables.js');
    const src = `// Generated by tools/endgame-tables.js — do not edit.
// K+P vs K win/draw bitbase: one bit per (side to move, pawn square, kings), 1 = the pawn side wins.
const KPK_BITBASE = '${kpkBitbase()}';

let kpkBits = null;

// Is this K+P vs K position a win for the side with the pawn? Squares as
// { x, y } with y = 0 on the 8th rank; \`pawnToMove\` = the pawn side moves next.
// Returns null if the position is not K+P vs K.
function kpkWins(board, sideToMove) {
    const pieces = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (board[y][x]) pieces.push({ p: board[y][x], x, y });
    if (pieces.length !== 3) return null;
    const pawn = pieces.find(q => q.p.type === 'pawn');
    if (!pawn || pieces.some(q => q.p.type !== 'pawn' && q.p.type !== 'king')) return null;
    const strong = pawn.p.color;
    const king = (color) => pieces.find(q => q.p.type === 'king' && q.p.color === color);
    const sq = (q) => {
        let x = q.x, y = strong === 'white' ? q.y : 7 - q.y;
        if (pawn.x >= 4) x = 7 - x;
        return { x, y };
    };
    const p = sq(pawn), wk = sq(king(strong)), bk = sq(king(strong === 'white' ? 'black' : 'white'));
    if (p.y < 1 || p.y > 6) return null;
    if (!kpkBits) {
        const raw = atob(KPK_BITBASE);
        kpkBits = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) kpkBits[i] = raw.charCodeAt(i);
    }
    const stm = sideToMove === strong ? 0 : 1;
    const pi = (p.y - 1) * 4 + p.x;
    const n = ((stm * 24 + pi) * 64 + wk.y * 8 + wk.x) * 64 + bk.y * 8 + bk.x;
    return (kpkBits[n >> 3] >> (n & 7) & 1) === 1;
}
`;
    fs.writeFileSync(out, src);
    console.log(`Wrote ${path.relative(process.cwd(), out)} (${(src.length / 1024).toFixed(1)} KB)`);
}
