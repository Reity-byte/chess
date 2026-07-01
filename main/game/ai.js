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
const PASSED_PAWN_BONUS = [0, 200, 120, 80, 50, 30, 15, 0];
const BISHOP_PAIR_BONUS = 30;
const ROOK_SEMI_OPEN_BONUS = 15;
const ROOK_OPEN_BONUS = 25;

// Both sides' starting non-pawn, non-king material — used as the "phase" signal to
// blend the midgame/endgame king PSTs. A simple linear blend, not a full tapered
// eval, but enough to make the king centralize once pieces come off the board.
const TOTAL_NON_PAWN_MATERIAL =
    2 * (2 * PIECE_VALUES.knight + 2 * PIECE_VALUES.bishop + 2 * PIECE_VALUES.rook + PIECE_VALUES.queen);

// ─── EVALUATION ───────────────────────────────────────────────────────────────
function evaluateBoard() {
    let score = 0;
    let whiteBishops = 0, blackBishops = 0;
    let nonPawnMaterial = 0;
    const whitePawnFiles = new Array(8).fill(0);
    const blackPawnFiles = new Array(8).fill(0);

    // First pass: material + PST for everything except the king (its PST depends
    // on the game phase, computed below from this pass's material tally), plus
    // the pawn-file and bishop counts the second pass's bonuses need.
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p) continue;

            if (p.type === 'pawn') {
                (p.color === 'white' ? whitePawnFiles : blackPawnFiles)[x]++;
            } else if (p.type !== 'king') {
                nonPawnMaterial += PIECE_VALUES[p.type];
            }
            if (p.type === 'bishop') {
                if (p.color === 'white') whiteBishops++; else blackBishops++;
            }
            if (p.type === 'king') continue;

            const rank = p.color === 'white' ? y : (7 - y);
            const value = PIECE_VALUES[p.type] + ((PST[p.type]?.[rank]?.[x]) || 0);
            score += p.color === 'white' ? value : -value;
        }
    }

    if (whiteBishops >= 2) score += BISHOP_PAIR_BONUS;
    if (blackBishops >= 2) score -= BISHOP_PAIR_BONUS;

    const phase = Math.min(1, Math.max(0, (TOTAL_NON_PAWN_MATERIAL - nonPawnMaterial) / TOTAL_NON_PAWN_MATERIAL));

    // Second pass: rook file bonus, passed pawns, and the phase-blended king.
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p) continue;

            if (p.type === 'rook') {
                const ownFiles   = p.color === 'white' ? whitePawnFiles : blackPawnFiles;
                const enemyFiles = p.color === 'white' ? blackPawnFiles : whitePawnFiles;
                if (ownFiles[x] === 0) {
                    const bonus = enemyFiles[x] === 0 ? ROOK_OPEN_BONUS : ROOK_SEMI_OPEN_BONUS;
                    score += p.color === 'white' ? bonus : -bonus;
                }
            }

            if (p.type === 'pawn' && isPassedPawn(x, y, p.color)) {
                const distance = p.color === 'white' ? y : (7 - y);
                const bonus = PASSED_PAWN_BONUS[distance] || 0;
                score += p.color === 'white' ? bonus : -bonus;
            }

            if (p.type === 'king') {
                const rank = p.color === 'white' ? y : (7 - y);
                const mg = PST.king[rank][x];
                const eg = KING_ENDGAME_PST[rank][x];
                const value = PIECE_VALUES.king + mg + (eg - mg) * phase;
                score += p.color === 'white' ? value : -value;
            }
        }
    }

    return score;
}

// A pawn is passed if no enemy pawn on its own or an adjacent file sits further
// toward its promotion square than it does.
function isPassedPawn(x, y, color) {
    for (let f = x - 1; f <= x + 1; f++) {
        if (f < 0 || f >= 8) continue;
        for (let yy = 0; yy < 8; yy++) {
            const p = gameState[yy][f];
            if (!p || p.type !== 'pawn' || p.color === color) continue;
            const blocksWhite = color === 'white' && yy < y;
            const blocksBlack = color === 'black' && yy > y;
            if (blocksWhite || blocksBlack) return false;
        }
    }
    return true;
}

