// ─── LIVE GAME PAGE ────────────────────────────────────────────────────────────
// Drives game.html: setup, the board (board-ui.js), human input, the engine
// (in a Web Worker, see ai-worker.js), clocks, takeback/draw/resign, PGN, and
// save/resume. The rules live in engine.js; this file only orchestrates.

// Engine strength comes from the calibrated ladder in strength.js: each level is
// a search depth + eval-noise setting with a self-play-measured rating.
const AI_TIME_HUMAN = ENGINE_MOVE_TIME_MS; // the time cap the ladder was calibrated with
const AI_TIME_SELFPLAY = 500; // ms per move in Engine vs Engine (keeps it watchable)
const MIN_REPLY_MS = 250;     // instant (book) replies still get a beat before they land

// Time controls, their modes (Bullet/Blitz/Rapid/Unlimited) and the player's
// rating per mode live in ratings.js.
const INPROGRESS_KEY = 'chessInProgressGame';
const ANALYSIS_HANDOFF_KEY = 'chessGameForAnalysis';
const SETUP_KEY = 'chessSetup';
const MIN_RATED_PLIES = 4;     // games aborted before this many moves don't count

// ─── STATE ─────────────────────────────────────────────────────────────────────
// Setup choices; level / whiteLevel / blackLevel are ENGINE_LEVELS indices;
// timeByMode remembers the last time control picked in each mode.
// First visit: the opponent nearest your rating; engines watch at a strong level.
const settings = Object.assign(
    { mode: 'human', color: 'white', time: 'unlimited', level: null, timeByMode: {}, coach: 'off', autoFlip: 'on',
      whiteLevel: ENGINE_LEVELS.length - 4, blackLevel: ENGINE_LEVELS.length - 4 },
    loadJSON(SETUP_KEY) || {});
// A control saved by an older version that no mode offers: that mode's default.
if (!TIME_MODES.some(m => m.controls.includes(settings.time))) {
    settings.time = TIME_MODES.find(m => m.id === timeModeOf(settings.time)).defaultControl;
}
if (settings.level === null || settings.level === undefined) {
    settings.level = nearestEngineLevel(playerRating(timeModeOf(settings.time)).rating);
}

let gameMode = 'human';     // 'human' (vs engine) | 'local' (pass & play) | 'ai' (engine vs engine)
let autoFlip = false;       // pass & play: turn the board to the side to move after each move
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

