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

// ─── MOVE ORDERING (captures first, for better alpha-beta pruning) ─────────────
function orderMoves(moves) {
    return moves.sort((a, b) => {
        const aCapture = gameState[a.toY][a.toX] ? (PIECE_VALUES[gameState[a.toY][a.toX].type] || 0) : 0;
        const bCapture = gameState[b.toY][b.toX] ? (PIECE_VALUES[gameState[b.toY][b.toX].type] || 0) : 0;
        return bCapture - aCapture;
    });
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

function cloneGameState(state) {
    return state.map(row => row.map(p => {
        if (!p) return null;
        const c = new ChessPiece(p.type, p.color);
        c.hasMoved = p.hasMoved;
        return c;
    }));
}

// ─── MINIMAX WITH ALPHA-BETA ──────────────────────────────────────────────────
// color = whose turn it is at this node
// Correctly alternates each ply so black and white actually play against each other
function minimax(depth, alpha, beta, color) {
    if (depth === 0) return evaluateBoard();

    const moves = orderMoves(getAllValidMoves(color));

    // No moves = checkmate or stalemate; leaf node evaluation is accurate
    if (moves.length === 0) {
        const kp = findKing(color);
        const enemy = color === 'white' ? 'black' : 'white';
        if (kp && isSquareAttacked(kp.x, kp.y, enemy)) {
            // Checkmate: the side whose turn it is lost
            // Return a very bad score for that side, biased by depth (prefer faster mates)
            return color === 'white' ? -50000 - depth * 100 : 50000 + depth * 100;
        }
        return 0; // Stalemate
    }

    const savedState    = cloneGameState(gameState);
    const savedTurn     = currentTurn;
    const savedLastMove = lastMove ? { ...lastMove } : null;
    const savedHalf     = halfMoveClock;

    const isMax  = color === 'white';
    const next   = isMax ? 'black' : 'white';
    let best     = isMax ? -Infinity : +Infinity;

    for (const move of moves) {
        movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);

        // Auto-queen pawn promotions inside the search tree
        const landed = gameState[move.toY][move.toX];
        if (landed && landed.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
            landed.type = 'queen';
            currentTurn = next;
        }

        const score = minimax(depth - 1, alpha, beta, next);

        gameState    = cloneGameState(savedState);
        currentTurn  = savedTurn;
        lastMove     = savedLastMove ? { ...savedLastMove } : null;
        halfMoveClock = savedHalf;

        if (isMax) {
            if (score > best) best = score;
            if (best > alpha) alpha = best;
        } else {
            if (score < best) best = score;
            if (best < beta)  beta  = best;
        }
        if (beta <= alpha) break; // Prune
    }

    return best;
}

// ─── AI ENTRY POINT ───────────────────────────────────────────────────────────
function makeAIMove() {
    console.log("AI is thinking...");

    const moves = orderMoves(getAllValidMoves('black'));
    if (moves.length === 0) return;

    let bestScore = +Infinity;
    let bestMove  = null;

    for (const move of moves) {
        const savedState    = cloneGameState(gameState);
        const savedTurn     = currentTurn;
        const savedLastMove = lastMove ? { ...lastMove } : null;
        const savedHalf     = halfMoveClock;

        movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);

        const landed = gameState[move.toY][move.toX];
        if (landed && landed.type === 'pawn' && move.toY === 7) {
            landed.type  = 'queen';
            currentTurn  = 'white';
        }

        // Search 3 plies deep (white responds, black responds, white responds)
        const score = minimax(4, -Infinity, +Infinity, 'white');

        gameState    = cloneGameState(savedState);
        currentTurn  = savedTurn;
        lastMove     = savedLastMove ? { ...savedLastMove } : null;
        halfMoveClock = savedHalf;

        if (score < bestScore) {
            bestScore = score;
            bestMove  = move;
        }
    }

    if (bestMove) {
        console.log(`AI chose move with score: ${bestScore}`);
        movePiece(bestMove.fromX, bestMove.fromY, bestMove.toX, bestMove.toY, bestMove.details);

        const landed = gameState[bestMove.toY][bestMove.toX];
        if (landed && landed.type === 'pawn' && bestMove.toY === 7) {
            landed.type = 'queen';
            currentTurn = 'white';
        }

        // Record position AFTER AI move for draw detection
        recordPosition();
    }
}