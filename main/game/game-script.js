const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let gameActive       = false;  // true while a game is in progress
let aiThinking        = false; // true while the AI is searching for a move
let selectedSquare   = null;
let currentValidMoves = [];
let promoTargetX     = null;
let promoTargetY     = null;
let pendingPromo      = null;  // { fromX, fromY, tx, ty, chosenMove, color, sanBase }
let gameResult        = '*';   // PGN result token, set by showGameOverModal from its message

// ─── GAME SETUP STATE ──────────────────────────────────────────────────────────
let gameMode    = 'human'; // 'human' (vs AI) | 'ai' (AI vs AI)
let playerColor = 'white'; // the human's color (orientation reference in AI vs AI too)
let isFlipped   = false;   // true => board is drawn from Black's perspective

let selectedMode  = 'human';
let selectedColor = 'white';

// Difficulty controls both search depth and eval noise (random centipawn jitter
// applied once at the root move choice — see ai.js findBestMove). Noise makes
// weaker levels feel like human mistakes instead of just shallow, predictable play.
const DIFFICULTY = {
    beginner:     { maxDepth: 1, evalNoise: 80 },
    intermediate: { maxDepth: 2, evalNoise: 30 },
    expert:       { maxDepth: 4, evalNoise: 10 },
    master:       { maxDepth: 6, evalNoise: 0  },
};
let selectedDifficulty = 'intermediate';

const AI_TIME_HUMAN = 1500;  // ms search budget when playing against a human
const AI_TIME_SELFPLAY = 500; // ms search budget for AI vs AI (keeps it watchable)

// ─── TIME CONTROL (chess clock) ────────────────────────────────────────────────
// `null` selection (Unlimited) means clockState stays null and the clock UI/tick
// loop are skipped entirely - untimed play behaves exactly as before this feature.
const TIME_CONTROLS = {
    '5|0':   { minutes: 5,  incrementSec: 0  },
    '10|5':  { minutes: 10, incrementSec: 5  },
    '15|10': { minutes: 15, incrementSec: 10 },
};
let selectedTimeControl = 'unlimited';

// { white, black: ms remaining; incrementMs; lastTick: Date.now() at last tick;
//   intervalId } or null when untimed.
let clockState = null;

// ─── MOVE HISTORY ─────────────────────────────────────────────────────────────
// Each entry: { white: 'e4', black: 'e5' | null }
let moveHistory = [];

function appendHistoryMove(color, san) {
    if (color === 'white') {
        moveHistory.push({ white: san, black: null });
    } else if (moveHistory.length > 0 && moveHistory[moveHistory.length - 1].black === null) {
        moveHistory[moveHistory.length - 1].black = san;
    } else {
        moveHistory.push({ white: null, black: san });
    }
    renderMoveHistory();
}

