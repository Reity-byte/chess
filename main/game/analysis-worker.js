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
importScripts('engine.js?v=32', 'ai.js?v=32', 'notation.js?v=32', 'openings.js?v=32', 'analysis.js?v=32');

// Single moves judged on the review page (variations, retries) and the live
// engine panel always search at full strength, whatever level the game was
// played at.
const JUDGE_MODE = { timeMs: 700, maxDepth: 20 };
const HINT_MODE = { timeMs: 900, maxDepth: 20 };
const THREAT_MODE = { timeMs: 300, maxDepth: 12 };  // the opponent's "free move" in a hint
const LIVE_LINES = 3;
const LIVE_MAX_MS = 20000;
const LIVE_MAX_DEPTH = 30;
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

// ─── EXPLANATIONS ("why was this a mistake?") ──────────────────────────────────
// Turns the engine's verdict into a concrete reason by replaying its lines on
// the real board: mates allowed or missed, material that goes or could have
// been won, and forks behind either. Returns { motif, text } or null; the board
// is always restored to the position after the move.
const EXPLAIN_MIN_LOSS = 5;      // win% loss from which an error gets explained
const EXPLAIN_MATERIAL = 150;    // cp swing that counts as winning/losing material
const LINE_PLIES = 3;            // how far along a line material is counted

function squareName(x, y) { return FILE_NAMES[x] + (8 - y); }

function materialWord(cp) {
    if (cp >= 800) return 'the queen';
    if (cp >= 450) return 'a rook';
    if (cp >= 250) return 'a piece';
    if (cp >= 150) return 'material';
    return 'a pawn';
}

// Plays up to `plies` SAN moves of `line` from the current position and
// returns the material change for `color` (stops early at a finished game).
function lineMaterialDelta(line, color, plies) {
    const before = materialBalance(color);
    for (let k = 0; k < Math.min(plies, line.length); k++) {
        const r = resolveSAN(currentTurn, line[k]);
        if (!r) break;
        applyMoveWithPromotion(r.move, r.promo);
        if (!hasAnyLegalMove(currentTurn)) break;
    }
    return materialBalance(color) - before;
}

// Enemy pieces the piece on (x, y) attacks that are worth forking: the king,
// anything more valuable than the attacker, or anything undefended. (Move
// generation lists the enemy king's square too when the piece gives check.)
function forkTargets(x, y) {
    const piece = gameState[y][x];
    if (!piece) return [];
    const enemy = piece.color === 'white' ? 'black' : 'white';
    const mine = PIECE_VALUES[piece.type];
    const out = [];
    for (const m of getvalidMoves(x, y)) {
        const t = gameState[m.y][m.x];
        if (!t || t.color !== enemy || t.type === 'pawn') continue;
        const worth = t.type === 'king' || PIECE_VALUES[t.type] > mine || !isSquareAttacked(m.x, m.y, enemy);
        if (worth) out.push(t.type);
    }
    out.sort((a, b) => PIECE_VALUES[b] - PIECE_VALUES[a]); // king first
    return [...new Set(out)];
}

function forkText(targets) {
    const named = targets.slice(0, 2).map(t => `the ${t}`);
    return named.join(' and ');
}

// A fork only counts if it pays off: following the engine line after it (the
// opponent's reply, then the forker's follow-up), the forking side must win at
// least EXPLAIN_MATERIAL on top of anything the forking move itself took.
// Attacking two pieces that are both safe is not a fork worth naming.
function forkPaysOff(side, lineAfter) {
    return lineMaterialDelta(lineAfter, side, 2) >= EXPLAIN_MATERIAL;
}

// Plays `move` from the current position; returns the fork targets of the moved
// piece if it is a fork that pays off along `lineAfter`, else []. The board is
// NOT restored.
function forkAfter(move, lineAfter) {
    const legal = getvalidMoves(move.fromX, move.fromY).find(m => m.x === move.toX && m.y === move.toY);
    if (!legal) return [];
    const side = gameState[move.fromY][move.fromX].color;
    applyMoveWithPromotion({ ...move, details: legal }, move.promo || null);
    const targets = forkTargets(move.toX, move.toY);
    return targets.length >= 2 && forkPaysOff(side, lineAfter) ? targets : [];
}

