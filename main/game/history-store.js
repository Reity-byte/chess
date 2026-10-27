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

// The headline numbers of a finished review (analysis-worker report) as stored
// on a history game: accuracy (overall and by phase), and per side the category
// counts, the kinds of mistakes made (motifs of moves that cost at least 5%
// winning chances) and the mistakes themselves (for the Trainer's practice list).
const MISTAKE_CATEGORIES = ['Mistake', 'Miss', 'Blunder'];

function reviewHistoryFields(report) {
    const side = (color) => {
        const motifs = {};
        const mistakes = [];
        for (const m of report.perMove) {
            if (m.color !== color) continue;
            if (m.motif && m.winLoss >= 5) motifs[m.motif] = (motifs[m.motif] || 0) + 1;
            if (MISTAKE_CATEGORIES.includes(m.category) && m.bestMove) {
                mistakes.push({
                    ply: m.ply, san: m.san, category: m.category, motif: m.motif || null, reason: m.reason || null, winLoss: m.winLoss,
                    best: m.bestMove.san, line: (m.bestLine || []).slice(0, 6),
                });
            }
        }
        return { counts: report.counts[color], motifs, mistakes };
    };
    return {
        accuracy: report.accuracy, phaseAccuracy: report.phaseAccuracy || null, reviewMode: report.mode,
        review: { white: side('white'), black: side('black') },
    };
}

// Hands a stored game to the review page and goes there. `extra` may ask it to
// start Retry mistakes ({ retry: true, retryPly }).
function openGameReview(g, extra = {}) {
    const plainName = (n) => /^You\b/.test(n || '') ? 'You' : n;
    try {
        localStorage.setItem('chessGameForAnalysis', JSON.stringify({
            sanMoves: g.sanMoves, white: plainName(g.white), black: plainName(g.black), result: g.result, historyId: g.id, ...extra,
        }));
    } catch (e) { return; }
    location.href = 'analysis.html';
}

// Merges `fields` into the stored game `id` (no-op if it's gone).
function updateHistoryGame(id, fields) {
    const list = loadHistory();
    const game = list.find(g => g.id === id);
    if (!game) return;
    Object.assign(game, fields);
    saveHistory(list);
}