function renderMoveHistory() {
    const panel = document.getElementById('move-history-body');
    if (!panel) return;

    panel.innerHTML = '';

    moveHistory.forEach((row, i) => {
        const tr = document.createElement('tr');

        const tdNum = document.createElement('td');
        tdNum.className = 'move-num';
        tdNum.textContent = (i + 1) + '.';

        const tdW = document.createElement('td');
        tdW.className = 'move-san move-white';
        tdW.textContent = row.white || '';

        const tdB = document.createElement('td');
        tdB.className = 'move-san move-black';
        tdB.textContent = row.black || '';

        tr.appendChild(tdNum);
        tr.appendChild(tdW);
        tr.appendChild(tdB);
        panel.appendChild(tr);
    });

    const scroller = panel.closest('.history-scroll');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

// ─── BOARD ORIENTATION HELPERS ─────────────────────────────────────────────────
function screenX(x) { return isFlipped ? 7 - x : x; }
function screenY(y) { return isFlipped ? 7 - y : y; }

function placeAt(el, x, y) {
    el.style.left = `${screenX(x) * 12.5}%`;
    el.style.top  = `${screenY(y) * 12.5}%`;
}

// ─── DOM SETUP ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const start       = document.getElementById('startButton');
    const exit        = document.getElementById('exitButton');
    const board       = document.getElementById('chessboard');
    const restartBtn  = document.getElementById('restartButton');
    const reportBtn   = document.getElementById('reportButton');
    const closeBtn    = document.getElementById('closeModalButton');
    const modal       = document.getElementById('gameOverModal');
    const setupModal  = document.getElementById('setupModal');
    const beginBtn    = document.getElementById('beginGameButton');
    const colorRow    = document.getElementById('colorChoiceRow');

    if (board) {
        board.addEventListener('click', e => {
            const sq = e.target.closest('.square');
            if (sq) handleSquareClick(sq);
        });
    }

    if (start && setupModal) {
        start.addEventListener('click', () => {
            if (gameActive) return;
            setupModal.classList.remove('hidden');
        });
    }

    const params = new URLSearchParams(location.search);

    // site.html's "Resume Game" button links here with ?resume=1 when a saved
    // in-progress game exists (see saveInProgressGame/clearInProgressGame).
    // Resolved here, but actually started at the bottom of this handler, after
    // every other listener below has been wired up.
    let resumeData = null;
    if (params.get('resume') === '1') {
        try { resumeData = JSON.parse(localStorage.getItem('chessInProgressGame')); } catch (e) { resumeData = null; }
        if (!resumeData || !Array.isArray(resumeData.moveHistory)) resumeData = null;
    }

    // Landing page links here with ?mode=human|ai (and optionally ?difficulty=...)
    // to preselect the setup modal and open it immediately instead of requiring
    // an extra click.
    const requestedMode = params.get('mode');
    const requestedDifficulty = params.get('difficulty');
    if (setupModal && (requestedMode === 'human' || requestedMode === 'ai')) {
        selectedMode = requestedMode;
        document.querySelectorAll('.setup-choice[data-mode]').forEach(b =>
            b.classList.toggle('selected', b.dataset.mode === requestedMode));
        if (colorRow) colorRow.style.display = requestedMode === 'ai' ? 'none' : '';
        setupModal.classList.remove('hidden');
    }
    if (requestedDifficulty && DIFFICULTY[requestedDifficulty]) {
        selectedDifficulty = requestedDifficulty;
        document.querySelectorAll('.setup-choice[data-difficulty]').forEach(b =>
            b.classList.toggle('selected', b.dataset.difficulty === requestedDifficulty));
    }

    document.querySelectorAll('.setup-choice[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMode = btn.dataset.mode;
            document.querySelectorAll('.setup-choice[data-mode]').forEach(b => b.classList.toggle('selected', b === btn));
            if (colorRow) colorRow.style.display = selectedMode === 'ai' ? 'none' : '';
        });
    });

    document.querySelectorAll('.setup-choice[data-color]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedColor = btn.dataset.color;
            document.querySelectorAll('.setup-choice[data-color]').forEach(b => b.classList.toggle('selected', b === btn));
        });
    });

    document.querySelectorAll('.setup-choice[data-difficulty]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedDifficulty = btn.dataset.difficulty;
            document.querySelectorAll('.setup-choice[data-difficulty]').forEach(b => b.classList.toggle('selected', b === btn));
        });
    });

    document.querySelectorAll('.setup-choice[data-time]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedTimeControl = btn.dataset.time;
            document.querySelectorAll('.setup-choice[data-time]').forEach(b => b.classList.toggle('selected', b === btn));
        });
    });

    if (beginBtn) {
        beginBtn.addEventListener('click', async () => {
            gameMode = selectedMode;
            if (gameMode === 'human') {
                playerColor = selectedColor === 'random'
                    ? (Math.random() < 0.5 ? 'white' : 'black')
                    : selectedColor;
            } else {
                playerColor = 'white'; // orientation only; no human side in AI vs AI
            }
            isFlipped = playerColor === 'black';

            setupModal.classList.add('hidden');
            board.style.display = 'grid';
            await startGame();
        });
    }

    if (exit)       exit.addEventListener('click', () => { gameActive = false; location.href = '../site.html'; });
    if (restartBtn) restartBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        gameActive = false;
        aiThinking = false;
        selectedSquare = null;
        currentValidMoves = [];
        stopClock();
        setupModal.classList.remove('hidden');
    });
    if (closeBtn)   closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    if (reportBtn)  reportBtn.addEventListener('click', () => {
        const sanMoves = [];
        for (const row of moveHistory) {
            if (row.white) sanMoves.push(row.white);
            if (row.black) sanMoves.push(row.black);
        }
        if (sanMoves.length === 0) { alert('No moves to analyze yet!'); return; }
        // Hand the finished game off to the dedicated review page (analysis.html)
        // via localStorage rather than an in-page modal, so the report gets its
        // own board + move list, matching a chess.com-style game review.
        localStorage.setItem('chessGameForAnalysis', JSON.stringify(sanMoves));
        location.href = 'analysis.html';
    });

    document.querySelectorAll('.promo-piece').forEach(img => {
        img.addEventListener('click', e => completePromotion(e.target.getAttribute('data-type')));
    });

    const pgnBtn      = document.getElementById('pgnButton');
    const pgnBtnModal = document.getElementById('pgnButtonModal');
    if (pgnBtn)      pgnBtn.addEventListener('click', downloadPGN);
    if (pgnBtnModal) pgnBtnModal.addEventListener('click', downloadPGN);

    const copyPgnBtn      = document.getElementById('copyPgnButton');
    const copyPgnBtnModal = document.getElementById('copyPgnButtonModal');
    const closePgnModalBtn = document.getElementById('closePgnModalButton');
    const copyPgnConfirmBtn = document.getElementById('copyPgnConfirmButton');
    if (copyPgnBtn)      copyPgnBtn.addEventListener('click', showPgnModal);
    if (copyPgnBtnModal) copyPgnBtnModal.addEventListener('click', showPgnModal);
    if (closePgnModalBtn) closePgnModalBtn.addEventListener('click', () => document.getElementById('pgnModal').classList.add('hidden'));
    if (copyPgnConfirmBtn) copyPgnConfirmBtn.addEventListener('click', copyPgnToClipboard);

    const resignBtn     = document.getElementById('resignButton');
    const offerDrawBtn  = document.getElementById('offerDrawButton');
    const takebackBtn   = document.getElementById('takebackButton');
    if (resignBtn)    resignBtn.addEventListener('click', resign);
    if (offerDrawBtn) offerDrawBtn.addEventListener('click', offerDraw);
    if (takebackBtn)  takebackBtn.addEventListener('click', takeback);

    updatePlayerTags();

    if (resumeData) {
        board.style.display = 'grid';
        startGame(resumeData);
    }
});