// The time mode of the game being played (its rating is the one that counts).
function currentTimeMode() {
    return timeModeOf(timeControl);
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
const isHumanTurn = () => gameActive && (gameMode === 'local' || (gameMode === 'human' && currentTurn === playerColor));
const isEngineTurn = () => gameActive && gameMode !== 'local' && (gameMode === 'ai' || currentTurn !== playerColor);

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
            this.worker = new Worker('ai-worker.js?v=30');
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
                    resolve(findBestMove(currentTurn, params.level, params.sanMoves));
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

    board = new BoardView(document.getElementById('chessboard'), {
        canSelect: (x, y) => viewPly === null && isHumanTurn() && !aiThinking && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onHumanMove,
    });
    board.render(gameState, { animate: false });

    const $ = (id) => document.getElementById(id);
    const setupModal = $('setupModal');

    buildStrengthSliders();
    buildTimeControls();
    $('matchRatingButton').addEventListener('click', () => {
        settings.level = nearestEngineLevel(playerRating(timeModeOf(settings.time)).rating);
        syncSetupUI();
    });

    // Segmented controls in the setup modal write into `settings`.
    document.querySelectorAll('#setupModal .segmented[data-group]').forEach(group => {
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
    $('rematchButton').addEventListener('click', () => { $('gameOverModal').classList.add('hidden'); rematch(); });
    $('closeModalButton').addEventListener('click', () => $('gameOverModal').classList.add('hidden'));
    $('gameOverModal').addEventListener('click', (e) => { if (e.target === $('gameOverModal')) $('gameOverModal').classList.add('hidden'); });
    $('reportButton').addEventListener('click', openReview);
    $('viewStart').addEventListener('click', () => viewPosition(0));
    $('viewPrev').addEventListener('click', () => stepView(-1));
    $('viewNext').addEventListener('click', () => stepView(1));
    $('viewLive').addEventListener('click', () => viewPosition(null));
    document.addEventListener('keydown', (e) => {
        if ((e.target.closest && e.target.closest('input, textarea')) || document.querySelector('.modal-overlay:not(.hidden)')) return;
        const keys = { ArrowLeft: () => stepView(-1), ArrowRight: () => stepView(1), Home: () => viewPosition(0), End: () => viewPosition(null) };
        if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    });
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
    $('hintButton').addEventListener('click', requestHint);

    // Landing-page links preselect the setup (?mode=human|ai&difficulty=...);
    // ?resume=1 continues the saved in-progress game.
    const params = new URLSearchParams(location.search);
    if (['human', 'local', 'ai'].includes(params.get('mode'))) settings.mode = params.get('mode');
    const legacy = LEGACY_DIFFICULTY_LEVEL[params.get('difficulty')];
    if (legacy !== undefined) settings.level = legacy;
    // The Trainer's suggested game: ?level=<ENGINE_LEVELS index>&time=<control>.
    const level = parseInt(params.get('level'), 10);
    if (ENGINE_LEVELS[level]) { settings.mode = 'human'; settings.level = level; }
    const time = params.get('time');
    if (TIME_MODES.some(m => m.controls.includes(time))) settings.time = time;
    if (params.get('coach') === 'on') { settings.mode = 'human'; settings.coach = 'on'; }

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

// Mode tabs (Bullet / Blitz / Rapid / Unlimited, each with your rating in it)
// and the chosen mode's time controls as chips.
function buildTimeControls() {
    const tabs = document.getElementById('timeModeTabs');
    for (const mode of TIME_MODES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.mode = mode.id;
        b.innerHTML = `<span class="tm-name">${mode.icon} ${mode.name}</span><small class="tm-rating"></small>`;
        b.addEventListener('click', () => {
            if (timeModeOf(settings.time) === mode.id) return;
            settings.time = settings.timeByMode[mode.id] || mode.defaultControl;
            syncSetupUI();
        });
        tabs.appendChild(b);
    }
}

function syncTimeControls() {
    const modeId = timeModeOf(settings.time);
    const ratings = loadPlayerRatings();
    document.querySelectorAll('#timeModeTabs button').forEach(b => {
        b.classList.toggle('selected', b.dataset.mode === modeId);
        b.querySelector('.tm-rating').textContent = ratingText(ratings[b.dataset.mode]);
    });
    const chips = document.getElementById('timeControlChips');
    chips.innerHTML = '';
    const mode = TIME_MODES.find(m => m.id === modeId);
    for (const control of mode.controls) {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'time-chip' + (control === settings.time ? ' selected' : '');
        c.textContent = timeControlLabel(control);
        c.addEventListener('click', () => {
            settings.time = control;
            settings.timeByMode[modeId] = control;
            syncSetupUI();
        });
        chips.appendChild(c);
    }
    chips.classList.toggle('hidden', mode.controls.length < 2);
}

function syncSetupUI() {
    document.querySelectorAll('#setupModal .segmented[data-group]').forEach(group => {
        group.querySelectorAll('button').forEach(b =>
            b.classList.toggle('selected', b.dataset.value === settings[group.dataset.group]));
    });
    syncTimeControls();
    const vsEngine = settings.mode === 'human';
    document.getElementById('colorChoiceRow').classList.toggle('hidden', !vsEngine);
    document.getElementById('coachRow').classList.toggle('hidden', !vsEngine);
    document.getElementById('strengthHuman').classList.toggle('hidden', !vsEngine);
    document.getElementById('localRow').classList.toggle('hidden', settings.mode !== 'local');
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

    const modeName = timeModeName(timeModeOf(settings.time));
    const me = playerRating(timeModeOf(settings.time));
    const opponent = ENGINE_LEVELS[settings.level];
    document.getElementById('levelOdds').textContent =
        `Your expected score: ${Math.round(expectedScore(me.rating, opponent.rating) * 100)}%`;
    document.getElementById('setupSub').textContent = me.games
        ? `Your ${modeName} rating: ${ratingText(me)} after ${me.games} rated game${me.games === 1 ? '' : 's'}.`
        : `Your ${modeName} rating starts at ${me.rating} and adjusts after every game against the engine.`;
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
    cancelGamePreview();
    let coach = false; // Coach mode for this game (see coach.js)
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
        coach = resumeData.coach === true && gameMode === 'human';
        autoFlip = gameMode === 'local' && resumeData.autoFlip !== false;
    } else {
        gameMode = settings.mode;
        playerColor = gameMode !== 'human' ? 'white'
            : settings.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : settings.color;
        engineLevels = gameMode === 'ai' ? { white: settings.whiteLevel, black: settings.blackLevel }
            : gameMode === 'local' ? { white: null, black: null }
            : { white: null, black: null, [other(playerColor)]: settings.level };
        autoFlip = gameMode === 'local' && settings.autoFlip === 'on';
        coach = gameMode === 'human' && settings.coach === 'on';
        rated = gameMode === 'human' && !coach; // coached games are practice
        timeControl = settings.time;
    }
    resetCoach(coach);
    ratingChange = null;
    lastGameId = null;
    isFlipped = playerColor === 'black';

    const resumeSAN = resumeData ? rowsToSAN(resumeData.moveHistory) : [];
    const applied = replayWithSnapshots(resumeSAN);
    viewPly = null;
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

    if (autoFlip) isFlipped = currentTurn === 'black';
    board.setFlipped(isFlipped);
    board.render(gameState, { animate: false });
    board.setArrows([]);
    syncBoardMarks();
    board.setInteractive(gameMode !== 'ai');
    document.getElementById('liveActions').classList.toggle('hidden', gameMode === 'ai');

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
    snapshots.push(takeSnapshot());
    viewPly = null;

    board.render(gameState);
    syncBoardMarks();
    renderMoves();
    updatePlayers();
    saveInProgressGame();

    if (gameMode === 'human' && color === playerColor) coachAfterMove(sanList().slice(0, -1), san);
    if (autoFlip) flipToMover();

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
            sanMoves: sanList(),
            level: { timeMs: aiTimeBudget(), maxDepth: level.maxDepth, evalNoise: level.evalNoise, blunder: level.blunder },
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
            ratingChange = recordRatedResult(currentTimeMode(), score, levelOf(other(playerColor)).rating);
        }
        rated = false; // never count the same game twice
    }
    const sans = sanList();
    lastGameId = sans.length ? addGameToHistory({
        mode: gameMode, playerColor: gameMode === 'human' ? playerColor : null,
        white: names.white, black: names.black,
        engineRatings: { white: levelOf('white')?.rating ?? null, black: levelOf('black')?.rating ?? null },
        result: status.result, reason: status.message, plies: sans.length, sanMoves: sans,
        timeControl, timeMode: currentTimeMode(), rated: !!ratingChange,
        ratingBefore: ratingChange ? ratingChange.before : null, ratingAfter: ratingChange ? ratingChange.after : null,
    }) : null;
    updatePlayers();
    updateStatus(status);
    updateClockDisplay();
    clearHint();
    if (coachOn) showCoach({ title: 'Game over', line: 'How your moves were graded this game:', tally: true });
    startGamePreview(sans);
    setTimeout(() => showGameOverModal(status), 450);
}

