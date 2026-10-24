// ─── PIECE-SQUARE TABLES (White's perspective; mirrored for Black) ─────────────

const PST = {
    pawn: [
        [  0,  0,  0,  0,  0,  0,  0,  0],
        [ 50, 50, 50, 50, 50, 50, 50, 50],
        [ 10, 10, 20, 30, 30, 20, 10, 10],
        [  5,  5, 10, 25, 25, 10,  5,  5],
        [  0,  0,  0, 20, 20,  0,  0,  0],
        [  5, -5,-10,  0,  0,-10, -5,  5],
        [  5, 10, 10,-20,-20, 10, 10,  5],
        [  0,  0,  0,  0,  0,  0,  0,  0]
    ],
    knight: [
        [-50,-40,-30,-30,-30,-30,-40,-50],
        [-40,-20,  0,  0,  0,  0,-20,-40],
        [-30,  0, 10, 15, 15, 10,  0,-30],
        [-30,  5, 15, 20, 20, 15,  5,-30],
        [-30,  0, 15, 20, 20, 15,  0,-30],
        [-30,  5, 10, 15, 15, 10,  5,-30],
        [-40,-20,  0,  5,  5,  0,-20,-40],
        [-50,-40,-30,-30,-30,-30,-40,-50]
    ],
    bishop: [
        [-20,-10,-10,-10,-10,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5, 10, 10,  5,  0,-10],
        [-10,  5,  5, 10, 10,  5,  5,-10],
        [-10,  0, 10, 10, 10, 10,  0,-10],
        [-10, 10, 10, 10, 10, 10, 10,-10],
        [-10,  5,  0,  0,  0,  0,  5,-10],
        [-20,-10,-10,-10,-10,-10,-10,-20]
    ],
    rook: [
        [  0,  0,  0,  0,  0,  0,  0,  0],
        [  5, 10, 10, 10, 10, 10, 10,  5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [ -5,  0,  0,  0,  0,  0,  0, -5],
        [  0,  0,  0,  5,  5,  0,  0,  0]
    ],
    queen: [
        [-20,-10,-10, -5, -5,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5,  5,  5,  5,  0,-10],
        [ -5,  0,  5,  5,  5,  5,  0, -5],
        [  0,  0,  5,  5,  5,  5,  0, -5],
        [-10,  5,  5,  5,  5,  5,  0,-10],
        [-10,  0,  5,  0,  0,  0,  0,-10],
        [-20,-10,-10, -5, -5,-10,-10,-20]
    ],
    // Midgame king: hide in the corner after castling
    king: [
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-20,-30,-30,-40,-40,-30,-30,-20],
        [-10,-20,-20,-20,-20,-20,-20,-10],
        [ 20, 20,  0,  0,  0,  0, 20, 20],
        [ 20, 30, 10,  0,  0, 10, 30, 20]
    ]
};

const PIECE_VALUES = { pawn: 100, knight: 300, bishop: 330, rook: 500, queen: 900, king: 20000 };

// Endgame king PST: centralize instead of hiding in the corner once material thins out.
const KING_ENDGAME_PST = [
    [-50,-40,-30,-20,-20,-30,-40,-50],
    [-30,-20,-10,  0,  0,-10,-20,-30],
    [-30,-10, 20, 30, 30, 20,-10,-30],
    [-30,-10, 30, 40, 40, 30,-10,-30],
    [-30,-10, 30, 40, 40, 30,-10,-30],
    [-30,-10, 20, 30, 30, 20,-10,-30],
    [-30,-30,  0,  0,  0,  0,-30,-30],
    [-50,-30,-30,-30,-30,-30,-30,-50]
];

// Passed-pawn bonus indexed by squares-to-go before promotion (1 = one step away).
// Applied at half strength in the middlegame, full strength in the endgame.
const PASSED_PAWN_BONUS = [0, 200, 120, 80, 50, 30, 15, 0];
const BISHOP_PAIR_BONUS = 30;
const ROOK_SEMI_OPEN_BONUS = 15;
const ROOK_OPEN_BONUS = 25;
const DOUBLED_PAWN_PENALTY = 12;
const ISOLATED_PAWN_PENALTY = 10;
const PAWN_SHIELD_NEAR = 12; // own pawn directly in front of a castled-style king
const PAWN_SHIELD_FAR = 6;   // ...or one square further

// Both sides' starting non-pawn, non-king material — the "phase" signal that
// blends midgame and endgame terms (0 = full board, 256 = bare kings + pawns).
const TOTAL_NON_PAWN_MATERIAL =
    2 * (2 * PIECE_VALUES.knight + 2 * PIECE_VALUES.bishop + 2 * PIECE_VALUES.rook + PIECE_VALUES.queen);

// ═══ SEARCH BOARD ═══════════════════════════════════════════════════════════════
// The search runs on its own compact 0x88 board (a 128-byte typed array) instead
// of gameState's 2D array of piece objects: square = y*16 + x (y = 0 is rank 8,
// like gameState), off-board squares have the 0x88 bit set. Pieces are small
// integers — type 1..6 (pawn, knight, bishop, rook, queen, king), +8 for Black.
// Moves are single integers. It is loaded from gameState at the start of each
// search (loadSearchBoard) and uses the same Zobrist keys as engine.js, so its
// hashes line up with the game's recorded position history.
const P_PAWN = 1, P_KNIGHT = 2, P_BISHOP = 3, P_ROOK = 4, P_QUEEN = 5, P_KING = 6, BLACK = 8;
const TYPE_NAMES = [null, 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const TYPE_LETTERS = ['', '', 'N', 'B', 'R', 'Q', 'K'];
const PIECE_VALUE_T = [0, 100, 300, 330, 500, 900, 20000];
const SEE_VALUE_T = [0, 100, 320, 330, 500, 900, 20000];

const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17];
const DIAG_OFFSETS = [-17, -15, 15, 17];
const ORTHO_OFFSETS = [-16, -1, 1, 16];

const sb = new Int8Array(128);
let sbSide = 0;         // 0 = White to move, 8 = Black
let sbCastle = 0;       // castling rights, same bits as engine.js castleRightsMask()
let sbEp = -1;          // en-passant target square, or -1
let sbHalf = 0;         // half-move clock
let sbLo = 0, sbHi = 0; // Zobrist hash halves
const sbKing = new Int16Array(2); // king squares [white, black]

// Zobrist keys re-indexed by (piece code * 128 + 0x88 square).
const SZ_LO = new Int32Array(16 * 128), SZ_HI = new Int32Array(16 * 128);
// Piece-square value (material + PST) by (piece code * 128 + square), signed from White's view.
const SPST = new Int16Array(16 * 128);
const SKING_MG = new Int16Array(16 * 128), SKING_EG = new Int16Array(16 * 128);
// Castling rights that survive a move touching each square (king/rook home squares clear bits).
const CASTLE_KEEP = new Int8Array(128).fill(15);