// ctx: { i, resolved, color, move, bestScore, playedScore, winLoss, isBest,
//        best (line entry), current (search of the position before), next
//        (search after), materialBefore }
function explainMove(ctx) {
    const { i, resolved, color, move, best, current, next } = ctx;
    const backToAfter = () => restorePosition(resolved, i + 1);
    const backToBefore = () => restorePosition(resolved, i);

    if (ctx.winLoss < EXPLAIN_MIN_LOSS) {
        // A good move: only call out a fork it creates (one that actually wins
        // something — and a mating move is simply mate).
        if (ctx.winLoss > ANALYSIS_THRESHOLDS.excellent || !hasAnyLegalMove(currentTurn)) return null;
        const targets = forkTargets(move.toX, move.toY);
        if (targets.length < 2) return null;
        const pays = forkPaysOff(color, next.pv);
        backToAfter();
        return pays ? { motif: 'fork', text: `Forks ${forkText(targets)}.` } : null;
    }

    // 1. Mates.
    if (next.score >= EVAL_MATE_BOUND) {
        const n = mateInMoves(next.score);
        return { motif: 'allowsMate', text: `Allows mate in ${n}${next.pv.length ? ` (${next.pv.slice(0, 2 * n - 1).join(' ')})` : ''}.` };
    }
    if (ctx.bestScore >= EVAL_MATE_BOUND && ctx.playedScore < EVAL_MATE_BOUND && best) {
        return { motif: 'missedMate', text: `Misses mate in ${mateInMoves(ctx.bestScore)} starting with ${best.san}.` };
    }

    // 2. Material the opponent's best reply wins (we're at the position after the
    //    move). `lost` is net of anything the move itself captured.
    const punish = next.lines[0];
    const moveGain = materialBalance(color) - ctx.materialBefore;
    let lost = -moveGain, punishFork = [];
    if (punish) {
        lost = -(moveGain + lineMaterialDelta(next.pv, color, LINE_PLIES - 1));
        backToAfter();
        punishFork = forkAfter(punish.move, next.pv.slice(1));
        backToAfter();
    }
    if (punish && lost >= EXPLAIN_MATERIAL) {
        if (punishFork.length) return { motif: 'allowsFork', text: `Allows ${punish.san}, forking ${forkText(punishFork)}.` };
        const target = gameState[punish.move.toY][punish.move.toX];
        if (target && target.color === color && target.type !== 'pawn' && lost >= PIECE_VALUES[target.type] - 100) {
            return { motif: 'hangs', text: `Hangs the ${target.type} on ${squareName(punish.move.toX, punish.move.toY)} — ${punish.san} wins it.` };
        }
        return { motif: 'losesMaterial', text: `Loses ${materialWord(lost)} after ${punish.san}.` };
    }

    // 3. Material the best move would have won (from the position before the move).
    if (best && !ctx.isBest) {
        backToBefore();
        const gained = lineMaterialDelta(current.pv, color, LINE_PLIES);
        backToBefore();
        const bestFork = forkAfter(best.move, current.pv.slice(1));
        backToAfter();
        if (bestFork.length && gained - Math.max(0, -lost) >= EXPLAIN_MATERIAL - 50) {
            return { motif: 'missedFork', text: `Misses the fork ${best.san}, hitting ${forkText(bestFork)}.` };
        }
        if (gained + lost >= EXPLAIN_MATERIAL && gained >= EXPLAIN_MATERIAL) {
            return { motif: 'missedWin', text: `Misses ${best.san}, which wins ${materialWord(gained)}.` };
        }
    }
    return null;
}

// ─── GAME ANALYSIS: RANGES + FINAL REPORT ──────────────────────────────────────
// A game can be analyzed in pieces: analyzeRange() handles the moves
// [from, to) — searching positions from..to, the last one being the position
// after move to-1 — and the review page runs several ranges in parallel, one
// per worker. finalizeReport() then puts the moves back in order, settles the
// one classification rule that looks at the previous move ("Miss" needs the
// opponent's error size), and computes accuracy and totals.

