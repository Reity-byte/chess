// ─── GAME ANALYSIS WEB WORKER ──────────────────────────────────────────────────
// Runs the Game Analysis Engine off the main thread. importScripts gives this
// worker its OWN copy of the engine globals, so replaying a game here never
// touches the page's board.
//
// How a game is analyzed: every position is searched ONCE, with multi-PV 2 and
// the move actually played forced into the same search. That gives, at one
// identical depth, the best move's exact score, the runner-up's exact score
// (for "only move" detection) and the played move's exact score — so a played
// best move always shows exactly zero loss, and losses never come from
// comparing two searches of different depth. The next position's search then
// supplies the eval graph point after the move and the opponent's best reply
// (the "punish" move for puzzles). Results stream back move by move.
importScripts('engine.js?v=8', 'ai.js?v=8', 'notation.js?v=8', 'openings.js?v=8', 'analysis.js?v=8');

// "What if" exploration always searches at full strength, whatever difficulty
// the original game was played at.
const EXPLORE_TIME_MS = 1200;
const EXPLORE_DEPTH = 20;
const SACRIFICE_MIN = 150;     // net material given up (cp) to count as a sacrifice
const SACRIFICE_CONFIRM_PLIES = 2; // best-line plies played out to check the material stays given up
const ALREADY_WINNING = 97;    // win% above which a non-mating sacrifice isn't "brilliant" anymore
const OPPORTUNITY_MIN = 10;    // win% the opponent's previous move gave away to make a "Miss" possible

// ─── POSITION SEARCH ───────────────────────────────────────────────────────────
// Searches the current real-board position. `played` (optional) is the move
// that was actually played here. Scores are from the side to move's view.
function searchPosition(mode, played) {
    const color = currentTurn;
    if (!hasAnyLegalMove(color)) {
        return { terminal: true, score: isInCheck(color) ? -EVAL_MATE : 0, lines: [], pv: [], depth: 0, legalCount: 0 };
    }
    const r = searchRoot(color, {
        timeMs: mode.timeMs, maxDepth: mode.maxDepth, multiPV: 2, contempt: 0,
        includeMove: played ? played.move : null, includePromo: played ? played.promo : null,
        searchForced: true, withLines: true,
    });
    return {
        terminal: false,
        score: r.score,
        lines: r.lines.map(l => ({ move: plainMove(l.move, l.promo), san: l.san, score: l.score })),
        pv: r.pv,
        depth: r.depth,
        includedScore: r.includedScore,
        legalCount: getAllValidMoves(color).length,
    };
}

function plainMove(move, promo) {
    return move ? { fromX: move.fromX, fromY: move.fromY, toX: move.toX, toY: move.toY, details: move.details, promo: promo || null } : null;
}

// Material on the board, for the opening/middlegame/endgame split.
function gamePhaseAt(ply) {
    let npm = 0, queens = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p || p.type === 'pawn' || p.type === 'king') continue;
            npm += PIECE_VALUES[p.type];
            if (p.type === 'queen') queens++;
        }
    }
    if (npm <= 2600 || (queens === 0 && npm <= 3200)) return 'endgame';
    if (ply < 20) return 'opening';
    return 'middlegame';
}

// ─── CLASSIFICATION ────────────────────────────────────────────────────────────
// Win percentages are from the mover's view. Priority: Forced, Book, Brilliant,
// Great, Miss, then the plain loss buckets.
function classify(c) {
    if (c.legalCount === 1) return 'Forced';
    if (c.inBook) return 'Book';
    const t = ANALYSIS_THRESHOLDS;
    const isTopMove = c.isBest || c.winLoss <= t.best;
    if (c.deliversMate) return 'Best';
    if (c.sacrifice >= SACRIFICE_MIN && c.winLoss <= t.excellent && c.winPlayed >= 40
        && (c.winBest < ALREADY_WINNING || c.sacrificeMates)) return 'Brilliant';
    if (isTopMove && c.winSecond !== null && c.winBest - c.winSecond >= 15
        && c.winSecond < 90 && c.winPlayed >= 20 && !c.isRecapture) return 'Great';
    if (c.prevLoss >= OPPORTUNITY_MIN && c.winLoss > t.inaccuracy && c.winPlayed >= 30 && c.winBest >= 50) return 'Miss';
    if (isTopMove) return 'Best';
    if (c.winLoss <= t.excellent) return 'Excellent';
    if (c.winLoss <= t.good) return 'Good';
    if (c.winLoss <= t.inaccuracy) return 'Inaccuracy';
    if (c.winLoss <= t.mistake) return 'Mistake';
    return 'Blunder';
}

