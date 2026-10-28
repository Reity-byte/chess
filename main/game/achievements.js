// ─── ACHIEVEMENTS ──────────────────────────────────────────────────────────────
// Badges for milestones across the site, worked out from the progress every
// trainer already stores (game history, puzzle and Rush records, opening and
// endgame progress, training positions, Today's plan) — nothing new to record.
//
// Loaded on every page, after opening-repertoires.js and endgame-lessons.js
// (without them the opening / endgame badges can't be judged and stay locked
// on that page). After any chess* localStorage write it re-checks (a
// moment later, once) and announces new badges with a toast that links to the
// achievements page. The first run ever unlocks what you already earned
// quietly, with one summary toast.
//
// localStorage['chessAchievements'] = { unlocked: { [id]: ISO date } }
// Achievement ids are stored — never rename them.
const ACHIEVEMENTS_KEY = 'chessAchievements';

const ACHIEVEMENT_GROUPS = [
    { id: 'play', name: 'Playing' },
    { id: 'puzzles', name: 'Puzzles' },
    { id: 'openings', name: 'Openings' },
    { id: 'endgames', name: 'Endgames' },
    { id: 'training', name: 'Training habits' },
];

// check(ctx) -> true/false, or [current, goal] for a progress bar.
const ACHIEVEMENTS = [
    { id: 'win-first',   group: 'play', icon: '♔', name: 'First win', desc: 'Beat the engine at any level.', check: (c) => c.wins.length > 0 },
    { id: 'win-black',   group: 'play', icon: '♚', name: 'Dark side', desc: 'Win a game with Black.', check: (c) => c.wins.some(g => g.playerColor === 'black') },
    { id: 'beat-1000',   group: 'play', icon: '🥉', name: 'Novice no more', desc: 'Beat the engine at ≈ 950 or stronger.', check: (c) => c.bestWin >= 950 },
    { id: 'beat-1400',   group: 'play', icon: '🥈', name: 'Club strength', desc: 'Beat the engine at ≈ 1400 or stronger.', check: (c) => c.bestWin >= 1400 },
    { id: 'beat-1800',   group: 'play', icon: '🥇', name: 'Expert slayer', desc: 'Beat the engine at ≈ 1800 or stronger.', check: (c) => c.bestWin >= 1800 },
    { id: 'beat-max',    group: 'play', icon: '👑', name: 'Beat the machine', desc: 'Beat the engine at full strength.', check: (c) => c.bestWin >= 2300 },
    { id: 'games-10',    group: 'play', icon: '♟', name: 'Regular', desc: 'Play 10 games against the engine.', check: (c) => [c.games.length, 10] },
    { id: 'games-50',    group: 'play', icon: '♜', name: 'Seasoned', desc: 'Play 50 games against the engine.', check: (c) => [c.games.length, 50] },
    { id: 'rating-1200', group: 'play', icon: '📈', name: 'Rated 1200', desc: 'Reach a 1200 rating in any time mode.', check: (c) => [c.bestRating, 1200] },
    { id: 'rating-1500', group: 'play', icon: '🚀', name: 'Rated 1500', desc: 'Reach a 1500 rating in any time mode.', check: (c) => [c.bestRating, 1500] },
    { id: 'brilliant',   group: 'play', icon: '💎', name: 'Brilliant!', desc: 'Play a move the review rates Brilliant.', check: (c) => c.reviewed.some(g => (c.counts(g).Brilliant || 0) > 0) },
    { id: 'accuracy-90', group: 'play', icon: '🎯', name: 'Sharpshooter', desc: 'Play a game of 15+ moves with 90% accuracy or more.', check: (c) => c.reviewed.some(g => g.plies >= 30 && g.accuracy[g.playerColor] >= 90) },
    { id: 'clean-win',   group: 'play', icon: '🧼', name: 'Clean win', desc: 'Win a reviewed game of 15+ moves without a mistake or blunder.',
      check: (c) => c.reviewed.some(g => c.score(g) === 1 && g.plies >= 30 && !c.counts(g).Mistake && !c.counts(g).Blunder) },

    { id: 'puzzle-first', group: 'puzzles', icon: '🧩', name: 'First puzzle', desc: 'Solve a rated puzzle.', check: (c) => c.puzzlesSolved > 0 },
    { id: 'puzzle-100',   group: 'puzzles', icon: '💯', name: 'Puzzle hundred', desc: 'Solve 100 rated puzzles.', check: (c) => [c.puzzlesSolved, 100] },
    { id: 'puzzle-1500',  group: 'puzzles', icon: '🧠', name: 'Tactician', desc: 'Reach a 1500 puzzle rating.', check: (c) => [c.puzzleRating, 1500] },
    { id: 'puzzle-2000',  group: 'puzzles', icon: '🔮', name: 'Puzzle master', desc: 'Reach a 2000 puzzle rating.', check: (c) => [c.puzzleRating, 2000] },
    { id: 'rush-15',      group: 'puzzles', icon: '⚡', name: 'Rush 15', desc: 'Score 15 in any Puzzle Rush mode.', check: (c) => [c.rushBest, 15] },
    { id: 'rush-30',      group: 'puzzles', icon: '🌩', name: 'Rush 30', desc: 'Score 30 in any Puzzle Rush mode.', check: (c) => [c.rushBest, 30] },
    { id: 'daily-7',      group: 'puzzles', icon: '📅', name: 'Daily habit', desc: 'Solve the daily puzzle 7 days in a row.', check: (c) => [c.dailyStreak, 7] },

    { id: 'opening-first', group: 'openings', icon: '♞', name: 'First line', desc: 'Learn an opening line in the opening trainer.', check: (c) => c.linesLearned > 0 },
    { id: 'opening-master', group: 'openings', icon: '⭐', name: 'By heart', desc: 'Master an opening line (four clean reviews).', check: (c) => c.linesMastered > 0 },
    { id: 'opening-rep',   group: 'openings', icon: '📖', name: 'Repertoire', desc: 'Learn every line of one repertoire.', check: (c) => c.bestRepertoire },
    { id: 'opening-all',   group: 'openings', icon: '📚', name: 'Opening book', desc: 'Learn every line in the opening trainer.', check: (c) => c.linesTotal > 0 && [c.linesLearned, c.linesTotal] },

    { id: 'endgame-first', group: 'endgames', icon: '♚', name: 'Endgame student', desc: 'Solve an endgame lesson.', check: (c) => c.lessonsSolved > 0 },
    { id: 'endgame-mates', group: 'endgames', icon: '♛', name: 'Mating technique', desc: 'Solve every basic checkmate except bishop and knight.', check: (c) => c.solvedAll(l => l.chapter === 'mates' && !l.expert) },
    { id: 'endgame-bn',    group: 'endgames', icon: '♝', name: 'Bishop and knight', desc: 'Mate with bishop and knight — the hardest basic mate.', check: (c) => c.solvedAll(l => l.id === 'm-bn') },
    { id: 'endgame-rooks', group: 'endgames', icon: '♜', name: 'Lucena and Philidor', desc: 'Solve both rook endgame lessons.', check: (c) => c.solvedAll(l => l.chapter === 'rooks') },
    { id: 'endgame-stars', group: 'endgames', icon: '🌟', name: 'Three stars everywhere', desc: 'Get three stars on every endgame lesson.', check: (c) => c.endgameStarsTotal > 0 && [c.endgameStars, c.endgameStarsTotal] },

    { id: 'fix-first',   group: 'training', icon: '🔧', name: 'Fixer', desc: 'Fix a position from one of your games.', check: (c) => c.positionsFixed > 0 },
    { id: 'fix-10',      group: 'training', icon: '🏅', name: 'Lessons learned', desc: 'Master 10 positions from your games.', check: (c) => [c.positionsMastered, 10] },
    { id: 'plan-1',      group: 'training', icon: '✅', name: 'Plan complete', desc: 'Finish Today\'s plan.', check: (c) => c.planDays > 0 },
    { id: 'plan-7',      group: 'training', icon: '🔥', name: 'Week of training', desc: 'Finish Today\'s plan 7 days in a row.', check: (c) => [c.planBestRun, 7] },
];

