// ─── PUZZLE TRAINER ─────────────────────────────────────────────────────────────
// Drives puzzles.html: a standalone, rated "puzzle rush"-style trainer separate
// from the Game Analysis Engine's in-context "Try this as a puzzle" button.
// Puzzles are { sanPrefix, punishMove, rating, category, centipawnLoss } records
// (see puzzle-bank.js for the format) drawn from STARTER_PUZZLES (shipped with
// the site) plus a growing pool in localStorage['chessPuzzleBank'], appended to
// by analysis-page.js every time a game gets analyzed (live or pasted PGN).
const RATING_KEY  = 'chessPuzzleRating';
const STREAK_KEY  = 'chessPuzzleStreak';
const SOLVED_KEY  = 'chessPuzzleSolvedCount';
const DONE_KEY    = 'chessPuzzleSolvedIds'; // ids already seen, to avoid immediate repeats
const BANK_KEY     = 'chessPuzzleBank';
const BANK_CAP     = 300; // oldest entries drop once the growing pool exceeds this

let rating = 1200;
let streak = 0;
let solvedCount = 0;
let solvedIds = [];

let allPuzzles = [];
let currentPuzzle = null;
let puzzleDone = false; // true once solved or given up on - blocks further guesses
let selectedSquare = null;
let currentValidMoves = [];

function loadNumber(key, fallback) {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

document.addEventListener('DOMContentLoaded', () => {
    const board = document.getElementById('chessboard');
    const homeBtn = document.getElementById('homeButton');
    const giveUpBtn = document.getElementById('giveUpButton');
    const nextBtn = document.getElementById('nextPuzzleButton');

    if (homeBtn) homeBtn.addEventListener('click', () => location.href = '../site.html');
    if (giveUpBtn) giveUpBtn.addEventListener('click', giveUp);
    if (nextBtn) nextBtn.addEventListener('click', loadNextPuzzle);

    board.addEventListener('click', (e) => {
        const sq = e.target.closest('.square');
        if (sq) onSquareClick(parseInt(sq.dataset.x), parseInt(sq.dataset.y));
    });

    rating = loadNumber(RATING_KEY, 1200);
    streak = loadNumber(STREAK_KEY, 0);
    solvedCount = loadNumber(SOLVED_KEY, 0);
    try { solvedIds = JSON.parse(localStorage.getItem(DONE_KEY)) || []; } catch (e) { solvedIds = []; }

    let grownBank = [];
    try { grownBank = JSON.parse(localStorage.getItem(BANK_KEY)) || []; } catch (e) { grownBank = []; }
    allPuzzles = STARTER_PUZZLES.concat(grownBank);

    updateStats();
    loadNextPuzzle();
});

// ─── PUZZLE SELECTION ───────────────────────────────────────────────────────────
// Picks the puzzle whose rating is closest to the user's current rating, among
// ones not already solved this "career" - once every puzzle has been solved at
// least once, the seen-list resets so the (finite) bank can be replayed.
function pickPuzzle() {
    if (allPuzzles.length === 0) return null;

    let candidates = allPuzzles.filter(p => !solvedIds.includes(p.id));
    if (candidates.length === 0) {
        solvedIds = [];
        candidates = allPuzzles;
    }

    candidates = candidates.slice().sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating));
    // Small amount of randomness among the closest matches so it isn't 100%
    // deterministic which puzzle appears next at a given rating.
    const pool = candidates.slice(0, Math.min(5, candidates.length));
    return pool[Math.floor(Math.random() * pool.length)];
}

function loadNextPuzzle() {
    currentPuzzle = pickPuzzle();
    puzzleDone = false;
    selectedSquare = null;
    currentValidMoves = [];

    document.getElementById('puzzleResult').textContent = '';
    document.getElementById('nextPuzzleButton').classList.add('hidden');
    document.getElementById('giveUpButton').classList.remove('hidden');

    if (!currentPuzzle) {
        document.getElementById('puzzleCaption').textContent = 'No puzzles available yet — analyze a game to generate some!';
        drawEmptyBoard();
        return;
    }

    resetGame();
    for (const san of currentPuzzle.sanPrefix) {
        const color = currentTurn;
        const resolved = resolveSANLocal(color, san);
        if (!resolved) break;
        applyMoveLocal(resolved.move, resolved.promo);
    }

    drawBoard();
    const toMove = currentTurn === 'white' ? 'White' : 'Black';
    document.getElementById('puzzleCaption').textContent =
        `Find ${toMove}'s best move (puzzle rating ${currentPuzzle.rating})`;
}

// ─── SAN RESOLUTION / REPLAY (same pattern as analysis-worker.js/game-script.js) ──
function resolveSANLocal(color, sanRaw) {
    const san = sanRaw.replace(/[+#]$/, '');
    const moves = legalMovesFallback(color);
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

// puzzles.html doesn't load ai.js (no engine search needed here), so
// getAllValidMoves isn't available - build the legal move list directly.
function legalMovesFallback(color) {
    const moves = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.color === color) {
                for (const m of getvalidMoves(x, y)) {
                    moves.push({ fromX: x, fromY: y, toX: m.x, toY: m.y, details: m });
                }
            }
        }
    }
    return moves;
}

function applyMoveLocal(move, promo) {
    const isPromoting = movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);
    if (isPromoting) {
        gameState[move.toY][move.toX].type = promo || 'queen';
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }
}