// Same settings again with colors swapped (vs the engine), or the two engines'
// levels swapped (engine vs engine).
function rematch() {
    const human = gameMode === 'human';
    const color = human ? other(playerColor) : 'white';
    const levels = human ? { white: null, black: null, [other(color)]: engineLevels[other(playerColor)] }
        : gameMode === 'local' ? { white: null, black: null }
        : { white: engineLevels.black, black: engineLevels.white };
    startGame({ gameMode, playerColor: color, selectedTimeControl: timeControl, engineLevels: levels,
                rated: human && !coachOn, coach: coachOn, autoFlip, moveHistory: [], clock: null });
}

// ─── PLAYERS, CAPTURES, STATUS ─────────────────────────────────────────────────

// Display name (the rating is shown next to it); 'You' must stay exactly that,
// the review page uses it to orient the board and pick whose mistakes to retry.
function playerLabel(color) {
    if (gameMode === 'local') return color === 'white' ? 'White' : 'Black';
    return gameMode === 'human' && color === playerColor ? 'You' : 'Engine';
}

function playerRatingLabel(color) {
    if (gameMode === 'human' && color === playerColor) return ratingText(playerRating(currentTimeMode()));
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
    const fill = (prefix, color) => {
        document.getElementById(prefix + 'Name').textContent = playerLabel(color);
        document.getElementById(prefix + 'Rating').textContent = playerRatingLabel(color);
        document.getElementById(prefix + 'Avatar').className = `piece-icon ${color} king`;
        renderCaptured(document.getElementById(prefix + 'Captured'), color);
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
    if (gameMode === 'local') {
        chip.textContent = `Pass & play · ${timeControlTitle(timeControl)}`;
    } else if (gameMode === 'ai' && levelOf('white') && levelOf('black')) {
        chip.textContent = `≈${levelOf('white').rating} vs ≈${levelOf('black').rating} · ${timeControlTitle(timeControl)}`;
    } else if (opponent) {
        chip.textContent = `Engine ≈${opponent.rating} · ${timeControlTitle(timeControl)} · ${rated ? 'rated' : coachOn ? 'coach' : 'unrated'}`;
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
        if (gameMode === 'local') {
            text.textContent = check ? `Check! ${toMove} to move` : `${toMove} to move`;
            sub.textContent = 'Pass & play — hand the device over';
        } else if (gameMode === 'ai') {
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
    const canAct = gameActive && gameMode !== 'ai';
    document.getElementById('takebackButton').disabled = !canAct || sanList().length === 0;
    document.getElementById('offerDrawButton').disabled = !canAct || aiThinking;
    document.getElementById('resignButton').disabled = !canAct;
    syncHintButton();
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
            const ply = i * 2 + j + 1; // snapshot index after this move
            if (san) {
                cell.classList.add('clickable');
                cell.addEventListener('click', () => viewPosition(ply));
                if (ply === total) cell.classList.add('latest');
                if (ply === (viewPly === null ? total : viewPly)) cell.classList.add('active');
            }
            grid.appendChild(cell);
        });
    });
    document.getElementById('movesEmpty').classList.toggle('hidden', total > 0);
    const scroller = document.getElementById('movesScroll');
    if (viewPly === null) scroller.scrollTop = scroller.scrollHeight;
    syncViewControls();
}

