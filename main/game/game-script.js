// ─── LIVE GAME PAGE ────────────────────────────────────────────────────────────
// Drives game.html: setup, the board (board-ui.js), human input, the engine
// (in a Web Worker, see ai-worker.js), clocks, takeback/draw/resign, PGN, and
// save/resume. The rules live in engine.js; this file only orchestrates.

// Engine strength comes from the calibrated ladder in strength.js: each level is
// a search depth + eval-noise setting with a self-play-measured rating.
const AI_TIME_HUMAN = ENGINE_MOVE_TIME_MS; // the time cap the ladder was calibrated with
const AI_TIME_SELFPLAY = 500; // ms per move in Engine vs Engine (keeps it watchable)
const MIN_REPLY_MS = 250;     // instant (book) replies still get a beat before they land

// `unlimited` has no entry: no clock at all.
const TIME_CONTROLS = {
    '5|0':   { minutes: 5,  incrementSec: 0  },
    '10|5':  { minutes: 10, incrementSec: 5  },
    '15|10': { minutes: 15, incrementSec: 10 },
};

const INPROGRESS_KEY = 'chessInProgressGame';
const ANALYSIS_HANDOFF_KEY = 'chessGameForAnalysis';
const SETUP_KEY = 'chessSetup';
const PLAYER_RATING_KEY = 'chessPlayerRating';
const DEFAULT_PLAYER_RATING = 800;
const PROVISIONAL_GAMES = 20;  // bigger rating steps until the rating has settled
const MIN_RATED_PLIES = 4;     // games aborted before this many moves don't count

// ─── STATE ─────────────────────────────────────────────────────────────────────
// Setup choices; level / whiteLevel / blackLevel are ENGINE_LEVELS indices.
// First visit: the opponent nearest your rating; engines watch at a strong level.
const settings = Object.assign(
    { mode: 'human', color: 'white', time: 'unlimited', level: nearestEngineLevel(playerRating().rating),
      whiteLevel: ENGINE_LEVELS.length - 4, blackLevel: ENGINE_LEVELS.length - 4 },
    loadJSON(SETUP_KEY) || {});

let gameMode = 'human';     // 'human' (vs engine) | 'ai' (engine vs engine)
let playerColor = 'white';  // the human's color (orientation reference in AI vs AI)
let engineLevels = { white: null, black: null }; // level index per engine-controlled color
let rated = false;          // vs-engine games count toward your rating unless a takeback is used
let ratingChange = null;    // { before, after, delta } once a rated game has ended
let lastGameId = null;      // history id of the game that just ended (for the review link)
let timeControl = 'unlimited';
let isFlipped = false;

let gameActive = false;
let aiThinking = false;
let gameToken = 0;          // bumps on every new game/takeback; stale engine replies are dropped
let gameResult = '*';
let moveHistory = [];       // [{ white: 'e4', black: 'e5' | null }]
let clockState = null;      // { white, black (ms), incrementMs, lastTick, intervalId }
let board = null;

function sanList() {
    return rowsToSAN(moveHistory);
}

function loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
}

// ─── PLAYER RATING ─────────────────────────────────────────────────────────────
// Plain Elo against the engine levels' calibrated ratings.
function playerRating() {
    const r = loadJSON(PLAYER_RATING_KEY);
    return r && Number.isFinite(r.rating) ? r : { rating: DEFAULT_PLAYER_RATING, games: 0 };
}

