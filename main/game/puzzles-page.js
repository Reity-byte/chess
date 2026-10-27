// ─── PUZZLES ───────────────────────────────────────────────────────────────────
// Drives puzzles.html. Puzzles come from PUZZLE_LIBRARY (puzzle-library.js,
// engine-mined by tools/make-puzzles.js) plus the positions your own reviewed
// games added to localStorage['chessPuzzleBank'] (analysis-page.js). Every
// puzzle is normalized to { id, rating, themes, prefix, solution }: `prefix` is
// the game up to and including the opponent's mistake, `solution` the solver's
// moves alternating with the forced replies.
//
// Two modes: Rated (Elo against the puzzle's rating, theme filter, a daily
// puzzle) and Puzzle Rush (3 min / 5 min / Survival, ever harder puzzles, three
// mistakes and out; it never touches the rating).
const RATING_KEY = 'chessPuzzleRating';
const STREAK_KEY = 'chessPuzzleStreak';
const SOLVED_KEY = 'chessPuzzleSolvedCount';
const DONE_KEY   = 'chessPuzzleSolvedIds'; // ids already seen, to avoid repeats
const BANK_KEY   = 'chessPuzzleBank';
const RUSH_KEY   = 'chessPuzzleRush';
const DAILY_KEY  = 'chessPuzzleDaily';

const THEMES = [
    { key: 'all',          label: 'All' },
    { key: 'mate',         label: 'Checkmates' },
    { key: 'mateIn1',      label: 'Mate in 1' },
    { key: 'mateIn2',      label: 'Mate in 2' },
    { key: 'mateIn3plus',  label: 'Mate in 3+' },
    { key: 'fork',         label: 'Forks' },
    { key: 'hangingPiece', label: 'Hanging pieces' },
    { key: 'sacrifice',    label: 'Sacrifices' },
    { key: 'advantage',    label: 'Win material' },
    { key: 'backRankMate', label: 'Back rank' },
    { key: 'promotion',    label: 'Promotion' },
    { key: 'endgame',      label: 'Endgames' },
    { key: 'long',         label: 'Long lines' },
    { key: 'yourGames',    label: 'From your games' },
];
const THEME_NAMES = {
    mate: 'Checkmate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5',
    fork: 'Fork', hangingPiece: 'Hanging piece', sacrifice: 'Sacrifice', advantage: 'Wins material', backRankMate: 'Back-rank mate',
    promotion: 'Promotion', endgame: 'Endgame', long: 'Long line', oneMove: 'One move', yourGames: 'From your game',
};
const RUSH_MODES = {
    3:        { label: '3 min',    ms: 180000, start: 500, step: 45 },
    5:        { label: '5 min',    ms: 300000, start: 500, step: 35 },
    survival: { label: 'Survival', ms: 0,      start: 500, step: 55 },
};
const RUSH_STRIKES = 3;

let rating = 1200;
let streak = 0;
let solvedCount = 0;
let seenIds = [];
let allPuzzles = [];
let theme = 'all';
let mode = 'rated';
let board = null;
let run = null;          // the puzzle on the board: { p, step, ready, done, hinted, rated, kind, token }
let loadToken = 0;
let rush = null;         // { key, score, strikes, endsAt, timer, results:[{p, ok}], used:Set }
let rushChoice = '3';

