// Puzzle mining — evaluated inside the analysis-worker context (engine.js,
// ai.js, notation.js, analysis.js and the worker's helpers), see
// tools/make-puzzles.js. Plays engine-vs-engine games with the human-like
// weaker levels (they make real mistakes) and turns the moments a mistake hands
// the other side a clear, unique win into puzzles.

const MINE_FAST = { timeMs: 160, maxDepth: 8 };    // first pass over every position
const MINE_DEEP = { timeMs: 1500, maxDepth: 18 };  // verifying a candidate
const MINE_STEP = { timeMs: 900, maxDepth: 16 };   // each later move of the solution
const WIN_CP = 220;          // the solution must leave the solver at least this far ahead
const SWING_CP = 180;        // ...and the move before must have handed over at least this much
const UNIQUE_CP = 160;       // the best move must beat the second best by this much
const LOST_CP = 700;         // skip gifts in positions that were already decided
const MAX_PLAYER_MOVES = 3;  // longest non-mate puzzle (solver's moves)
const MAX_MATE_MOVES = 5;

function minerSearch(mode, multiPV = 2) {
    return searchRoot(currentTurn, { timeMs: mode.timeMs, maxDepth: mode.maxDepth, multiPV, contempt: 0, withLines: true, searchForced: true });
}

function minerPlay(san) {
    const r = resolveSAN(currentTurn, san);
    applyMoveWithPromotion(r.move, r.promo);
    recordPosition();
    return r;
}

const minerMate = (s) => Math.abs(s) >= EVAL_MATE_BOUND;

// Why candidates were dropped (printed by make-puzzles.js, for tuning).
const MINER_STATS = {};
function reject(reason) { MINER_STATS[reason] = (MINER_STATS[reason] || 0) + 1; return null; }

// The best move counts as the only solution: a mate with no other mate beside
// it, or a lead over the second-best move of at least UNIQUE_CP.
function uniqueBest(res) {
    const a = res.lines[0], b = res.lines[1];
    if (!a || !b) return false; // a forced move isn't a puzzle
    if (minerMate(a.score) && a.score > 0) return !(minerMate(b.score) && b.score > 0);
    return a.score - b.score >= UNIQUE_CP;
}

// One engine game between `levels` = { white, black } (ENGINE_LEVELS entries).
function minerGame(levels, opening) {
    const sans = [];
    resetGame();
    recordPosition();
    for (const san of opening) { minerPlay(san); sans.push(san); }
    for (let ply = 0; ply < 180; ply++) {
        if (getGameStatus()) break;
        const level = levels[currentTurn];
        const r = findBestMove(currentTurn, { ...level, timeMs: 400 }, sans);
        if (!r.move) break;
        const piece = gameState[r.move.fromY][r.move.fromX];
        const promo = piece.type === 'pawn' && (r.move.toY === 0 || r.move.toY === 7) ? (r.promo || 'queen') : null;
        const san = moveToSAN(r.move.fromX, r.move.fromY, r.move.toX, r.move.toY, r.move.details, promo);
        applyMoveWithPromotion(r.move, promo);
        recordPosition();
        sans.push(san + getCheckSuffix(currentTurn));
    }
    return sans;
}

// Every puzzle hidden in a finished game.
function minerPuzzles(sans) {
    // Fast eval of every position (side to move's view).
    const fast = [];
    resetGame();
    recordPosition();
    for (let k = 0; k <= sans.length; k++) {
        fast.push(getGameStatus() ? null : minerSearch(MINE_FAST, 1).score);
        if (k < sans.length) minerPlay(sans[k]);
    }
    const out = [];
    let lastAt = -10;
    for (let k = 8; k < sans.length; k++) {
        if (fast[k] === null || fast[k - 1] === null) continue;
        // The side to move at k is clearly better, and the last move made it so.
        if (fast[k] < WIN_CP || fast[k] + fast[k - 1] < SWING_CP) continue;
        if (fast[k - 1] < -LOST_CP) { reject('alreadyLost'); continue; } // no real puzzle left
        if (k - lastAt < 4) { reject('sameSkirmish'); continue; } // one puzzle per tactical skirmish
        reject('candidates');
        const p = minerBuild(sans.slice(0, k));
        if (p) { out.push(p); lastAt = k; }
    }
    return out;
}