// ─── PLAYER TAGS ────────────────────────────────────────────────────────────────
function updatePlayerTags() {
    const topName    = document.getElementById('topName');
    const bottomName = document.getElementById('bottomName');
    const topAvatar  = document.getElementById('topAvatar');
    const bottomAvatar = document.getElementById('bottomAvatar');
    if (!topName || !bottomName) return;

    // Top of the board is whichever color is NOT at the bottom.
    const bottomColor = isFlipped ? 'black' : 'white';
    const topColor    = isFlipped ? 'white' : 'black';

    const label = (color) => {
        if (gameMode === 'ai') return `Engine (${color === 'white' ? 'White' : 'Black'})`;
        return color === playerColor ? `You (${color === 'white' ? 'White' : 'Black'})` : `Engine (${color === 'white' ? 'White' : 'Black'})`;
    };

    topName.textContent    = label(topColor);
    bottomName.textContent = label(bottomColor);
    topAvatar.textContent    = topColor === 'white' ? '♙' : '♟';
    bottomAvatar.textContent = bottomColor === 'white' ? '♙' : '♟';
}

// ─── THINKING INDICATOR ────────────────────────────────────────────────────────
function setThinkingIndicator(color, on) {
    const topColor = isFlipped ? 'white' : 'black';
    const tag = document.getElementById(topColor === color ? 'topName' : 'bottomName')
                        ?.closest('.player-tag');
    if (tag) tag.classList.toggle('thinking', on);
}