function achRead(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

// Everything the checks look at, read once.
function achievementContext() {
    const history = achRead('chessGameHistory', []);
    const games = (Array.isArray(history) ? history : []).filter(g => g && g.mode === 'human' && g.playerColor);
    const score = (g) => (g.result === '1/2-1/2' ? 0.5 : (g.result === '1-0') === (g.playerColor === 'white') ? 1 : 0);
    const wins = games.filter(g => score(g) === 1 && g.result !== '*');
    const opp = (g) => (g.engineRatings ? g.engineRatings[g.playerColor === 'white' ? 'black' : 'white'] : null) || 0;
    const reviewed = games.filter(g => g.accuracy && typeof g.accuracy[g.playerColor] === 'number');
    const ratings = achRead('chessPlayerRatings', {}) || {};

    const rush = (achRead('chessPuzzleRush', {}) || {}).best || {};
    const daily = achRead('chessPuzzleDaily', {}) || {};
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const yesterday = dayKey(new Date(Date.now() - 86400000));
    const dailyStreak = daily.lastSolved === dayKey(new Date()) || daily.lastSolved === yesterday ? daily.streak || 0 : 0;

    const lines = (achRead('chessOpenings', {}) || {}).lines || {};
    const reps = typeof OPENING_REPERTOIRES !== 'undefined' ? OPENING_REPERTOIRES : [];
    const lessons = (achRead('chessEndgames', {}) || {}).lessons || {};
    const egList = typeof ENDGAME_LESSONS !== 'undefined' ? ENDGAME_LESSONS : [];
    const stars = (l) => (lessons[l.id] && lessons[l.id].stars) || 0;
    const items = Object.values((achRead('chessTraining', {}) || {}).items || {});

    // Longest run of consecutive days with Today's plan done.
    const done = [...new Set((achRead('chessDailyPlan', {}) || {}).completed || [])].sort();
    let run = 0, bestRun = 0, prev = null;
    for (const d of done) {
        const t = Date.parse(d + 'T12:00:00');
        run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
        bestRun = Math.max(bestRun, run);
        prev = t;
    }

    return {
        games, wins, reviewed, score,
        bestWin: wins.reduce((m, g) => Math.max(m, opp(g)), 0),
        counts: (g) => (g.review && g.review[g.playerColor] && g.review[g.playerColor].counts) || {},
        bestRating: Object.values(ratings).reduce((m, r) => Math.max(m, (r && r.games ? r.rating : 0) || 0), 0),
        puzzlesSolved: Number(achRead('chessPuzzleSolvedCount', 0)) || 0,
        puzzleRating: Math.round(Number(achRead('chessPuzzleRating', 0)) || 0),
        rushBest: Math.max(0, ...Object.values(rush).map(Number).filter(Number.isFinite)),
        dailyStreak,
        linesLearned: Object.keys(lines).length,
        linesMastered: Object.values(lines).filter(r => r.box >= 5).length,
        linesTotal: reps.reduce((n, r) => n + r.lines.length, 0),
        bestRepertoire: reps.some(r => r.lines.every(l => lines[l.id])),
        lessonsSolved: egList.filter(l => stars(l) > 0).length,
        solvedAll: (pred) => { const ls = egList.filter(pred); return ls.length > 0 && ls.every(l => stars(l) > 0); },
        endgameStars: egList.reduce((n, l) => n + stars(l), 0),
        endgameStarsTotal: egList.length * 3,
        positionsFixed: items.filter(r => r.box >= 1).length,
        positionsMastered: items.filter(r => r.box >= 5).length,
        planDays: done.length,
        planBestRun: bestRun,
    };
}

// [{ ...achievement, unlocked: ISO date | null, progress: [cur, goal] | null }]
function evaluateAchievements() {
    const ctx = achievementContext();
    const store = achRead(ACHIEVEMENTS_KEY, {}) || {};
    const unlocked = store.unlocked || {};
    return ACHIEVEMENTS.map(a => {
        let r = false;
        try { r = a.check(ctx); } catch (e) { r = false; }
        const progress = Array.isArray(r) ? [Math.min(r[0], r[1]), r[1]] : null;
        const met = Array.isArray(r) ? r[0] >= r[1] : !!r;
        return { ...a, met, progress, unlocked: unlocked[a.id] || null };
    });
}

// Unlocks what's newly earned and announces it. Earned badges stay earned
// (a rating can drop again; the badge doesn't).
function checkAchievements() {
    const store = achRead(ACHIEVEMENTS_KEY, null);
    const first = !store || !store.unlocked;
    const unlocked = (store && store.unlocked) || {};
    const fresh = evaluateAchievements().filter(a => a.met && !unlocked[a.id]);
    if (!fresh.length && !first) return [];
    const now = new Date().toISOString();
    for (const a of fresh) unlocked[a.id] = now;
    achWriting = true;
    try { localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify({ unlocked })); } catch (e) { /* try again next time */ }
    achWriting = false;
    if (first) {
        if (fresh.length) achievementToast({ icon: '🏆', title: `${fresh.length} achievement${fresh.length === 1 ? '' : 's'} already earned`, sub: 'Tap to see them all' });
    } else {
        fresh.slice(0, 3).forEach((a, i) => setTimeout(() => achievementToast({ icon: a.icon, title: a.name, sub: 'Achievement unlocked' }), i * 900));
        if (fresh.length > 3) setTimeout(() => achievementToast({ icon: '🏆', title: `+${fresh.length - 3} more`, sub: 'Achievements unlocked' }), 3 * 900);
    }
    if (typeof onAchievementsChanged === 'function') onAchievementsChanged();
    return fresh;
}