function expectedScore(rating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

function recordRatedResult(score, opponentRating) {
    const r = playerRating();
    const k = r.games < PROVISIONAL_GAMES ? 40 : 20;
    const delta = Math.round(k * (score - expectedScore(r.rating, opponentRating)));
    const after = Math.max(100, r.rating + delta);
    saveJSON(PLAYER_RATING_KEY, { rating: after, games: r.games + 1 });
    return { before: r.rating, after, delta: after - r.rating };
}

function ratingText(r) {
    return `${r.rating}${r.games < PROVISIONAL_GAMES ? '?' : ''}`;
}

function levelOf(color) {
    const index = engineLevels[color];
    return index === null || index === undefined ? null : ENGINE_LEVELS[index] || null;
}

function rowsToSAN(rows) {
    const out = [];
    for (const row of rows) {
        if (row.white) out.push(row.white);
        if (row.black) out.push(row.black);
    }
    return out;
}

function rowsFromSAN(list) {
    const rows = [];
    list.forEach((san, i) => {
        if (i % 2 === 0) rows.push({ white: san, black: null });
        else rows[rows.length - 1].black = san;
    });
    return rows;
}

const other = (c) => c === 'white' ? 'black' : 'white';
const isHumanTurn = () => gameActive && gameMode === 'human' && currentTurn === playerColor;
const isEngineTurn = () => gameActive && (gameMode === 'ai' || currentTurn !== playerColor);

// ─── ENGINE (worker with synchronous fallback) ─────────────────────────────────
// Workers can't start from file:// in some browsers; then the search runs on
// the main thread instead (the UI pauses while it thinks, as before).
const engineClient = {
    worker: null,
    broken: false,
    pending: null,
    nextId: 1,

    ensure() {
        if (this.worker || this.broken) return;
        try {
            this.worker = new Worker('ai-worker.js?v=9');
            this.worker.onmessage = (e) => this.onMessage(e.data);
            this.worker.onerror = (e) => { e.preventDefault(); this.fail(); };
        } catch (e) {
            this.broken = true;
        }
    },

    fail() {
        this.broken = true;
        if (this.worker) this.worker.terminate();
        this.worker = null;
        const p = this.pending;
        this.pending = null;
        if (p) p.runLocally();
    },

    newGame() {
        this.cancel();
        this.ensure();
        if (this.worker) this.worker.postMessage({ type: 'newGame' });
        else clearSearchMemory();
    },

    // Drops any search in flight. The worker is replaced so the next request
    // doesn't queue behind a search nobody wants anymore.
    cancel() {
        if (!this.pending) return;
        this.pending = null;
        if (this.worker) { this.worker.terminate(); this.worker = null; }
    },

    think(params) {
        this.ensure();
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const runLocally = () => setTimeout(() => {
                try {
                    resolve(findBestMove(currentTurn, params.timeMs, params.maxDepth, params.evalNoise, params.sanMoves));
                } catch (err) { reject(err); }
            }, 30);
            if (!this.worker) { runLocally(); return; }
            this.pending = { id, resolve, reject, runLocally };
            this.worker.postMessage({ type: 'think', id, ...params });
        });
    },

    onMessage(d) {
        if (!this.pending || d.id !== this.pending.id) return;
        const p = this.pending;
        this.pending = null;
        if (d.type === 'error') p.reject(new Error(d.message));
        else p.resolve({ move: d.move, promo: d.promo });
    },
};