// Resolves the whole game up front so a bad PGN fails fast with a clear message.
function resolveGame(sanMoves) {
    resetGame();
    const resolved = [];
    for (let i = 0; i < sanMoves.length; i++) {
        const r = resolveSAN(currentTurn, sanMoves[i]);
        if (!r) throw new Error(`Illegal or unreadable move ${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'} ${sanMoves[i]}`);
        resolved.push(r);
        applyMoveWithPromotion(r.move, r.promo);
    }
    return resolved;
}

// Analyzes moves [from, to). Each finished move is passed to `onMove(entry,
// startEval)` (startEval only known to the range that starts at 0). Entries
// carry `inputs`, the classification facts finalizeReport() re-classifies from.
function analyzeRange(sanMoves, from, to, modeKey, onMove) {
    const mode = typeof modeKey === 'object' ? modeKey : ANALYSIS_MODES[modeKey] || ANALYSIS_MODES.standard;
    const opening = identifyOpening(sanMoves, OPENING_BOOK.map(l => l.moves));
    const resolved = resolveGame(sanMoves);
    to = Math.min(to, resolved.length);
    restorePosition(resolved, from);

    let current = searchPosition(mode, resolved[from] || null);
    const startEval = from === 0 ? current.score : null; // White to move at the start
    const entries = [];

    for (let i = from; i < to; i++) {
        const color = currentTurn;
        const sign = color === 'white' ? 1 : -1;
        const { move, promo } = resolved[i];
        const phase = gamePhaseAt(i);
        const best = current.lines[0];
        const isBest = !!best && sameMove(best.move, move) && (best.move.promo || null) === (promo || null);
        const bestScore = current.score;
        const playedScore = isBest ? bestScore : current.includedScore;
        const second = current.lines[1] || null;
        // A recapture: the previous move captured on the square this move lands on.
        const prevMove = i > 0 ? resolved[i - 1].move : null;
        const isRecapture = !!prevMove && sanMoves[i - 1].includes('x') && prevMove.toX === move.toX && prevMove.toY === move.toY;

        const measured = playAndMeasure(move, promo, color);
        const { captured, deliversMate } = measured;

        const next = i + 1 < resolved.length ? searchPosition(mode, resolved[i + 1]) : searchFinalPosition(mode);

        let sacrifice = measured.sacrifice, sacrificeMates = false;
        if (sacrifice >= SACRIFICE_MIN) {
            const check = confirmSacrifice(next.pv || [], color, measured.materialBefore, () => restorePosition(resolved, i + 1));
            sacrificeMates = check.mates;
            if (!check.mates) sacrifice = Math.min(sacrifice, Math.max(0, check.given));
        }

        const winBest = winProbability(bestScore);
        const winPlayed = winProbability(playedScore);
        const winLoss = Math.max(0, winBest - winPlayed);
        // Book and forced moves aren't the player's judgement: nothing to explain.
        const why = i < opening.bookPlies || current.legalCount === 1 ? null : explainMove({
            i, resolved, color, move, bestScore, playedScore, winLoss, isBest, best, current, next,
            materialBefore: measured.materialBefore,
        });
        const inputs = {
            legalCount: current.legalCount, inBook: i < opening.bookPlies, isBest,
            winBest, winPlayed, winLoss, winSecond: second ? winProbability(second.score) : null,
            sacrifice, sacrificeMates, isRecapture, deliversMate,
        };
        const prevLoss = entries.length ? entries[entries.length - 1].winLoss : 0; // provisional at a range start
        const evalAfterWhite = -sign * next.score; // from the next position's own (deeper) search

        const entry = {
            ply: i, color, san: sanMoves[i], category: classify({ ...inputs, prevLoss }), phase, inputs,
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
            reason: why ? why.text : null,
            motif: why ? why.motif : null,
            depth: current.depth,
        };
        entries.push(entry);
        onMove(entry, startEval);
        current = next;
    }
    return { entries, startEval, opening };
}