const $ = (id) => document.getElementById(id);
const bare = (san) => (san || '').replace(/[+#!?]/g, '');
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function loadNumber(key, fallback) {
    try {
        const n = Number(localStorage.getItem(key));
        return localStorage.getItem(key) !== null && Number.isFinite(n) ? n : fallback;
    } catch (e) { return fallback; }
}
function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
}
function save(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (e) { /* progress just won't persist */ }
}

document.addEventListener('DOMContentLoaded', () => {
    board = new BoardView($('chessboard'), {
        canSelect: (x, y) => !!run && run.ready && !run.done && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onPuzzleMove,
    });
    board.render(gameState, { animate: false });

    $('giveUpButton').addEventListener('click', giveUp);
    $('nextPuzzleButton').addEventListener('click', nextPuzzle);
    $('hintButton').addEventListener('click', showHint);
    $('dailyButton').addEventListener('click', playDaily);
    $('rushStart').addEventListener('click', startRush);
    $('rushAgain').addEventListener('click', startRush);
    $('rushModes').addEventListener('click', showRushSetup);
    $('rushEndButton').addEventListener('click', () => endRush('ended'));
    for (const b of $('modeTabs').querySelectorAll('button')) b.addEventListener('click', () => setMode(b.dataset.mode));
    for (const b of $('rushOptions').querySelectorAll('button')) {
        b.addEventListener('click', () => {
            rushChoice = b.dataset.rush;
            for (const o of $('rushOptions').querySelectorAll('button')) o.classList.toggle('selected', o === b);
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && mode === 'rated' && run && run.done) nextPuzzle();
    });

    rating = loadNumber(RATING_KEY, 1200);
    streak = loadNumber(STREAK_KEY, 0);
    solvedCount = loadNumber(SOLVED_KEY, 0);
    seenIds = loadJSON(DONE_KEY, []);
    allPuzzles = PUZZLE_LIBRARY.map(fromLibrary).concat(loadJSON(BANK_KEY, []).map(fromBank).filter(Boolean));

    const params = new URLSearchParams(location.search);
    if (THEMES.some(t => t.key === params.get('theme'))) theme = params.get('theme');
    renderThemes();
    updateStats();
    renderDaily();
    if (params.get('mode') === 'rush') setMode('rush');
    else nextPuzzle();
});

function fromLibrary(p) {
    return { id: p.id, rating: p.rating, themes: p.themes, prefix: p.prefix.split(' '), solution: p.solution.split(' ') };
}

// Positions your reviewed games added: a single best move (older entries
// without its SAN are skipped).
function fromBank(p) {
    if (!p || !p.sanPrefix || !p.punishMove || !p.punishMove.san) return null;
    return { id: p.id, rating: p.rating, themes: ['yourGames'], prefix: p.sanPrefix, solution: [p.punishMove.san] };
}

function hasTheme(p, key) {
    if (key === 'all') return !p.themes.includes('yourGames');
    if (key === 'mateIn3plus') return p.themes.some(t => /^mateIn[3-9]$/.test(t));
    return p.themes.includes(key);
}

// ─── MODES ─────────────────────────────────────────────────────────────────────
function setMode(next) {
    if (rush && rush.timer) endRush('ended', { silent: true });
    mode = next;
    for (const b of $('modeTabs').querySelectorAll('button')) b.classList.toggle('selected', b.dataset.mode === mode);
    const rated = mode === 'rated';
    $('ratedStats').classList.toggle('hidden', !rated);
    $('themePanel').classList.toggle('hidden', !rated);
    $('dailyPanel').classList.toggle('hidden', !rated);
    $('rushRun').classList.add('hidden');
    $('rushEnd').classList.add('hidden');
    $('rushSetup').classList.toggle('hidden', rated);
    if (rated) nextPuzzle();
    else showRushSetup();
}

// ─── RATED: SELECTION ──────────────────────────────────────────────────────────
// Closest rating to the player's among unseen puzzles of the chosen theme (a
// little randomness among the eight closest); the seen-list for the theme
// resets once everything in it was played.
function pickPuzzle() {
    const pool = allPuzzles.filter(p => hasTheme(p, theme));
    if (!pool.length) return null;
    const current = run && run.p;
    let candidates = pool.filter(p => !seenIds.includes(p.id) && p !== current);
    if (!candidates.length) {
        const ids = new Set(pool.map(p => p.id));
        seenIds = seenIds.filter(id => !ids.has(id));
        candidates = pool.filter(p => p !== current);
        if (!candidates.length) candidates = pool;
    }
    candidates = candidates.slice().sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating));
    const near = candidates.slice(0, Math.min(8, candidates.length));
    return near[Math.floor(Math.random() * near.length)];
}

