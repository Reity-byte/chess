// ─── STARTING POSITION (for the decorative hero board only) ────────────────────
const HERO_BACK_ROW = ['rook','knight','bishop','queen','king','bishop','knight','rook'];

function buildMiniBoard() {
    const board = document.getElementById('miniBoard');
    if (!board) return;

    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const sq = document.createElement('div');
            sq.className = 'mini-sq ' + ((x + y) % 2 === 0 ? 'light' : 'dark');

            let piece = null;
            if (y === 0) piece = { type: HERO_BACK_ROW[x], color: 'b' };
            else if (y === 1) piece = { type: 'pawn', color: 'b' };
            else if (y === 6) piece = { type: 'pawn', color: 'w' };
            else if (y === 7) piece = { type: HERO_BACK_ROW[x], color: 'w' };

            if (piece) {
                const img = document.createElement('img');
                img.src = `game/pieces/${piece.type}-${piece.color}.png`;
                img.alt = '';
                sq.appendChild(img);
            }
            board.appendChild(sq);
        }
    }
}

function goToGame(mode) {
    location.href = mode ? `game/game.html?mode=${mode}` : 'game/game.html';
}

document.addEventListener('DOMContentLoaded', () => {
    buildMiniBoard();

    const navPlay   = document.getElementById('navPlayButton');
    const startBtn  = document.getElementById('startGameButton');
    const watchBtn  = document.getElementById('watchAiButton');
    const resumeBtn = document.getElementById('resumeGameButton');

    if (navPlay)  navPlay.addEventListener('click', () => goToGame('human'));
    if (startBtn) startBtn.addEventListener('click', () => goToGame('human'));
    if (watchBtn) watchBtn.addEventListener('click', () => goToGame('ai'));

    // An in-progress game (not yet finished) leaves a save behind - see
    // game-script.js's saveInProgressGame(). Offer to jump straight back in.
    let hasSavedGame = false;
    try { hasSavedGame = !!localStorage.getItem('chessInProgressGame'); } catch (e) { hasSavedGame = false; }
    if (resumeBtn) {
        resumeBtn.classList.toggle('hidden', !hasSavedGame);
        resumeBtn.addEventListener('click', () => location.href = 'game/game.html?resume=1');
    }

    document.querySelectorAll('.card-button[data-play]').forEach(btn => {
        btn.addEventListener('click', () => goToGame(btn.dataset.play));
    });

    const puzzlesBtn = document.getElementById('puzzlesButton');
    if (puzzlesBtn) puzzlesBtn.addEventListener('click', () => location.href = 'game/puzzles.html');
});