// ─── SETUP ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initBoardThemePicker();

    board = new BoardView(document.getElementById('chessboard'), {
        canSelect: (x, y) => isHumanTurn() && !aiThinking && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onHumanMove,
    });
    board.render(gameState, { animate: false });

    const $ = (id) => document.getElementById(id);
    const setupModal = $('setupModal');

    buildStrengthSliders();
    $('matchRatingButton').addEventListener('click', () => {
        settings.level = nearestEngineLevel(playerRating().rating);
        syncSetupUI();
    });

    // Segmented controls in the setup modal write into `settings`.
    document.querySelectorAll('#setupModal .segmented').forEach(group => {
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            settings[group.dataset.group] = btn.dataset.value;
            syncSetupUI();
        });
    });

    $('beginGameButton').addEventListener('click', () => {
        setupModal.classList.add('hidden');
        startGame();
    });
    $('cancelSetupButton').addEventListener('click', () => setupModal.classList.add('hidden'));
    $('newGameButton').addEventListener('click', openSetup);
    $('restartButton').addEventListener('click', () => { $('gameOverModal').classList.add('hidden'); openSetup(); });
    $('closeModalButton').addEventListener('click', () => $('gameOverModal').classList.add('hidden'));
    $('reportButton').addEventListener('click', openReview);
    $('flipButton').addEventListener('click', () => { isFlipped = !isFlipped; board.setFlipped(isFlipped); updatePlayers(); });
    $('pgnButton').addEventListener('click', downloadPGN);
    $('pgnButtonModal').addEventListener('click', downloadPGN);
    $('copyPgnButton').addEventListener('click', showPgnModal);
    $('copyPgnButtonModal').addEventListener('click', showPgnModal);
    $('closePgnModalButton').addEventListener('click', () => $('pgnModal').classList.add('hidden'));
    $('copyPgnConfirmButton').addEventListener('click', copyPgnToClipboard);
    $('resignButton').addEventListener('click', resign);
    $('offerDrawButton').addEventListener('click', offerDraw);
    $('takebackButton').addEventListener('click', takeback);

    // Landing-page links preselect the setup (?mode=human|ai&difficulty=...);
    // ?resume=1 continues the saved in-progress game.
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'human' || params.get('mode') === 'ai') settings.mode = params.get('mode');
    const legacy = LEGACY_DIFFICULTY_LEVEL[params.get('difficulty')];
    if (legacy !== undefined) settings.level = legacy;

    let resumeData = null;
    if (params.get('resume') === '1') {
        try { resumeData = JSON.parse(localStorage.getItem(INPROGRESS_KEY)); } catch (e) { resumeData = null; }
        if (!resumeData || !Array.isArray(resumeData.moveHistory)) resumeData = null;
    }

    updatePlayers();
    updateStatus();
    syncSetupUI();
    if (resumeData) startGame(resumeData);
    else openSetup();
});

// Builds one slider + readout in every `.strength[data-level-key]` container.
function buildStrengthSliders() {
    document.querySelectorAll('#setupModal .strength').forEach(box => {
        const key = box.dataset.levelKey;
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'strength-slider';
        slider.min = 0;
        slider.max = ENGINE_LEVELS.length - 1;
        slider.step = 1;
        slider.setAttribute('aria-label', key === 'level' ? 'Engine strength' : `${key === 'whiteLevel' ? 'White' : 'Black'} engine strength`);
        const readout = document.createElement('div');
        readout.className = 'strength-readout';
        slider.addEventListener('input', () => { settings[key] = +slider.value; syncSetupUI(); });
        box.append(slider, readout);
    });
}

function syncSetupUI() {
    document.querySelectorAll('#setupModal .segmented').forEach(group => {
        group.querySelectorAll('button').forEach(b =>
            b.classList.toggle('selected', b.dataset.value === settings[group.dataset.group]));
    });
    document.getElementById('colorChoiceRow').classList.toggle('hidden', settings.mode === 'ai');
    document.getElementById('strengthHuman').classList.toggle('hidden', settings.mode === 'ai');
    document.getElementById('strengthAi').classList.toggle('hidden', settings.mode !== 'ai');

    document.querySelectorAll('#setupModal .strength').forEach(box => {
        const index = Math.max(0, Math.min(ENGINE_LEVELS.length - 1, settings[box.dataset.levelKey] | 0));
        settings[box.dataset.levelKey] = index;
        const level = ENGINE_LEVELS[index];
        const slider = box.querySelector('input');
        slider.value = index;
        slider.style.setProperty('--fill', `${(index / (ENGINE_LEVELS.length - 1)) * 100}%`);
        box.querySelector('.strength-readout').innerHTML =
            `<strong>≈ ${level.rating}</strong><span>${engineLevelTitle(level.rating)}</span>`;
    });

    const me = playerRating();
    const opponent = ENGINE_LEVELS[settings.level];
    document.getElementById('levelOdds').textContent =
        `Your expected score: ${Math.round(expectedScore(me.rating, opponent.rating) * 100)}%`;
    document.getElementById('setupSub').textContent = me.games
        ? `Your rating: ${ratingText(me)} after ${me.games} rated game${me.games === 1 ? '' : 's'}.`
        : `Your rating starts at ${me.rating} and adjusts after every game against the engine.`;
    saveJSON(SETUP_KEY, settings);
}