// Material of `color` minus the opponent's, in centipawns (kings excluded).
function materialBalance(color) {
    let total = 0;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.type !== 'king') total += p.color === color ? PIECE_VALUES[p.type] : -PIECE_VALUES[p.type];
        }
    }
    return total;
}

// Plays `move` on the real board and measures, from the mover's side, how
// much material the move offers up: either the moved piece itself can be won
// (net of anything it just captured), or another piece is left hanging that
// wasn't before. Returns { sacrifice, captured, deliversMate, materialBefore }.
// This is only a candidate — confirmSacrifice() checks it holds up.
function playAndMeasure(move, promo, mover) {
    const materialBefore = materialBalance(mover);
    const victim = move.details.isEnPassant ? { type: 'pawn' } : gameState[move.toY][move.toX];
    const captured = victim ? PIECE_VALUES[victim.type] : 0;
    const hangingBefore = maxHangingValue(mover, move.fromX, move.fromY);

    applyMoveWithPromotion(move, promo);
    recordPosition();
    const opponent = mover === 'white' ? 'black' : 'white';
    if (!hasAnyLegalMove(opponent) && isInCheck(opponent)) return { sacrifice: 0, captured, deliversMate: true, materialBefore };

    const onDestination = captureGainOn(move.toX, move.toY) - captured;
    const elsewhere = maxHangingValue(mover, move.toX, move.toY) - hangingBefore;
    return { sacrifice: Math.max(0, onDestination, elsewhere), captured, deliversMate: false, materialBefore };
}

// A piece that merely *looks* en prise isn't a sacrifice if the material comes
// straight back (10.Nxb5 cxb5 11.Bxb5+ in the Opera Game nets only about a
// pawn). Plays the opponent's best reply and the mover's answer from the
// engine line, then re-measures: returns { given, mates } where `given` is the
// material the mover is still down versus before the move, and `mates` says the
// line ends with the mover delivering checkmate. `restore` rebuilds the board.
function confirmSacrifice(line, mover, materialBefore, restore) {
    let mates = false;
    for (let k = 0; k < line.length; k++) {
        const r = resolveSAN(currentTurn, line[k]);
        if (!r) break;
        applyMoveWithPromotion(r.move, r.promo);
        if (!hasAnyLegalMove(currentTurn)) {
            mates = currentTurn !== mover && isInCheck(currentTurn);
            break;
        }
        if (k + 1 >= SACRIFICE_CONFIRM_PLIES && !line[k + 1]?.endsWith('#')) break;
    }
    const given = materialBefore - materialBalance(mover);
    restore();
    return { given, mates };
}

// Rebuilds the real board (with repetition history) after the first `count` moves.
function restorePosition(resolved, count) {
    resetGame();
    recordPosition();
    for (let k = 0; k < count; k++) {
        applyMoveWithPromotion(resolved[k].move, resolved[k].promo);
        recordPosition();
    }
}

// ─── ACCURACY (lichess-style) ──────────────────────────────────────────────────
// Per-move accuracy from win-% loss, then per side the average of a
// volatility-weighted mean (calm positions count less) and a harmonic mean
// (a few disasters drag the score down the way they should).
function moveAccuracy(winLoss) {
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669 + 1));
}

function stdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

function computeAccuracy(perMove, whiteWinByPosition) {
    const n = perMove.length;
    const windowSize = Math.max(2, Math.min(8, Math.floor(n / 10)));
    const weights = [];
    for (let i = 0; i < n; i++) {
        const start = Math.max(0, Math.min(i - windowSize + 2, whiteWinByPosition.length - windowSize));
        const window = whiteWinByPosition.slice(Math.max(0, start), Math.max(0, start) + windowSize);
        weights.push(Math.max(0.5, Math.min(12, stdDev(window.length ? window : [50]))));
    }
    const side = (color) => {
        let wSum = 0, wTotal = 0, invSum = 0, count = 0;
        perMove.forEach((m, i) => {
            if (m.color !== color || m.category === 'Forced') return;
            const acc = moveAccuracy(m.winLoss);
            wSum += acc * weights[i]; wTotal += weights[i];
            invSum += 1 / Math.max(acc, 1); count++;
        });
        if (count === 0) return null;
        return Math.round(((wSum / wTotal) + (count / invSum)) / 2 * 10) / 10;
    };
    return { white: side('white'), black: side('black') };
}