// ─── LOOKING BACK DURING A GAME ─────────────────────────────────────────────────
// Every position of the game is kept as a small snapshot (pieces, last move,
// check), so you can step back through the game while playing — tap a move in
// the list or use ⏮ ◀ ▶ ⏭ under the board. Looking back is read-only and
// never touches the live game; the clock keeps running, and the next move
// played brings the board back to the live position.
let snapshots = [];   // index = plies played: [{ board, from, to, check }]
let viewPly = null;   // null = the live position, else the snapshot shown

function takeSnapshot() {
    const kp = findKing(currentTurn);
    return {
        board: gameState.map(row => row.map(p => p && { color: p.color, type: p.type })),
        from: lastMove ? { x: lastMove.fromX, y: lastMove.fromY } : null,
        to: lastMove ? { x: lastMove.toX, y: lastMove.toY } : null,
        check: kp && isInCheck(currentTurn) ? { x: kp.x, y: kp.y } : null,
    };
}

// replaySANFromStart that also keeps a snapshot of every position.
function replayWithSnapshots(sans) {
    resetGame();
    recordPosition();
    snapshots = [takeSnapshot()];
    let applied = 0;
    for (const san of sans) {
        const r = resolveSAN(currentTurn, san);
        if (!r) break;
        applyMoveWithPromotion(r.move, r.promo);
        recordPosition();
        snapshots.push(takeSnapshot());
        applied++;
    }
    return applied;
}