function achievementsPageHref() {
    return /\/game\//.test(location.pathname) ? 'achievements.html' : 'game/achievements.html';
}

function achievementToast({ icon, title, sub }) {
    let host = document.querySelector('.ach-toasts');
    if (!host) {
        host = document.createElement('div');
        host.className = 'ach-toasts';
        host.setAttribute('role', 'status');
        document.body.appendChild(host);
    }
    const t = document.createElement('a');
    t.className = 'ach-toast';
    t.href = achievementsPageHref();
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    t.innerHTML = `<span class="ach-toast-icon">${esc(icon)}</span><span class="ach-toast-text"><span>${esc(sub)}</span><strong>${esc(title)}</strong></span>`;
    host.appendChild(t);
    try { if (typeof playTone === 'function') { playTone(784, 0.08, { type: 'sine' }); playTone(1047, 0.14, { type: 'sine', at: 0.08 }); } } catch (e) { /* no sound */ }
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 4200);
}

// Re-check shortly after progress is saved anywhere on the page.
// Saved often and never part of a badge: no re-check for these.
const ACH_IGNORED_KEYS = new Set([ACHIEVEMENTS_KEY, 'chessAnalysisCache', 'chessInProgressGame', 'chessGameForAnalysis']);
let achTimer = null;
let achWriting = false;
(function watchProgress() {
    if (typeof Storage === 'undefined') return;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
        original.call(this, key, value);
        if (!achWriting && String(key).startsWith('chess') && !ACH_IGNORED_KEYS.has(key)) {
            clearTimeout(achTimer);
            achTimer = setTimeout(checkAchievements, 700);
        }
    };
})();
document.addEventListener('DOMContentLoaded', () => setTimeout(checkAchievements, 400));

