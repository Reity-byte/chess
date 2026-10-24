const PIECE_ORDER = { pawn: 0, knight: 1, bishop: 2, rook: 3, queen: 4, king: 5 };

// `code` (0-5, see PIECE_ORDER) and `white` mirror `type`/`color` as plain
// numbers/booleans so the search's hot loops never do string-keyed lookups.
// `type` stays assignable (promotion code sets it directly) and keeps `code` in sync.
class ChessPiece {
    constructor(type, color) {
        this._type = type;
        this.code = PIECE_ORDER[type];
        this.color = color;
        this.white = color === 'white';
        this.hasMoved = false;
    }
    get type() { return this._type; }
    set type(t) { this._type = t; this.code = PIECE_ORDER[t]; }
}

let currentTurn = 'white';
let lastMove = null;

// ─── DRAW DETECTION STATE ───────────────────────────────────────────────────────
// positionHistory maps a numeric position hash (see getBoardKey) -> occurrence
// count, for threefold repetition. A Map with number keys avoids the
// number->string conversion a plain object would pay on every search lookup.
let positionHistory = new Map();
// halfMoveClock counts moves since last pawn move or capture (for 50-move rule)
let halfMoveClock = 0;
// The same recorded positions in game order (hash halves), which the search
// scans backwards for repetitions instead of doing Map lookups per node.
let hashHistoryLo = [], hashHistoryHi = [];

// ─── DIRECTION TABLES (hoisted so move generation never allocates them) ────────
const KNIGHT_DX = [2, 2, -2, -2, 1, 1, -1, -1];
const KNIGHT_DY = [1, -1, 1, -1, 2, -2, 2, -2];
const KING_DX   = [1, 1, 1, 0, 0, -1, -1, -1];
const KING_DY   = [1, 0, -1, 1, -1, 1, 0, -1];
const DIAG_DX   = [1, 1, -1, -1];
const DIAG_DY   = [1, -1, 1, -1];
const ORTHO_DX  = [1, -1, 0, 0];
const ORTHO_DY  = [0, 0, 1, -1];

function initializeBoard() {
    const board = [];
    for (let y = 0; y < 8; y++) board.push(new Array(8).fill(null));
    const backRow = ['rook','knight','bishop','queen','king','bishop','knight','rook'];
    for (let x = 0; x < 8; x++) {
        board[0][x] = new ChessPiece(backRow[x], 'black');
        board[1][x] = new ChessPiece('pawn', 'black');
        board[6][x] = new ChessPiece('pawn', 'white');
        board[7][x] = new ChessPiece(backRow[x], 'white');
    }
    return board;
}

let gameState = initializeBoard();

function resetGame() {
    gameState = initializeBoard();
    currentTurn = 'white';
    lastMove = null;
    positionHistory = new Map();
    hashHistoryLo = []; hashHistoryHi = [];
    halfMoveClock = 0;
    kingPos.white.x = 4; kingPos.white.y = 7;
    kingPos.black.x = 4; kingPos.black.y = 0;
}

// ─── ZOBRIST HASHING ────────────────────────────────────────────────────────────
// Positions are identified by a 53-bit Zobrist hash (two 32-bit halves) instead
// of a 64-character string. It encodes exactly what the old string key did:
// piece placement, side to move, the four castling rights, and the en-passant
// file whenever the last move was a double pawn push. The search (ai.js) uses
// the same keys on its own board and updates them incrementally; positions on
// the real board are hashed from scratch via computeHash().
const Z_PIECE_LO = new Int32Array(12 * 64), Z_PIECE_HI = new Int32Array(12 * 64);
const Z_CASTLE_LO = new Int32Array(16),     Z_CASTLE_HI = new Int32Array(16);
const Z_EP_LO = new Int32Array(8),          Z_EP_HI = new Int32Array(8);
let Z_SIDE_LO = 0, Z_SIDE_HI = 0;

(function seedZobrist() {
    // xorshift32 with a fixed seed: deterministic across page loads and workers,
    // so a hash recorded on the main thread means the same thing in a worker.
    let s = 0x9E3779B9;
    const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; };
    for (let i = 0; i < Z_PIECE_LO.length; i++) { Z_PIECE_LO[i] = next(); Z_PIECE_HI[i] = next(); }
    for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = next(); Z_CASTLE_HI[i] = next(); }
    for (let i = 0; i < 8; i++)  { Z_EP_LO[i] = next(); Z_EP_HI[i] = next(); }
    Z_SIDE_LO = next(); Z_SIDE_HI = next();
    Z_CASTLE_LO[0] = 0; Z_CASTLE_HI[0] = 0; // "no rights" contributes nothing
})();