// ─── BOARD ──────────────────────────────────────────────────────────────────────
function drawEmptyBoard() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const sq = document.createElement('div');
            sq.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
            sq.dataset.x = x;
            sq.dataset.y = y;
            sq.style.left = `${x * 12.5}%`;
            sq.style.top  = `${y * 12.5}%`;
            board.appendChild(sq);
        }
    }
}

function drawBoard() {
    drawEmptyBoard();
    const board = document.getElementById('chessboard');
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const piece = gameState[y][x];
            if (!piece) continue;
            const el = document.createElement('div');
            el.className = `piece piece-${piece.color} ${piece.type}`;
            el.style.left = `${x * 12.5}%`;
            el.style.top  = `${y * 12.5}%`;
            board.appendChild(el);
        }
    }
}

function highlightSelection(x, y, moves) {
    const sq = document.querySelector(`.square[data-x="${x}"][data-y="${y}"]`);
    if (sq) sq.classList.add('selected');
    for (const m of moves) {
        const target = document.querySelector(`.square[data-x="${m.x}"][data-y="${m.y}"]`);
        if (target) target.classList.add(gameState[m.y][m.x] ? 'capture-hint' : 'move-hint');
    }
}

function clearSquareHighlights() {
    document.querySelectorAll('.square.selected, .square.move-hint, .square.capture-hint')
        .forEach(sq => sq.classList.remove('selected', 'move-hint', 'capture-hint'));
}

// ─── GUESSING ───────────────────────────────────────────────────────────────────
function onSquareClick(x, y) {
    if (!currentPuzzle || puzzleDone) return;

    const piece = gameState[y][x];
    if (piece && piece.color === currentTurn) {
        clearSquareHighlights();
        selectedSquare = { x, y };
        currentValidMoves = getvalidMoves(x, y);
        highlightSelection(x, y, currentValidMoves);
        return;
    }

    if (selectedSquare) {
        const chosen = currentValidMoves.find(m => m.x === x && m.y === y);
        if (chosen) checkGuess(selectedSquare.x, selectedSquare.y, x, y, chosen);
        clearSquareHighlights();
        selectedSquare = null;
        currentValidMoves = [];
    }
}

function checkGuess(fromX, fromY, toX, toY, moveDetails) {
    const target = currentPuzzle.punishMove;
    const correct = fromX === target.fromX && fromY === target.fromY
        && toX === target.toX && toY === target.toY;

    if (!correct) {
        solvePuzzle(false);
        return;
    }

    const isPawnPromo = gameState[fromY][fromX].type === 'pawn' && (toY === 0 || toY === 7);
    applyMoveLocal({ fromX, fromY, toX, toY, details: moveDetails }, isPawnPromo ? 'queen' : null);
    drawBoard();
    solvePuzzle(true);
}

function giveUp() {
    if (!currentPuzzle || puzzleDone) return;
    solvePuzzle(false);
}

// ─── SCORING (simple Elo-style update against the puzzle's own rating) ─────────
function solvePuzzle(success) {
    puzzleDone = true;

    const expected = 1 / (1 + Math.pow(10, (currentPuzzle.rating - rating) / 400));
    const K = 24;
    const delta = Math.round(K * ((success ? 1 : 0) - expected));
    rating = Math.max(400, Math.min(3000, rating + delta));

    if (success) {
        streak++;
        solvedCount++;
    } else {
        streak = 0;
    }

    if (!solvedIds.includes(currentPuzzle.id)) solvedIds.push(currentPuzzle.id);

    localStorage.setItem(RATING_KEY, String(rating));
    localStorage.setItem(STREAK_KEY, String(streak));
    localStorage.setItem(SOLVED_KEY, String(solvedCount));
    localStorage.setItem(DONE_KEY, JSON.stringify(solvedIds));
    updateStats();

    const resultEl = document.getElementById('puzzleResult');
    const sign = delta >= 0 ? '+' : '';
    if (success) {
        resultEl.textContent = `Correct! (${sign}${delta})`;
        resultEl.style.color = '#81b64c';
        document.getElementById('puzzleCaption').textContent = `Solved — that punishes the ${currentPuzzle.category.toLowerCase()}.`;
    } else {
        // Reveal the answer on the board so the user can see what they missed.
        const t = currentPuzzle.punishMove;
        const isPawnPromo = gameState[t.fromY][t.fromX] && gameState[t.fromY][t.fromX].type === 'pawn' && (t.toY === 0 || t.toY === 7);
        applyMoveLocal({ fromX: t.fromX, fromY: t.fromY, toX: t.toX, toY: t.toY, details: t.details }, isPawnPromo ? 'queen' : null);
        drawBoard();
        resultEl.textContent = `Not quite (${sign}${delta})`;
        resultEl.style.color = '#e0402c';
        document.getElementById('puzzleCaption').textContent = 'Here\'s the move that punishes it.';
    }

    document.getElementById('giveUpButton').classList.add('hidden');
    document.getElementById('nextPuzzleButton').classList.remove('hidden');
}

function updateStats() {
    document.getElementById('puzzleRatingValue').textContent = Math.round(rating);
    document.getElementById('puzzleStreakValue').textContent = streak;
    document.getElementById('puzzleSolvedValue').textContent = solvedCount;
}