(function initSearchTables() {
    const pstNames = [null, 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
    for (let t = 1; t <= 6; t++) {
        for (const color of [0, BLACK]) {
            const p = t | color;
            const zi = (t - 1) + (color ? 6 : 0);
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const sq = y * 16 + x;
                    SZ_LO[p * 128 + sq] = Z_PIECE_LO[zi * 64 + y * 8 + x];
                    SZ_HI[p * 128 + sq] = Z_PIECE_HI[zi * 64 + y * 8 + x];
                    const rank = color ? 7 - y : y;
                    const sign = color ? -1 : 1;
                    if (t === P_KING) {
                        SKING_MG[p * 128 + sq] = PST.king[rank][x];
                        SKING_EG[p * 128 + sq] = KING_ENDGAME_PST[rank][x];
                    } else {
                        SPST[p * 128 + sq] = sign * (PIECE_VALUE_T[t] + PST[pstNames[t]][rank][x]);
                    }
                }
            }
        }
    }
    CASTLE_KEEP[0x74] = 12; CASTLE_KEEP[0x77] = 14; CASTLE_KEEP[0x70] = 13; // e1 h1 a1
    CASTLE_KEEP[0x04] = 3;  CASTLE_KEEP[0x07] = 11; CASTLE_KEEP[0x00] = 7;  // e8 h8 a8
})();

// Copies gameState (+ side, castling, en passant, clock) into the search board.
function loadSearchBoard() {
    sb.fill(0);
    let lo = 0, hi = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p) continue;
            const code = (p.code + 1) | (p.white ? 0 : BLACK);
            const sq = y * 16 + x;
            sb[sq] = code;
            lo ^= SZ_LO[code * 128 + sq]; hi ^= SZ_HI[code * 128 + sq];
            if (p.code === 5) sbKing[p.white ? 0 : 1] = sq;
        }
    }
    sbSide = currentTurn === 'white' ? 0 : BLACK;
    sbCastle = castleRightsMask();
    const epFile = epFileOf(lastMove);
    sbEp = epFile >= 0 ? ((lastMove.fromY + lastMove.toY) >> 1) * 16 + epFile : -1;
    sbHalf = halfMoveClock;
    lo ^= Z_CASTLE_LO[sbCastle]; hi ^= Z_CASTLE_HI[sbCastle];
    if (sbEp >= 0) { lo ^= Z_EP_LO[sbEp & 7]; hi ^= Z_EP_HI[sbEp & 7]; }
    if (sbSide) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    sbLo = lo; sbHi = hi;
}

// Is `sq` attacked by side `by` (0 = White, 8 = Black)?
function sbAttacked(sq, by) {
    let s;
    if (by === 0) {
        s = sq + 15; if (!(s & 0x88) && sb[s] === P_PAWN) return true;
        s = sq + 17; if (!(s & 0x88) && sb[s] === P_PAWN) return true;
    } else {
        s = sq - 15; if (!(s & 0x88) && sb[s] === (P_PAWN | BLACK)) return true;
        s = sq - 17; if (!(s & 0x88) && sb[s] === (P_PAWN | BLACK)) return true;
    }
    const knight = P_KNIGHT | by, king = P_KING | by, bishop = P_BISHOP | by, rook = P_ROOK | by, queen = P_QUEEN | by;
    for (let i = 0; i < 8; i++) {
        s = sq + KNIGHT_OFFSETS[i];
        if (!(s & 0x88) && sb[s] === knight) return true;
    }
    for (let i = 0; i < 8; i++) {
        s = sq + KING_OFFSETS[i];
        if (!(s & 0x88) && sb[s] === king) return true;
    }
    for (let i = 0; i < 4; i++) {
        const d = DIAG_OFFSETS[i];
        s = sq + d;
        while (!(s & 0x88)) {
            const p = sb[s];
            if (p) { if (p === bishop || p === queen) return true; break; }
            s += d;
        }
    }
    for (let i = 0; i < 4; i++) {
        const d = ORTHO_OFFSETS[i];
        s = sq + d;
        while (!(s & 0x88)) {
            const p = sb[s];
            if (p) { if (p === rook || p === queen) return true; break; }
            s += d;
        }
    }
    return false;
}

function sbInCheck() {
    return sbAttacked(sbKing[sbSide >> 3], sbSide ^ BLACK);
}

// ─── MOVE ENCODING / GENERATION ────────────────────────────────────────────────
// move = from | to << 7 | promoType << 14 | flags << 17
const MF_EP = 1, MF_CASTLE = 2, MF_DOUBLE = 4;
const MOVE_SLOTS = 256;
const MAX_PLY = 64;
const moveBuf = new Int32Array((MAX_PLY + 4) * MOVE_SLOTS);
const scoreBuf = new Int32Array((MAX_PLY + 4) * MOVE_SLOTS);
const SCRATCH_BASE = (MAX_PLY + 2) * MOVE_SLOTS; // for root/SAN/PV helpers outside the search tree

// Writes pseudo-legal moves for the side to move at moveBuf[base..]; returns the
// count. capturesOnly limits output to captures, en passant and queen promotions.
function sbGenerate(base, capturesOnly) {
    const us = sbSide, them = us ^ BLACK;
    let n = base;
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = sb[sq];
        if (!p || (p & BLACK) !== us) continue;
        const t = p & 7;
        if (t === P_PAWN) {
            const dir = us ? 16 : -16;
            const to = sq + dir;
            const promoting = (to >> 4) === 0 || (to >> 4) === 7;
            if (sb[to] === 0) {
                if (promoting) {
                    moveBuf[n++] = sq | (to << 7) | (P_QUEEN << 14);
                    if (!capturesOnly) {
                        moveBuf[n++] = sq | (to << 7) | (P_KNIGHT << 14);
                        moveBuf[n++] = sq | (to << 7) | (P_ROOK << 14);
                        moveBuf[n++] = sq | (to << 7) | (P_BISHOP << 14);
                    }
                } else if (!capturesOnly) {
                    moveBuf[n++] = sq | (to << 7);
                    const startRank = us ? 1 : 6;
                    if ((sq >> 4) === startRank && sb[to + dir] === 0) moveBuf[n++] = sq | ((to + dir) << 7) | (MF_DOUBLE << 17);
                }
            }
            for (let c = -1; c <= 1; c += 2) {
                const cap = to + c;
                if (cap & 0x88) continue;
                const q = sb[cap];
                if (q && (q & BLACK) === them) {
                    if (promoting) {
                        moveBuf[n++] = sq | (cap << 7) | (P_QUEEN << 14);
                        if (!capturesOnly) {
                            moveBuf[n++] = sq | (cap << 7) | (P_KNIGHT << 14);
                            moveBuf[n++] = sq | (cap << 7) | (P_ROOK << 14);
                            moveBuf[n++] = sq | (cap << 7) | (P_BISHOP << 14);
                        }
                    } else {
                        moveBuf[n++] = sq | (cap << 7);
                    }
                } else if (cap === sbEp) {
                    moveBuf[n++] = sq | (cap << 7) | (MF_EP << 17);
                }
            }
        } else if (t === P_KNIGHT || t === P_KING) {
            const offs = t === P_KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
            for (let i = 0; i < 8; i++) {
                const to = sq + offs[i];
                if (to & 0x88) continue;
                const q = sb[to];
                if (q === 0) { if (!capturesOnly) moveBuf[n++] = sq | (to << 7); }
                else if ((q & BLACK) === them) moveBuf[n++] = sq | (to << 7);
            }
            if (t === P_KING && !capturesOnly && sbCastle) {
                if (us === 0 && sq === 0x74) {
                    if ((sbCastle & 1) && sb[0x75] === 0 && sb[0x76] === 0 && sb[0x77] === P_ROOK
                        && !sbAttacked(0x74, BLACK) && !sbAttacked(0x75, BLACK)) moveBuf[n++] = 0x74 | (0x76 << 7) | (MF_CASTLE << 17);
                    if ((sbCastle & 2) && sb[0x73] === 0 && sb[0x72] === 0 && sb[0x71] === 0 && sb[0x70] === P_ROOK
                        && !sbAttacked(0x74, BLACK) && !sbAttacked(0x73, BLACK)) moveBuf[n++] = 0x74 | (0x72 << 7) | (MF_CASTLE << 17);
                } else if (us === BLACK && sq === 0x04) {
                    if ((sbCastle & 4) && sb[0x05] === 0 && sb[0x06] === 0 && sb[0x07] === (P_ROOK | BLACK)
                        && !sbAttacked(0x04, 0) && !sbAttacked(0x05, 0)) moveBuf[n++] = 0x04 | (0x06 << 7) | (MF_CASTLE << 17);
                    if ((sbCastle & 8) && sb[0x03] === 0 && sb[0x02] === 0 && sb[0x01] === 0 && sb[0x00] === (P_ROOK | BLACK)
                        && !sbAttacked(0x04, 0) && !sbAttacked(0x03, 0)) moveBuf[n++] = 0x04 | (0x02 << 7) | (MF_CASTLE << 17);
                }
            }
        } else {
            const start = t === P_ROOK ? 4 : 0;
            const end = t === P_BISHOP ? 4 : 8;
            for (let i = start; i < end; i++) {
                const d = i < 4 ? DIAG_OFFSETS[i] : ORTHO_OFFSETS[i - 4];
                let to = sq + d;
                while (!(to & 0x88)) {
                    const q = sb[to];
                    if (q === 0) { if (!capturesOnly) moveBuf[n++] = sq | (to << 7); }
                    else { if ((q & BLACK) === them) moveBuf[n++] = sq | (to << 7); break; }
                    to += d;
                }
            }
        }
    }
    return n - base;
}

