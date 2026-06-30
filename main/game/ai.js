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

// ─── EVALUATION ───────────────────────────────────────────────────────────────
function evaluateBoard() {
    let score = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p) continue;
            const rank = p.color === 'white' ? y : (7 - y);
            const value = (PIECE_VALUES[p.type] || 0) + ((PST[p.type]?.[rank]?.[x]) || 0);
            score += p.color === 'white' ? value : -value;
        }
    }
    return score;
}

// Evaluation from the perspective of `color` (positive = good for `color`).
function evaluateForColor(color) {
    const s = evaluateBoard();
    return color === 'white' ? s : -s;
}

function getAllValidMoves(color) {
    const allMoves = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.color === color) {
                for (const m of getvalidMoves(x, y)) {
                    allMoves.push({ fromX: x, fromY: y, toX: m.x, toY: m.y, details: m });
                }
            }
        }
    }
    return allMoves;
}

// ─── MOVE ORDERING (TT move first, then captures via MVV-LVA) ────────────────
function moveScore(move, ttMove) {
    if (ttMove && move.fromX === ttMove.fromX && move.fromY === ttMove.fromY
        && move.toX === ttMove.toX && move.toY === ttMove.toY) {
        return 1000000;
    }
    const victim = gameState[move.toY][move.toX];
    if (victim) {
        const attacker = gameState[move.fromY][move.fromX];
        return 100000 + (PIECE_VALUES[victim.type] || 0) * 10 - (PIECE_VALUES[attacker.type] || 0);
    }
    if (move.details && move.details.isEnPassant) return 100000 + PIECE_VALUES.pawn * 10;
    return 0;
}

function orderMoves(moves, ttMove) {
    return moves.slice().sort((a, b) => moveScore(b, ttMove) - moveScore(a, ttMove));
}

// ─── MAKE / UNMAKE (search-only, mutates the live board without cloning) ─────
// Far cheaper than cloning the whole 8x8 array of piece objects on every node.
function applySearchMove(move) {
    const { fromX, fromY, toX, toY, details } = move;
    const movingPiece = gameState[fromY][fromX];
    const capturedPiece = gameState[toY][toX];

    const undo = {
        fromX, fromY, toX, toY, movingPiece, capturedPiece,
        capturedHasMoved: capturedPiece ? capturedPiece.hasMoved : null,
        prevHasMoved: movingPiece.hasMoved,
        prevType: movingPiece.type,
        prevLastMove: lastMove,
        prevTurn: currentTurn,
        prevHalfMove: halfMoveClock,
        isCastle: false, isEnPassant: false,
        rookFromX: null, rookToX: null, rookPiece: null, rookPrevHasMoved: null,
        epCapturedPiece: null, epCaptureX: null, epCaptureY: null,
        promoted: false
    };

    if (details && details.isCastle) {
        const rook = gameState[fromY][details.rookFromX];
        undo.isCastle = true;
        undo.rookFromX = details.rookFromX;
        undo.rookToX = details.rookToX;
        undo.rookPiece = rook;
        undo.rookPrevHasMoved = rook.hasMoved;
        gameState[fromY][details.rookToX] = rook;
        gameState[fromY][details.rookFromX] = null;
        rook.hasMoved = true;
    }

    if (details && details.isEnPassant) {
        undo.isEnPassant = true;
        undo.epCaptureX = details.captureX;
        undo.epCaptureY = details.captureY;
        undo.epCapturedPiece = gameState[details.captureY][details.captureX];
        gameState[details.captureY][details.captureX] = null;
    }

    gameState[toY][toX] = movingPiece;
    gameState[fromY][fromX] = null;
    movingPiece.hasMoved = true;

    lastMove = { piece: movingPiece, fromX, fromY, toX, toY };

    if (movingPiece.type === 'pawn' || capturedPiece || (details && details.isEnPassant)) {
        halfMoveClock = 0;
    } else {
        halfMoveClock++;
    }

    // Auto-queen promotions inside the search tree
    if (movingPiece.type === 'pawn' && (toY === 0 || toY === 7)) {
        movingPiece.type = 'queen';
        undo.promoted = true;
    }

    currentTurn = currentTurn === 'white' ? 'black' : 'white';

    return undo;
}

function undoSearchMove(undo) {
    const { fromX, fromY, toX, toY, movingPiece } = undo;

    if (undo.promoted) movingPiece.type = undo.prevType;

    gameState[fromY][fromX] = movingPiece;
    movingPiece.hasMoved = undo.prevHasMoved;

    gameState[toY][toX] = undo.capturedPiece;
    if (undo.capturedPiece) undo.capturedPiece.hasMoved = undo.capturedHasMoved;

    if (undo.isEnPassant) {
        gameState[undo.epCaptureY][undo.epCaptureX] = undo.epCapturedPiece;
    }

    if (undo.isCastle) {
        gameState[fromY][undo.rookFromX] = undo.rookPiece;
        gameState[fromY][undo.rookToX] = null;
        undo.rookPiece.hasMoved = undo.rookPrevHasMoved;
    }

    lastMove = undo.prevLastMove;
    currentTurn = undo.prevTurn;
    halfMoveClock = undo.prevHalfMove;
}

// ─── TIME-BOUNDED SEARCH PLUMBING ─────────────────────────────────────────────
class SearchTimeUp extends Error {}

let searchDeadline = Infinity;
let nodeCount = 0;

function checkTime() {
    // Move generation (full king-safety legality checks) makes individual nodes
    // expensive, so the deadline is checked every node rather than every N nodes -
    // Date.now() itself is cheap relative to that cost.
    if (Date.now() > searchDeadline) throw new SearchTimeUp();
}