// Orders the entries, re-classifies each with its predecessor's loss, and
// builds the report.
function finalizeReport(entries, startEval, sanMoves, modeKey) {
    const perMove = entries.slice().sort((a, b) => a.ply - b.ply);
    perMove.forEach((m, i) => {
        m.category = classify({ ...m.inputs, prevLoss: i > 0 ? perMove[i - 1].winLoss : 0 });
    });
    const opening = identifyOpening(sanMoves, OPENING_BOOK.map(l => l.moves));
    const whiteWin = [winProbability(startEval)].concat(perMove.map(m => winProbability(m.evalAfter)));
    const counts = { white: {}, black: {} };
    for (const m of perMove) counts[m.color][m.category] = (counts[m.color][m.category] || 0) + 1;
    const depths = perMove.map(m => m.depth);
    return {
        version: ANALYSIS_VERSION,
        mode: modeKey,
        opening: opening.name,
        bookPlies: opening.bookPlies,
        startEval,
        perMove,
        evalGraph: perMove.map(m => m.evalAfter),
        accuracy: computeAccuracy(perMove, whiteWin),
        phaseAccuracy: phaseAccuracy(perMove),
        counts,
        avgDepth: depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length * 10) / 10 : 0,
    };
}

// Whole game on this one worker (tests, and browsers without spare cores).
function runAnalysis(sanMoves, modeKey) {
    clearSearchMemory();
    const opening = identifyOpening(sanMoves, OPENING_BOOK.map(l => l.moves));
    self.postMessage({ type: 'start', total: sanMoves.length, opening: opening.name, mode: modeKey });
    const { entries, startEval } = analyzeRange(sanMoves, 0, sanMoves.length, modeKey,
        (entry, start) => self.postMessage({ type: 'move', entry, startEval: start }));
    return finalizeReport(entries, startEval, sanMoves, modeKey);
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
// Rates the move `san` in the position after `sanMoves` exactly like a game
// move — category, reason, better move and lines — by analyzing it as a
// one-move range. Used for the review page's own variations and for "Retry
// mistakes". Returns the analysis entry (evalAfter etc. from White's view).
function runJudgeMove(sanMoves, san) {
    const all = sanMoves.concat([san]);
    const { entries } = analyzeRange(all, sanMoves.length, all.length, JUDGE_MODE, () => {});
    return entries[0];
}

// ─── HINTS ─────────────────────────────────────────────────────────────────────
// The game page's 💡 Hint: the best move in the position after `sanMoves`, plus
// a clue about what it does that doesn't name the move. Returns null when the
// game is over.
function runHint(sanMoves) {
    const restore = () => replaySANFromStart(sanMoves);
    restore();
    const color = currentTurn, enemy = color === 'white' ? 'black' : 'white';
    if (!hasAnyLegalMove(color)) return null;
    const res = searchPosition(HINT_MODE, null);
    const best = res.lines[0];
    if (!best) return null;
    const piece = gameState[best.move.fromY][best.move.fromX].type;
    let clue;
    if (res.score >= EVAL_MATE_BOUND) {
        clue = `There's a forced mate in ${mateInMoves(res.score)}.`;
    } else {
        const gain = lineMaterialDelta(res.pv, color, LINE_PLIES);
        restore();
        const fork = forkAfter(best.move, res.pv.slice(1));
        restore();
        const danger = piecesInDanger(color, enemy);
        const threat = isInCheck(color) ? null : opponentThreat(enemy);
        restore();
        if (fork.length) clue = 'There is a fork.';
        else if (gain >= EXPLAIN_MATERIAL) clue = `You can win ${materialWord(gain)}.`;
        else if (isInCheck(color)) clue = 'Get out of check — but pick the safest way.';
        else if (danger.length && danger[0].x === best.move.fromX && danger[0].y === best.move.fromY) {
            clue = `Your ${danger[0].type} on ${squareName(danger[0].x, danger[0].y)} is in danger.`;
        } else if (threat === 'mate') clue = 'Your opponent threatens mate — stop it.';
        else if (threat) clue = 'Your opponent has a threat — what does their last move attack?';
        else if (danger.length) clue = `Something of yours is under attack — deal with it.`;
        else if (res.score <= -300) clue = 'You are worse here — find the toughest defence.';
        else clue = best.san.includes('x') ? 'A capture is strong here.' : 'No tactics right now — find the best improving move.';
    }
    const sign = color === 'white' ? 1 : -1;
    return { move: best.move, san: best.san, piece, clue, evalWhite: sign * res.score, line: res.pv.slice(0, 6) };
}

// What `enemy` would do with a free move here (a "null move"): 'mate', 'material'
// (wins at least EXPLAIN_MATERIAL along its line) or null. Leaves the board changed.
function opponentThreat(enemy) {
    currentTurn = enemy;
    if (!hasAnyLegalMove(enemy)) return null;
    const res = searchPosition(THREAT_MODE, null);
    if (res.score >= EVAL_MATE_BOUND) return 'mate';
    return lineMaterialDelta(res.pv, enemy, LINE_PLIES) >= EXPLAIN_MATERIAL ? 'material' : null;
}

// `color`'s pieces (not pawns or the king) that are attacked and undefended,
// most valuable first.
function piecesInDanger(color, enemy) {
    const out = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p || p.color !== color || p.type === 'pawn' || p.type === 'king') continue;
            if (isSquareAttacked(x, y, enemy) && !isSquareAttacked(x, y, color)) out.push({ x, y, type: p.type });
        }
    }
    return out.sort((a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]);
}