// ─── MAKE / UNMAKE ─────────────────────────────────────────────────────────────
const STACK_SIZE = 1024;
const stCaptured = new Int8Array(STACK_SIZE), stCastle = new Int8Array(STACK_SIZE);
const stEp = new Int16Array(STACK_SIZE), stHalf = new Int16Array(STACK_SIZE);
const stLo = new Int32Array(STACK_SIZE), stHi = new Int32Array(STACK_SIZE);
let stSp = 0;

function castleRookSquares(to) {
    // returns rookFrom | rookTo << 7 for a castling king destination
    if (to === 0x76) return 0x77 | (0x75 << 7);
    if (to === 0x72) return 0x70 | (0x73 << 7);
    if (to === 0x06) return 0x07 | (0x05 << 7);
    return 0x00 | (0x03 << 7);
}

function sbMake(m) {
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    const p = sb[from], cap = sb[to];
    stCaptured[stSp] = cap; stCastle[stSp] = sbCastle; stEp[stSp] = sbEp;
    stHalf[stSp] = sbHalf; stLo[stSp] = sbLo; stHi[stSp] = sbHi; stSp++;

    let lo = sbLo ^ SZ_LO[p * 128 + from], hi = sbHi ^ SZ_HI[p * 128 + from];
    if (cap) { lo ^= SZ_LO[cap * 128 + to]; hi ^= SZ_HI[cap * 128 + to]; }
    if (flags & MF_EP) {
        const capSq = to + (sbSide ? -16 : 16);
        const epPawn = sb[capSq];
        lo ^= SZ_LO[epPawn * 128 + capSq]; hi ^= SZ_HI[epPawn * 128 + capSq];
        sb[capSq] = 0;
    }
    const placed = promo ? (promo | sbSide) : p;
    sb[to] = placed; sb[from] = 0;
    lo ^= SZ_LO[placed * 128 + to]; hi ^= SZ_HI[placed * 128 + to];
    if (flags & MF_CASTLE) {
        const r = castleRookSquares(to), rf = r & 127, rt = r >> 7, rook = sb[rf];
        sb[rt] = rook; sb[rf] = 0;
        lo ^= SZ_LO[rook * 128 + rf] ^ SZ_LO[rook * 128 + rt];
        hi ^= SZ_HI[rook * 128 + rf] ^ SZ_HI[rook * 128 + rt];
    }
    if ((p & 7) === P_KING) sbKing[sbSide >> 3] = to;

    const castle = sbCastle & CASTLE_KEEP[from] & CASTLE_KEEP[to];
    if (castle !== sbCastle) {
        lo ^= Z_CASTLE_LO[sbCastle] ^ Z_CASTLE_LO[castle]; hi ^= Z_CASTLE_HI[sbCastle] ^ Z_CASTLE_HI[castle];
        sbCastle = castle;
    }
    if (sbEp >= 0) { lo ^= Z_EP_LO[sbEp & 7]; hi ^= Z_EP_HI[sbEp & 7]; }
    sbEp = (flags & MF_DOUBLE) ? (from + to) >> 1 : -1;
    if (sbEp >= 0) { lo ^= Z_EP_LO[sbEp & 7]; hi ^= Z_EP_HI[sbEp & 7]; }

    sbHalf = ((p & 7) === P_PAWN || cap) ? 0 : sbHalf + 1;
    sbSide ^= BLACK;
    sbLo = lo ^ Z_SIDE_LO; sbHi = hi ^ Z_SIDE_HI;
}

function sbUnmake(m) {
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    stSp--;
    sbSide ^= BLACK;
    const moved = promo ? (P_PAWN | sbSide) : sb[to];
    sb[from] = moved;
    sb[to] = stCaptured[stSp];
    if (flags & MF_EP) sb[to + (sbSide ? -16 : 16)] = P_PAWN | (sbSide ^ BLACK);
    if (flags & MF_CASTLE) {
        const r = castleRookSquares(to), rf = r & 127, rt = r >> 7;
        sb[rf] = sb[rt]; sb[rt] = 0;
    }
    if ((moved & 7) === P_KING) sbKing[sbSide >> 3] = from;
    sbCastle = stCastle[stSp]; sbEp = stEp[stSp]; sbHalf = stHalf[stSp];
    sbLo = stLo[stSp]; sbHi = stHi[stSp];
}

// Makes `m` if it doesn't leave the mover's king attacked; returns false (and
// leaves the board untouched) otherwise.
function sbMakeLegal(m) {
    sbMake(m);
    if (sbAttacked(sbKing[(sbSide ^ BLACK) >> 3], sbSide)) { sbUnmake(m); return false; }
    return true;
}

function sbMakeNull() {
    stEp[stSp] = sbEp; stLo[stSp] = sbLo; stHi[stSp] = sbHi; stSp++;
    if (sbEp >= 0) { sbLo ^= Z_EP_LO[sbEp & 7]; sbHi ^= Z_EP_HI[sbEp & 7]; }
    sbEp = -1;
    sbSide ^= BLACK;
    sbLo ^= Z_SIDE_LO; sbHi ^= Z_SIDE_HI;
}

function sbUnmakeNull() {
    stSp--;
    sbSide ^= BLACK;
    sbEp = stEp[stSp]; sbLo = stLo[stSp]; sbHi = stHi[stSp];
}

// Legal moves for the side to move, compacted at moveBuf[base..]; returns count.
function sbLegalMoves(base) {
    const n = sbGenerate(base, false);
    let k = base;
    for (let i = base; i < base + n; i++) {
        const m = moveBuf[i];
        if (sbMakeLegal(m)) { sbUnmake(m); moveBuf[k++] = m; }
    }
    return k - base;
}

function sbHasNonPawnMaterial(side) {
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = sb[sq];
        if (p && (p & BLACK) === side) { const t = p & 7; if (t !== P_PAWN && t !== P_KING) return true; }
    }
    return false;
}