// Pseudo-legal capture generation + legality check ONLY on captures, instead of
// computing the full legal move list (getAllValidMoves) and filtering afterward.
// Quiescence runs at every leaf node, so this avoids paying for every quiet move's
// expensive king-safety check just to throw the result away.
function getCaptureMoves(color) {
    const moves = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.color === color) {
                for (const m of getPseudoLegalMoves(x, y)) {
                    if ((gameState[m.y][m.x] || m.isEnPassant) && isMoveLegal(x, y, m)) {
                        moves.push({ fromX: x, fromY: y, toX: m.x, toY: m.y, details: m });
                    }
                }
            }
        }
    }
    return moves;
}

// Transposition table: key -> { depth, score, flag, bestMove }
let transpositionTable = new Map();
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

// ─── QUIESCENCE SEARCH (captures only, avoids the horizon effect) ────────────
function quiescence(alpha, beta, color, qdepth) {
    nodeCount++;
    checkTime();

    const standPat = evaluateForColor(color);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= 6) return alpha;

    const captures = getCaptureMoves(color);
    const ordered = orderMoves(captures, null);
    const next = color === 'white' ? 'black' : 'white';

    for (const move of ordered) {
        const undo = applySearchMove(move);
        let score;
        try {
            score = -quiescence(-beta, -alpha, next, qdepth + 1);
        } finally {
            // Must run even when SearchTimeUp unwinds through the recursive call,
            // otherwise the live board is left mid-search-mutation permanently.
            undoSearchMove(undo);
        }

        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
    }

    return alpha;
}

// ─── NEGAMAX WITH ALPHA-BETA + TRANSPOSITION TABLE ────────────────────────────
function negamax(depth, alpha, beta, color) {
    nodeCount++;
    checkTime();

    const origAlpha = alpha;
    const key = getBoardKey();
    const ttEntry = transpositionTable.get(key);
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === TT_EXACT) return ttEntry.score;
        if (ttEntry.flag === TT_LOWER) alpha = Math.max(alpha, ttEntry.score);
        else if (ttEntry.flag === TT_UPPER) beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
    }

    if (depth === 0) return quiescence(alpha, beta, color, 0);

    const moves = getAllValidMoves(color);
    if (moves.length === 0) {
        const kp = findKing(color);
        const enemy = color === 'white' ? 'black' : 'white';
        if (kp && isSquareAttacked(kp.x, kp.y, enemy)) {
            // Side to move is mated; bias toward faster mates.
            return -50000 - depth * 100;
        }
        return 0; // Stalemate
    }

    const ordered = orderMoves(moves, ttEntry && ttEntry.bestMove);
    const next = color === 'white' ? 'black' : 'white';
    let best = -Infinity;
    let bestMove = null;

    for (const move of ordered) {
        const undo = applySearchMove(move);
        let score;
        try {
            score = -negamax(depth - 1, -beta, -alpha, next);
        } finally {
            undoSearchMove(undo);
        }

        if (score > best) { best = score; bestMove = move; }
        if (best > alpha) alpha = best;
        if (alpha >= beta) break; // Prune
    }

    let flag = TT_EXACT;
    if (best <= origAlpha) flag = TT_UPPER;
    else if (best >= beta) flag = TT_LOWER;
    transpositionTable.set(key, { depth, score: best, flag, bestMove });

    return best;
}

// ─── ROOT SEARCH: ITERATIVE DEEPENING ─────────────────────────────────────────
function findBestMove(color, timeBudgetMs, maxDepth) {
    nodeCount = 0;
    transpositionTable.clear();
    searchDeadline = Date.now() + timeBudgetMs;

    const rootMoves = getAllValidMoves(color);
    if (rootMoves.length === 0) return null;
    if (rootMoves.length === 1) return rootMoves[0];

    const next = color === 'white' ? 'black' : 'white';
    let bestMove = rootMoves[0];

    try {
        for (let depth = 1; depth <= maxDepth; depth++) {
            const prevBest = bestMove;
            let alpha = -Infinity;
            const beta = Infinity;
            let currentBestMove = null;
            let currentBestScore = -Infinity;

            const ordered = orderMoves(rootMoves, prevBest);

            for (const move of ordered) {
                const undo = applySearchMove(move);
                let score;
                try {
                    score = -negamax(depth - 1, -beta, -alpha, next);
                } finally {
                    undoSearchMove(undo);
                }

                if (score > currentBestScore) {
                    currentBestScore = score;
                    currentBestMove = move;
                }
                if (currentBestScore > alpha) alpha = currentBestScore;
            }

            bestMove = currentBestMove;

            // Found a forced mate; no need to search deeper.
            if (currentBestScore > 40000) break;
        }
    } catch (e) {
        if (!(e instanceof SearchTimeUp)) throw e;
        // Keep the best move found at the last fully-completed depth.
    }

    return bestMove;
}

// ─── AI ENTRY POINT ───────────────────────────────────────────────────────────
// Plays one move for `color` on the live board and returns { move, san, color },
// or null if `color` has no legal moves.
function makeAIMove(color, timeBudgetMs = 1200, maxDepth = 6) {
    const move = findBestMove(color, timeBudgetMs, maxDepth);
    if (!move) return null;

    const movingPiece = gameState[move.fromY][move.fromX];
    const isPawnPromo = movingPiece.type === 'pawn' && (move.toY === 0 || move.toY === 7);
    const sanBase = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details,
        isPawnPromo ? 'queen' : null);

    movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);

    if (isPawnPromo) {
        gameState[move.toY][move.toX].type = 'queen';
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }

    recordPosition();

    const san = sanBase + getCheckSuffix(currentTurn);
    return { move, san, color };
}