// ─── BOARD INIT ───────────────────────────────────────────────────────────────
function drawBoardDOM() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';

    // 1. Draw the Background Squares
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            let square = document.createElement('div');
            square.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
            square.dataset.x = x;
            square.dataset.y = y;
            placeAt(square, x, y);

            // Rank label on the leftmost screen column; file label on the bottom screen row.
            // screenX/screenY map logical coords to screen position, so labels flip with the board.
            if (screenX(x) === 0) {
                const span = document.createElement('span');
                span.className = 'coord-rank';
                span.textContent = String(8 - y);
                square.appendChild(span);
            }
            if (screenY(y) === 7) {
                const span = document.createElement('span');
                span.className = 'coord-file';
                span.textContent = FILE_NAMES[x];
                square.appendChild(span);
            }

            board.appendChild(square);
        }
    }

    // 2. Draw the Floating Pieces
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const piece = gameState[y][x];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.id = piece.domId;
                pieceElement.className = `piece piece-${piece.color} ${piece.type}`;
                placeAt(pieceElement, x, y);
                board.appendChild(pieceElement);
            }
        }
    }
}

// `resumeData` (from localStorage's chessInProgressGame, see saveInProgressGame)
// replays a previously in-progress game instead of starting fresh - same
// resetGame()-then-replay pattern the Game Analysis Engine and takeback() use.
async function startGame(resumeData) {
    if (resumeData) {
        gameMode = resumeData.gameMode;
        playerColor = resumeData.playerColor;
        selectedDifficulty = resumeData.selectedDifficulty;
        selectedTimeControl = resumeData.selectedTimeControl;
        isFlipped = playerColor === 'black';
    }

    resetGame();
    gameActive = true;
    gameResult = '*';
    moveHistory = [];

    if (resumeData) {
        const sanList = [];
        for (const row of resumeData.moveHistory) {
            if (row.white) sanList.push(row.white);
            if (row.black) sanList.push(row.black);
        }
        replaySAN(sanList);
        moveHistory = resumeData.moveHistory;
    }

    renderMoveHistory();
    updatePlayerTags();

    // Resign/draw/takeback only make sense with a human in the game.
    const liveActions = document.getElementById('liveActionButtons');
    if (liveActions) liveActions.style.display = gameMode === 'human' ? 'flex' : 'none';

    if (resumeData && resumeData.clock) {
        stopClock();
        clockState = { ...resumeData.clock, lastTick: Date.now(), intervalId: null };
        clockState.intervalId = setInterval(tickClock, 200);
        updateClockDisplay();
    } else {
        startClock();
    }

    drawBoardDOM();
    updateCheckStatus();

    // Kick off the AI if it has to move first (AI vs AI, or human chose Black).
    if (gameMode === 'ai' || (gameMode === 'human' && currentTurn !== playerColor)) {
        setTimeout(playAIMove, 300);
    }
}

async function renderBoard() {
    const board = document.getElementById('chessboard');
    const activeIds = new Set();

    // 1. Slide existing pieces to their new coordinates
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const piece = gameState[y][x];
            if (piece) {
                activeIds.add(piece.domId);
                let pieceElement = document.getElementById(piece.domId);

                // If the piece is new (like a promoted Queen), create it!
                if (!pieceElement) {
                    pieceElement = document.createElement('div');
                    pieceElement.id = piece.domId;
                    board.appendChild(pieceElement);
                }

                // Update class (handles promotion image swap) and Slide!
                pieceElement.className = `piece piece-${piece.color} ${piece.type}`;
                placeAt(pieceElement, x, y);
            }
        }
    }

    // 2. Delete captured pieces from the screen
    const currentDOMPieces = board.querySelectorAll('.piece');
    currentDOMPieces.forEach(domPiece => {
        if (!activeIds.has(domPiece.id)) domPiece.remove();
    });
}