// ─── EVALUATION ───────────────────────────────────────────────────────────────
// Static score in centipawns from White's perspective: material + PST, bishop
// pair, rooks on (semi-)open files, doubled/isolated/passed pawns (passers grow
// in value toward the endgame), a phase-blended king table with a midgame pawn
// shield, and a clamp for sides that can't possibly win.
const evWFiles = new Int8Array(8), evBFiles = new Int8Array(8);
const evBMinY = new Int8Array(8), evWMaxY = new Int8Array(8);
const evPawnSq = new Int16Array(16), evRookSq = new Int16Array(20);

function evaluateSearchBoard() {
    evWFiles.fill(0); evBFiles.fill(0); evBMinY.fill(8); evWMaxY.fill(-1);
    let score = 0, wNpm = 0, bNpm = 0, wBishops = 0, bBishops = 0, wPawns = 0, bPawns = 0;
    let pawnN = 0, rookN = 0;

    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = sb[sq];
        if (!p) continue;
        const t = p & 7;
        if (t === P_KING) continue;
        score += SPST[p * 128 + sq];
        const black = p & BLACK;
        if (t === P_PAWN) {
            const x = sq & 7, y = sq >> 4;
            if (black) { evBFiles[x]++; if (y < evBMinY[x]) evBMinY[x] = y; bPawns++; }
            else       { evWFiles[x]++; if (y > evWMaxY[x]) evWMaxY[x] = y; wPawns++; }
            if (pawnN < 16) evPawnSq[pawnN++] = sq | (black << 4);
        } else {
            if (black) bNpm += PIECE_VALUE_T[t]; else wNpm += PIECE_VALUE_T[t];
            if (t === P_BISHOP) { if (black) bBishops++; else wBishops++; }
            else if (t === P_ROOK && rookN < 20) evRookSq[rookN++] = sq | (black << 4);
        }
    }

    let phase = (((TOTAL_NON_PAWN_MATERIAL - wNpm - bNpm) * 256) / TOTAL_NON_PAWN_MATERIAL) | 0;
    if (phase < 0) phase = 0; else if (phase > 256) phase = 256;

    if (wBishops >= 2) score += BISHOP_PAIR_BONUS;
    if (bBishops >= 2) score -= BISHOP_PAIR_BONUS;

    for (let i = 0; i < rookN; i++) {
        const v = evRookSq[i], black = v & 128, x = v & 7;
        const own = black ? evBFiles[x] : evWFiles[x];
        if (own !== 0) continue;
        const bonus = (black ? evWFiles[x] : evBFiles[x]) === 0 ? ROOK_OPEN_BONUS : ROOK_SEMI_OPEN_BONUS;
        score += black ? -bonus : bonus;
    }

    for (let f = 0; f < 8; f++) {
        if (evWFiles[f] > 1) score -= DOUBLED_PAWN_PENALTY * (evWFiles[f] - 1);
        if (evBFiles[f] > 1) score += DOUBLED_PAWN_PENALTY * (evBFiles[f] - 1);
    }

    for (let i = 0; i < pawnN; i++) {
        const v = evPawnSq[i], black = v & 128, x = v & 7, y = (v & 127) >> 4;
        const files = black ? evBFiles : evWFiles;
        if ((x === 0 || files[x - 1] === 0) && (x === 7 || files[x + 1] === 0)) {
            score += black ? ISOLATED_PAWN_PENALTY : -ISOLATED_PAWN_PENALTY;
        }
        let passed = true;
        for (let f = x > 0 ? x - 1 : 0; f <= (x < 7 ? x + 1 : 7); f++) {
            if (black ? evWMaxY[f] > y : evBMinY[f] < y) { passed = false; break; }
        }
        if (passed) {
            const base = PASSED_PAWN_BONUS[black ? 7 - y : y];
            const bonus = (base >> 1) + (((base - (base >> 1)) * phase) >> 8);
            score += black ? -bonus : bonus;
        }
    }

    score += kingTerm(sbKing[0], 0, phase) - kingTerm(sbKing[1], BLACK, phase);

    if (wPawns === 0 && wNpm <= PIECE_VALUES.bishop && score > 0) score = 0;
    if (bPawns === 0 && bNpm <= PIECE_VALUES.bishop && score < 0) score = 0;
    return score;
}

function kingTerm(sq, side, phase) {
    const k = (P_KING | side) * 128 + sq;
    const mg = SKING_MG[k], eg = SKING_EG[k];
    let v = mg + (((eg - mg) * phase) >> 8);
    const y = sq >> 4;
    if ((side ? y : 7 - y) <= 1 && phase < 200) {
        const dir = side ? 16 : -16, pawn = P_PAWN | side;
        let shield = 0;
        for (let dx = -1; dx <= 1; dx++) {
            const near = sq + dir + dx;
            if (near & 0x88) continue;
            if (sb[near] === pawn) { shield += PAWN_SHIELD_NEAR; continue; }
            const far = near + dir;
            if (!(far & 0x88) && sb[far] === pawn) shield += PAWN_SHIELD_FAR;
        }
        v += (shield * (256 - phase)) >> 8;
    }
    return v;
}

function evaluateSideToMove() {
    const s = evaluateSearchBoard();
    return sbSide ? -s : s;
}

// Static evaluation of the real board from `color`'s perspective.
function evaluateForColor(color) {
    loadSearchBoard();
    const s = evaluateSearchBoard();
    return color === 'white' ? s : -s;
}

// ─── STATIC EXCHANGE EVALUATION ──────────────────────────────────────────────
// Material outcome (centipawns, for the capturing side) of the full exchange on
// a square, each side recapturing with its least valuable attacker. Attackers
// are lifted off the board as they capture so x-ray attackers behind them are
// found by the normal ray scan.
const seeGain = new Int32Array(40);
const seeLifted = new Int16Array(40);
let lvaSq = -1;

function leastValuableAttacker(sq, side) {
    let s;
    if (side === 0) {
        s = sq + 15; if (!(s & 0x88) && sb[s] === P_PAWN) { lvaSq = s; return P_PAWN; }
        s = sq + 17; if (!(s & 0x88) && sb[s] === P_PAWN) { lvaSq = s; return P_PAWN; }
    } else {
        s = sq - 15; if (!(s & 0x88) && sb[s] === (P_PAWN | BLACK)) { lvaSq = s; return P_PAWN; }
        s = sq - 17; if (!(s & 0x88) && sb[s] === (P_PAWN | BLACK)) { lvaSq = s; return P_PAWN; }
    }
    for (let i = 0; i < 8; i++) {
        s = sq + KNIGHT_OFFSETS[i];
        if (!(s & 0x88) && sb[s] === (P_KNIGHT | side)) { lvaSq = s; return P_KNIGHT; }
    }
    let rookSq = -1, queenSq = -1;
    for (let i = 0; i < 4; i++) {
        const d = DIAG_OFFSETS[i];
        s = sq + d;
        while (!(s & 0x88)) {
            const p = sb[s];
            if (p) {
                if (p === (P_BISHOP | side)) { lvaSq = s; return P_BISHOP; }
                if (p === (P_QUEEN | side)) queenSq = s;
                break;
            }
            s += d;
        }
    }
    for (let i = 0; i < 4; i++) {
        const d = ORTHO_OFFSETS[i];
        s = sq + d;
        while (!(s & 0x88)) {
            const p = sb[s];
            if (p) {
                if (p === (P_ROOK | side)) rookSq = s;
                else if (p === (P_QUEEN | side)) queenSq = s;
                break;
            }
            s += d;
        }
    }
    if (rookSq >= 0) { lvaSq = rookSq; return P_ROOK; }
    if (queenSq >= 0) { lvaSq = queenSq; return P_QUEEN; }
    for (let i = 0; i < 8; i++) {
        s = sq + KING_OFFSETS[i];
        if (!(s & 0x88) && sb[s] === (P_KING | side)) { lvaSq = s; return P_KING; }
    }
    return 0;
}