function phaseAccuracy(perMove) {
    const out = { white: {}, black: {} };
    for (const color of ['white', 'black']) {
        for (const phase of ['opening', 'middlegame', 'endgame']) {
            const moves = perMove.filter(m => m.color === color && m.phase === phase && m.category !== 'Forced');
            out[color][phase] = moves.length
                ? Math.round(moves.reduce((a, m) => a + moveAccuracy(m.winLoss), 0) / moves.length)
                : null;
        }
    }
    return out;
}

// ─── FULL-GAME ANALYSIS ────────────────────────────────────────────────────────
function runAnalysis(sanMoves, modeKey) {
    const mode = ANALYSIS_MODES[modeKey] || ANALYSIS_MODES.standard;
    resetGame();
    recordPosition();
    clearSearchMemory();

    const opening = identifyOpening(sanMoves, OPENING_BOOK.map(l => l.moves));

    // Resolve every move up front so a bad PGN fails fast with a clear message.
    const resolved = [];
    for (let i = 0; i < sanMoves.length; i++) {
        const r = resolveSAN(currentTurn, sanMoves[i]);
        if (!r) throw new Error(`Illegal or unreadable move ${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${sanMoves[i]}`);
        resolved.push(r);
        applyMoveWithPromotion(r.move, r.promo);
    }
    const total = resolved.length;
    resetGame();
    recordPosition();

    self.postMessage({ type: 'start', total, opening: opening.name, mode: modeKey });

    const perMove = [];
    let current = searchPosition(mode, resolved[0] || null);
    const startEval = current.score; // White to move at the start
    const whiteWin = [winProbability(startEval)];
    let depthSum = current.depth, depthCount = 1;

    for (let i = 0; i < total; i++) {
        const color = currentTurn;
        const sign = color === 'white' ? 1 : -1;
        const { move, promo } = resolved[i];
        const phase = gamePhaseAt(i);
        const best = current.lines[0];
        const isBest = !!best && sameMove(best.move, move) && (best.move.promo || null) === (promo || null);
        const bestScore = current.score;
        const playedScore = isBest ? bestScore : current.includedScore;
        const second = current.lines[1] || null;
        const prev = perMove[i - 1];
        const isRecapture = !!prev && prev.captured > 0 && prev.to.x === move.toX && prev.to.y === move.toY;

        const measured = playAndMeasure(move, promo, color);
        const { captured, deliversMate } = measured;

        const next = i + 1 < total ? searchPosition(mode, resolved[i + 1]) : searchFinalPosition(mode);
        depthSum += next.depth; depthCount++;

        let sacrifice = measured.sacrifice, sacrificeMates = false;
        if (sacrifice >= SACRIFICE_MIN) {
            const check = confirmSacrifice(next.pv || [], color, measured.materialBefore, () => restorePosition(resolved, i + 1));
            sacrificeMates = check.mates;
            if (!check.mates) sacrifice = Math.min(sacrifice, Math.max(0, check.given));
        }

        const winBest = winProbability(bestScore);
        const winPlayed = winProbability(playedScore);
        const winLoss = Math.max(0, winBest - winPlayed);
        const category = classify({
            legalCount: current.legalCount, inBook: i < opening.bookPlies, isBest,
            winBest, winPlayed, winLoss, winSecond: second ? winProbability(second.score) : null,
            sacrifice, sacrificeMates, prevLoss: prev ? prev.winLoss : 0, isRecapture, deliversMate,
        });

        // Eval after the move comes from the next position's own (deeper) search.
        const evalAfterWhite = -sign * next.score;
        whiteWin.push(winProbability(evalAfterWhite));

        const entry = {
            ply: i, color, san: sanMoves[i], category, phase,
            from: { x: move.fromX, y: move.fromY }, to: { x: move.toX, y: move.toY },
            details: move.details, promo,
            winBest: round1(winBest), winPlayed: round1(winPlayed), winLoss: round1(winLoss),
            centipawnLoss: Math.max(0, Math.round(clampCp(bestScore) - clampCp(playedScore))),
            evalBefore: sign * bestScore,          // White's view, best play from the position before
            evalAfter: evalAfterWhite,             // White's view, position after the move
            bestMove: !isBest && best ? { ...best.move, san: best.san } : null,
            bestLine: current.pv,
            punishMove: next.lines.length ? { ...next.lines[0].move, san: next.lines[0].san } : null,
            punishLine: next.pv,
            sacrifice, captured,
            depth: current.depth,
        };
        perMove.push(entry);
        self.postMessage({ type: 'move', entry, startEval });
        current = next;
    }

    const accuracy = computeAccuracy(perMove, whiteWin);
    const counts = { white: {}, black: {} };
    for (const m of perMove) counts[m.color][m.category] = (counts[m.color][m.category] || 0) + 1;

    return {
        version: ANALYSIS_VERSION,
        mode: modeKey,
        opening: opening.name,
        bookPlies: opening.bookPlies,
        startEval,
        perMove,
        evalGraph: perMove.map(m => m.evalAfter),
        accuracy,
        phaseAccuracy: phaseAccuracy(perMove),
        counts,
        avgDepth: Math.round(depthSum / depthCount * 10) / 10,
    };
}