function openSetup() {
    syncSetupUI();
    document.getElementById('setupModal').classList.remove('hidden');
}

// ─── GAME LIFECYCLE ────────────────────────────────────────────────────────────
// `resumeData` (from saveInProgressGame) replays a previously saved game.
function startGame(resumeData) {
    gameToken++;
    engineClient.newGame();
    stopClock();

    if (resumeData) {
        gameMode = resumeData.gameMode;
        playerColor = resumeData.playerColor;
        timeControl = resumeData.selectedTimeControl || 'unlimited';
        if (resumeData.engineLevels) {
            engineLevels = resumeData.engineLevels;
        } else {
            // Saved by an older version: map its named difficulty onto the ladder.
            const legacy = LEGACY_DIFFICULTY_LEVEL[resumeData.selectedDifficulty] ?? settings.level;
            engineLevels = { white: null, black: null, [other(playerColor)]: legacy };
        }
        rated = resumeData.rated === true;
    } else {
        gameMode = settings.mode;
        playerColor = gameMode === 'ai' ? 'white'
            : settings.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : settings.color;
        engineLevels = gameMode === 'ai'
            ? { white: settings.whiteLevel, black: settings.blackLevel }
            : { white: null, black: null, [other(playerColor)]: settings.level };
        rated = gameMode === 'human';
        timeControl = settings.time;
    }
    ratingChange = null;
    lastGameId = null;
    isFlipped = playerColor === 'black';

    const resumeSAN = resumeData ? rowsToSAN(resumeData.moveHistory) : [];
    const applied = replaySANFromStart(resumeSAN);
    moveHistory = rowsFromSAN(resumeSAN.slice(0, applied));

    gameActive = true;
    aiThinking = false;
    gameResult = '*';

    if (resumeData && resumeData.clock) {
        clockState = { ...resumeData.clock, lastTick: Date.now(), intervalId: null };
        clockState.intervalId = setInterval(tickClock, 100);
    } else {
        startClock();
    }

    board.setFlipped(isFlipped);
    board.render(gameState, { animate: false });
    board.setArrows([]);
    syncBoardMarks();
    board.setInteractive(gameMode === 'human');
    document.getElementById('liveActions').classList.toggle('hidden', gameMode !== 'human');

    updatePlayers();
    renderMoves();
    updateStatus();
    updateClockDisplay();

    if (isEngineTurn()) setTimeout(playEngineMove, 400);
}

// Applies `move` (with its promotion piece, if any) for the side to move and
// runs everything that follows a move: history, sound, clock, board, game end.
function commitMove(move, promo) {
    const color = currentTurn;
    const piece = gameState[move.fromY][move.fromX];
    const isPromo = piece.type === 'pawn' && (move.toY === 0 || move.toY === 7);
    const sanBase = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, isPromo ? (promo || 'queen') : null);
    applyMoveWithPromotion(move, isPromo ? (promo || 'queen') : null);
    recordPosition();
    const san = sanBase + getCheckSuffix(currentTurn);

    if (color === 'white') moveHistory.push({ white: san, black: null });
    else if (moveHistory.length && moveHistory[moveHistory.length - 1].black === null) moveHistory[moveHistory.length - 1].black = san;
    else moveHistory.push({ white: null, black: san });

    playSoundForMove(san);
    if (clockState) clockState[color] += clockState.incrementMs;

    board.render(gameState);
    syncBoardMarks();
    renderMoves();
    updatePlayers();
    saveInProgressGame();

    const status = getGameStatus();
    if (status) { endGame(status); return; }
    updateStatus();
    updateClockDisplay();
    if (isEngineTurn()) setTimeout(playEngineMove, gameMode === 'ai' ? 300 : 60);
}

function syncBoardMarks() {
    board.setLastMove(lastMove ? { x: lastMove.fromX, y: lastMove.fromY } : null,
                      lastMove ? { x: lastMove.toX, y: lastMove.toY } : null);
    board.updateCheckFromGame();
}

