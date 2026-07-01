// ─── GAME ANALYSIS WEB WORKER ──────────────────────────────────────────────────
// importScripts gives this worker its OWN global scope, so `gameState` /
// `currentTurn` / etc. here are entirely separate from the main thread's live
// game — replaying the recorded moves from a fresh resetGame() is enough to
// isolate the analysis board, no FEN import/export needed (a deviation from the
// original plan sketch in TODO.md, but simpler and just as correct here).
importScripts('engine.js', 'ai.js', 'notation.js', 'analysis.js');

const ANALYSIS_TIME_MS = 400; // per-position search budget; off-thread, so fine to spend a bit more
const ANALYSIS_DEPTH   = 4;
const WINNING_WIN_PCT = 65; // win-probability points; "clearly winning" for the Miss category

// "What if" exploration always searches at full strength (Master-level), regardless
// of the difficulty the original game was played at — the user is asking what the
// engine actually thinks, so noise/shallow depth would defeat the point.
const EXPLORE_TIME_MS = 1500;
const EXPLORE_DEPTH   = 6;

// Resolves a played SAN string to a move + promotion type. Unlike ai.js's
// sanToMove (only ever used for short opening-book lines), this also matches
// promotions, since a full game can reach any of them.
function resolveSAN(color, san) {
    const moves = getAllValidMoves(color);
    for (const move of moves) {
        const piece = gameState[move.fromY][move.fromX];
        const isPromo = piece.type === 'pawn' && (move.toY === 0 || move.toY === 7);
        if (isPromo) {
            for (const promo of ['queen', 'rook', 'bishop', 'knight']) {
                if (moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo) === san) {
                    return { move, promo };
                }
            }
        } else if (moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, null) === san) {
            return { move, promo: null };
        }
    }
    return null;
}

// Applies the move the way the real game would (respecting the actual
// promotion piece chosen), not the search's auto-queen shortcut.
function applyRealMove(move, promo) {
    const isPromoting = movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);
    if (isPromoting) {
        gameState[move.toY][move.toX].type = promo || 'queen';
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }
}

// True if `playedSAN` matches one of OPENING_BOOK's candidate replies at this
// exact ply, given the (already +/# stripped) SANs played so far.
function isBookMove(playedSAN, sanSoFar) {
    const ply = sanSoFar.length;
    return OPENING_BOOK.some(line => {
        if (line.moves.length <= ply) return false;
        for (let i = 0; i < ply; i++) if (line.moves[i] !== sanSoFar[i]) return false;
        return line.moves[ply] === playedSAN;
    });
}

// Rough "was this a sacrifice?" signal: does the piece that just moved land on
// a square now attacked by an enemy piece of equal or lesser value? Combined
// with "this was still the engine's best move" to flag Brilliant moves. This is
// a simplified heuristic, not a full search-based sacrifice justification.
function looksLikeSacrifice(move, moverColor) {
    const piece = gameState[move.toY][move.toX];
    if (!piece) return false;
    const enemy = moverColor === 'white' ? 'black' : 'white';
    if (!isSquareAttacked(move.toX, move.toY, enemy)) return false;

    let cheapestAttacker = Infinity;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.color === enemy
                && getPseudoLegalMoves(x, y, false).some(m => m.x === move.toX && m.y === move.toY)) {
                cheapestAttacker = Math.min(cheapestAttacker, PIECE_VALUES[p.type] || 0);
            }
        }
    }
    return cheapestAttacker <= (PIECE_VALUES[piece.type] || 0);
}

// `winLoss` is win-PROBABILITY-POINT loss (0-100), not raw centipawns - see the
// comment on ANALYSIS_THRESHOLDS in analysis.js for why.
function classify(winLoss, wasWinningBefore, isBook, isSac) {
    if (isBook) return 'Book';
    if (isSac && winLoss <= ANALYSIS_THRESHOLDS.best) return 'Brilliant';
    if (wasWinningBefore && winLoss > ANALYSIS_THRESHOLDS.mistake) return 'Miss';
    if (winLoss <= ANALYSIS_THRESHOLDS.best) return 'Best';
    if (winLoss <= ANALYSIS_THRESHOLDS.excellent) return 'Excellent';
    if (winLoss <= ANALYSIS_THRESHOLDS.good) return 'Good';
    if (winLoss <= ANALYSIS_THRESHOLDS.inaccuracy) return 'Inaccuracy';
    if (winLoss <= ANALYSIS_THRESHOLDS.mistake) return 'Mistake';
    return 'Blunder';
}