function seeExchange(from, to, victimValue) {
    const attacker = sb[from];
    if (!attacker) return 0;
    let side = (attacker & BLACK) ^ BLACK;
    let attackerVal = SEE_VALUE_T[attacker & 7];
    let lifted = 0, d = 0;
    seeGain[0] = victimValue;
    seeLifted[lifted++] = from; seeLifted[lifted++] = attacker; sb[from] = 0;

    while (d < 30) {
        d++;
        seeGain[d] = attackerVal - seeGain[d - 1];
        if (Math.max(-seeGain[d - 1], seeGain[d]) < 0) break;
        const t = leastValuableAttacker(to, side);
        if (!t) break;
        const asq = lvaSq;
        if (t === P_KING) {
            // A king may only capture onto a square the other side no longer defends.
            const king = sb[asq];
            sb[asq] = 0;
            const defended = leastValuableAttacker(to, side ^ BLACK) !== 0;
            sb[asq] = king;
            if (defended) break;
        }
        attackerVal = SEE_VALUE_T[t];
        seeLifted[lifted++] = asq; seeLifted[lifted++] = sb[asq]; sb[asq] = 0;
        side ^= BLACK;
    }
    while (--d > 0) seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]);
    for (let i = lifted - 2; i >= 0; i -= 2) sb[seeLifted[i]] = seeLifted[i + 1];
    return seeGain[0];
}

function seeMove(m) {
    const to = (m >> 7) & 127;
    const victim = sb[to];
    const victimValue = victim ? SEE_VALUE_T[victim & 7] : ((m >> 17) & MF_EP ? 100 : 0);
    return seeExchange(m & 127, to, victimValue);
}

// What the opponent of the piece on search-board square `sq` nets by capturing
// it right now (SEE with their least valuable attacker); 0 when it's safe.
function sbCaptureGain(sq) {
    const p = sb[sq];
    if (!p || (p & 7) === P_KING) return 0;
    const t = leastValuableAttacker(sq, (p & BLACK) ^ BLACK);
    if (!t) return 0;
    return Math.max(0, seeExchange(lvaSq, sq, SEE_VALUE_T[p & 7]));
}

// Real-board helpers for the Game Analysis Engine's sacrifice detection.
function captureGainOn(x, y) {
    loadSearchBoard();
    return sbCaptureGain(y * 16 + x);
}

// Largest capture gain available against any of `color`'s pieces ("how much is
// left hanging"), optionally ignoring the piece on (exceptX, exceptY).
function maxHangingValue(color, exceptX = -1, exceptY = -1) {
    loadSearchBoard();
    const own = color === 'white' ? 0 : BLACK;
    const except = exceptX >= 0 ? exceptY * 16 + exceptX : -1;
    let worst = 0;
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        if (sq === except || !sb[sq] || (sb[sq] & BLACK) !== own) continue;
        const gain = sbCaptureGain(sq);
        if (gain > worst) worst = gain;
    }
    return worst;
}

// ─── SEARCH CONSTANTS ─────────────────────────────────────────────────────────
const INF = 1000000;
const MATE = 100000;          // mate scores are ±(MATE - plies to mate)
const MATE_BOUND = MATE - 1000;
const MAX_QDEPTH = 8;

// ─── CONTEMPT (draw avoidance) ─────────────────────────────────────────────────
// Draws (repetition, stalemate, 50-move) are scored as a small loss for the side
// the search plays FOR (the root side) and a small gain for its opponent, so the
// engine steers away from draws while better and accepts them once worse. The
// Game Analysis Engine searches with 0 contempt for an objective evaluation.
const CONTEMPT = 60;
let searchContempt = CONTEMPT;
let rootSide = 0;
let lastSearchSignature = null;

function drawScore() {
    return sbSide === rootSide ? -searchContempt : searchContempt;
}

// ─── REPETITION STACK ──────────────────────────────────────────────────────────
// Hashes of the game's recorded positions followed by the current search line.
// A position can only repeat one with the same side to move (every 2nd entry)
// reached since the last irreversible move (half-move clock), so the backwards
// scan is short. A line that would trigger the real threefold rule is a draw.
const REP_CAPACITY = 512 + MAX_PLY;
const repLo = new Int32Array(REP_CAPACITY), repHi = new Int32Array(REP_CAPACITY);
let repSp = 0;

function repetitionCount() {
    let count = 0;
    const stop = Math.max(0, repSp - sbHalf);
    for (let i = repSp - 2; i >= stop; i -= 2) {
        if (repLo[i] === sbLo && repHi[i] === sbHi) count++;
    }
    return count;
}

function loadRepetitionStack() {
    const n = hashHistoryLo.length;
    repSp = 0;
    for (let i = Math.max(0, n - 256); i < n; i++) { repLo[repSp] = hashHistoryLo[i]; repHi[repSp] = hashHistoryHi[i]; repSp++; }
    // Root position not recorded yet (e.g. a position set up directly): add it.
    if (repSp === 0 || repLo[repSp - 1] !== sbLo || repHi[repSp - 1] !== sbHi) {
        repLo[repSp] = sbLo; repHi[repSp] = sbHi; repSp++;
    }
}

// ─── TRANSPOSITION TABLE (typed arrays, allocated on first search) ───────────
// One slot per (hash & mask), keeping both hash halves for verification, the
// score (mate scores stored node-relative), bound type, depth, best move and
// the search generation — entries from older searches are replaced first. The
// table persists between searches of the same game, a head start for the next.
const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
let ttLo = null, ttHi, ttScore, ttMove, ttDepth, ttFlag, ttGen;
let ttGeneration = 0;

function ttEnsure() {
    if (ttLo) return;
    ttLo = new Int32Array(TT_SIZE); ttHi = new Int32Array(TT_SIZE);
    ttScore = new Int32Array(TT_SIZE); ttMove = new Int32Array(TT_SIZE);
    ttDepth = new Int8Array(TT_SIZE); ttFlag = new Uint8Array(TT_SIZE); ttGen = new Uint8Array(TT_SIZE);
}

// Forget everything learned (new game). Searches within one game keep the table.
function clearSearchMemory() {
    if (ttLo) ttFlag.fill(0);
    historyTable.fill(0);
}

function ttProbe() {
    const i = sbLo & TT_MASK;
    return ttFlag[i] !== 0 && ttLo[i] === sbLo && ttHi[i] === sbHi ? i : -1;
}

function scoreToTT(s, ply)   { return s >= MATE_BOUND ? s + ply : s <= -MATE_BOUND ? s - ply : s; }
function scoreFromTT(s, ply) { return s >= MATE_BOUND ? s - ply : s <= -MATE_BOUND ? s + ply : s; }

function ttStore(depth, score, flag, move, ply) {
    const i = sbLo & TT_MASK;
    const same = ttFlag[i] !== 0 && ttLo[i] === sbLo && ttHi[i] === sbHi;
    if (!same && ttFlag[i] !== 0 && ttGen[i] === (ttGeneration & 255) && ttDepth[i] > depth) return;
    if (!same || move) ttMove[i] = move;
    ttLo[i] = sbLo; ttHi[i] = sbHi;
    ttScore[i] = scoreToTT(score, ply);
    ttDepth[i] = depth; ttFlag[i] = flag; ttGen[i] = ttGeneration & 255;
}