// Shows position `ply` (0 = the start); null or the last position = live.
function viewPosition(ply) {
    const last = snapshots.length - 1;
    if (ply === null || ply >= last) {
        if (viewPly === null) return;
        viewPly = null;
        board.render(gameState);
        syncBoardMarks();
        updatePlayers();
        renderMoves();
        return;
    }
    if (viewPly === null) clearHint();
    viewPly = Math.max(0, ply);
    const snap = snapshots[viewPly];
    board.clearSelection();
    board.render(snap.board);
    board.setLastMove(snap.from, snap.to);
    board.setCheck(snap.check);
    board.setBadge(null);
    const topColor = isFlipped ? 'white' : 'black';
    renderCaptured(document.getElementById('topCaptured'), topColor, snap.board);
    renderCaptured(document.getElementById('bottomCaptured'), other(topColor), snap.board);
    renderMoves();
}

function stepView(delta) {
    const last = snapshots.length - 1;
    const from = viewPly === null ? last : viewPly;
    const to = Math.max(0, Math.min(last, from + delta));
    if (to === from) return;
    viewPosition(to);
    if (delta > 0) { const sans = sanList(); if (sans[to - 1]) playSoundForMove(sans[to - 1]); }
}

function syncViewControls() {
    const last = snapshots.length - 1;
    const viewing = viewPly !== null;
    const label = document.getElementById('viewLabel');
    if (!label) return;
    const ply = viewing ? viewPly : last;
    label.textContent = !viewing ? 'Live' : ply === 0 ? 'Viewing the start' : `Viewing ${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${sanList()[ply - 1]}`;
    label.classList.toggle('viewing', viewing);
    document.getElementById('chessboard').classList.toggle('viewing', viewing);
    document.getElementById('viewStart').disabled = ply <= 0;
    document.getElementById('viewPrev').disabled = ply <= 0;
    document.getElementById('viewNext').disabled = !viewing;
    document.getElementById('viewLive').disabled = !viewing;
}

// ─── CLOCK ─────────────────────────────────────────────────────────────────────
function startClock() {
    stopClock();
    const tc = parseTimeControl(timeControl);
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
        // A flag only wins if the other side could still mate (chess.com's rule).
        if (!hasMatingMaterial(winner)) {
            endGame({ reason: 'timeout', result: '1/2-1/2', message: 'Draw — time out, but no mating material left' });
            return;
        }
        endGame({ reason: 'timeout', result: winner === 'white' ? '1-0' : '0-1',
                  message: `${winner === 'white' ? 'White' : 'Black'} wins on time` });
        return;
    }
    updateClockDisplay();
}

// Whether `color` has anything that could still deliver mate: not a lone king,
// nor king + a single bishop or knight.
function hasMatingMaterial(color) {
    let minors = 0;
    for (const row of gameState) {
        for (const p of row) {
            if (!p || p.color !== color || p.type === 'king') continue;
            if (p.type === 'bishop' || p.type === 'knight') minors++;
            else return true; // a pawn, rook or queen
        }
    }
    return minors >= 2;
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

// ─── PASS & PLAY ───────────────────────────────────────────────────────────────
// Turns the board to the side to move, after a short beat so the move just
// played is seen landing first.
function flipToMover() {
    const token = gameToken, plies = sanList().length;
    setTimeout(() => {
        if (token !== gameToken || sanList().length !== plies || !gameActive) return;
        isFlipped = currentTurn === 'black';
        board.setFlipped(isFlipped);
        updatePlayers();
        updateStatus();
    }, 450);
}

// Runs `action` only on a second click within 3 s (the button asks `prompt`
// in between) — nobody resigns or agrees a draw by accident on a shared device.
function confirmTwice(btn, prompt, action) {
    if (btn.dataset.armed) {
        clearTimeout(+btn.dataset.armed);
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
        action();
        return;
    }
    btn.dataset.label = btn.textContent;
    btn.textContent = prompt;
    btn.dataset.armed = String(setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }, 3000));
}