function runAnalysis(sanMoves) {
    resetGame();

    const perMove = [];
    const evalGraph = [];
    const sanSoFar = [];
    let whiteWinLoss = 0, whiteCount = 0, blackWinLoss = 0, blackCount = 0;

    for (let i = 0; i < sanMoves.length; i++) {
        const color = i % 2 === 0 ? 'white' : 'black';
        const rawSAN = sanMoves[i];
        const san = rawSAN.replace(/[+#]$/, '');

        const resolved = resolveSAN(color, san);
        if (!resolved) {
            // Shouldn't happen for a validly recorded game; skip defensively.
            sanSoFar.push(san);
            self.postMessage({ type: 'progress', ply: i + 1, total: sanMoves.length });
            continue;
        }

        const bestBefore = iterativeDeepen(color, ANALYSIS_TIME_MS, ANALYSIS_DEPTH, 0).score;
        const book = isBookMove(san, sanSoFar);
        const sac = !book && looksLikeSacrifice(resolved.move, color);

        applyRealMove(resolved.move, resolved.promo);

        const opponent = color === 'white' ? 'black' : 'white';
        const opponentResult = iterativeDeepen(opponent, ANALYSIS_TIME_MS, ANALYSIS_DEPTH, 0);

        let actual;
        if (opponentResult.score === null) {
            // Opponent has no legal reply: checkmate (best possible outcome for
            // the mover) or stalemate (a forced draw — a big loss of advantage
            // if the mover was previously winning).
            const kp = findKing(opponent);
            const opponentInCheck = kp && isSquareAttacked(kp.x, kp.y, color);
            actual = opponentInCheck ? 100000 : 0;
        } else {
            actual = -opponentResult.score;
        }

        // Raw cp loss is still shown to the user (it's a familiar, concrete number
        // for the on-board caption/tooltip), but classification and accuracy use
        // the win-probability-loss version so already-decided positions don't
        // exaggerate every remaining move into a "blunder" - see analysis.js.
        const centipawnLoss = Math.max(0, bestBefore - actual);
        const winBefore = winProbability(bestBefore);
        const winAfter = winProbability(actual);
        const winLoss = Math.max(0, winBefore - winAfter);
        const wasWinningBefore = winBefore > WINNING_WIN_PCT;
        const category = classify(winLoss, wasWinningBefore, book, sac);

        // from/to/details/promo let the review page (analysis.html) replay this
        // exact move directly, without re-resolving SAN a second time.
        perMove.push({
            color, san: rawSAN, category, centipawnLoss: Math.round(centipawnLoss),
            from: { x: resolved.move.fromX, y: resolved.move.fromY },
            to:   { x: resolved.move.toX,   y: resolved.move.toY },
            details: resolved.move.details,
            promo: resolved.promo,
        });
        evalGraph.push(color === 'white' ? actual : -actual);

        if (color === 'white') { whiteWinLoss += winLoss; whiteCount++; }
        else { blackWinLoss += winLoss; blackCount++; }

        sanSoFar.push(san);
        self.postMessage({ type: 'progress', ply: i + 1, total: sanMoves.length });
    }

    // Chess.com's published accuracy curve, applied to average win-probability
    // loss instead of raw centipawns for the same reason as classify() above -
    // otherwise one side getting mated drags their whole game to 0% even for
    // moves that didn't actually throw anything away.
    const accuracy = (avgWinLoss) => {
        const raw = 103.1668 * Math.exp(-0.04354 * avgWinLoss) - 3.1669;
        return Math.max(0, Math.min(100, Math.round(raw)));
    };

    return {
        perMove,
        evalGraph,
        accuracy: {
            white: accuracy(whiteCount ? whiteWinLoss / whiteCount : 0),
            black: accuracy(blackCount ? blackWinLoss / blackCount : 0),
        },
    };
}

// Replays `sanMoves` (the real game up to the branch point) then `variationMoves`
// (already-resolved move objects — no SAN re-resolution needed, the page that
// played them already has the exact coordinates), then searches for `color`'s
// best reply from that resulting position. Used for "what if" exploration: the
// user plays a move on the review board, and this supplies the engine's reply.
function runExplore(sanMoves, variationMoves, color) {
    resetGame();
    for (const rawSAN of sanMoves) {
        const mvColor = currentTurn;
        const resolved = resolveSAN(mvColor, rawSAN.replace(/[+#]$/, ''));
        if (resolved) applyRealMove(resolved.move, resolved.promo);
    }
    for (const vm of variationMoves) {
        applyRealMove(vm, vm.promo);
    }

    const result = iterativeDeepen(color, EXPLORE_TIME_MS, EXPLORE_DEPTH, 0);
    if (!result.move) return { move: null, san: null, score: result.score };

    const movingPiece = gameState[result.move.fromY][result.move.fromX];
    const isPromo = movingPiece.type === 'pawn' && (result.move.toY === 0 || result.move.toY === 7);
    const promo = isPromo ? 'queen' : null;
    const san = moveToSAN(result.move.fromX, result.move.fromY, result.move.toX, result.move.toY, result.move.details, promo);

    return {
        move: {
            fromX: result.move.fromX, fromY: result.move.fromY,
            toX: result.move.toX, toY: result.move.toY,
            details: result.move.details, promo,
        },
        san,
        score: result.score,
    };
}

self.onmessage = function (e) {
    const data = e.data;
    if (data.type === 'analyze') {
        try {
            const report = runAnalysis(data.sanMoves);
            self.postMessage({ type: 'done', report });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    } else if (data.type === 'explore') {
        try {
            const result = runExplore(data.sanMoves, data.variationMoves, data.color);
            self.postMessage({ type: 'exploreReply', result });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
