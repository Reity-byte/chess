// ─── GAME HISTORY STORE ────────────────────────────────────────────────────────
// Finished games kept in localStorage (newest last, capped). Written by the game
// page when a game ends, enriched by the review page (accuracy, error types),
// and read by the history page.
const HISTORY_KEY = 'chessGameHistory';
const HISTORY_CAP = 300;

function loadHistory() {
    try {
        const list = JSON.parse(localStorage.getItem(HISTORY_KEY));
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveHistory(list) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_CAP)));
        return true;
    } catch (e) {
        return false; // storage full or unavailable — history is best-effort
    }
}

// Adds a finished game and returns its id.
function addGameToHistory(record) {
    const list = loadHistory();
    const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    list.push({ id, date: new Date().toISOString(), ...record });
    saveHistory(list);
    return id;
}

// Merges `fields` into the stored game `id` (no-op if it's gone).
function updateHistoryGame(id, fields) {
    const list = loadHistory();
    const game = list.find(g => g.id === id);
    if (!game) return;
    Object.assign(game, fields);
    saveHistory(list);
}
