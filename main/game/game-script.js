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

    // Landing page links here with ?mode=human|ai (and optionally ?difficulty=...)
    // to preselect the setup modal and open it immediately instead of requiring
    // an extra click.
    const params = new URLSearchParams(location.search);
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

    updatePlayerTags();
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
async function startGame() {
    resetGame();
    gameActive = true;
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    moveHistory = [];
    renderMoveHistory();
    updatePlayerTags();

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
                recordPosition();
                updateCheckStatus();
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

// ─── AI TURN(S) ─────────────────────────────────────────────────────────────────
function aiTimeBudget() { return gameMode === 'ai' ? AI_TIME_SELFPLAY : AI_TIME_HUMAN; }
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
    renderBoard();
    highlightLastMove(result.move.fromX, result.move.fromY, result.move.toX, result.move.toY);
    updateCheckStatus();

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

// ─── MODALS ───────────────────────────────────────────────────────────────────
function showGameOverModal(message) {
    playGameOverSound();
    document.getElementById('modalMessage').textContent = message;
    document.getElementById('gameOverModal').classList.remove('hidden');
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
        pendingPromo = null;
    }

    renderBoard();
    recordPosition();
    updateCheckStatus();

    const over = checkGameOver();
    if (over) { gameActive = false; return; }
    if (currentTurn !== playerColor) {
        setTimeout(playAIMove, 300);
    }
}