async function onHumanMove(move) {
    if (!isHumanTurn() || aiThinking) return;
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        const token = gameToken;
        promo = await board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || token !== gameToken || !isHumanTurn()) return;
    }
    commitMove(move, promo);
}

function aiTimeBudget() {
    if (clockState) return Math.max(100, Math.min(clockState[currentTurn] / 25, AI_TIME_HUMAN));
    return gameMode === 'ai' ? AI_TIME_SELFPLAY : AI_TIME_HUMAN;
}

async function playEngineMove() {
    if (!isEngineTurn() || aiThinking) return;
    const token = gameToken;
    const color = currentTurn;
    const level = levelOf(color);
    aiThinking = true;
    updateStatus();
    const started = Date.now();

    let result;
    try {
        result = await engineClient.think({
            sanMoves: sanList(), timeMs: aiTimeBudget(), maxDepth: level.maxDepth, evalNoise: level.evalNoise,
        });
    } catch (err) {
        console.error(err);
        if (token === gameToken) { aiThinking = false; updateStatus(); showToast('Engine error: ' + err.message); }
        return;
    }
    const wait = MIN_REPLY_MS - (Date.now() - started);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (token !== gameToken || !gameActive || currentTurn !== color) return;

    aiThinking = false;
    if (!result.move) { endGame(getGameStatus()); return; }
    commitMove(result.move, result.promo);
}

function endGame(status) {
    if (!status) return;
    gameActive = false;
    aiThinking = false;
    gameToken++;
    engineClient.cancel();
    stopClock();
    clearInProgressGame();
    playGameOverSound();
    gameResult = status.result;
    board.setInteractive(false);
    // Names (with ratings) as they stood while the game was played.
    const names = { white: fullPlayerName('white'), black: fullPlayerName('black') };
    if (rated && gameMode === 'human' && status.result !== '*') {
        if (sanList().length >= MIN_RATED_PLIES) {
            const score = status.result === '1/2-1/2' ? 0.5 : (status.result === '1-0') === (playerColor === 'white') ? 1 : 0;
            ratingChange = recordRatedResult(score, levelOf(other(playerColor)).rating);
        }
        rated = false; // never count the same game twice
    }
    const sans = sanList();
    lastGameId = sans.length ? addGameToHistory({
        mode: gameMode, playerColor: gameMode === 'human' ? playerColor : null,
        white: names.white, black: names.black,
        engineRatings: { white: levelOf('white')?.rating ?? null, black: levelOf('black')?.rating ?? null },
        result: status.result, reason: status.message, plies: sans.length, sanMoves: sans,
        timeControl, rated: !!ratingChange,
        ratingBefore: ratingChange ? ratingChange.before : null, ratingAfter: ratingChange ? ratingChange.after : null,
    }) : null;
    updatePlayers();
    updateStatus(status);
    updateClockDisplay();
    setTimeout(() => showGameOverModal(status), 450);
}

// ─── PLAYERS, CAPTURES, STATUS ─────────────────────────────────────────────────
const START_COUNTS = { pawn: 8, knight: 2, bishop: 2, rook: 2, queen: 1 };
const CAPTURE_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'];

// Display name (the rating is shown next to it); 'You' must stay exactly that,
// the review page uses it to orient the board and pick whose mistakes to retry.
function playerLabel(color) {
    return gameMode === 'human' && color === playerColor ? 'You' : 'Engine';
}

function playerRatingLabel(color) {
    if (gameMode === 'human' && color === playerColor) return ratingText(playerRating());
    const level = levelOf(color);
    return level ? `≈${level.rating}` : '';
}

// Name with rating, for PGN headers and the review page.
function fullPlayerName(color) {
    const r = playerRatingLabel(color);
    return r ? `${playerLabel(color)} (${r})` : playerLabel(color);
}