function nextPuzzle() {
    const p = pickPuzzle();
    if (!p) {
        run = null;
        setPrompt(null, 'No puzzles here yet', theme === 'yourGames' ? 'Review a game — its blunders become puzzles.' : 'Try another theme.');
        setFooter({});
        return;
    }
    startPuzzle(p, { kind: 'rated', rated: true });
}

function renderThemes() {
    const wrap = $('themeChips');
    wrap.innerHTML = '';
    for (const t of THEMES) {
        const n = allPuzzles.filter(p => hasTheme(p, t.key)).length;
        if (!n && t.key !== 'all') continue;
        const b = document.createElement('button');
        b.className = 'theme-chip' + (t.key === theme ? ' selected' : '');
        b.innerHTML = `${esc(t.label)} <span>${n}</span>`;
        b.addEventListener('click', () => {
            theme = t.key;
            renderThemes();
            const url = new URL(location.href);
            if (theme === 'all') url.searchParams.delete('theme'); else url.searchParams.set('theme', theme);
            history.replaceState(null, '', url);
            if (mode === 'rated') nextPuzzle();
        });
        wrap.appendChild(b);
    }
}

// ─── DAILY PUZZLE ──────────────────────────────────────────────────────────────
// Same puzzle for everyone on a given day: a mid-rated library puzzle picked by
// the date. Solving it on consecutive days builds a streak.
function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dailyPuzzle() {
    const pool = allPuzzles.filter(p => !p.themes.includes('yourGames') && p.rating >= 900 && p.rating <= 1800);
    const list = pool.length ? pool : allPuzzles;
    if (!list.length) return null;
    const day = Math.floor(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) / 86400000);
    return list[(day * 7919) % list.length];
}

function renderDaily() {
    const d = loadJSON(DAILY_KEY, {});
    const done = d.date === todayKey();
    const streakDays = dailyStreak(d);
    $('dailySub').textContent = done
        ? `${d.solved ? '✓ Solved today' : 'Done for today'}${streakDays > 1 ? ` · ${streakDays}-day streak 🔥` : ''}`
        : streakDays ? `Keep your ${streakDays}-day streak going` : 'A new one every day.';
    $('dailyButton').textContent = done ? 'Look again' : 'Solve';
    $('dailyPanel').classList.toggle('done', done && !!d.solved);
}

// Days in a row (up to today or yesterday) the daily puzzle was solved.
function dailyStreak(d) {
    if (!d.lastSolved) return 0;
    const yesterday = todayKey(new Date(Date.now() - 86400000));
    return d.lastSolved === todayKey() || d.lastSolved === yesterday ? d.streak || 0 : 0;
}

function playDaily() {
    const p = dailyPuzzle();
    if (!p) return;
    const d = loadJSON(DAILY_KEY, {});
    // Rated the first time today only.
    startPuzzle(p, { kind: 'daily', rated: d.date !== todayKey() });
}

function finishDaily(success) {
    const d = loadJSON(DAILY_KEY, {});
    if (d.date === todayKey()) return;
    const today = todayKey();
    const continues = d.lastSolved === todayKey(new Date(Date.now() - 86400000));
    const next = { date: today, solved: success, lastSolved: d.lastSolved, streak: d.streak || 0 };
    if (success) { next.lastSolved = today; next.streak = continues ? (d.streak || 0) + 1 : 1; }
    save(DAILY_KEY, next);
    renderDaily();
}

