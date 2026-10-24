// ─── PUZZLE TRAINER ────────────────────────────────────────────────────────────
// Drives puzzles.html: a rated trainer built from real blunders. Puzzles are
// { sanPrefix, punishMove, rating, category, centipawnLoss, solutionLine? }
// records drawn from STARTER_PUZZLES (puzzle-bank.js) plus the growing pool in
// localStorage['chessPuzzleBank'] that analysis-page.js appends to whenever a
// game is reviewed.
const RATING_KEY = 'chessPuzzleRating';
const STREAK_KEY = 'chessPuzzleStreak';
const SOLVED_KEY = 'chessPuzzleSolvedCount';
const DONE_KEY   = 'chessPuzzleSolvedIds'; // ids already seen, to avoid immediate repeats
const BANK_KEY   = 'chessPuzzleBank';

let rating = 1200;
let streak = 0;
let solvedCount = 0;
let solvedIds = [];
let allPuzzles = [];
let currentPuzzle = null;
let puzzleDone = false;   // solved or revealed — blocks further guesses
let hintUsed = false;
let loadToken = 0;
let board = null;

const $ = (id) => document.getElementById(id);

function loadNumber(key, fallback) {
    try {
        const n = Number(localStorage.getItem(key));
        return localStorage.getItem(key) !== null && Number.isFinite(n) ? n : fallback;
    } catch (e) { return fallback; }
}

function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* progress just won't persist */ }
}

document.addEventListener('DOMContentLoaded', () => {
    initBoardThemePicker();
    board = new BoardView($('chessboard'), {
        canSelect: (x, y) => !!currentPuzzle && !puzzleDone && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: checkGuess,
    });
    board.render(gameState, { animate: false });

    $('giveUpButton').addEventListener('click', giveUp);
    $('nextPuzzleButton').addEventListener('click', loadNextPuzzle);
    $('hintButton').addEventListener('click', showHint);
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && puzzleDone) loadNextPuzzle(); });

    rating = loadNumber(RATING_KEY, 1200);
    streak = loadNumber(STREAK_KEY, 0);
    solvedCount = loadNumber(SOLVED_KEY, 0);
    try { solvedIds = JSON.parse(localStorage.getItem(DONE_KEY)) || []; } catch (e) { solvedIds = []; }
    let grown = [];
    try { grown = JSON.parse(localStorage.getItem(BANK_KEY)) || []; } catch (e) { grown = []; }
    allPuzzles = STARTER_PUZZLES.concat(grown);

    updateStats();
    loadNextPuzzle();
});

// ─── SELECTION ─────────────────────────────────────────────────────────────────
// Closest rating to the player's among unseen puzzles (a little randomness
// among the five closest); the seen-list resets once everything was played.
function pickPuzzle() {
    if (allPuzzles.length === 0) return null;
    let candidates = allPuzzles.filter(p => !solvedIds.includes(p.id) && (!currentPuzzle || p.id !== currentPuzzle.id));
    if (candidates.length === 0) {
        solvedIds = [];
        candidates = allPuzzles.filter(p => !currentPuzzle || p.id !== currentPuzzle.id);
        if (candidates.length === 0) candidates = allPuzzles;
    }
    candidates = candidates.slice().sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating));
    const pool = candidates.slice(0, Math.min(5, candidates.length));
    return pool[Math.floor(Math.random() * pool.length)];
}

function loadNextPuzzle() {
    currentPuzzle = pickPuzzle();
    puzzleDone = false;
    hintUsed = false;
    $('puzzleResult').textContent = '';
    $('puzzleResult').className = 'puzzle-result';
    $('ratingDelta').textContent = '';
    $('nextPuzzleButton').classList.add('hidden');
    $('giveUpButton').classList.remove('hidden');
    $('hintButton').classList.remove('hidden');
    $('hintButton').disabled = false;

    if (!currentPuzzle) {
        $('puzzleCaption').textContent = 'No puzzles yet';
        $('puzzleSub').textContent = 'Review a game to generate some.';
        return;
    }

    // Show the position before the blunder, then play the blunder so it animates in.
    const prefix = currentPuzzle.sanPrefix;
    replaySANFromStart(prefix.slice(0, -1));
    const toMoveAfter = currentTurn === 'white' ? 'black' : 'white';
    board.setFlipped(toMoveAfter === 'black');
    board.render(gameState, { animate: false });
    board.setArrows([]);
    board.setBadge(null);
    board.setLastMove(null, null);
    board.setCheck(null);

    const last = resolveSAN(currentTurn, prefix[prefix.length - 1]);
    const token = ++loadToken;
    setTimeout(() => {
        if (token !== loadToken) return;
        if (last) {
            applyMoveWithPromotion(last.move, last.promo);
            recordPosition();
            board.render(gameState);
            board.setLastMove({ x: last.move.fromX, y: last.move.fromY }, { x: last.move.toX, y: last.move.toY });
            board.updateCheckFromGame();
        }
        currentPuzzle.targetSan = targetSAN();
        board.setInteractive(true);
    }, 350);

    const side = toMoveAfter === 'white' ? 'White' : 'Black';
    $('turnSwatch').className = `turn-swatch ${toMoveAfter}`;
    $('puzzleCaption').textContent = `${side} to move`;
    $('puzzleSub').textContent = `Punish ${prefix[prefix.length - 1]} — find the best move.`;
    $('puzzleRatingChip').hidden = false;
    $('puzzleRatingChip').textContent = `★ ${currentPuzzle.rating}`;
}