function updatePlayers() {
    const topColor = isFlipped ? 'white' : 'black';
    const bottomColor = other(topColor);
    const counts = { white: {}, black: {} };
    const material = { white: 0, black: 0 };
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (!p || p.type === 'king') continue;
            counts[p.color][p.type] = (counts[p.color][p.type] || 0) + 1;
            material[p.color] += PIECE_VALUES[p.type];
        }
    }
    const fill = (prefix, color) => {
        document.getElementById(prefix + 'Name').textContent = playerLabel(color);
        document.getElementById(prefix + 'Rating').textContent = playerRatingLabel(color);
        document.getElementById(prefix + 'Avatar').className = `piece-icon ${color} king`;
        const cap = document.getElementById(prefix + 'Captured');
        cap.innerHTML = '';
        // Pieces this side has taken = the opponent's pieces missing from the board.
        for (const type of CAPTURE_ORDER) {
            const missing = Math.max(0, START_COUNTS[type] - (counts[other(color)][type] || 0));
            if (!missing) continue;
            const group = document.createElement('span');
            group.className = 'group';
            for (let i = 0; i < missing; i++) group.appendChild(pieceIcon(other(color), type));
            cap.appendChild(group);
        }
        const diff = Math.round((material[color] - material[other(color)]) / 100);
        if (diff > 0) {
            const d = document.createElement('span');
            d.className = 'material-diff';
            d.textContent = `+${diff}`;
            cap.appendChild(d);
        }
    };
    fill('top', topColor);
    fill('bottom', bottomColor);
    updateClockDisplay();
}

function updateStatus(finalStatus) {
    const text = document.getElementById('statusText');
    const sub = document.getElementById('statusSub');
    const dot = document.getElementById('statusDot');
    const chip = document.getElementById('levelChip');
    chip.hidden = !gameActive && !finalStatus;
    const opponent = levelOf(other(playerColor));
    if (gameMode === 'ai' && levelOf('white') && levelOf('black')) {
        chip.textContent = `≈${levelOf('white').rating} vs ≈${levelOf('black').rating}`;
    } else if (opponent) {
        chip.textContent = `Engine ≈${opponent.rating} · ${rated ? 'rated' : 'unrated'}`;
    } else {
        chip.hidden = true; // no game set up yet
    }
    dot.className = 'status-dot';

    if (finalStatus) {
        text.textContent = resultHeadline(finalStatus.result);
        sub.textContent = finalStatus.message;
    } else if (!gameActive) {
        text.textContent = 'Ready to play';
        sub.textContent = 'Start a new game to begin.';
    } else {
        const toMove = currentTurn === 'white' ? 'White' : 'Black';
        const check = isInCheck(currentTurn);
        dot.classList.add(check ? 'alert' : 'live');
        if (gameMode === 'ai') {
            text.textContent = check ? `${toMove} is in check` : `${toMove} to move`;
            sub.textContent = aiThinking ? 'Engine is thinking…' : 'Engine vs Engine';
        } else if (currentTurn === playerColor) {
            text.textContent = check ? 'Check! Your move' : 'Your move';
            sub.textContent = `You play ${playerColor === 'white' ? 'White' : 'Black'}`;
        } else {
            text.textContent = 'Engine is thinking…';
            sub.textContent = check ? 'The engine is in check' : `${toMove} to move`;
        }
    }
    const opening = typeof identifyOpening === 'function' ? identifyOpening(sanList()).name : null;
    document.getElementById('openingName').textContent = opening || '';
    for (const id of ['topStrip', 'bottomStrip']) {
        const strip = document.getElementById(id);
        const color = (id === 'topStrip') === isFlipped ? 'white' : 'black';
        strip.classList.toggle('thinking', aiThinking && currentTurn === color && gameActive);
    }
    const canAct = gameActive && gameMode === 'human';
    document.getElementById('takebackButton').disabled = !canAct || sanList().length === 0;
    document.getElementById('offerDrawButton').disabled = !canAct || aiThinking;
    document.getElementById('resignButton').disabled = !canAct;
}

function resultHeadline(result) {
    if (result === '1/2-1/2') return 'Draw';
    const winner = result === '1-0' ? 'white' : 'black';
    if (gameMode === 'human') return winner === playerColor ? 'You won!' : 'You lost';
    return `${winner === 'white' ? 'White' : 'Black'} wins`;
}