// Evaluation from the perspective of `color` (positive = good for `color`).
// `noise` (centipawns) is only ever passed at the search ROOT (findBestMove),
// never from inside negamax/quiescence — jitter injected at every node would
// compound across the tree and make play incoherent rather than human-like.
function evaluateForColor(color, noise = 0) {
    const s = evaluateBoard();
    const jittered = noise > 0 ? s + (Math.random() * 2 - 1) * noise : s;
    return color === 'white' ? jittered : -jittered;
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

// ─── KILLER MOVES + HISTORY HEURISTIC (per-search move-ordering caches) ───────
// killers[depth] = [move, move] — the two quiet moves that most recently caused
// a beta cutoff at that remaining-depth. historyTable[fromX,fromY,toX,toY] counts
// how often a quiet move has improved alpha, weighted by depth^2. Both are reset
// per search in findBestMove — they're move-ordering hints, not search state that
// should persist across unrelated searches.
let killers = [];
let historyTable = {};

// ─── CONTEMPT (draw avoidance) ─────────────────────────────────────────────────
// A draw (repetition or stalemate) is scored as a small loss for whoever is "to
// move" at that node, instead of a flat 0. Since negamax scores are always from
// the mover's perspective, this makes a winning side actively route around a
// draw (any real alternative easily beats -CONTEMPT) while a losing side still
// happily walks into one once it's genuinely behind by more than CONTEMPT -
// exactly "win or steer toward a draw, don't drift into one by accident".
const CONTEMPT = 60;

// searchPathCounts tracks how many times each position has been reached so far
// WITHIN the current search tree (pushed/popped alongside make/unmake), so it
// can be added to the real game's positionHistory to detect a hypothetical line
// that would actually trigger the live threefold rule. Reset per search.
let searchPathCounts = {};

function sameMove(a, b) {
    return !!a && !!b && a.fromX === b.fromX && a.fromY === b.fromY && a.toX === b.toX && a.toY === b.toY;
}

function historyKey(move) {
    return move.fromX + ',' + move.fromY + ',' + move.toX + ',' + move.toY;
}

function recordKiller(move, depth) {
    const slot = killers[depth] || (killers[depth] = [null, null]);
    if (!sameMove(move, slot[0])) {
        slot[1] = slot[0];
        slot[0] = move;
    }
}

function addHistory(move, depth) {
    const key = historyKey(move);
    historyTable[key] = (historyTable[key] || 0) + depth * depth;
}

// ─── MOVE ORDERING (TT move, then killers, then captures via MVV-LVA, then history) ──
function moveScore(move, ttMove, depth, historyTbl) {
    if (ttMove && sameMove(move, ttMove)) return 1000000;

    const victim = gameState[move.toY][move.toX];
    const isCapture = !!victim || (move.details && move.details.isEnPassant);

    // Killer moves score above captures — a move that already caused a cutoff in
    // a sibling branch at this same depth is worth retrying immediately.
    if (!isCapture && depth !== undefined && killers[depth]) {
        const [k1, k2] = killers[depth];
        if (sameMove(move, k1)) return 500001;
        if (sameMove(move, k2)) return 500000;
    }

    if (victim) {
        const attacker = gameState[move.fromY][move.fromX];
        return 100000 + (PIECE_VALUES[victim.type] || 0) * 10 - (PIECE_VALUES[attacker.type] || 0);
    }
    if (move.details && move.details.isEnPassant) return 100000 + PIECE_VALUES.pawn * 10;

    if (historyTbl) {
        const h = historyTbl[historyKey(move)];
        if (h) return h;
    }
    return 0;
}

function orderMoves(moves, ttMove, depth, historyTbl) {
    return moves.slice().sort((a, b) => moveScore(b, ttMove, depth, historyTbl) - moveScore(a, ttMove, depth, historyTbl));
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

const MAX_QDEPTH = 6;

// ─── QUIESCENCE SEARCH (captures only, avoids the horizon effect) ────────────
function quiescence(alpha, beta, color, qdepth) {
    nodeCount++;
    checkTime();

    const standPat = evaluateForColor(color);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= MAX_QDEPTH) return alpha;

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

// Applies `move`, checks whether the resulting position would actually trigger
// the live game's threefold rule (real occurrences so far + hypothetical repeats
// already made earlier in this same search line), and either short-circuits with
// the contempt-adjusted draw score or recurses normally. Shared by negamax's move
// loop and the root loop in iterativeDeepen so both see the same draw-avoidance
// behavior. Always unmakes the move before returning.
function makeMoveAndSearch(move, depth, alpha, beta, next) {
    const undo = applySearchMove(move);
    let score;
    try {
        const key = getBoardKey();
        const occurrences = (positionHistory[key] || 0) + (searchPathCounts[key] || 0) + 1;
        if (occurrences >= 3) {
            score = -CONTEMPT;
        } else {
            searchPathCounts[key] = (searchPathCounts[key] || 0) + 1;
            try {
                score = -negamax(depth - 1, -beta, -alpha, next, key);
            } finally {
                searchPathCounts[key]--;
            }
        }
    } finally {
        undoSearchMove(undo);
    }
    return score;
}

// ─── NEGAMAX WITH ALPHA-BETA + TRANSPOSITION TABLE ────────────────────────────
// `knownKey` lets a caller that already computed this position's board key (see
// makeMoveAndSearch) pass it in instead of paying for getBoardKey() twice.
function negamax(depth, alpha, beta, color, knownKey) {
    nodeCount++;
    checkTime();

    const origAlpha = alpha;
    const key = knownKey || getBoardKey();
    const ttEntry = transpositionTable.get(key);
    if (ttEntry && ttEntry.depth >= depth) {
        if (ttEntry.flag === TT_EXACT) return ttEntry.score;
        if (ttEntry.flag === TT_LOWER) alpha = Math.max(alpha, ttEntry.score);
        else if (ttEntry.flag === TT_UPPER) beta = Math.min(beta, ttEntry.score);
        if (alpha >= beta) return ttEntry.score;
    }

    if (depth === 0) return quiescence(alpha, beta, color, 0);

    if (transpositionTable.size > 500000) transpositionTable.clear();

    const moves = getAllValidMoves(color);
    if (moves.length === 0) {
        const kp = findKing(color);
        const enemy = color === 'white' ? 'black' : 'white';
        if (kp && isSquareAttacked(kp.x, kp.y, enemy)) {
            // Side to move is mated; bias toward faster mates.
            return -50000 - depth * 100;
        }
        return -CONTEMPT; // Stalemate: a draw, treated as a small loss for the mover (see CONTEMPT).
    }

    const ordered = orderMoves(moves, ttEntry && ttEntry.bestMove, depth, historyTable);
    const next = color === 'white' ? 'black' : 'white';
    let best = -Infinity;
    let bestMove = null;

    for (const move of ordered) {
        const capturedBefore = gameState[move.toY][move.toX];
        const isQuiet = !capturedBefore && !(move.details && move.details.isEnPassant);

        const score = makeMoveAndSearch(move, depth, alpha, beta, next);

        if (score > best) { best = score; bestMove = move; }
        if (best > alpha) {
            alpha = best;
            if (isQuiet) addHistory(move, depth);
        }
        if (alpha >= beta) {
            if (isQuiet) recordKiller(move, depth);
            break; // Prune
        }
    }

    let flag = TT_EXACT;
    if (best <= origAlpha) flag = TT_UPPER;
    else if (best >= beta) flag = TT_LOWER;
    transpositionTable.set(key, { depth, score: best, flag, bestMove });

    return best;
}

// ─── OPENING BOOK ──────────────────────────────────────────────────────────────
// Lines are stored as SAN move sequences rather than getBoardKey() lookups (the
// originally planned format in TODO.md): hand-computing this engine's exact board
// keys — which fold in castling rights and en passant — for ~20 lines by hand
// would be fragile and unverifiable without actually running the engine. Matching
// against the played SAN prefix is directly checkable against standard opening
// theory and is how most small opening books work in practice.
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

// moveHistory is a game-script.js global (this codebase shares state via plain
// globals rather than modules); by the time findBestMove ever runs, all scripts
// have loaded, so the reference resolves fine despite ai.js loading first.
function flattenPlayedSAN() {
    if (typeof moveHistory === 'undefined') return [];
    const played = [];
    for (const row of moveHistory) {
        if (row.white) played.push(row.white);
        if (row.black) played.push(row.black);
    }
    return played;
}

function stripCheckSuffix(san) {
    return san.replace(/[+#]$/, '');
}

// Resolves a book SAN string to an actual move object for `color` at the current
// position, using the existing move generator + SAN generator so it's always a
// legal move (or null if the string doesn't match anything, e.g. a data typo).
function sanToMove(color, san) {
    const moves = getAllValidMoves(color);
    for (const move of moves) {
        const base = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, null);
        if (base === san) return move;
    }
    return null;
}

function pickBookMove(color) {
    const played = flattenPlayedSAN().map(stripCheckSuffix);
    const ply = played.length;

    const candidates = [];
    for (const line of OPENING_BOOK) {
        if (line.moves.length <= ply) continue;
        let matches = true;
        for (let i = 0; i < ply; i++) {
            if (line.moves[i] !== played[i]) { matches = false; break; }
        }
        if (!matches) continue;

        const move = sanToMove(color, line.moves[ply]);
        if (move) candidates.push({ move, weight: line.weight });
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

// ─── ROOT SEARCH: ITERATIVE DEEPENING ─────────────────────────────────────────
// Returns { move, score } — score is the TRUE (non-jittered) evaluation of the
// chosen move from `color`'s perspective. Shared by findBestMove (live play:
// book move + eval noise layered on top) and the Game Analysis Engine, which
// calls this directly with evalNoise = 0 for a ground-truth, book-free search
// (see analysis-worker.js).
//
// `evalNoise` (centipawns) is applied only here, once per root move per depth —
// see the comment on evaluateForColor for why it must not leak into negamax/quiescence.
function iterativeDeepen(color, timeBudgetMs, maxDepth, evalNoise = 0) {
    nodeCount = 0;
    transpositionTable.clear();
    killers = [];
    historyTable = {};
    searchPathCounts = {};
    searchDeadline = Date.now() + timeBudgetMs;

    const rootMoves = getAllValidMoves(color);
    if (rootMoves.length === 0) return { move: null, score: null };
    if (rootMoves.length === 1) return { move: rootMoves[0], score: evaluateForColor(color) };

    const next = color === 'white' ? 'black' : 'white';
    let bestMove = rootMoves[0];
    let bestScore = -Infinity;

    try {
        for (let depth = 1; depth <= maxDepth; depth++) {
            const prevBest = bestMove;
            let alpha = -Infinity;
            const beta = Infinity;
            let currentBestMove = null;
            let currentBestJittered = -Infinity;
            let trueScoreOfJitteredBest = -Infinity;
            let trueBestScore = -Infinity;

            const ordered = orderMoves(rootMoves, prevBest, depth, historyTable);

            for (const move of ordered) {
                const score = makeMoveAndSearch(move, depth, alpha, beta, next);

                // Jitter only affects which move is picked, not the alpha window,
                // so it can't distort pruning of the remaining sibling searches.
                const jittered = evalNoise > 0 ? score + (Math.random() * 2 - 1) * evalNoise : score;
                if (jittered > currentBestJittered) {
                    currentBestJittered = jittered;
                    currentBestMove = move;
                    trueScoreOfJitteredBest = score;
                }
                if (score > trueBestScore) trueBestScore = score;
                if (trueBestScore > alpha) alpha = trueBestScore;
            }

            bestMove = currentBestMove;
            bestScore = trueScoreOfJitteredBest;

            // Found a forced mate; no need to search deeper.
            if (trueBestScore > 40000) break;
        }
    } catch (e) {
        if (!(e instanceof SearchTimeUp)) throw e;
        // Keep the best move found at the last fully-completed depth.
    }

    return { move: bestMove, score: bestScore };
}

function findBestMove(color, timeBudgetMs, maxDepth, evalNoise = 0) {
    const bookMove = pickBookMove(color);
    if (bookMove) return bookMove;
    return iterativeDeepen(color, timeBudgetMs, maxDepth, evalNoise).move;
}

// ─── AI ENTRY POINT ───────────────────────────────────────────────────────────
// Plays one move for `color` on the live board and returns { move, san, color },
// or null if `color` has no legal moves.
function makeAIMove(color, timeBudgetMs = 1200, maxDepth = 6, evalNoise = 0) {
    const move = findBestMove(color, timeBudgetMs, maxDepth, evalNoise);
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