function pieceIndex(p) {
    return p.white ? p.code : p.code + 6;
}

// Bitmask of castling rights still available: 1=K, 2=Q, 4=k, 8=q.
function castleRightsMask() {
    let m = 0;
    const wk = gameState[7][4];
    if (wk && wk.type === 'king' && wk.color === 'white' && !wk.hasMoved) {
        const r1 = gameState[7][7], r2 = gameState[7][0];
        if (r1 && r1.type === 'rook' && r1.color === 'white' && !r1.hasMoved) m |= 1;
        if (r2 && r2.type === 'rook' && r2.color === 'white' && !r2.hasMoved) m |= 2;
    }
    const bk = gameState[0][4];
    if (bk && bk.type === 'king' && bk.color === 'black' && !bk.hasMoved) {
        const r1 = gameState[0][7], r2 = gameState[0][0];
        if (r1 && r1.type === 'rook' && r1.color === 'black' && !r1.hasMoved) m |= 4;
        if (r2 && r2.type === 'rook' && r2.color === 'black' && !r2.hasMoved) m |= 8;
    }
    return m;
}

function epFileOf(lm) {
    return lm && lm.piece && lm.piece.type === 'pawn' && Math.abs(lm.fromY - lm.toY) === 2 ? lm.toX : -1;
}

function computeHash() {
    let lo = 0, hi = 0;
    for (let y = 0; y < 8; y++) {
        const row = gameState[y];
        for (let x = 0; x < 8; x++) {
            const p = row[x];
            if (!p) continue;
            const i = pieceIndex(p) * 64 + y * 8 + x;
            lo ^= Z_PIECE_LO[i]; hi ^= Z_PIECE_HI[i];
        }
    }
    const cr = castleRightsMask();
    lo ^= Z_CASTLE_LO[cr]; hi ^= Z_CASTLE_HI[cr];
    const ep = epFileOf(lastMove);
    if (ep >= 0) { lo ^= Z_EP_LO[ep]; hi ^= Z_EP_HI[ep]; }
    if (currentTurn === 'black') { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    return { lo, hi };
}

// Folds the two halves into one exact JS number (21 + 32 bits) usable as a Map key.
function hashKey(lo, hi) {
    return (hi & 0x1FFFFF) * 4294967296 + (lo >>> 0);
}

function getBoardKey() {
    const h = computeHash();
    return hashKey(h.lo, h.hi);
}

function recordPosition() {
    const h = computeHash();
    hashHistoryLo.push(h.lo); hashHistoryHi.push(h.hi);
    const key = hashKey(h.lo, h.hi);
    const n = (positionHistory.get(key) || 0) + 1;
    positionHistory.set(key, n);
    return n;
}

// ─── INSUFFICIENT MATERIAL CHECK ──────────────────────────────────────────────
function isInsufficientMaterial() {
    const pieces = { white: [], black: [] };
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.type !== 'king') {
                if (pieces[p.color].length >= 2) return false;
                pieces[p.color].push({ type: p.type, x, y });
            }
        }
    }
    const w = pieces.white;
    const b = pieces.black;
    const isMinor = (p) => p.type === 'bishop' || p.type === 'knight';

    if (w.length === 0 && b.length === 0) return true;                       // K vs K
    if (w.length === 0 && b.length === 1 && isMinor(b[0])) return true;     // K vs K+minor
    if (b.length === 0 && w.length === 1 && isMinor(w[0])) return true;
    if (w.length === 1 && b.length === 1 && w[0].type === 'bishop' && b[0].type === 'bishop') {
        return (w[0].x + w[0].y) % 2 === (b[0].x + b[0].y) % 2;              // same-colored bishops
    }
    return false;
}