// ─── RESIGN / DRAW / TAKEBACK ──────────────────────────────────────────────────
function resign() {
    if (!gameActive) return;
    if (gameMode === 'local') {
        const loser = currentTurn === 'white' ? 'White' : 'Black', winner = other(currentTurn);
        confirmTwice(document.getElementById('resignButton'), `${loser} resigns?`, () => endGame({ reason: 'resign',
            result: winner === 'white' ? '1-0' : '0-1', message: `${loser} resigned — ${winner === 'white' ? 'White' : 'Black'} wins` }));
        return;
    }
    if (gameMode !== 'human') return;
    const winner = other(playerColor);
    endGame({ reason: 'resign', result: winner === 'white' ? '1-0' : '0-1',
              message: `You resigned — ${winner === 'white' ? 'White' : 'Black'} wins` });
}

// The engine accepts only when its static evaluation says it isn't better.
function offerDraw() {
    if (gameActive && gameMode === 'local') {
        confirmTwice(document.getElementById('offerDrawButton'), 'Both agree?',
            () => endGame({ reason: 'agreement', result: '1/2-1/2', message: 'Draw by agreement' }));
        return;
    }
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
    if (!gameActive || gameMode === 'ai') return;
    const list = sanList();
    if (list.length === 0) return;
    gameToken++;
    engineClient.cancel();
    aiThinking = false;
    if (rated) {
        rated = false;
        showToast('Takeback used — this game no longer counts toward your rating.', 3200);
    }

    list.pop(); // pass & play undoes just the last move; vs the engine, back to your turn
    while (gameMode === 'human' && list.length > 0 && (list.length % 2 === 0 ? 'white' : 'black') !== playerColor) list.pop();

    replayWithSnapshots(list);
    viewPly = null;
    moveHistory = rowsFromSAN(list);
    clearHint();
    board.setBadge(null);
    board.clearSelection();
    board.render(gameState);
    syncBoardMarks();
    renderMoves();
    updatePlayers();
    updateStatus();
    saveInProgressGame();
    if (autoFlip) flipToMover();
    if (isEngineTurn()) setTimeout(playEngineMove, 300);
}