// The puzzle at the position after `prefix`, or null if it doesn't qualify.
function minerBuild(prefix) {
    replaySANFromStart(prefix);
    const color = currentTurn;
    const first = minerSearch(MINE_DEEP, 2);
    if (!first.lines.length || first.lines[0].score < WIN_CP) return reject('notWinningDeep');
    if (!uniqueBest(first)) return reject('notUnique');
    const mating = minerMate(first.lines[0].score);
    const startMaterial = materialBalance(color);

    const solution = [];
    let res = first, playerMoves = 0;
    let finalScore = null; // solver's view at the end of the line (null: score after the last move)
    while (true) {
        const best = res.lines[0];
        solution.push(best.san);
        minerPlay(best.san);
        playerMoves++;
        if (!hasAnyLegalMove(currentTurn) || getGameStatus()) break; // mate (or a draw — rejected below)
        if (playerMoves >= (mating ? MAX_MATE_MOVES : MAX_PLAYER_MOVES)) break;
        const reply = minerSearch(MINE_STEP, 1).lines[0];
        if (!reply) break;
        minerPlay(reply.san);
        const next = minerSearch(MINE_STEP, 2);
        // Continue only while the next move is again the only good one (mates: to the end).
        if (!next.lines.length || !uniqueBest(next) || (mating && !minerMate(next.lines[0].score))) {
            if (mating) return reject('mateNotUnique'); // a mate puzzle must run all the way to mate
            // The line ends with the solver's move; the reply isn't part of it.
            finalScore = next.lines.length ? next.lines[0].score : null;
            break;
        }
        solution.push(reply.san);
        res = next;
    }
    const status = getGameStatus();
    if (status && status.result === '1/2-1/2') return reject('draw');
    if (mating && !(status && status.reason === 'checkmate')) return reject('mateTooLong');
    if (mating) finalScore = EVAL_MATE;
    else if (finalScore === null) finalScore = -minerSearch(MINE_FAST, 1).score;
    if (!mating && finalScore < WIN_CP) return reject('fizzles');
    reject('kept');

    // ─── themes ───
    const themes = [];
    if (mating) {
        themes.push('mate', `mateIn${playerMoves}`);
        if (backRankMate(color)) themes.push('backRankMate');
    }
    replaySANFromStart(prefix);
    const firstMove = resolveSAN(color, solution[0]);
    const victim = gameState[firstMove.move.toY][firstMove.move.toX];
    const enemy = color === 'white' ? 'black' : 'white';
    if (victim && victim.type !== 'pawn' && !isSquareAttacked(firstMove.move.toX, firstMove.move.toY, enemy) && playerMoves === 1) themes.push('hangingPiece');
    for (let j = 0; j < solution.length; j += 2) {
        replaySANFromStart(prefix.concat(solution.slice(0, j)));
        const m = resolveSAN(color, solution[j]);
        if (m && forkAfter({ ...m.move, promo: m.promo }, solution.slice(j + 1)).length) { themes.push('fork'); break; }
    }
    replaySANFromStart(prefix);
    minerPlay(solution[0]);
    if (solution[1]) minerPlay(solution[1]);
    if (materialBalance(color) - startMaterial <= -200 && !themes.includes('hangingPiece')) themes.push('sacrifice');
    if (solution.some((s, i) => i % 2 === 0 && s.includes('='))) themes.push('promotion');
    replaySANFromStart(prefix);
    if (nonPawnMaterial() <= 13) themes.push('endgame');
    if (!mating) themes.push('advantage');
    if (playerMoves === 1) themes.push('oneMove'); else if (playerMoves >= 3) themes.push('long');

    return { prefix, solution, themes, rating: minerRating(prefix, solution, themes, color, playerMoves), score: first.lines[0].score };
}

function nonPawnMaterial() {
    const V = { knight: 3, bishop: 3, rook: 5, queen: 9 };
    let n = 0;
    for (const row of gameState) for (const p of row) if (p && V[p.type]) n += V[p.type];
    return n;
}

// Mated king on its back rank, mated by a rook or queen on that same rank.
function backRankMate(winner) {
    const loser = winner === 'white' ? 'black' : 'white';
    const k = findKing(loser);
    if (!k || k.y !== (loser === 'white' ? 7 : 0)) return false;
    return lastMove && lastMove.toY === k.y && ['rook', 'queen'].includes(gameState[lastMove.toY][lastMove.toX].type);
}

// Difficulty estimate (not calibrated on people): how deep the engine must look
// before the first move is its choice, plus length, a quiet first move, a sacrifice.
function minerRating(prefix, solution, themes, color, playerMoves) {
    replaySANFromStart(prefix);
    let found = 9;
    for (let d = 8; d >= 1; d--) {
        const r = searchRoot(color, { timeMs: 4000, maxDepth: d, multiPV: 1, contempt: 0, withLines: true, searchForced: true });
        if (!r.lines.length || r.lines[0].san !== solution[0]) break;
        found = d;
    }
    const firstQuiet = !/[x+#=]/.test(solution[0]);
    let rating = 650 + 150 * (found - 1) + 170 * (playerMoves - 1) + (firstQuiet ? 220 : 0)
        + (themes.includes('sacrifice') ? 250 : 0) - (themes.includes('hangingPiece') ? 150 : 0)
        + (themes.includes('mate') ? (playerMoves === 1 ? -100 : 80 * (playerMoves - 1)) : 0);
    return Math.max(500, Math.min(2600, Math.round(rating / 10) * 10));
}