// ─── MOVE PIECE (real moves: UI, replays) ────────────────────────────────────
function movePiece(fromX, fromY, toX, toY, moveDetails = null) {
    const movingPiece = gameState[fromY][fromX];
    const capturedPiece = gameState[toY][toX];

    // Castling: teleport the rook
    if (moveDetails && moveDetails.isCastle) {
        const rook = gameState[fromY][moveDetails.rookFromX];
        gameState[fromY][moveDetails.rookToX] = rook;
        gameState[fromY][moveDetails.rookFromX] = null;
        rook.hasMoved = true;
    }

    // En passant: remove the captured pawn
    if (moveDetails && moveDetails.isEnPassant) {
        gameState[moveDetails.captureY][moveDetails.captureX] = null;
    }

    gameState[toY][toX] = movingPiece;
    gameState[fromY][fromX] = null;
    movingPiece.hasMoved = true;
    if (movingPiece.type === 'king') { kingPos[movingPiece.color].x = toX; kingPos[movingPiece.color].y = toY; }

    lastMove = { piece: movingPiece, fromX, fromY, toX, toY };

    if (movingPiece.type === 'pawn' || capturedPiece || (moveDetails && moveDetails.isEnPassant)) {
        halfMoveClock = 0;
    } else {
        halfMoveClock++;
    }

    // Promotion: the caller picks the piece and flips the turn afterwards.
    const isPromotionMove = movingPiece.type === 'pawn' && (toY === 0 || toY === 7);
    if (!isPromotionMove) {
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }
    return isPromotionMove;
}

// Plays a fully-resolved move including its promotion choice (defaults to a
// queen) and flips the turn. The one helper every replay path shares.
function applyMoveWithPromotion(move, promo) {
    const isPromoting = movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);
    if (isPromoting) {
        gameState[move.toY][move.toX].type = promo || 'queen';
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }
    return isPromoting;
}

// ─── PSEUDO-LEGAL MOVE GENERATION ────────────────────────────────────────────
// Pushes { fromX, fromY, toX, toY, details } records into `out`. `details` is the
// object movePiece() expects (it carries the castling / en-passant extras).
// capturesOnly restricts output to captures, en passant, and promotions — the
// "tactical" moves quiescence search looks at.
function pushMove(out, fx, fy, tx, ty, details) {
    out.push({ fromX: fx, fromY: fy, toX: tx, toY: ty, details: details || { x: tx, y: ty } });
}

function genSlides(out, x, y, color, dxs, dys, capturesOnly) {
    for (let d = 0; d < dxs.length; d++) {
        const dx = dxs[d], dy = dys[d];
        let cx = x + dx, cy = y + dy;
        while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
            const t = gameState[cy][cx];
            if (t === null) {
                if (!capturesOnly) pushMove(out, x, y, cx, cy);
            } else {
                if (t.color !== color) pushMove(out, x, y, cx, cy);
                break;
            }
            cx += dx; cy += dy;
        }
    }
}

function genSteps(out, x, y, color, dxs, dys, capturesOnly) {
    for (let d = 0; d < dxs.length; d++) {
        const cx = x + dxs[d], cy = y + dys[d];
        if (cx < 0 || cx >= 8 || cy < 0 || cy >= 8) continue;
        const t = gameState[cy][cx];
        if (t === null ? !capturesOnly : t.color !== color) pushMove(out, x, y, cx, cy);
    }
}

function genPieceMoves(out, x, y, piece, capturesOnly, checkCastling) {
    const color = piece.color;
    switch (piece.type) {
        case 'pawn': {
            const dir = color === 'white' ? -1 : 1;
            const startRow = color === 'white' ? 6 : 1;
            const ny = y + dir;
            if (ny < 0 || ny > 7) return;
            const promoRank = ny === 0 || ny === 7;
            if (gameState[ny][x] === null && (!capturesOnly || promoRank)) {
                pushMove(out, x, y, x, ny);
                if (!capturesOnly && y === startRow && gameState[y + 2 * dir][x] === null) {
                    pushMove(out, x, y, x, y + 2 * dir);
                }
            }
            for (let dx = -1; dx <= 1; dx += 2) {
                const nx = x + dx;
                if (nx < 0 || nx > 7) continue;
                const t = gameState[ny][nx];
                if (t && t.color !== color) pushMove(out, x, y, nx, ny);
            }
            // En passant
            const lm = lastMove;
            if (lm && lm.toY === y && Math.abs(lm.toX - x) === 1 && Math.abs(lm.fromY - lm.toY) === 2) {
                const adj = gameState[y][lm.toX];
                if (adj && adj === lm.piece && adj.type === 'pawn' && adj.color !== color) {
                    pushMove(out, x, y, lm.toX, ny, { x: lm.toX, y: ny, isEnPassant: true, captureX: lm.toX, captureY: y });
                }
            }
            return;
        }
        case 'knight': genSteps(out, x, y, color, KNIGHT_DX, KNIGHT_DY, capturesOnly); return;
        case 'bishop': genSlides(out, x, y, color, DIAG_DX, DIAG_DY, capturesOnly); return;
        case 'rook':   genSlides(out, x, y, color, ORTHO_DX, ORTHO_DY, capturesOnly); return;
        case 'queen':
            genSlides(out, x, y, color, DIAG_DX, DIAG_DY, capturesOnly);
            genSlides(out, x, y, color, ORTHO_DX, ORTHO_DY, capturesOnly);
            return;
        case 'king': {
            genSteps(out, x, y, color, KING_DX, KING_DY, capturesOnly);
            if (capturesOnly || !checkCastling || piece.hasMoved) return;
            const enemy = color === 'white' ? 'black' : 'white';
            if (isSquareAttacked(x, y, enemy)) return;
            const row = gameState[y];
            const kRook = row[7];
            if (kRook && kRook.type === 'rook' && kRook.color === color && !kRook.hasMoved
                && row[5] === null && row[6] === null && !isSquareAttacked(5, y, enemy)) {
                pushMove(out, x, y, 6, y, { x: 6, y, isCastle: true, rookFromX: 7, rookToX: 5 });
            }
            const qRook = row[0];
            if (qRook && qRook.type === 'rook' && qRook.color === color && !qRook.hasMoved
                && row[1] === null && row[2] === null && row[3] === null && !isSquareAttacked(3, y, enemy)) {
                pushMove(out, x, y, 2, y, { x: 2, y, isCastle: true, rookFromX: 0, rookToX: 3 });
            }
        }
    }
}

