// ─── STYLE SETTINGS ────────────────────────────────────────────────────────────
// Piece set, board colors and a few feel options, shared by every page and kept
// in localStorage. Loaded (not deferred) in each page's <head> so the saved
// look is on <html> before anything is drawn — no flash of the default set.
// The Style button it adds to the top bar opens the panel to change them.
//
// Everything is applied as data attributes on <html>, which the stylesheets
// key on: data-pieces (pieces.css), data-board (theme.css), and data-coords /
// data-anim / data-hints = "off" (game.css).
const STYLE_KEY = 'chessStyle';
const STYLE_BASE = new URL('.', document.currentScript.src); // the main/ folder
const SOUND_MUTED_KEY = 'chessSoundMuted'; // shared with sound.js

const PIECE_SETS = [
    { id: 'pixel',      name: 'Pixel' },
    { id: 'cburnett',   name: 'Classic' },
    { id: 'merida',     name: 'Merida' },
    { id: 'california', name: 'California' },
    { id: 'staunty',    name: 'Staunty' },
    { id: 'cardinal',   name: 'Cardinal' },
    { id: 'maestro',    name: 'Maestro' },
    { id: 'fantasy',    name: 'Fantasy' },
    { id: 'celtic',     name: 'Celtic' },
    { id: 'spatial',    name: 'Spatial' },
];

const BOARD_THEMES = [
    { id: 'green',  name: 'Green',  light: '#ebecd0', dark: '#779556' },
    { id: 'brown',  name: 'Wood',   light: '#f0d9b5', dark: '#b58863' },
    { id: 'walnut', name: 'Walnut', light: '#e6c9a0', dark: '#8b5a3c' },
    { id: 'blue',   name: 'Ice',    light: '#dee3e6', dark: '#8ca2ad' },
    { id: 'slate',  name: 'Slate',  light: '#c6ccd6', dark: '#66758c' },
    { id: 'purple', name: 'Lavender', light: '#e9e3f2', dark: '#8877b7' },
    { id: 'coral',  name: 'Coral',  light: '#f3e4d8', dark: '#d0806a' },
    { id: 'night',  name: 'Night',  light: '#9aa6b5', dark: '#46546a' },
];

const STYLE_DEFAULTS = { pieces: 'pixel', board: 'green', coords: true, anim: true, hints: true };

function loadStyle() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STYLE_KEY)) || {}; } catch (e) { /* defaults */ }
    // The board theme used to be stored on its own.
    if (!saved.board) { try { saved.board = localStorage.getItem('chessBoardTheme') || undefined; } catch (e) { /* default */ } }
    const style = { ...STYLE_DEFAULTS, ...saved };
    if (!PIECE_SETS.some(s => s.id === style.pieces)) style.pieces = STYLE_DEFAULTS.pieces;
    if (!BOARD_THEMES.some(t => t.id === style.board)) style.board = STYLE_DEFAULTS.board;
    return style;
}

function applyStyle(style) {
    const root = document.documentElement.dataset;
    root.pieces = style.pieces;
    root.board = style.board;
    root.coords = style.coords ? 'on' : 'off';
    root.anim = style.anim ? 'on' : 'off';
    root.hints = style.hints ? 'on' : 'off';
}

function saveStyle(style) {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch (e) { /* this visit only */ }
    applyStyle(style);
}

function soundIsMuted() {
    try { return localStorage.getItem(SOUND_MUTED_KEY) === 'true'; } catch (e) { return false; }
}

function setSoundMuted(muted) {
    try { localStorage.setItem(SOUND_MUTED_KEY, String(muted)); } catch (e) { /* not persisted */ }
    // The game page keeps its own copy and a mute button (sound.js).
    if (typeof soundMuted !== 'undefined') soundMuted = muted;
    if (typeof setSoundButtonIcon === 'function') setSoundButtonIcon(document.getElementById('soundToggleButton'));
}

applyStyle(loadStyle());

// ─── PANEL ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    let right = bar.querySelector('.topbar-right');
    if (!right) {
        right = document.createElement('div');
        right.className = 'topbar-right';
        bar.appendChild(right);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost style-button';
    btn.setAttribute('aria-label', 'Style: pieces and board');
    btn.title = 'Style: pieces and board';
    btn.innerHTML = '<span class="style-button-icon" aria-hidden="true"><span class="piece-icon white knight"></span></span><span class="style-button-label">Style</span>';
    btn.addEventListener('click', openStylePanel);
    right.prepend(btn);
    buildTabBar(bar);
});

// Phone tab bar (shown by theme.css on narrow screens): the page's own top-bar
// links, each with an icon.
function buildTabBar(bar) {
    const nav = bar.querySelector('.topnav');
    if (!nav || document.querySelector('.tabbar')) return;
    const tabs = document.createElement('nav');
    tabs.className = 'tabbar';
    tabs.setAttribute('aria-label', 'Pages');
    const icon = (href) => /trainer/.test(href) ? 'train' : /history/.test(href) ? 'history' : /puzzles/.test(href) ? 'puzzles' : /analysis/.test(href) ? 'review' : 'play';
    for (const link of nav.querySelectorAll('a')) {
        const a = document.createElement('a');
        a.href = link.getAttribute('href');
        if (link.classList.contains('active')) { a.className = 'active'; a.setAttribute('aria-current', 'page'); }
        a.innerHTML = `<span class="tab-icon" data-tab="${icon(a.href)}" aria-hidden="true"></span><span>${link.textContent}</span>`;
        tabs.appendChild(a);
    }
    document.body.appendChild(tabs);
}