function renderMoves() {
    const grid = document.getElementById('movesGrid');
    grid.innerHTML = '';
    const total = sanList().length;
    moveHistory.forEach((row, i) => {
        const num = document.createElement('div');
        num.className = 'mv-num';
        num.textContent = `${i + 1}.`;
        grid.appendChild(num);
        [row.white, row.black].forEach((san, j) => {
            const cell = document.createElement('div');
            cell.className = 'mv';
            cell.textContent = san || (j === 0 && !row.white ? '…' : '');
            if (san && i * 2 + j === total - 1) cell.classList.add('latest', 'active');
            grid.appendChild(cell);
        });
    });
    document.getElementById('movesEmpty').classList.toggle('hidden', total > 0);
    const scroller = document.getElementById('movesScroll');
    scroller.scrollTop = scroller.scrollHeight;
}

// ─── CLOCK ─────────────────────────────────────────────────────────────────────
function startClock() {
    stopClock();
    const tc = TIME_CONTROLS[timeControl];
    if (!tc) { clockState = null; return; }
    clockState = {
        white: tc.minutes * 60000, black: tc.minutes * 60000,
        incrementMs: tc.incrementSec * 1000, lastTick: Date.now(), intervalId: null,
    };
    clockState.intervalId = setInterval(tickClock, 100);
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
        const winner = other(currentTurn);
        endGame({ reason: 'timeout', result: winner === 'white' ? '1-0' : '0-1',
                  message: `${winner === 'white' ? 'White' : 'Black'} wins on time` });
        return;
    }
    updateClockDisplay();
}