// ─── THE PUZZLE ON THE BOARD ───────────────────────────────────────────────────
function startPuzzle(p, { kind, rated }) {
    const token = ++loadToken;
    run = { p, step: 0, ready: false, done: false, hinted: false, rated, kind, token };
    board.setInteractive(false);
    board.clearSelection();
    $('puzzleResult').textContent = '';
    $('puzzleResult').className = 'puzzle-result';
    $('ratingDelta').textContent = '';
    $('puzzleThemes').classList.add('hidden');
    setFooter(kind === 'rush' ? { end: true } : { hint: true, giveUp: true });
    $('hintButton').disabled = false;

    // Show the position before the opponent's mistake, then play it so it animates in.
    replaySANFromStart(p.prefix.slice(0, -1));
    const solver = currentTurn === 'white' ? 'black' : 'white';
    board.setFlipped(solver === 'black');
    board.render(gameState, { animate: false });
    board.setArrows([]);
    board.setBadge(null);
    board.setLastMove(null, null);
    board.setCheck(null);

    const playerMoves = Math.ceil(p.solution.length / 2);
    const mate = p.themes.find(t => /^mateIn\d$/.test(t));
    const goal = mate ? `Find mate in ${mate.slice(6)}.`
        : playerMoves > 1 ? `Find the best move — the line is ${playerMoves} moves long.` : 'Find the best move.';
    const label = kind === 'daily' ? `Daily puzzle · ${solver === 'white' ? 'White' : 'Black'} to move` : `${solver === 'white' ? 'White' : 'Black'} to move`;
    setPrompt(solver, label, `${p.themes.includes('yourGames') ? 'From one of your games. ' : ''}${goal}`);
    $('puzzleRatingChip').classList.remove('hidden');
    $('puzzleRatingChip').textContent = `★ ${p.rating}`;

    setTimeout(() => {
        if (!run || run.token !== token) return;
        const last = playSAN(p.prefix[p.prefix.length - 1]);
        if (last) playSoundForMove(p.prefix[p.prefix.length - 1]);
        run.ready = true;
        board.setInteractive(true);
    }, kind === 'rush' ? 250 : 400);
}

// Plays a SAN move on the board with its animation; returns the resolved move.
function playSAN(san) {
    const r = resolveSAN(currentTurn, san);
    if (!r) return null;
    applyMoveWithPromotion(r.move, r.promo);
    recordPosition();
    board.render(gameState);
    board.setLastMove({ x: r.move.fromX, y: r.move.fromY }, { x: r.move.toX, y: r.move.toY });
    board.updateCheckFromGame();
    return r;
}

// Back to the puzzle position at solution step `step` (no animation).
function restoreStep(step) {
    const moves = run.p.prefix.concat(run.p.solution.slice(0, step));
    replaySANFromStart(moves.slice(0, -1));
    const r = resolveSAN(currentTurn, moves[moves.length - 1]);
    replaySANFromStart(moves);
    board.render(gameState, { animate: false });
    board.setLastMove(r ? { x: r.move.fromX, y: r.move.fromY } : null, r ? { x: r.move.toX, y: r.move.toY } : null);
    board.updateCheckFromGame();
}

async function onPuzzleMove(move) {
    if (!run || !run.ready || run.done) return;
    const current = run;
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || run !== current || run.done) return;
    }
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    recordPosition();
    const full = san + getCheckSuffix(currentTurn);
    board.render(gameState);
    board.setLastMove({ x: move.fromX, y: move.fromY }, { x: move.toX, y: move.toY });
    board.updateCheckFromGame();
    playSoundForMove(full);

    const expected = run.p.solution[run.step];
    // Any mate is right, even one other than the stored line's.
    const mates = !hasAnyLegalMove(currentTurn) && isInCheck(currentTurn);
    if (bare(full) !== bare(expected) && !mates) { wrongMove(full); return; }

    run.step++;
    if (mates || run.step >= run.p.solution.length) { puzzleSolved(); return; }
    // The forced reply, then the solver again.
    run.ready = false;
    board.setInteractive(false);
    $('puzzleResult').textContent = '✓ Best move — keep going!';
    $('puzzleResult').className = 'puzzle-result good';
    setTimeout(() => {
        if (run !== current || run.done) return;
        const reply = run.p.solution[run.step];
        playSAN(reply);
        playSoundForMove(reply);
        run.step++;
        run.ready = true;
        board.setInteractive(true);
    }, run.kind === 'rush' ? 300 : 450);
}