// ─── CLICK HANDLER ────────────────────────────────────────────────────────────
function handleSquareClick(squareDiv) {
    if (!gameActive || aiThinking) return;
    if (gameMode === 'ai') return;                 // no human input in AI vs AI
    if (currentTurn !== playerColor) return;        // not your turn

    const tx = parseInt(squareDiv.dataset.x);
    const ty = parseInt(squareDiv.dataset.y);
    const target = gameState[ty][tx];

    if (target && target.color === currentTurn) {
        if (selectedSquare) {
            selectedSquare.classList.remove('selected');
            clearMoveHighlights();
        }
        squareDiv.classList.add('selected');
        selectedSquare    = squareDiv;
        currentValidMoves = getvalidMoves(tx, ty);
        highlightMoves(currentValidMoves);
        return;
    }

    if (selectedSquare) {
        const chosenMove = currentValidMoves.find(m => m.x === tx && m.y === ty);

        if (chosenMove) {
            const fromX = parseInt(selectedSquare.dataset.x);
            const fromY = parseInt(selectedSquare.dataset.y);
            const movingColor = gameState[fromY][fromX].color;

            const isPawnPromo = gameState[fromY][fromX]?.type === 'pawn' && (ty === 0 || ty === 7);

            // SAN must be computed BEFORE the board changes (moveToSAN inspects pre-move state).
            // For promotions the final piece type is unknown yet, so the suffix is filled in later.
            const sanBase = moveToSAN(fromX, fromY, tx, ty, chosenMove, null);
            if (isPawnPromo) {
                pendingPromo = { fromX, fromY, tx, ty, chosenMove, color: movingColor, sanBase };
            }

            const isPromoting = movePiece(fromX, fromY, tx, ty, chosenMove);

            selectedSquare.classList.remove('selected');
            selectedSquare    = null;
            clearMoveHighlights();
            currentValidMoves = [];

            highlightLastMove(fromX, fromY, tx, ty);
            renderBoard();

            if (isPromoting) {
                showPromotionModal(tx, ty, movingColor);
            } else {
                const finalSan = sanBase + getCheckSuffix(currentTurn);
                appendHistoryMove(movingColor, finalSan);
                playSoundForMove(finalSan);
                applyIncrement(movingColor);
                recordPosition();
                updateCheckStatus();
                saveInProgressGame();
                const over = checkGameOver();
                if (over) { gameActive = false; }
                else if (currentTurn !== playerColor) {
                    setTimeout(playAIMove, 300);
                }
            }
        } else {
            selectedSquare.classList.remove('selected');
            selectedSquare    = null;
            clearMoveHighlights();
            currentValidMoves = [];
        }
    }
}

// ─── CHESS CLOCK ────────────────────────────────────────────────────────────────
function startClock() {
    stopClock();
    const tc = TIME_CONTROLS[selectedTimeControl];
    if (!tc) { clockState = null; updateClockDisplay(); return; } // Unlimited

    clockState = {
        white: tc.minutes * 60 * 1000,
        black: tc.minutes * 60 * 1000,
        incrementMs: tc.incrementSec * 1000,
        lastTick: Date.now(),
    };
    clockState.intervalId = setInterval(tickClock, 200);
    updateClockDisplay();
}

function stopClock() {
    if (clockState && clockState.intervalId) clearInterval(clockState.intervalId);
    if (clockState) clockState.intervalId = null;
}

function tickClock() {
    if (!clockState || !gameActive) return;
    const now = Date.now();
    clockState[currentTurn] -= now - clockState.lastTick;
    clockState.lastTick = now;

    if (clockState[currentTurn] <= 0) {
        clockState[currentTurn] = 0;
        updateClockDisplay();
        stopClock();
        gameActive = false;
        const winner = currentTurn === 'white' ? 'Black' : 'White';
        showGameOverModal(`${winner} Wins on Time!`);
        return;
    }
    updateClockDisplay();
}

// Called right after a move completes, crediting that color's increment (Fischer-style).
function applyIncrement(color) {
    if (!clockState) return;
    clockState[color] += clockState.incrementMs;
}