// ─── LIVE ANALYSIS ─────────────────────────────────────────────────────────────
// The review page's engine panel: searches the position after `sanMoves`
// deeper and deeper (top LIVE_LINES moves) and posts every finished depth.
// The page terminates this worker when the position changes, which is the
// only way to interrupt a search.
function runLive(sanMoves, requestId, maxMs = LIVE_MAX_MS) {
    replaySANFromStart(sanMoves);
    const color = currentTurn, sign = color === 'white' ? 1 : -1;
    const post = (fields) => self.postMessage({ type: 'live', requestId, ...fields });
    const status = getGameStatus();
    if (status) {
        const evalWhite = status.result === '1-0' ? EVAL_MATE : status.result === '0-1' ? -EVAL_MATE : 0;
        post({ depth: 0, lines: [], evalWhite, terminal: status.message, done: true });
        return;
    }
    const started = Date.now();
    let reached = 0;
    for (let depth = 1; depth <= LIVE_MAX_DEPTH; depth++) {
        const left = maxMs - (Date.now() - started);
        if (left <= 0) break;
        const r = searchRoot(color, { timeMs: left, maxDepth: depth, multiPV: LIVE_LINES, contempt: 0, withLines: true, searchForced: true });
        if (r.depth <= reached) break; // out of time before this depth finished
        reached = r.depth;
        const lines = r.lines.slice(0, LIVE_LINES).map(l => ({
            move: plainMove(l.move, l.promo), san: l.san, pv: l.pv || [l.san], evalWhite: sign * l.score,
        }));
        post({ depth: r.depth, lines, evalWhite: lines.length ? lines[0].evalWhite : 0 });
        if (lines.length && Math.abs(lines[0].evalWhite) >= EVAL_MATE_BOUND) break; // a forced mate won't change
    }
    post({ done: true, depth: reached });
}

self.onmessage = function (e) {
    const data = e.data;
    try {
        if (data.type === 'analyze') {
            const report = runAnalysis(data.sanMoves, data.mode || 'standard');
            self.postMessage({ type: 'done', report });
        } else if (data.type === 'analyzeRange') {
            if (data.from === 0) {
                const opening = identifyOpening(data.sanMoves, OPENING_BOOK.map(l => l.moves));
                self.postMessage({ type: 'start', total: data.sanMoves.length, opening: opening.name, mode: data.mode });
            }
            analyzeRange(data.sanMoves, data.from, data.to, data.mode || 'standard',
                (entry, startEval) => self.postMessage({ type: 'move', entry, startEval }));
            self.postMessage({ type: 'rangeDone', rangeId: data.rangeId });
        } else if (data.type === 'finalize') {
            const report = finalizeReport(data.entries, data.startEval, data.sanMoves, data.mode || 'standard');
            self.postMessage({ type: 'done', report });
        } else if (data.type === 'judgeMove') {
            const entry = runJudgeMove(data.sanMoves, data.san);
            self.postMessage({ type: 'judgeReply', entry, requestId: data.requestId });
        } else if (data.type === 'hint') {
            self.postMessage({ type: 'hintReply', hint: runHint(data.sanMoves), requestId: data.requestId });
        } else if (data.type === 'live') {
            runLive(data.sanMoves, data.requestId, data.maxMs);
        }
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message, requestType: data.type, requestId: data.requestId });
    }
};