// Reverse "who attacks this square" lookup: walk outward from (tx,ty) per
// piece-type pattern and check what's there.
function isSquareAttacked(tx, ty, enemyColor) {
    // Pawns: an enemy pawn attacks (tx,ty) from one diagonal step "behind" it.
    const py = ty + (enemyColor === 'white' ? 1 : -1);
    if (py >= 0 && py < 8) {
        const row = gameState[py];
        if (tx > 0) { const p = row[tx - 1]; if (p && p.type === 'pawn' && p.color === enemyColor) return true; }
        if (tx < 7) { const p = row[tx + 1]; if (p && p.type === 'pawn' && p.color === enemyColor) return true; }
    }
    for (let d = 0; d < 8; d++) {
        const nx = tx + KNIGHT_DX[d], ny = ty + KNIGHT_DY[d];
        if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
            const p = gameState[ny][nx];
            if (p && p.type === 'knight' && p.color === enemyColor) return true;
        }
    }
    for (let d = 0; d < 8; d++) {
        const nx = tx + KING_DX[d], ny = ty + KING_DY[d];
        if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
            const p = gameState[ny][nx];
            if (p && p.type === 'king' && p.color === enemyColor) return true;
        }
    }
    for (let d = 0; d < 4; d++) {
        const dx = DIAG_DX[d], dy = DIAG_DY[d];
        let cx = tx + dx, cy = ty + dy;
        while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
            const p = gameState[cy][cx];
            if (p) {
                if (p.color === enemyColor && (p.type === 'bishop' || p.type === 'queen')) return true;
                break;
            }
            cx += dx; cy += dy;
        }
    }
    for (let d = 0; d < 4; d++) {
        const dx = ORTHO_DX[d], dy = ORTHO_DY[d];
        let cx = tx + dx, cy = ty + dy;
        while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
            const p = gameState[cy][cx];
            if (p) {
                if (p.color === enemyColor && (p.type === 'rook' || p.type === 'queen')) return true;
                break;
            }
            cx += dx; cy += dy;
        }
    }
    return false;
}

// ─── KING LOCATION CACHE ─────────────────────────────────────────────────────
// findKing() used to scan all 64 squares and was called once per candidate move
// during legality checks. The cache is verified on every read (falls back to a
// scan if stale), so any code that edits gameState directly stays correct.
const kingPos = { white: { x: 4, y: 7 }, black: { x: 4, y: 0 } };

function findKing(color) {
    const c = kingPos[color];
    const p = gameState[c.y][c.x];
    if (p && p.type === 'king' && p.color === color) return c;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const q = gameState[y][x];
            if (q && q.type === 'king' && q.color === color) { c.x = x; c.y = y; return c; }
        }
    }
    return null;
}

function isInCheck(color) {
    const kp = findKing(color);
    return !!kp && isSquareAttacked(kp.x, kp.y, color === 'white' ? 'black' : 'white');
}

