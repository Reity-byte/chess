// ─── TIME MODES & PLAYER RATINGS ───────────────────────────────────────────────
// Time controls grouped into modes like chess.com's — Bullet, Blitz, Rapid, plus
// Unlimited (no clock) — and a separate Elo rating per mode, against the engine
// levels' calibrated ratings. Shared by the game page and the history page.
const TIME_MODES = [
    { id: 'bullet',    name: 'Bullet',    icon: '⚡', defaultControl: '1|0',  controls: ['1|0', '1|1', '2|1'] },
    { id: 'blitz',     name: 'Blitz',     icon: '🔥', defaultControl: '5|0',  controls: ['3|0', '3|2', '5|0', '5|3'] },
    { id: 'rapid',     name: 'Rapid',     icon: '⏱', defaultControl: '10|0', controls: ['10|0', '10|5', '15|10', '30|0'] },
    { id: 'unlimited', name: 'Unlimited', icon: '∞', defaultControl: 'unlimited', controls: ['unlimited'] },
];

// 'minutes|incrementSeconds' -> { minutes, incrementSec }; 'unlimited' -> null (no clock).
function parseTimeControl(control) {
    if (!control || control === 'unlimited') return null;
    const [minutes, incrementSec] = control.split('|').map(Number);
    return Number.isFinite(minutes) ? { minutes, incrementSec: incrementSec || 0 } : null;
}

// chess.com's rule: expected game length = base time + 40 × increment;
// under 3 minutes is bullet, under 10 blitz, otherwise rapid.
function timeModeOf(control) {
    const tc = parseTimeControl(control);
    if (!tc) return 'unlimited';
    const seconds = tc.minutes * 60 + 40 * tc.incrementSec;
    return seconds < 180 ? 'bullet' : seconds < 600 ? 'blitz' : 'rapid';
}

function timeModeName(id) {
    const mode = TIME_MODES.find(m => m.id === id);
    return mode ? mode.name : id;
}

// "3 | 2", "1 min", "No clock".
function timeControlLabel(control) {
    const tc = parseTimeControl(control);
    if (!tc) return 'No clock';
    return tc.incrementSec ? `${tc.minutes} | ${tc.incrementSec}` : `${tc.minutes} min`;
}

// "Blitz 3 | 2", "Bullet 1 min", "Unlimited".
function timeControlTitle(control) {
    const mode = timeModeOf(control);
    return mode === 'unlimited' ? timeModeName(mode) : `${timeModeName(mode)} ${timeControlLabel(control)}`;
}

// ─── RATINGS ───────────────────────────────────────────────────────────────────
const PLAYER_RATINGS_KEY = 'chessPlayerRatings';
const LEGACY_RATING_KEY = 'chessPlayerRating'; // the single rating used before modes
const DEFAULT_PLAYER_RATING = 800;
const PROVISIONAL_GAMES = 20;  // bigger rating steps until a rating has settled

// { bullet: { rating, games }, blitz: …, rapid: …, unlimited: … }. The first time
// it runs, the old single rating becomes every mode's starting point, and each
// mode's game count comes from the rated games of that mode in the history.
function loadPlayerRatings() {
    let all = null;
    try { all = JSON.parse(localStorage.getItem(PLAYER_RATINGS_KEY)); } catch (e) { all = null; }
    if (!all || typeof all !== 'object') {
        let legacy = null;
        try { legacy = JSON.parse(localStorage.getItem(LEGACY_RATING_KEY)); } catch (e) { legacy = null; }
        const start = legacy && Number.isFinite(legacy.rating) ? legacy.rating : DEFAULT_PLAYER_RATING;
        const history = typeof loadHistory === 'function' ? loadHistory() : [];
        all = {};
        for (const m of TIME_MODES) {
            const games = history.filter(g => g.rated && historyTimeMode(g) === m.id).length;
            all[m.id] = { rating: start, games };
        }
        savePlayerRatings(all);
    }
    for (const m of TIME_MODES) {
        if (!all[m.id] || !Number.isFinite(all[m.id].rating)) all[m.id] = { rating: DEFAULT_PLAYER_RATING, games: 0 };
    }
    return all;
}

function savePlayerRatings(all) {
    try { localStorage.setItem(PLAYER_RATINGS_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
}

function playerRating(mode) {
    return loadPlayerRatings()[mode] || { rating: DEFAULT_PLAYER_RATING, games: 0 };
}

function expectedScore(rating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

// Records a rated result (1 / 0.5 / 0) in `mode`; returns { before, after, delta }.
function recordRatedResult(mode, score, opponentRating) {
    const all = loadPlayerRatings();
    const r = all[mode];
    const k = r.games < PROVISIONAL_GAMES ? 40 : 20;
    const delta = Math.round(k * (score - expectedScore(r.rating, opponentRating)));
    const after = Math.max(100, r.rating + delta);
    all[mode] = { rating: after, games: r.games + 1 };
    savePlayerRatings(all);
    return { before: r.rating, after, delta: after - r.rating };
}

// "1012", or "1012?" while still provisional.
function ratingText(r) {
    return `${r.rating}${r.games < PROVISIONAL_GAMES ? '?' : ''}`;
}

// The mode of a stored history game (older entries only have the time control).
function historyTimeMode(g) {
    return g.timeMode || timeModeOf(g.timeControl || 'unlimited');
}