// SAN of the solution in the current (puzzle) position.
function targetSAN() {
    const t = currentPuzzle.punishMove;
    if (t.san) return t.san;
    const piece = gameState[t.fromY][t.fromX];
    const legal = piece && getvalidMoves(t.fromX, t.fromY).find(m => m.x === t.toX && m.y === t.toY);
    if (!legal) return null;
    const isPromo = piece.type === 'pawn' && (t.toY === 0 || t.toY === 7);
    return moveToSAN(t.fromX, t.fromY, t.toX, t.toY, legal, isPromo ? (t.promo || 'queen') : null);
}

// ─── GUESSING ──────────────────────────────────────────────────────────────────
function isTarget(move) {
    const t = currentPuzzle.punishMove;
    return move.fromX === t.fromX && move.fromY === t.fromY && move.toX === t.toX && move.toY === t.toY;
}

function playTarget() {
    const t = currentPuzzle.punishMove;
    const piece = gameState[t.fromY][t.fromX];
    if (!piece) return;
    const isPromo = piece.type === 'pawn' && (t.toY === 0 || t.toY === 7);
    const legal = getvalidMoves(t.fromX, t.fromY).find(m => m.x === t.toX && m.y === t.toY);
    applyMoveWithPromotion({ ...t, details: legal || t.details }, isPromo ? (t.promo || 'queen') : null);
    board.render(gameState);
    board.setLastMove({ x: t.fromX, y: t.fromY }, { x: t.toX, y: t.toY });
    board.updateCheckFromGame();
}

function checkGuess(move) {
    if (!currentPuzzle || puzzleDone) return;
    if (!isTarget(move)) {
        // Show the wrong move briefly, then take it back.
        const snapshot = { from: { x: move.fromX, y: move.fromY }, to: { x: move.toX, y: move.toY } };
        board.setArrows([{ from: snapshot.from, to: snapshot.to, color: 'rgba(239, 94, 85, 0.85)' }]);
        setTimeout(() => board.setArrows([]), 900);
        finishPuzzle(false);
        return;
    }
    playTarget();
    finishPuzzle(true);
}

function showHint() {
    if (!currentPuzzle || puzzleDone) return;
    hintUsed = true;
    const t = currentPuzzle.punishMove;
    board.select(t.fromX, t.fromY);
    $('hintButton').disabled = true;
    $('puzzleSub').textContent = 'Hint: this piece makes the winning move. (A hint halves the rating gain.)';
}

function giveUp() {
    if (!currentPuzzle || puzzleDone) return;
    finishPuzzle(false);
}

// ─── SCORING (Elo-style update against the puzzle's own rating) ────────────────
function finishPuzzle(success) {
    puzzleDone = true;
    board.setInteractive(false);

    const expected = 1 / (1 + Math.pow(10, (currentPuzzle.rating - rating) / 400));
    let delta = Math.round(24 * ((success ? 1 : 0) - expected));
    if (success && hintUsed) delta = Math.round(delta / 2);
    rating = Math.max(400, Math.min(3000, rating + delta));
    if (success) { streak++; solvedCount++; } else { streak = 0; }
    if (!solvedIds.includes(currentPuzzle.id)) solvedIds.push(currentPuzzle.id);

    save(RATING_KEY, String(rating));
    save(STREAK_KEY, String(streak));
    save(SOLVED_KEY, String(solvedCount));
    save(DONE_KEY, JSON.stringify(solvedIds));
    updateStats();

    const deltaEl = $('ratingDelta');
    deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta}`;
    deltaEl.className = 'stat-delta ' + (delta >= 0 ? 'up' : 'down');

    const t = currentPuzzle.punishMove;
    const line = currentPuzzle.solutionLine && currentPuzzle.solutionLine.length > 1
        ? ` Line: ${currentPuzzle.solutionLine.slice(0, 6).join(' ')}` : '';
    const result = $('puzzleResult');
    if (success) {
        result.textContent = `✓ Correct!${line}`;
        result.className = 'puzzle-result good';
        $('puzzleCaption').textContent = 'Solved';
        $('puzzleSub').textContent = `That punishes the ${currentPuzzle.category.toLowerCase()} ${currentPuzzle.blunderSan || ''}.`;
    } else {
        setTimeout(() => {
            playTarget();
            board.setArrows([{ from: { x: t.fromX, y: t.fromY }, to: { x: t.toX, y: t.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
        }, 650);
        result.textContent = `✗ The answer was ${currentPuzzle.targetSan || 'shown on the board'}.${line}`;
        result.className = 'puzzle-result bad';
        $('puzzleCaption').textContent = 'Not quite';
        $('puzzleSub').textContent = 'Here is the move that punishes it.';
    }
    $('giveUpButton').classList.add('hidden');
    $('hintButton').classList.add('hidden');
    $('nextPuzzleButton').classList.remove('hidden');
}

function updateStats() {
    $('puzzleRatingValue').textContent = Math.round(rating);
    $('puzzleStreakValue').textContent = streak;
    $('puzzleSolvedValue').textContent = solvedCount;
}
