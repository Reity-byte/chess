const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isGameRunning   = false;
let selectedSquare  = null;
let currentValidMoves = [];
let promoTargetX    = null;
let promoTargetY    = null;

// ─── MOVE HISTORY ─────────────────────────────────────────────────────────────
// Each entry: { white: 'e4', black: 'e5' | null }
let moveHistory = [];
let pendingWhiteSAN = null;  // white's SAN waits here until black replies

// Called before movePiece() so the board is still in pre-move state
function recordMove(fromX, fromY, toX, toY, details, promoType = null) {
    const san = moveToSAN(fromX, fromY, toX, toY, details, promoType);

    if (currentTurn === 'white') {
        // White just moved – open a new row
        moveHistory.push({ white: san, black: null });
    } else {
        // Black just moved – close the current row
        if (moveHistory.length === 0) moveHistory.push({ white: '…', black: null });
        moveHistory[moveHistory.length - 1].black = san;
    }

    renderMoveHistory();
    return san;
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

    // Auto-scroll to latest move
    panel.scrollTop = panel.scrollHeight;
}

// ─── DOM SETUP ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const start      = document.getElementById('startButton');
    const exit       = document.getElementById('exitButton');
    const board      = document.getElementById('chessboard');
    const restartBtn = document.getElementById('restartButton');
    const closeBtn   = document.getElementById('closeModalButton');
    const modal      = document.getElementById('gameOverModal');

    if (board) {
        board.addEventListener('click', e => {
            const sq = e.target.closest('.square');
            if (sq) handleSquareClick(sq);
        });
    }

    if (start && board) {
        start.addEventListener('click', async () => {
            if (isGameRunning) return;
            board.style.display = 'grid';
            await startGame();
        });
    }

    if (exit)       exit.addEventListener('click', () => { location.href = '../site.html'; });
    if (restartBtn) restartBtn.addEventListener('click', () => location.reload());
    if (closeBtn)   closeBtn.addEventListener('click', () => modal.classList.add('hidden'));

    document.querySelectorAll('.promo-piece').forEach(img => {
        img.addEventListener('click', e => completePromotion(e.target.getAttribute('data-type')));
    });
});

// ─── BOARD INIT ───────────────────────────────────────────────────────────────
async function startGame() {
    isGameRunning = true;
    const board = document.getElementById('chessboard');
    board.innerHTML = '';

    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const sq = document.createElement('div');
            sq.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
            sq.dataset.x = x;
            sq.dataset.y = y;

            if (x === 0) {
                const lbl = document.createElement('span');
                lbl.className = 'coord-rank';
                lbl.textContent = 8 - y;
                sq.appendChild(lbl);
            }
            if (y === 7) {
                const lbl = document.createElement('span');
                lbl.className = 'coord-file';
                lbl.textContent = 'abcdefgh'[x];
                sq.appendChild(lbl);
            }

            const piece = gameState[y][x];
            if (piece) {
                const pe = document.createElement('div');
                pe.className = `piece piece-${piece.color} ${piece.type}`;
                sq.appendChild(pe);
            }

            board.appendChild(sq);
            await sleep(20);
        }
    }

    recordPosition();
    updateCheckStatus();
    isGameRunning = false;
}

function renderBoard() {
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const sq = document.querySelector(`.square[data-x="${x}"][data-y="${y}"]`);
            sq.querySelectorAll('.piece').forEach(el => el.remove());
            const piece = gameState[y][x];
            if (piece) {
                const pe = document.createElement('div');
                pe.className = `piece piece-${piece.color} ${piece.type}`;
                sq.appendChild(pe);
            }
        }
    }
}

// ─── CLICK HANDLER ────────────────────────────────────────────────────────────
function handleSquareClick(squareDiv) {
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

            // ── Record SAN before the board changes ──────────────────────────
            // For pawn promotion we won't know the piece yet; handled in completePromotion
            const isPawnPromo = gameState[fromY][fromX]?.type === 'pawn' && (ty === 0 || ty === 7);
            if (!isPawnPromo) recordMove(fromX, fromY, tx, ty, chosenMove);
            else { pendingWhiteSAN = { fromX, fromY, tx, ty, chosenMove }; }

            const isPromoting = movePiece(fromX, fromY, tx, ty, chosenMove);

            selectedSquare.classList.remove('selected');
            selectedSquare    = null;
            clearMoveHighlights();
            currentValidMoves = [];

            highlightLastMove(fromX, fromY, tx, ty);
            renderBoard();

            if (isPromoting) {
                // currentTurn hasn't flipped yet – pass the color that moved
                showPromotionModal(tx, ty, currentTurn === 'white' ? 'white' : 'black');
            } else {
                recordPosition();
                updateCheckStatus();
                checkGameOver();

                if (currentTurn === 'black') {
                    setTimeout(runAI, 50);
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

function runAI() {
    makeAIMove();
    const last = lastMove;
    renderBoard();
    highlightLastMove(last.fromX, last.fromY, last.toX, last.toY);
    updateCheckStatus();
    checkGameOver();
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
    // Record the SAN now that we know the promotion piece
    if (pendingWhiteSAN) {
        const p = pendingWhiteSAN;
        recordMove(p.fromX, p.fromY, p.tx, p.ty, p.chosenMove, pieceType);
        pendingWhiteSAN = null;
    }

    gameState[promoTargetY][promoTargetX].type = pieceType;
    document.getElementById('promotionModal').classList.add('hidden');

    currentTurn = currentTurn === 'white' ? 'black' : 'white';

    renderBoard();
    recordPosition();
    updateCheckStatus();
    checkGameOver();

    if (currentTurn === 'black') {
        setTimeout(runAI, 50);
    }
}