function wrongMove(san) {
    const current = run;
    run.ready = false;
    board.setInteractive(false);
    flash('bad');
    if (run.kind === 'rush') { rushResult(false, san); return; }
    puzzleFailed(san);
    // Take the wrong move back, then show the rest of the solution.
    setTimeout(() => {
        if (run !== current) return;
        restoreStep(run.step);
        revealRest(current);
    }, 700);
}

// Plays the remaining solution moves one by one, arrowing the solver's moves.
function revealRest(current) {
    const solution = current.p.solution;
    let i = current.step;
    const tick = () => {
        if (run !== current || i >= solution.length) return;
        const r = resolveSAN(currentTurn, solution[i]);
        if (!r) return;
        if (i % 2 === 0) board.setArrows([{ from: { x: r.move.fromX, y: r.move.fromY }, to: { x: r.move.toX, y: r.move.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
        setTimeout(() => {
            if (run !== current) return;
            playSAN(solution[i]);
            playSoundForMove(solution[i]);
            i++;
            if (i < solution.length) setTimeout(tick, 550);
            else setTimeout(() => { if (run === current) board.setArrows([]); }, 900);
        }, i % 2 === 0 ? 650 : 0);
    };
    tick();
}

function showHint() {
    if (!run || run.done || !run.ready) return;
    const r = resolveSAN(currentTurn, run.p.solution[run.step]);
    if (!r) return;
    run.hinted = true;
    board.select(r.move.fromX, r.move.fromY);
    $('hintButton').disabled = true;
    $('puzzleSub').textContent = `Hint: move the ${gameState[r.move.fromY][r.move.fromX].type}.${run.rated ? ' (A hint halves the rating gain.)' : ''}`;
}

function giveUp() {
    if (!run || run.done) return;
    const current = run;
    run.ready = false;
    board.setInteractive(false);
    puzzleFailed(null);
    restoreStep(run.step);
    revealRest(current);
}

// ─── RESULTS ───────────────────────────────────────────────────────────────────
function puzzleSolved() {
    run.done = true;
    board.setInteractive(false);
    flash('good');
    playTone(660, 0.09, { type: 'sine' }); playTone(880, 0.12, { type: 'sine', at: 0.09 });
    if (run.kind === 'rush') { rushResult(true); return; }
    const delta = rateResult(true);
    $('puzzleResult').textContent = run.hinted ? '✓ Solved with a hint' : '✓ Solved!';
    $('puzzleResult').className = 'puzzle-result good';
    $('puzzleCaption').textContent = 'Solved';
    $('puzzleSub').textContent = delta === null ? 'Not rated this time.' : `${delta >= 0 ? '+' : ''}${delta} rating.`;
    if (run.kind === 'daily') finishDaily(true);
    afterPuzzle();
}

function puzzleFailed(san) {
    run.done = true;
    const delta = rateResult(false);
    $('puzzleResult').textContent = san ? `✗ ${san} isn't it.` : 'Here is the solution.';
    $('puzzleResult').className = 'puzzle-result bad';
    $('puzzleCaption').textContent = san ? 'Not quite' : 'Solution';
    $('puzzleSub').textContent = `The line: ${run.p.solution.join(' ')}${delta === null ? '' : ` · ${delta} rating`}`;
    if (run.kind === 'daily') finishDaily(false);
    afterPuzzle();
}

function afterPuzzle() {
    const shown = run.p.themes.filter(t => THEME_NAMES[t] && t !== 'oneMove' && t !== 'mate');
    $('puzzleThemes').innerHTML = shown.map(t => `<span class="chip">${esc(THEME_NAMES[t])}</span>`).join('');
    $('puzzleThemes').classList.toggle('hidden', !shown.length);
    setFooter({ next: mode === 'rated' });
}

// Elo update against the puzzle's rating; returns the change, or null when unrated.
function rateResult(success) {
    if (!run.rated) return null;
    const expected = 1 / (1 + Math.pow(10, (run.p.rating - rating) / 400));
    let delta = Math.round(24 * ((success ? 1 : 0) - expected));
    if (success && run.hinted) delta = Math.round(delta / 2);
    rating = Math.max(400, Math.min(3000, rating + delta));
    if (success && !run.hinted) streak++;
    else if (!success) streak = 0;
    if (success) solvedCount++;
    if (!seenIds.includes(run.p.id)) seenIds.push(run.p.id);
    save(RATING_KEY, String(rating));
    save(STREAK_KEY, String(streak));
    save(SOLVED_KEY, String(solvedCount));
    save(DONE_KEY, seenIds);
    updateStats();
    const el = $('ratingDelta');
    el.textContent = `${delta >= 0 ? '+' : ''}${delta}`;
    el.className = 'stat-delta ' + (delta >= 0 ? 'up' : 'down');
    return delta;
}

function updateStats() {
    $('puzzleRatingValue').textContent = Math.round(rating);
    $('puzzleStreakValue').textContent = streak;
    $('puzzleSolvedValue').textContent = solvedCount;
}

function setPrompt(color, caption, sub) {
    $('promptPanel').classList.remove('hidden');
    $('turnSwatch').className = `turn-swatch ${color || 'white'}`;
    $('turnSwatch').style.visibility = color ? '' : 'hidden';
    $('puzzleCaption').textContent = caption;
    $('puzzleSub').textContent = sub;
    if (!color) $('puzzleRatingChip').classList.add('hidden');
}

function setFooter({ hint = false, giveUp = false, next = false, end = false }) {
    $('hintButton').classList.toggle('hidden', !hint);
    $('giveUpButton').classList.toggle('hidden', !giveUp);
    $('nextPuzzleButton').classList.toggle('hidden', !next);
    $('rushEndButton').classList.toggle('hidden', !end);
    $('puzzleFooter').classList.toggle('hidden', !(hint || giveUp || next || end));
}

function flash(kind) {
    const el = $('chessboard');
    el.classList.remove('flash-good', 'flash-bad');
    void el.offsetWidth; // restart the animation
    el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
    if (kind === 'bad' && navigator.vibrate) navigator.vibrate(60);
}

// ─── PUZZLE RUSH ───────────────────────────────────────────────────────────────
function rushBest() {
    return loadJSON(RUSH_KEY, { best: {}, history: [] });
}

function showRushSetup() {
    if (rush && rush.timer) return;
    const data = rushBest();
    for (const el of $('rushOptions').querySelectorAll('[data-best]')) el.textContent = data.best[el.dataset.best] || 0;
    $('rushSetup').classList.remove('hidden');
    $('rushRun').classList.add('hidden');
    $('rushEnd').classList.add('hidden');
    run = null;
    loadToken++;
    board.setInteractive(false);
    $('promptPanel').classList.add('hidden');
}

function startRush() {
    const cfg = RUSH_MODES[rushChoice];
    rush = { key: rushChoice, cfg, score: 0, strikes: 0, results: [], used: new Set(),
             endsAt: cfg.ms ? Date.now() + cfg.ms : 0, timer: null };
    $('rushSetup').classList.add('hidden');
    $('rushEnd').classList.add('hidden');
    $('rushRun').classList.remove('hidden');
    $('rushRun').classList.toggle('survival', !cfg.ms);
    renderRush();
    rush.timer = setInterval(tickRush, 200);
    nextRushPuzzle();
}

// Ever harder: the target rating climbs with the score; the pick is random
// among the three closest puzzles not used in this run.
function nextRushPuzzle() {
    const target = rush.cfg.start + rush.cfg.step * rush.score;
    const pool = allPuzzles.filter(p => !p.themes.includes('yourGames') && !rush.used.has(p.id))
        .sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target)).slice(0, 3);
    if (!pool.length) { endRush('out'); return; }
    const p = pool[Math.floor(Math.random() * pool.length)];
    rush.used.add(p.id);
    startPuzzle(p, { kind: 'rush', rated: false });
}

function rushResult(ok, san) {
    const current = run;
    run.done = true;
    rush.results.push({ p: run.p, ok });
    if (ok) {
        rush.score++;
        $('puzzleResult').textContent = '✓ Solved';
        $('puzzleResult').className = 'puzzle-result good';
    } else {
        rush.strikes++;
        $('puzzleResult').textContent = `✗ ${san} — it was ${run.p.solution[run.step]}`;
        $('puzzleResult').className = 'puzzle-result bad';
        // Briefly arrow the right move.
        restoreStep(run.step);
        const r = resolveSAN(currentTurn, run.p.solution[run.step]);
        if (r) board.setArrows([{ from: { x: r.move.fromX, y: r.move.fromY }, to: { x: r.move.toX, y: r.move.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
    }
    renderRush();
    if (rush.strikes >= RUSH_STRIKES) { setTimeout(() => endRush('strikes'), 900); return; }
    setTimeout(() => { if (rush && rush.timer && run === current) nextRushPuzzle(); }, ok ? 350 : 1100);
}

function tickRush() {
    if (!rush) return;
    if (rush.endsAt && Date.now() >= rush.endsAt) { endRush('time'); return; }
    renderRush();
}

function renderRush() {
    const clock = $('rushClock');
    if (rush.endsAt) {
        const left = Math.max(0, rush.endsAt - Date.now());
        const s = Math.ceil(left / 1000);
        clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        clock.classList.toggle('low', left <= 15000);
    } else {
        clock.textContent = 'Survival';
        clock.classList.remove('low');
    }
    $('rushScore').textContent = rush.score;
    [...$('rushStrikes').children].forEach((el, i) => el.classList.toggle('on', i < rush.strikes));
}

function endRush(reason, { silent = false } = {}) {
    if (!rush || !rush.timer) return;
    clearInterval(rush.timer);
    rush.timer = null;
    loadToken++;
    if (run) { run.done = true; run.ready = false; }
    board.setInteractive(false);
    board.setArrows([]);

    const data = rushBest();
    const prev = data.best[rush.key] || 0;
    const isBest = rush.score > prev;
    if (isBest) data.best[rush.key] = rush.score;
    data.history = [{ mode: rush.key, score: rush.score, date: todayKey() }].concat(data.history || []).slice(0, 30);
    if (rush.results.length) save(RUSH_KEY, data);
    if (silent) return;

    playTone(isBest ? 784 : 440, 0.15, { type: 'sine' });
    $('rushRun').classList.add('hidden');
    $('rushEnd').classList.remove('hidden');
    $('rushEndMode').textContent = `${rush.cfg.label} · ${{ time: 'Time\'s up', strikes: 'Three mistakes', out: 'No puzzles left', ended: 'Run ended' }[reason]}`;
    $('rushFinal').textContent = rush.score;
    $('rushFinalNote').textContent = isBest && rush.score ? '🏆 New best!' : `Best ${Math.max(prev, rush.score)}`;
    const results = $('rushResults');
    results.innerHTML = '';
    for (const r of rush.results) {
        const b = document.createElement('button');
        b.className = `rush-result ${r.ok ? 'ok' : 'bad'}`;
        b.textContent = r.p.rating;
        b.title = `${r.ok ? 'Solved' : 'Missed'} · ★ ${r.p.rating}`;
        b.addEventListener('click', () => startPuzzle(r.p, { kind: 'review', rated: false }));
        results.appendChild(b);
    }
    $('rushResults').classList.toggle('hidden', !rush.results.length);
    $('rushResultsHelp').classList.toggle('hidden', !rush.results.length);
    $('promptPanel').classList.add('hidden');
}