// ─── SAVE / RESUME ─────────────────────────────────────────────────────────────
function saveInProgressGame() {
    if (!gameActive || gameMode === 'ai') return;
    try {
        localStorage.setItem(INPROGRESS_KEY, JSON.stringify({
            moveHistory, gameMode, playerColor, engineLevels, rated, coach: coachOn, autoFlip, selectedTimeControl: timeControl,
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
        ratingEl.textContent = `${timeModeName(currentTimeMode())} ${ratingChange.before} → ${ratingChange.after} (${ratingChange.delta >= 0 ? '+' : ''}${ratingChange.delta})`;
        ratingEl.className = 'rating-change ' + (ratingChange.delta >= 0 ? 'up' : 'down');
    } else {
        ratingEl.textContent = gameMode === 'human' ? 'unrated' : '';
        ratingEl.className = 'rating-change muted';
    }
    document.getElementById('reportButton').disabled = sanList().length === 0;
    document.getElementById('gameOverModal').classList.remove('hidden');
}

// ─── AFTER-GAME PREVIEW ────────────────────────────────────────────────────────
// When a game ends, a Quick review runs in the background (review-runner.js)
// so the game-over card can show both accuracies, the move grading and the
// biggest swing, like chess.com's. The report is cached and saved to the
// history, so Game Review opens with it instantly and refines from there.
const PREVIEW_CATEGORIES = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder'];
let previewJob = null;

function cancelGamePreview() {
    if (previewJob) previewJob.cancel();
    previewJob = null;
}

function startGamePreview(sans) {
    cancelGamePreview();
    const $ = (id) => document.getElementById(id);
    $('previewBox').classList.toggle('hidden', sans.length < 2);
    $('previewLoading').classList.remove('hidden');
    $('previewReady').classList.add('hidden');
    $('previewFill').style.width = '0%';
    $('previewText').textContent = 'Reviewing your game…';
    if (sans.length < 2) return;

    const token = gameToken, gameId = lastGameId;
    const show = (report) => {
        if (token !== gameToken) return;
        if (gameId) updateHistoryGame(gameId, reviewHistoryFields(report));
        renderGamePreview(report);
    };
    const cached = loadCachedReview(sans, 'quick');
    if (cached) { show(cached); return; }
    previewJob = runReview(sans, 'quick', {
        onMove: (entry, start, received) => {
            if (token !== gameToken) return;
            $('previewFill').style.width = `${(received / sans.length) * 100}%`;
            $('previewText').textContent = `Reviewing your game… ${received} of ${sans.length} moves`;
        },
        onDone: (report) => {
            previewJob = null;
            saveCachedReview(sans, 'quick', report);
            show(report);
        },
        onError: () => {
            previewJob = null;
            if (token === gameToken) $('previewText').textContent = 'The preview isn\'t available — the full review still works.';
        },
    });
    if (!previewJob) $('previewBox').classList.add('hidden');
}

function renderGamePreview(report) {
    const $ = (id) => document.getElementById(id);
    $('previewLoading').classList.add('hidden');
    $('previewReady').classList.remove('hidden');
    for (const color of ['white', 'black']) {
        const suffix = color === 'white' ? 'White' : 'Black';
        const acc = report.accuracy[color];
        $('previewAcc' + suffix).textContent = acc === null || acc === undefined ? '–' : acc.toFixed(1);
        $('previewName' + suffix).textContent = playerLabel(color);
    }
    const grades = $('previewGrades');
    grades.innerHTML = `<span></span><span class="go-col">${escapeText(playerLabel('white'))}</span><span class="go-col">${escapeText(playerLabel('black'))}</span>`;
    for (const cat of PREVIEW_CATEGORIES) {
        const w = report.counts.white[cat] || 0, b = report.counts.black[cat] || 0;
        if (!w && !b) continue; // keeps the card small
        const row = document.createElement('div');
        row.className = 'go-grade';
        row.innerHTML = `<span class="go-cat"><span class="mv-icon" style="background:${CATEGORY_COLORS[cat]}">${CATEGORY_SYMBOLS[cat]}</span>${cat}</span>`
            + `<span class="go-n" style="color:${w ? CATEGORY_COLORS[cat] : ''}">${w}</span><span class="go-n" style="color:${b ? CATEGORY_COLORS[cat] : ''}">${b}</span>`;
        grades.appendChild(row);
    }
    // The biggest swing by the human (either side in engine vs engine).
    const mine = report.perMove.filter(m => ['Mistake', 'Miss', 'Blunder'].includes(m.category)
        && (gameMode !== 'human' || m.color === playerColor));
    const worst = mine.sort((a, b) => b.winLoss - a.winLoss)[0];
    const moment = $('previewMoment');
    moment.classList.toggle('hidden', !worst);
    if (worst) {
        const prefix = `${Math.floor(worst.ply / 2) + 1}${worst.ply % 2 ? '...' : '.'}`;
        const why = worst.reason || (worst.bestMove ? `Best was ${worst.bestMove.san}.` : '');
        moment.innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[worst.category]}">${CATEGORY_SYMBOLS[worst.category]}</span>`
            + `<span><strong>Biggest swing: ${prefix} ${escapeText(worst.san)}</strong> ${escapeText(why)}</span>`;
    }
}

function escapeText(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