function openStylePanel() {
    const style = loadStyle();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal style-modal" role="dialog" aria-modal="true" aria-labelledby="styleTitle">
            <h2 id="styleTitle">Style</h2>
            <p class="modal-sub">Pieces, board and feel — saved in this browser.</p>
            <div class="style-preview" aria-hidden="true"></div>
            <div class="eyebrow field-label">Pieces</div>
            <div class="style-grid piece-set-grid"></div>
            <div class="eyebrow field-label">Board</div>
            <div class="style-grid board-grid"></div>
            <div class="eyebrow field-label">Options</div>
            <div class="style-options"></div>
            <div class="eyebrow field-label">Your data</div>
            <div class="data-actions">
                <button type="button" class="btn" data-transfer="send">📲 Move to another device</button>
                <button type="button" class="btn" data-transfer="save">⤓ Save backup file</button>
                <button type="button" class="btn" data-transfer="load">⤒ Load backup file</button>
            </div>
            <p class="style-credits faint">Piece sets other than Pixel are from lichess.org by their authors
                (GPL, MIT and CC BY-NC-SA licenses) — see game/pieces/CREDITS.md.</p>
            <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Done</button></div>
        </div>`;
    const modal = overlay.querySelector('.style-modal');

    // A 2×4 corner of a position, drawn with the current set and board.
    const preview = modal.querySelector('.style-preview');
    const PREVIEW = [
        ['black rook', '', 'black queen', 'black king'],
        ['', 'black knight', 'white bishop', ''],
        ['white pawn', '', 'white knight', ''],
        ['white rook', '', 'white queen', 'white king'],
    ];
    PREVIEW.forEach((row, y) => row.forEach((piece, x) => {
        const sq = document.createElement('div');
        sq.className = 'preview-sq ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
        if (piece) sq.innerHTML = `<span class="piece-icon ${piece}"></span>`;
        preview.appendChild(sq);
    }));

    const setGrid = modal.querySelector('.piece-set-grid');
    for (const set of PIECE_SETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'style-choice';
        b.dataset.value = set.id;
        // Each card shows its own set, whatever is active.
        b.innerHTML = `<span class="set-sample" data-pieces="${set.id}">
                <span class="piece-icon white king"></span><span class="piece-icon black queen"></span><span class="piece-icon white knight"></span>
            </span><span class="choice-name">${set.name}</span>`;
        b.addEventListener('click', () => { style.pieces = set.id; update(); });
        setGrid.appendChild(b);
    }

    const boardGrid = modal.querySelector('.board-grid');
    for (const t of BOARD_THEMES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'style-choice';
        b.dataset.value = t.id;
        b.innerHTML = `<span class="board-sample" style="--l:${t.light};--d:${t.dark}"></span><span class="choice-name">${t.name}</span>`;
        b.addEventListener('click', () => { style.board = t.id; update(); });
        boardGrid.appendChild(b);
    }

    const options = modal.querySelector('.style-options');
    const toggles = [
        { key: 'coords', label: 'Board coordinates', sub: 'a–h and 1–8 along the edges' },
        { key: 'anim',   label: 'Move animations',   sub: 'Pieces slide to their squares' },
        { key: 'hints',  label: 'Legal-move dots',   sub: 'Show where a selected piece can go' },
        { key: 'sound',  label: 'Sound effects',     sub: 'Moves, captures and checks' },
    ];
    for (const t of toggles) {
        const row = document.createElement('label');
        row.className = 'toggle-row';
        const on = t.key === 'sound' ? !soundIsMuted() : style[t.key];
        row.innerHTML = `<span><span class="toggle-label">${t.label}</span><span class="toggle-sub">${t.sub}</span></span>
            <input type="checkbox" class="switch" ${on ? 'checked' : ''}>`;
        row.querySelector('input').addEventListener('change', (e) => {
            if (t.key === 'sound') setSoundMuted(!e.target.checked);
            else { style[t.key] = e.target.checked; update(); }
        });
        options.appendChild(row);
    }

    function update() {
        saveStyle(style);
        setGrid.querySelectorAll('.style-choice').forEach(b => b.classList.toggle('active', b.dataset.value === style.pieces));
        boardGrid.querySelectorAll('.style-choice').forEach(b => b.classList.toggle('active', b.dataset.value === style.board));
    }
    update();

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    modal.querySelectorAll('[data-transfer]').forEach(b => b.addEventListener('click', () => { close(); openTransfer(b.dataset.transfer); }));
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    modal.querySelector('.style-choice.active').focus();
}

// Moving data between devices (QR / backup file) lives in transfer.js, loaded
// the first time it's needed.
function openTransfer(action) {
    if (typeof openTransferPanel === 'function') { openTransferPanel(action); return; }
    const script = document.createElement('script');
    script.src = new URL('transfer.js?v=24', STYLE_BASE).href;
    script.onload = () => openTransferPanel(action);
    document.head.appendChild(script);
}