// ─── MOVE ORDERING ─────────────────────────────────────────────────────────────
// TT move, then winning/equal captures and promotions (MVV-LVA), two killer
// moves per ply, quiet moves by history score, and last captures that lose
// material by SEE. Selection-picked lazily, since cutoffs usually come early.
const killers = new Int32Array(MAX_PLY * 2);
const historyTable = new Int32Array(1 << 14); // indexed by from | to << 7

const SCORE_TT = 4000000, SCORE_GOOD_CAPTURE = 2000000, SCORE_KILLER1 = 1500000,
      SCORE_KILLER2 = 1400000, SCORE_BAD_CAPTURE = -1000000, SCORE_SKIP = -2000000000;

function scoreMoves(base, n, ttMoveHere, ply) {
    const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (let i = base; i < base + n; i++) {
        const m = moveBuf[i];
        if (m === ttMoveHere) { scoreBuf[i] = SCORE_TT; continue; }
        const to = (m >> 7) & 127, victim = sb[to], promo = (m >> 14) & 7;
        if (victim || promo || ((m >> 17) & MF_EP)) {
            const vt = victim ? victim & 7 : (promo ? 0 : P_PAWN);
            const at = sb[m & 127] & 7;
            let s = SCORE_GOOD_CAPTURE + PIECE_VALUE_T[vt] * 16 - at + (promo === P_QUEEN ? 8000 : promo ? -8000 : 0);
            if (victim && !promo && PIECE_VALUE_T[at] > PIECE_VALUE_T[vt]) {
                const gain = seeMove(m);
                if (gain < 0) s = SCORE_BAD_CAPTURE + gain;
            }
            scoreBuf[i] = s;
        } else if (m === k1) scoreBuf[i] = SCORE_KILLER1;
        else if (m === k2) scoreBuf[i] = SCORE_KILLER2;
        else scoreBuf[i] = Math.min(historyTable[m & 0x3FFF], SCORE_KILLER2 - 1);
    }
}

function pickMove(i, end) {
    let bi = i;
    for (let j = i + 1; j < end; j++) if (scoreBuf[j] > scoreBuf[bi]) bi = j;
    if (bi !== i) {
        const tm = moveBuf[i]; moveBuf[i] = moveBuf[bi]; moveBuf[bi] = tm;
        const ts = scoreBuf[i]; scoreBuf[i] = scoreBuf[bi]; scoreBuf[bi] = ts;
    }
    return moveBuf[i];
}

// ─── TIME-BOUNDED SEARCH PLUMBING ─────────────────────────────────────────────
class SearchTimeUp extends Error {}

let searchDeadline = Infinity;
let nodeCount = 0;

function checkTime() {
    if (Date.now() > searchDeadline) throw new SearchTimeUp();
}

// ─── QUIESCENCE SEARCH (captures + queen promotions, avoids the horizon effect) ─
// Captures that can't raise alpha even winning the piece outright (delta
// pruning) or that lose material by SEE are skipped.
const DELTA_MARGIN = 200;

function quiescence(alpha, beta, ply, qdepth) {
    if ((++nodeCount & 1023) === 0) checkTime();

    const standPat = evaluateSideToMove();
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= MAX_QDEPTH || ply >= MAX_PLY - 1) return alpha;

    const base = ply * MOVE_SLOTS;
    const n = sbGenerate(base, true);
    const end = base + n;
    for (let i = base; i < end; i++) {
        const m = moveBuf[i];
        const to = (m >> 7) & 127, victim = sb[to], promo = (m >> 14) & 7;
        const vv = victim ? PIECE_VALUE_T[victim & 7] : ((m >> 17) & MF_EP ? 100 : 0);
        const at = sb[m & 127] & 7;
        if (!promo && standPat + vv + DELTA_MARGIN <= alpha) { scoreBuf[i] = SCORE_SKIP; continue; }
        if (!promo && victim && PIECE_VALUE_T[at] > vv && seeMove(m) < 0) { scoreBuf[i] = SCORE_SKIP; continue; }
        scoreBuf[i] = vv * 16 - at + (promo ? 10000 : 0);
    }

    for (let i = base; i < end; i++) {
        const m = pickMove(i, end);
        if (scoreBuf[i] === SCORE_SKIP) break;
        if (!sbMakeLegal(m)) continue;
        const score = -quiescence(-beta, -alpha, ply + 1, qdepth + 1);
        sbUnmake(m);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }
    return alpha;
}

// ─── NEGAMAX: PVS + ALPHA-BETA + TT + NULL MOVE + LMR + CHECK EXTENSION ──────
// Null-move pruning: if handing the opponent a free move still fails high, the
// real position almost certainly does too. Skipped in check, twice in a row,
// near mate windows, and with only king + pawns (zugzwang territory).
// Late move reductions: quiet, non-checking moves ordered after the first few
// are probed at reduced depth with a null window; only a probe that beats
// alpha earns the full-depth re-search.
const NULL_MOVE_MIN_DEPTH = 3;
const LMR_MIN_DEPTH = 3;
const LMR_FULL_SEARCH_MOVES = 3;

function negamax(depth, alpha, beta, ply, allowNull) {
    if ((++nodeCount & 1023) === 0) checkTime();

    if (sbHalf >= 100) return drawScore();

    // Mate-distance pruning: nothing here can beat a mate already found nearer the root.
    const matedHere = -MATE + ply;
    if (alpha < matedHere) alpha = matedHere;
    if (beta > MATE - ply - 1) beta = MATE - ply - 1;
    if (alpha >= beta) return alpha;

    const ti = ttProbe();
    let ttMoveHere = 0;
    if (ti >= 0) {
        ttMoveHere = ttMove[ti];
        if (ttDepth[ti] >= depth) {
            const s = scoreFromTT(ttScore[ti], ply);
            const f = ttFlag[ti];
            if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
        }
    }

    const inCheck = sbInCheck();
    if (inCheck && ply < MAX_PLY - 16) depth++;

    if (depth <= 0) return quiescence(alpha, beta, ply, 0);
    if (ply >= MAX_PLY - 1) return evaluateSideToMove();

    if (allowNull && !inCheck && depth >= NULL_MOVE_MIN_DEPTH && beta < MATE_BOUND && beta > -MATE_BOUND
        && sbHasNonPawnMaterial(sbSide) && evaluateSideToMove() >= beta) {
        const reduction = depth > 6 ? 3 : 2;
        sbMakeNull();
        const nullScore = -negamax(depth - 1 - reduction, -beta, -beta + 1, ply + 1, false);
        sbUnmakeNull();
        if (nullScore >= beta) return nullScore >= MATE_BOUND ? beta : nullScore;
    }

    const base = ply * MOVE_SLOTS;
    const n = sbGenerate(base, false);
    const end = base + n;
    scoreMoves(base, n, ttMoveHere, ply);

    const origAlpha = alpha;
    let best = -INF, bestMove = 0, legal = 0;

    for (let i = base; i < end; i++) {
        const m = pickMove(i, end);
        const isQuiet = !sb[(m >> 7) & 127] && !((m >> 14) & 7) && !((m >> 17) & MF_EP);
        const moveScore = scoreBuf[i];
        if (!sbMakeLegal(m)) continue;
        legal++;

        let score;
        if (repetitionCount() + 1 >= 3) {
            score = -drawScore();
        } else {
            repLo[repSp] = sbLo; repHi[repSp] = sbHi; repSp++;
            if (legal === 1) {
                score = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
            } else {
                let reduction = 0;
                if (depth >= LMR_MIN_DEPTH && legal > LMR_FULL_SEARCH_MOVES && isQuiet && !inCheck
                    && moveScore < SCORE_KILLER2 && !sbInCheck()) {
                    reduction = legal > LMR_FULL_SEARCH_MOVES + 5 ? 2 : 1;
                }
                score = -negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
                if (score > alpha && reduction > 0) score = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
                if (score > alpha && score < beta) score = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
            }
            repSp--;
        }
        sbUnmake(m);

        if (score > best) { best = score; bestMove = m; }
        if (score > alpha) {
            alpha = score;
            if (alpha >= beta) {
                if (isQuiet) {
                    if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
                    const h = m & 0x3FFF;
                    historyTable[h] += depth * depth;
                    if (historyTable[h] > 1000000) for (let k = 0; k < historyTable.length; k++) historyTable[k] >>= 1;
                }
                break;
            }
        }
    }

    if (legal === 0) return inCheck ? matedHere : drawScore();

    ttStore(depth, best, best <= origAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT, bestMove, ply);
    return best;
}