function formatClock(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    if (ms < 10000) return (Math.max(0, ms) / 1000).toFixed(1);
    return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

function updateClockDisplay() {
    const topColor = isFlipped ? 'white' : 'black';
    for (const [id, color] of [['topClock', topColor], ['bottomClock', other(topColor)]]) {
        const el = document.getElementById(id);
        if (!clockState) { el.textContent = ''; continue; }
        el.textContent = formatClock(clockState[color]);
        el.classList.toggle('active', gameActive && currentTurn === color);
        el.classList.toggle('low', clockState[color] < 20000);
    }
}

// ─── RESIGN / DRAW / TAKEBACK ──────────────────────────────────────────────────
function resign() {
    if (!gameActive || gameMode !== 'human') return;
    const winner = other(playerColor);
    endGame({ reason: 'resign', result: winner === 'white' ? '1-0' : '0-1',
              message: `You resigned — ${winner === 'white' ? 'White' : 'Black'} wins` });
}

// The engine accepts only when its static evaluation says it isn't better.
function offerDraw() {
    if (!gameActive || gameMode !== 'human' || aiThinking) return;
    if (evaluateForColor(other(playerColor)) < 100) {
        endGame({ reason: 'agreement', result: '1/2-1/2', message: 'Draw by agreement' });
    } else {
        showToast('The engine declines your draw offer.');
    }
}

// Undoes back to the human's previous turn (the engine's reply and the human's
// move before it). Works while the engine is thinking, too.
function takeback() {
    if (!gameActive || gameMode !== 'human') return;
    const list = sanList();
    if (list.length === 0) return;
    gameToken++;
    engineClient.cancel();
    aiThinking = false;
    if (rated) {
        rated = false;
        showToast('Takeback used — this game no longer counts toward your rating.', 3200);
    }

    list.pop();
    while (list.length > 0 && (list.length % 2 === 0 ? 'white' : 'black') !== playerColor) list.pop();

    replaySANFromStart(list);
    moveHistory = rowsFromSAN(list);
    board.clearSelection();
    board.render(gameState);
    syncBoardMarks();
    renderMoves();
    updatePlayers();
    updateStatus();
    saveInProgressGame();
    if (isEngineTurn()) setTimeout(playEngineMove, 300);
}

// ─── SAVE / RESUME ─────────────────────────────────────────────────────────────
function saveInProgressGame() {
    if (!gameActive || gameMode !== 'human') return;
    try {
        localStorage.setItem(INPROGRESS_KEY, JSON.stringify({
            moveHistory, gameMode, playerColor, engineLevels, rated, selectedTimeControl: timeControl,
            clock: clockState ? { white: clockState.white, black: clockState.black, incrementMs: clockState.incrementMs } : null,
        }));
    } catch (e) { /* storage full or unavailable: resume just won't be offered */ }
}

function clearInProgressGame() {
    try { localStorage.removeItem(INPROGRESS_KEY); } catch (e) { /* ignore */ }
}

// ─── GAME OVER + REVIEW HANDOFF ────────────────────────────────────────────────
function showGameOverModal(status) {
    document.getElementById('gameOverTitle').textContent = resultHeadline(status.result);
    document.getElementById('gameOverReason').textContent = status.message;
    document.getElementById('gameOverScore').textContent =
        status.result === '1/2-1/2' ? '½–½' : status.result.replace('-', '–');
    const n = moveHistory.length;
    document.getElementById('gameOverMoves').textContent = `${n} move${n === 1 ? '' : 's'}`;
    const ratingEl = document.getElementById('gameOverRating');
    if (ratingChange) {
        ratingEl.textContent = `${ratingChange.before} → ${ratingChange.after} (${ratingChange.delta >= 0 ? '+' : ''}${ratingChange.delta})`;
        ratingEl.className = 'rating-change ' + (ratingChange.delta >= 0 ? 'up' : 'down');
    } else {
        ratingEl.textContent = gameMode === 'human' ? 'unrated' : '';
        ratingEl.className = 'rating-change muted';
    }
    document.getElementById('reportButton').disabled = sanList().length === 0;
    document.getElementById('gameOverModal').classList.remove('hidden');
}

function openReview() {
    const sans = sanList();
    if (sans.length === 0) { showToast('No moves to review yet.'); return; }
    try {
        localStorage.setItem(ANALYSIS_HANDOFF_KEY, JSON.stringify({
            sanMoves: sans,
            white: fullPlayerName('white').replace(/^You .*/, 'You'),
            black: fullPlayerName('black').replace(/^You .*/, 'You'),
            result: gameActive ? '*' : gameResult,
            historyId: gameActive ? null : lastGameId,
        }));
    } catch (e) { showToast('Could not hand the game to the review page.'); return; }
    location.href = 'analysis.html';
}

// ─── PGN EXPORT ────────────────────────────────────────────────────────────────
function buildPGN() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
    const result = gameActive ? '*' : gameResult;
    const headers = [
        '[Event "Casual Game"]', '[Site "Chess Site"]', `[Date "${today}"]`, '[Round "1"]',
        `[White "${fullPlayerName('white')}"]`, `[Black "${fullPlayerName('black')}"]`, `[Result "${result}"]`,
    ];
    let movetext = '';
    moveHistory.forEach((row, i) => {
        movetext += `${i + 1}. ${row.white || '...'} `;
        if (row.black) movetext += `${row.black} `;
    });
    return headers.join('\n') + '\n\n' + (movetext + result).trim() + '\n';
}

function downloadPGN() {
    if (sanList().length === 0) { showToast('No moves to export yet.'); return; }
    const blob = new Blob([buildPGN()], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-game-${new Date().toISOString().slice(0, 10)}.pgn`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function showPgnModal() {
    if (sanList().length === 0) { showToast('No moves to export yet.'); return; }
    const textarea = document.getElementById('pgnTextArea');
    textarea.value = buildPGN();
    document.getElementById('pgnModal').classList.remove('hidden');
    textarea.focus();
    textarea.select();
}

function copyPgnToClipboard() {
    const textarea = document.getElementById('pgnTextArea');
    textarea.select();
    const done = () => showToast('PGN copied to clipboard.');
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textarea.value).then(done, () => { document.execCommand('copy'); done(); });
    } else {
        document.execCommand('copy');
        done();
    }
}