// The game's last position: a finished game (mate/stalemate/draw rule) gets its
// result as the evaluation instead of a search.
function searchFinalPosition(mode) {
    const status = getGameStatus();
    if (status && status.result === '1/2-1/2') {
        return { terminal: true, score: 0, lines: [], pv: [], depth: 0, legalCount: 0 };
    }
    return searchPosition(mode, null);
}

function round1(v) { return Math.round(v * 10) / 10; }
function clampCp(v) { return Math.max(-3000, Math.min(3000, v)); }

// ─── JUDGING A SINGLE MOVE ─────────────────────────────────────────────────────
// Rates `move` in the current position the same way a game move is rated
// (without book/sacrifice context). Leaves the board unchanged.
function judgeCurrentMove(move) {
    const mode = { timeMs: EXPLORE_TIME_MS / 2, maxDepth: EXPLORE_DEPTH };
    const before = searchPosition(mode, { move, promo: move.promo || null });
    const best = before.lines[0];
    const isBest = !!best && sameMove(best.move, move) && (best.move.promo || null) === (move.promo || best.move.promo || null);
    const winBest = winProbability(before.score);
    const winPlayed = winProbability(isBest ? before.score : before.includedScore);
    const winLoss = Math.max(0, winBest - winPlayed);
    const second = before.lines[1];
    const category = classify({
        legalCount: before.legalCount, inBook: false, isBest, winBest, winPlayed, winLoss,
        winSecond: second ? winProbability(second.score) : null,
        sacrifice: 0, prevLoss: 0, isRecapture: false,
        deliversMate: isBest && before.score === EVAL_MATE - 1,
    });
    const sign = currentTurn === 'white' ? 1 : -1;
    return {
        category, winLoss: round1(winLoss),
        bestSan: isBest || !best ? null : best.san,
        bestMove: best ? best.move : null,
        bestLine: before.pv,
        evalWhite: sign * (isBest ? before.score : before.includedScore),
    };
}

// "Retry mistakes": rate a replacement move in the position after `sanMoves`.
function runJudge(sanMoves, move) {
    replaySANFromStart(sanMoves);
    return judgeCurrentMove(move);
}

// ─── "WHAT IF" EXPLORATION ─────────────────────────────────────────────────────
// Replays the game up to the branch point plus the variation so far. The last
// variation move (the user's) is judged against the engine's choice in that
// position, then the engine searches its reply.
function runExplore(sanMoves, variationMoves) {
    replaySANFromStart(sanMoves);
    const earlier = variationMoves.slice(0, -1);
    for (const vm of earlier) { applyMoveWithPromotion(vm, vm.promo); recordPosition(); }

    let userVerdict = null;
    const userMove = variationMoves[variationMoves.length - 1];
    if (userMove) {
        const v = judgeCurrentMove(userMove);
        userVerdict = { category: v.category, bestSan: v.bestSan };
        applyMoveWithPromotion(userMove, userMove.promo);
        recordPosition();
    }

    const color = currentTurn;
    const reply = searchPosition({ timeMs: EXPLORE_TIME_MS, maxDepth: EXPLORE_DEPTH }, null);
    if (reply.terminal) {
        return { userVerdict, move: null, san: null, evalWhite: color === 'white' ? reply.score : -reply.score, pv: [] };
    }
    const top = reply.lines[0];
    return {
        userVerdict,
        move: top.move,
        san: top.san,
        evalWhite: color === 'white' ? reply.score : -reply.score,
        pv: reply.pv,
        depth: reply.depth,
    };
}

self.onmessage = function (e) {
    const data = e.data;
    try {
        if (data.type === 'analyze') {
            const report = runAnalysis(data.sanMoves, data.mode || 'standard');
            self.postMessage({ type: 'done', report });
        } else if (data.type === 'explore') {
            const result = runExplore(data.sanMoves, data.variationMoves);
            self.postMessage({ type: 'exploreReply', result, requestId: data.requestId });
        } else if (data.type === 'judge') {
            const result = runJudge(data.sanMoves, data.move);
            self.postMessage({ type: 'judgeReply', result, requestId: data.requestId });
        }
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message, requestType: data.type });
    }
};