// ─── SEARCH BOARD <-> GAME MOVE CONVERSION, SAN ───────────────────────────────
function sbSquareName(sq) { return FILE_NAMES[sq & 7] + (8 - (sq >> 4)); }

// SAN for search-board move `m` in the current search-board position.
function sbSAN(m) {
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    const p = sb[from], t = p & 7;
    let san;
    if (flags & MF_CASTLE) {
        san = (to & 7) === 6 ? 'O-O' : 'O-O-O';
    } else {
        const capture = sb[to] !== 0 || (flags & MF_EP);
        let dis = '';
        if (t !== P_PAWN) {
            const n = sbLegalMoves(SCRATCH_BASE);
            let ambiguous = false, sameFile = false, sameRank = false;
            for (let i = SCRATCH_BASE; i < SCRATCH_BASE + n; i++) {
                const f2 = moveBuf[i] & 127;
                if (f2 !== from && ((moveBuf[i] >> 7) & 127) === to && sb[f2] === p) {
                    ambiguous = true;
                    if ((f2 & 7) === (from & 7)) sameFile = true;
                    if ((f2 >> 4) === (from >> 4)) sameRank = true;
                }
            }
            if (ambiguous) dis = !sameFile ? FILE_NAMES[from & 7] : !sameRank ? String(8 - (from >> 4)) : sbSquareName(from);
        }
        san = TYPE_LETTERS[t] + dis + (t === P_PAWN && capture ? FILE_NAMES[from & 7] : '')
            + (capture ? 'x' : '') + sbSquareName(to) + (promo ? '=' + TYPE_LETTERS[promo] : '');
    }
    sbMake(m);
    if (sbInCheck()) san += sbLegalMoves(SCRATCH_BASE + MOVE_SLOTS) > 0 ? '+' : '#';
    sbUnmake(m);
    return san;
}

// Search-board move -> { move: { fromX, fromY, toX, toY, details }, promo } for
// the real board (gameState must be at the searched position).
function toGameMove(m, gameMoves) {
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7;
    const fx = from & 7, fy = from >> 4, tx = to & 7, ty = to >> 4;
    const move = gameMoves.find(g => g.fromX === fx && g.fromY === fy && g.toX === tx && g.toY === ty);
    return { move, promo: promo ? TYPE_NAMES[promo] : null };
}

function fromGameMove(move, promo, rootMoves) {
    const from = move.fromY * 16 + move.fromX, to = move.toY * 16 + move.toX;
    const promoCode = promo ? PIECE_ORDER[promo] + 1 : P_QUEEN;
    return rootMoves.find(m => (m & 127) === from && ((m >> 7) & 127) === to
        && (!((m >> 14) & 7) || ((m >> 14) & 7) === promoCode)) || 0;
}

// Follows best moves stored in the transposition table to reconstruct the
// principal variation, as SAN. Stops at a missing/illegal entry or a repetition.
function extractPV(first, maxLen) {
    const sans = [], made = [];
    const seen = new Set();
    let m = first;
    while (m && sans.length < maxLen) {
        sans.push(sbSAN(m));
        sbMake(m); made.push(m);
        const key = sbLo + ':' + sbHi;
        if (seen.has(key)) break;
        seen.add(key);
        const ti = ttProbe();
        const next = ti >= 0 ? ttMove[ti] : 0;
        if (!next) break;
        const n = sbLegalMoves(SCRATCH_BASE);
        m = 0;
        for (let i = SCRATCH_BASE; i < SCRATCH_BASE + n; i++) if (moveBuf[i] === next) { m = next; break; }
    }
    for (let i = made.length - 1; i >= 0; i--) sbUnmake(made[i]);
    return sans;
}

