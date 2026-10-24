// ─── HERO BOARD ────────────────────────────────────────────────────────────────
// Decorative static board: Morphy's Opera Game right after 16.Qb8+!! (the queen
// sacrifice the Game Review marks as Brilliant), with the move highlighted.
const HERO_FEN = '1Q2kb1r/p2n1ppp/4q3/4p1B1/4P3/8/PPP2PPP/2KR4';
const HERO_MOVE = { from: 'b3', to: 'b8' };
const FEN_PIECES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function buildMiniBoard() {
    const board = document.getElementById('miniBoard');
    if (!board) return;
    HERO_FEN.split('/').forEach((row, y) => {
        const cells = [];
        for (const ch of row) {
            if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) cells.push(null);
            else cells.push(ch);
        }
        cells.forEach((ch, x) => {
            const name = 'abcdefgh'[x] + (8 - y);
            const sq = document.createElement('div');
            sq.className = 'mini-sq ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
            if (name === HERO_MOVE.from || name === HERO_MOVE.to) sq.classList.add('hl');
            if (ch) {
                const color = ch === ch.toUpperCase() ? 'white' : 'black';
                const icon = document.createElement('span');
                icon.className = `piece-icon ${color} ${FEN_PIECES[ch.toLowerCase()]}`;
                sq.appendChild(icon);
            }
            if (name === HERO_MOVE.to) {
                const badge = document.createElement('span');
                badge.className = 'mini-badge';
                badge.textContent = '!!';
                sq.appendChild(badge);
            }
            board.appendChild(sq);
        });
    });
}

function goToGame(mode) {
    location.href = mode ? `game/game.html?mode=${mode}` : 'game/game.html';
}

document.addEventListener('DOMContentLoaded', () => {
    buildMiniBoard();

    document.getElementById('navPlayButton').addEventListener('click', () => goToGame('human'));
    document.getElementById('startGameButton').addEventListener('click', () => goToGame('human'));
    document.getElementById('watchAiButton').addEventListener('click', () => goToGame('ai'));

    // An unfinished game leaves a save behind (game-script.js saveInProgressGame).
    let hasSavedGame = false;
    try { hasSavedGame = !!localStorage.getItem('chessInProgressGame'); } catch (e) { hasSavedGame = false; }
    const resumeBtn = document.getElementById('resumeGameButton');
    resumeBtn.classList.toggle('hidden', !hasSavedGame);
    resumeBtn.addEventListener('click', () => location.href = 'game/game.html?resume=1');
});