// ─── ACHIEVEMENTS PAGE (achievements.html) ─────────────────────────────────────
function renderAchievementsPage() {
    const wrap = document.getElementById('achievementGroups');
    if (!wrap) return;
    const all = evaluateAchievements();
    const got = all.filter(a => a.unlocked).length;
    document.getElementById('achCount').textContent = `${got} of ${all.length}`;
    document.getElementById('achFill').style.width = `${Math.round(100 * got / all.length)}%`;
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    wrap.innerHTML = ACHIEVEMENT_GROUPS.map(g => {
        const list = all.filter(a => a.group === g.id);
        const n = list.filter(a => a.unlocked).length;
        return `<section class="ach-group"><h2>${esc(g.name)} <span class="muted">${n}/${list.length}</span></h2><div class="ach-grid">${list.map(a => {
            const date = a.unlocked ? new Date(a.unlocked).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            const bar = !a.unlocked && a.progress ? `<div class="ach-progress"><div style="width:${Math.round(100 * a.progress[0] / a.progress[1])}%"></div></div><span class="ach-progress-text">${a.progress[0]} / ${a.progress[1]}</span>` : '';
            return `<div class="panel ach-card${a.unlocked ? ' unlocked' : ''}">
                <span class="ach-icon">${esc(a.icon)}</span>
                <div class="ach-body"><strong>${esc(a.name)}</strong><span>${esc(a.desc)}</span>${a.unlocked ? `<span class="ach-date">✓ ${esc(date)}</span>` : bar}</div>
            </div>`;
        }).join('')}</div></section>`;
    }).join('');
}