// ─── ROOT SEARCH ───────────────────────────────────────────────────────────────
// Iterative deepening over the root moves of the side to move on the real
// board; only results of fully completed depths are used. Options:
//   timeMs, maxDepth – limits (depth 1 always completes)
//   evalNoise        – centipawn jitter (uniform ±evalNoise) applied to each
//                      root move's exact score when choosing (weaker levels).
//                      A move scoring at or below best − 2·evalNoise can never
//                      win the draw, so those only get a cheap null-window
//                      "is it below that line?" probe instead of an exact score
//   multiPV          – how many top moves get exact scores (default 1)
//   includeMove/includePromo – a game move whose exact score is always computed
//                      (the move actually played, for the Game Analysis Engine)
//   contempt         – draw contempt (default CONTEMPT)
//   searchForced     – still search when only one legal move exists
//   withLines        – also return SAN for the scored lines and the PV
// Returns { move, promo, score, depth, nodes, lines:[{move,promo,san,score}],
// includedScore, pv:[san] } — scores from the mover's view, mates ±(MATE-plies).
function searchRoot(color, opts = {}) {
    const timeMs = opts.timeMs ?? 1000;
    const maxDepth = Math.min(opts.maxDepth ?? 6, MAX_PLY - 2);
    const evalNoise = opts.evalNoise || 0;
    const multiPV = Math.max(1, opts.multiPV || 1);

    ttEnsure();
    loadSearchBoard();
    stSp = 0;
    searchContempt = opts.contempt ?? CONTEMPT;
    rootSide = sbSide;
    // Draw scores inside TT entries depend on contempt and on the side searched
    // for, so the table is only reused while both stay the same.
    const signature = searchContempt === 0 ? 'neutral' : `${rootSide}/${searchContempt}`;
    if (lastSearchSignature !== signature) ttFlag.fill(0);
    lastSearchSignature = signature;
    ttGeneration++;
    nodeCount = 0;
    killers.fill(0);
    for (let h = 0; h < historyTable.length; h++) historyTable[h] >>= 2;
    loadRepetitionStack();

    const gameMoves = getAllValidMoves(currentTurn);
    const n = sbLegalMoves(SCRATCH_BASE);
    const rootMoves = Array.from(moveBuf.subarray(SCRATCH_BASE, SCRATCH_BASE + n));
    const result = { move: null, promo: null, score: null, depth: 0, nodes: 0, lines: [], includedScore: null, pv: [] };
    if (n === 0) return result;

    const includeMove = opts.includeMove ? fromGameMove(opts.includeMove, opts.includePromo, rootMoves) : 0;
    if (n === 1 && !opts.searchForced) {
        const g = toGameMove(rootMoves[0], gameMoves);
        const score = evaluateSideToMove();
        return { ...result, move: g.move, promo: g.promo, score, includedScore: score,
                 lines: [{ ...g, san: opts.withLines ? sbSAN(rootMoves[0]) : null, score }] };
    }

    scoreMoves(SCRATCH_BASE, n, 0, 0);
    let entries = rootMoves.map((m, i) => ({ m, score: -INF, exact: false, order: scoreBuf[SCRATCH_BASE + i], include: m === includeMove }));
    entries.sort((a, b) => b.order - a.order);

    const exactAll = multiPV >= entries.length;
    let completedDepth = 0;

    const searchChild = (m, depth, alpha, beta) => {
        sbMake(m);
        let s;
        if (repetitionCount() + 1 >= 3) {
            s = -drawScore();
        } else {
            repLo[repSp] = sbLo; repHi[repSp] = sbHi; repSp++;
            s = -negamax(depth - 1, -beta, -alpha, 1, true);
            repSp--;
        }
        sbUnmake(m);
        return s;
    };

    searchDeadline = Infinity; // depth 1 always completes, whatever the budget
    const deadline = Date.now() + timeMs;
    try {
        for (let depth = 1; depth <= maxDepth; depth++) {
            const exactScores = [];
            const results = new Array(entries.length);
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                let score, exact = true;
                if (exactAll || e.include || exactScores.length < multiPV) {
                    score = searchChild(e.m, depth, -INF, INF);
                } else {
                    // Without noise: is it better than the multiPV-th best so far?
                    // With noise: could it still be picked at all (see evalNoise above)?
                    const alpha = evalNoise > 0 ? exactScores[0] - 2 * evalNoise : exactScores[multiPV - 1];
                    score = searchChild(e.m, depth, alpha, alpha + 1);
                    exact = false;
                    if (score > alpha) { score = searchChild(e.m, depth, alpha, INF); exact = true; }
                }
                results[i] = { score, exact };
                if (exact) { exactScores.push(score); exactScores.sort((a, b) => b - a); }
            }
            entries.forEach((e, i) => { e.score = results[i].score; e.exact = results[i].exact; });
            entries.sort((a, b) => (b.exact - a.exact) || (b.score - a.score));
            completedDepth = depth;
            searchDeadline = deadline;
            if (Date.now() > deadline) break;
            if (!exactAll && entries[0].score >= MATE_BOUND && !includeMove) break; // forced mate found
        }
    } catch (e) {
        if (!(e instanceof SearchTimeUp)) throw e;
        // A timeout unwinds mid-line without unmaking: rebuild the search board.
        loadSearchBoard();
        stSp = 0;
    } finally {
        searchDeadline = Infinity;
    }

    let chosen = entries[0];
    if (evalNoise > 0) {
        let bestJittered = -Infinity;
        for (const e of entries) {
            if (!e.exact) continue; // a bound, not a score — and provably out of reach
            const jittered = e.score + (Math.random() * 2 - 1) * evalNoise;
            if (jittered > bestJittered) { bestJittered = jittered; chosen = e; }
        }
    }

    const g = toGameMove(chosen.m, gameMoves);
    const included = entries.find(e => e.include);
    const lineEntries = entries.filter(e => e.exact).slice(0, opts.withLines ? multiPV : entries.length);
    return {
        move: g.move, promo: g.promo, score: chosen.score, depth: completedDepth, nodes: nodeCount,
        lines: lineEntries.map(e => ({ ...toGameMove(e.m, gameMoves), san: opts.withLines ? sbSAN(e.m) : null, score: e.score })),
        includedScore: included ? included.score : null,
        pv: opts.withLines ? extractPV(chosen.m, Math.max(1, Math.min(completedDepth, 12))) : [],
    };
}

function sameMove(a, b) {
    return !!a && !!b && a.fromX === b.fromX && a.fromY === b.fromY && a.toX === b.toX && a.toY === b.toY;
}
// ─── OPENING BOOK ──────────────────────────────────────────────────────────────
// SAN move sequences matched against the played prefix — directly checkable
// against opening theory, and immune to how positions are hashed.
const OPENING_BOOK = [
    { weight: 3, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },                          // Ruy Lopez
    { weight: 2, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },                          // Italian Game
    { weight: 1, moves: ['e4', 'e5', 'Bc4'] },                                        // Bishop's Opening
    { weight: 1, moves: ['e4', 'e5', 'Nc3'] },                                        // Vienna Game
    { weight: 2, moves: ['e4', 'c5'] },                                               // Sicilian Defense
    { weight: 1, moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3'] }, // Sicilian, Open
    { weight: 2, moves: ['e4', 'e6'] },                                               // French Defense
    { weight: 2, moves: ['e4', 'c6'] },                                               // Caro-Kann
    { weight: 1, moves: ['e4', 'd5'] },                                               // Scandinavian
    { weight: 1, moves: ['e4', 'Nf6'] },                                              // Alekhine's Defense
    { weight: 3, moves: ['d4', 'd5', 'c4'] },                                         // Queen's Gambit
    { weight: 2, moves: ['d4', 'd5', 'c4', 'e6'] },                                   // QGD
    { weight: 2, moves: ['d4', 'd5', 'c4', 'c6'] },                                   // Slav Defense
    { weight: 2, moves: ['d4', 'Nf6', 'c4', 'g6'] },                                  // King's Indian setup
    { weight: 1, moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },                    // Nimzo-Indian
    { weight: 2, moves: ['d4', 'd5', 'Nf3', 'Nf6', 'Bg5'] },                          // Queen's Pawn + Bg5
    { weight: 2, moves: ['d4', 'Nf6', 'Nf3', 'g6', 'Bf4'] },                          // London vs KID setup
    { weight: 1, moves: ['d4', 'f5'] },                                               // Dutch Defense
    { weight: 2, moves: ['Nf3', 'd5', 'g3'] },                                        // Reti Opening
    { weight: 1, moves: ['c4', 'e5'] },                                               // English, Reversed Sicilian
];

function stripCheckSuffix(san) {
    return san.replace(/[+#]$/, '');
}

// `playedSAN` is the game so far as a flat SAN list (check suffixes allowed).
function pickBookMove(color, playedSAN) {
    const played = (playedSAN || []).map(stripCheckSuffix);
    const ply = played.length;

    const candidates = [];
    for (const line of OPENING_BOOK) {
        if (line.moves.length <= ply) continue;
        let matches = true;
        for (let i = 0; i < ply; i++) {
            if (line.moves[i] !== played[i]) { matches = false; break; }
        }
        if (!matches) continue;
        const resolved = resolveSAN(color, line.moves[ply]);
        if (resolved) candidates.push({ move: resolved.move, weight: line.weight });
    }
    if (candidates.length === 0) return null;

    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let r = Math.random() * total;
    for (const c of candidates) {
        r -= c.weight;
        if (r <= 0) return c.move;
    }
    return candidates[candidates.length - 1].move;
}


// Book move or searched move for `color` -> { move, promo } (null move when
// there is no legal move). `playedSAN` is the game so far as a flat SAN list.
function findBestMove(color, timeBudgetMs, maxDepth, evalNoise = 0, playedSAN = []) {
    const bookMove = pickBookMove(color, playedSAN);
    if (bookMove) return { move: bookMove, promo: null };
    const r = searchRoot(color, { timeMs: timeBudgetMs, maxDepth, evalNoise });
    return { move: r.move, promo: r.promo };
}