// Make the move on the board, test whether the mover's king is attacked, restore.
function leavesKingSafe(move, kx, ky, enemy) {
    const { fromX, fromY, toX, toY, details } = move;
    const piece = gameState[fromY][fromX];
    const captured = gameState[toY][toX];
    let epCaptured = null;
    if (details.isEnPassant) {
        epCaptured = gameState[details.captureY][details.captureX];
        gameState[details.captureY][details.captureX] = null;
    }
    gameState[toY][toX] = piece;
    gameState[fromY][fromX] = null;

    const safe = !isSquareAttacked(kx, ky, enemy);

    gameState[fromY][fromX] = piece;
    gameState[toY][toX] = captured;
    if (details.isEnPassant) gameState[details.captureY][details.captureX] = epCaptured;
    return safe;
}

// Filters pseudo-legal moves of one side down to legal ones. The expensive
// make/test/unmake is skipped for the common case: when the side isn't in check,
// a non-king, non-en-passant move can only expose its king if the moving piece
// sits on a line (rank/file/diagonal) with that king — i.e. it might be pinned.
function filterLegal(moves, color) {
    const kp = findKing(color);
    if (!kp) return moves;
    const kx = kp.x, ky = kp.y;
    const enemy = color === 'white' ? 'black' : 'white';
    const inCheck = isSquareAttacked(kx, ky, enemy);
    let n = 0;
    for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        let legal;
        if (m.fromX === kx && m.fromY === ky) {
            legal = leavesKingSafe(m, m.toX, m.toY, enemy);
        } else if (!inCheck && !m.details.isEnPassant) {
            const dx = m.fromX - kx, dy = m.fromY - ky;
            legal = (dx !== 0 && dy !== 0 && dx !== dy && dx !== -dy) || leavesKingSafe(m, kx, ky, enemy);
        } else {
            legal = leavesKingSafe(m, kx, ky, enemy);
        }
        if (legal) moves[n++] = m;
    }
    moves.length = n;
    return moves;
}

// All legal moves for `color` as { fromX, fromY, toX, toY, details } records.
function generateMoves(color, capturesOnly = false) {
    const out = [];
    for (let y = 0; y < 8; y++) {
        const row = gameState[y];
        for (let x = 0; x < 8; x++) {
            const p = row[x];
            if (p && p.color === color) genPieceMoves(out, x, y, p, capturesOnly, true);
        }
    }
    return filterLegal(out, color);
}

function getAllValidMoves(color) {
    return generateMoves(color, false);
}

function hasAnyLegalMove(color) {
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p || p.color !== color) continue;
            const out = [];
            genPieceMoves(out, x, y, p, false, true);
            if (filterLegal(out, color).length > 0) return true;
        }
    }
    return false;
}

// Legal destinations for the piece on (x, y), as the { x, y, ...details } list
// the UI uses for move hints and for movePiece().
function getvalidMoves(x, y) {
    const piece = gameState[y][x];
    if (!piece) return [];
    const out = [];
    genPieceMoves(out, x, y, piece, false, true);
    return filterLegal(out, piece.color).map(m => m.details);
}

// ─── CHECK / CHECKMATE SUFFIX (for SAN, based on the CURRENT real board) ─────
// colorToMove: the side that must move next, i.e. the side that might be in check.
function getCheckSuffix(colorToMove) {
    if (!isInCheck(colorToMove)) return '';
    return hasAnyLegalMove(colorToMove) ? '+' : '#';
}

// ─── GAME STATUS (checkmate, stalemate, draws) ───────────────────────────────
// Returns null while the game is still going, otherwise
// { reason, result, message } — reason is checkmate | stalemate | threefold |
// fifty-move | insufficient, result a PGN token.
function getGameStatus() {
    const draw = (reason, message) => ({ reason, result: '1/2-1/2', message });
    if ((positionHistory.get(getBoardKey()) || 0) >= 3) return draw('threefold', 'Draw by threefold repetition');
    if (halfMoveClock >= 100) return draw('fifty-move', 'Draw by the 50-move rule');
    if (isInsufficientMaterial()) return draw('insufficient', 'Draw by insufficient material');
    if (hasAnyLegalMove(currentTurn)) return null;

    if (isInCheck(currentTurn)) {
        const winner = currentTurn === 'white' ? 'Black' : 'White';
        return { reason: 'checkmate', result: winner === 'White' ? '1-0' : '0-1', message: `Checkmate — ${winner} wins` };
    }
    return draw('stalemate', 'Draw by stalemate');
}