// ─── SAVE / RESUME IN-PROGRESS GAME ────────────────────────────────────────────
const INPROGRESS_KEY = 'chessInProgressGame';

function saveInProgressGame() {
    if (!gameActive || gameMode !== 'human') return; // nothing to resume in AI vs AI
    localStorage.setItem(INPROGRESS_KEY, JSON.stringify({
        moveHistory, gameMode, playerColor, selectedDifficulty, selectedTimeControl,
        clock: clockState ? { white: clockState.white, black: clockState.black, incrementMs: clockState.incrementMs } : null,
    }));
}

function clearInProgressGame() {
    localStorage.removeItem(INPROGRESS_KEY);
}

function formatClock(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function updateClockDisplay() {
    const topEl = document.getElementById('topTime');
    const bottomEl = document.getElementById('bottomTime');
    if (!topEl || !bottomEl) return;

    if (!clockState) { topEl.textContent = ''; bottomEl.textContent = ''; return; }

    const bottomColor = isFlipped ? 'black' : 'white';
    const topColor    = isFlipped ? 'white' : 'black';

    topEl.textContent = formatClock(clockState[topColor]);
    bottomEl.textContent = formatClock(clockState[bottomColor]);
    topEl.classList.toggle('clock-low', clockState[topColor] < 30000);
    bottomEl.classList.toggle('clock-low', clockState[bottomColor] < 30000);
}

// ─── AI TURN(S) ─────────────────────────────────────────────────────────────────
// With a clock running, the AI's search budget is derived from its own remaining
// time (capped so a single move can't eat too much of it) rather than the fixed
// constants, so its thinking time is naturally paid for out of its own clock.
function aiTimeBudget() {
    if (clockState) return Math.max(100, Math.min(clockState[currentTurn] / 20, AI_TIME_HUMAN));
    return gameMode === 'ai' ? AI_TIME_SELFPLAY : AI_TIME_HUMAN;
}
function aiDepth()      { return DIFFICULTY[selectedDifficulty].maxDepth; }
function aiEvalNoise()  { return DIFFICULTY[selectedDifficulty].evalNoise; }

async function playAIMove() {
    if (!gameActive || aiThinking) return;
    aiThinking = true;
    const color = currentTurn;
    setThinkingIndicator(color, true);

    // Yield to the browser so the thinking indicator repaints before the
    // synchronous search blocks the main thread.
    await sleep(0);

    const result = makeAIMove(color, aiTimeBudget(), aiDepth(), aiEvalNoise());

    aiThinking = false;
    setThinkingIndicator(color, false);

    if (!result) {
        gameActive = false;
        checkGameOver();
        return;
    }

    appendHistoryMove(result.color, result.san);
    playSoundForMove(result.san);
    applyIncrement(result.color);
    renderBoard();
    highlightLastMove(result.move.fromX, result.move.fromY, result.move.toX, result.move.toY);
    updateCheckStatus();
    saveInProgressGame();

    const over = checkGameOver();
    if (over) { gameActive = false; return; }

    // Keep going if it's still an AI's turn (AI vs AI, or AI just moved and it's AI's turn again
    // because the human is the opposite color).
    if (gameMode === 'ai' || currentTurn !== playerColor) {
        setTimeout(playAIMove, gameMode === 'ai' ? 400 : 300);
    }
}

// ─── HIGHLIGHT HELPERS ────────────────────────────────────────────────────────
function highlightMoves(moves) {
    for (const m of moves) {
        const sq = document.querySelector(`.square[data-x="${m.x}"][data-y="${m.y}"]`);
        if (sq) sq.classList.add(gameState[m.y][m.x] ? 'capture-hint' : 'move-hint');
    }
}
function clearMoveHighlights() {
    document.querySelectorAll('.square.move-hint, .square.capture-hint')
            .forEach(sq => sq.classList.remove('move-hint', 'capture-hint'));
}
function highlightLastMove(fromX, fromY, toX, toY) {
    document.querySelectorAll('.square.last-move').forEach(sq => sq.classList.remove('last-move'));
    const from = document.querySelector(`.square[data-x="${fromX}"][data-y="${fromY}"]`);
    const to   = document.querySelector(`.square[data-x="${toX}"][data-y="${toY}"]`);
    if (from) from.classList.add('last-move');
    if (to)   to.classList.add('last-move');
}

// ─── CHECK STATUS ─────────────────────────────────────────────────────────────
function updateCheckStatus() {
    document.querySelectorAll('.square.in-check').forEach(sq => sq.classList.remove('in-check'));
    const kp = findKing(currentTurn);
    if (!kp) return;
    const enemy = currentTurn === 'white' ? 'black' : 'white';
    if (isSquareAttacked(kp.x, kp.y, enemy)) {
        const sq = document.querySelector(`.square[data-x="${kp.x}"][data-y="${kp.y}"]`);
        if (sq) sq.classList.add('in-check');
    }
}

// ─── RESIGN / OFFER DRAW / TAKEBACK (vs-AI mode only) ─────────────────────────
function resign() {
    if (!gameActive || gameMode !== 'human') return;
    gameActive = false;
    const winner = playerColor === 'white' ? 'Black' : 'White';
    showGameOverModal(`You resigned! ${winner} Wins!`);
}

function offerDraw() {
    if (!gameActive || gameMode !== 'human') return;
    const aiColor = playerColor === 'white' ? 'black' : 'white';
    // A quick static eval (no search) from the engine's perspective - simple,
    // deterministic accept/decline rule, no new AI plumbing needed.
    const scoreForAI = evaluateForColor(aiColor);
    if (scoreForAI < 150) {
        gameActive = false;
        showGameOverModal('Draw agreed!');
    } else {
        alert('The engine declines your draw offer.');
    }
}

// Resolves a played SAN string to a move + promotion type on the LIVE board -
// the same pattern analysis-worker.js's resolveSAN uses, just against gameState
// directly instead of the worker's isolated copy.
function resolveSANLive(color, san) {
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

function flattenMoveHistorySAN() {
    const sanList = [];
    for (const row of moveHistory) {
        if (row.white) sanList.push(row.white);
        if (row.black) sanList.push(row.black);
    }
    return sanList;
}

// Replays `sanList` (each already carrying its original +/# suffix) from a
// fresh board, silently - used to rebuild the position after a takeback.
function replaySAN(sanList) {
    resetGame();
    for (const rawSan of sanList) {
        const color = currentTurn;
        const san = rawSan.replace(/[+#]$/, '');
        const resolved = resolveSANLive(color, san);
        if (!resolved) break;
        const isPromoting = movePiece(resolved.move.fromX, resolved.move.fromY, resolved.move.toX, resolved.move.toY, resolved.move.details);
        if (isPromoting) {
            gameState[resolved.move.toY][resolved.move.toX].type = resolved.promo || 'queen';
            currentTurn = currentTurn === 'white' ? 'black' : 'white';
        }
        recordPosition();
    }
}

function takeback() {
    if (!gameActive || gameMode !== 'human' || aiThinking) return;
    const sanList = flattenMoveHistorySAN();
    if (sanList.length === 0) return;

    // Undo back to right before the human's own last move: drop the AI's reply
    // (if any) and the human's move that preceded it, so it's the human's turn
    // again at the same position they had before.
    sanList.pop();
    while (sanList.length > 0 && (sanList.length % 2 === 0 ? 'white' : 'black') !== playerColor) {
        sanList.pop();
    }

    replaySAN(sanList);
    moveHistory = [];
    sanList.forEach((san, i) => appendHistoryMove(i % 2 === 0 ? 'white' : 'black', san));

    selectedSquare = null;
    currentValidMoves = [];
    clearMoveHighlights();
    document.querySelectorAll('.square.last-move').forEach(sq => sq.classList.remove('last-move'));
    renderBoard();
    updateCheckStatus();
    saveInProgressGame();
}

// ─── MODALS ───────────────────────────────────────────────────────────────────
function showGameOverModal(message) {
    stopClock();
    clearInProgressGame();
    playGameOverSound();
    gameResult = resultFromMessage(message);
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('gameOverModal').classList.remove('hidden');
}

// Maps a game-over message (the only place an outcome is decided) to a PGN
// result token. Falls back to the draw token for any non-checkmate ending
// (stalemate, threefold, 50-move, insufficient material, resignation-to-come).
function resultFromMessage(message) {
    if (/WHITE Wins/i.test(message)) return '1-0';
    if (/BLACK Wins/i.test(message)) return '0-1';
    return '1/2-1/2';
}

// ─── PGN EXPORT ───────────────────────────────────────────────────────────────
function playerLabel(color) {
    if (gameMode === 'ai') return 'Engine';
    return color === playerColor ? 'You' : 'Engine';
}

function buildPGN() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const result = gameActive ? '*' : gameResult;

    const headers = [
        `[Event "Casual Game"]`,
        `[Site "Chess Site"]`,
        `[Date "${today}"]`,
        `[Round "1"]`,
        `[White "${playerLabel('white')}"]`,
        `[Black "${playerLabel('black')}"]`,
        `[Result "${result}"]`,
    ];

    let movetext = '';
    moveHistory.forEach((row, i) => {
        movetext += `${i + 1}. `;
        if (row.white) movetext += `${row.white} `;
        if (row.black) movetext += `${row.black} `;
    });
    movetext += result;

    return headers.join('\n') + '\n\n' + movetext.trim() + '\n';
}

function downloadPGN() {
    if (moveHistory.length === 0) { alert('No moves to export yet!'); return; }

    const pgn = buildPGN();
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-game-${new Date().toISOString().slice(0, 10)}.pgn`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Shows the PGN as plain selectable/copyable text instead of triggering a file
// download - useful for pasting straight into a lichess/chess.com import box or
// a message, without a .pgn file to manage.
function showPgnModal() {
    if (moveHistory.length === 0) { alert('No moves to export yet!'); return; }

    const textarea = document.getElementById('pgnTextArea');
    textarea.value = buildPGN();
    document.getElementById('pgnModal').classList.remove('hidden');
    textarea.focus();
    textarea.select();
}

function copyPgnToClipboard() {
    const textarea = document.getElementById('pgnTextArea');
    textarea.select();

    // navigator.clipboard requires a secure context (https/localhost); document.
    // execCommand('copy') is deprecated but still works everywhere else as a
    // fallback, and doesn't need any extra permission prompt.
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textarea.value).catch(() => document.execCommand('copy'));
    } else {
        document.execCommand('copy');
    }
}

function showPromotionModal(x, y, color) {
    promoTargetX = x;
    promoTargetY = y;
    const s = color === 'white' ? 'w' : 'b';
    document.getElementById('promo-queen').src  = `pieces/queen-${s}.png`;
    document.getElementById('promo-rook').src   = `pieces/rook-${s}.png`;
    document.getElementById('promo-bishop').src = `pieces/bishop-${s}.png`;
    document.getElementById('promo-knight').src = `pieces/knight-${s}.png`;
    document.getElementById('promotionModal').classList.remove('hidden');
}

function completePromotion(pieceType) {
    const PROMO_LETTER = { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };

    gameState[promoTargetY][promoTargetX].type = pieceType;
    document.getElementById('promotionModal').classList.add('hidden');
    currentTurn = currentTurn === 'white' ? 'black' : 'white';

    if (pendingPromo) {
        const san = pendingPromo.sanBase + '=' + PROMO_LETTER[pieceType] + getCheckSuffix(currentTurn);
        appendHistoryMove(pendingPromo.color, san);
        playSoundForMove(san);
        applyIncrement(pendingPromo.color);
        pendingPromo = null;
    }

    renderBoard();
    recordPosition();
    updateCheckStatus();
    saveInProgressGame();

    const over = checkGameOver();
    if (over) { gameActive = false; return; }
    if (currentTurn !== playerColor) {
        setTimeout(playAIMove, 300);
    }
}
