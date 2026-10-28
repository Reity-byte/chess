// Checks the achievements (main/game/achievements.js) against a fake
// localStorage: ids are unique, nothing unlocks on an empty profile, each kind
// of progress unlocks the right badges, earned badges stay earned, and the
// first run unlocks quietly with one summary toast.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { GAME_DIR, makeChecker } = require('./lib');

function makePage(data = {}) {
    const store = { ...data };
    class Storage {
        getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }
        setItem(k, v) { store[k] = String(v); }
        removeItem(k) { delete store[k]; }
    }
    const toasts = [];
    const ctx = vm.createContext({
        console, Date, Math, JSON, Storage, setTimeout: (fn) => fn(), clearTimeout: () => {},
        location: { pathname: '/main/game/trainer.html' },
        document: { addEventListener: () => {}, querySelector: () => null, getElementById: () => null, createElement: () => ({ setAttribute() {}, appendChild() {}, classList: { add() {} } }), body: { appendChild() {} } },
    });
    ctx.localStorage = new Storage();
    for (const f of ['opening-repertoires.js', 'endgame-lessons.js', 'achievements.js']) {
        vm.runInContext(fs.readFileSync(path.join(GAME_DIR, f), 'utf8'), ctx, { filename: f });
    }
    vm.runInContext('achievementToast = (t) => __toasts.push(t);', Object.assign(ctx, { __toasts: toasts }));
    return { store, toasts, run: (code) => vm.runInContext(code, ctx) };
}

const t = makeChecker();
const ids = makePage().run('ACHIEVEMENTS.map(a => a.id)');
t.check(new Set(ids).size === ids.length, `${ids.length} achievements with unique ids`);

// Empty profile: nothing earned, first run is quiet.
{
    const p = makePage();
    const fresh = p.run('checkAchievements().length');
    t.check(fresh === 0 && p.toasts.length === 0, 'empty profile: nothing unlocks, no toast');
    t.check(!!p.store.chessAchievements, 'first run stores the (empty) unlocked set');
}

// A profile with progress everywhere.
const game = (o) => ({ id: 'g' + Math.random(), mode: 'human', playerColor: 'white', result: '1-0', plies: 40, engineRatings: { white: null, black: 1440 }, ...o });
const profile = {
    chessGameHistory: JSON.stringify([
        game({}),
        game({ playerColor: 'black', result: '0-1', engineRatings: { white: 960, black: null } }),
        game({ accuracy: { white: 92, black: 70 }, review: { white: { counts: { Brilliant: 1, Mistake: 0, Blunder: 0 } } } }),
    ]),
    chessPlayerRatings: JSON.stringify({ blitz: { rating: 1250, games: 12 } }),
    chessPuzzleSolvedCount: '40', chessPuzzleRating: '1520',
    chessPuzzleRush: JSON.stringify({ best: { 3: 16, 5: 9 } }),
    chessOpenings: JSON.stringify({ lines: { it1: { box: 5, due: '2099-01-01', reviews: 5 } } }),
    chessEndgames: JSON.stringify({ lessons: { 'm-rr': { stars: 3 }, 'r-lucena': { stars: 1 }, 'r-philidor': { stars: 2 } } }),
    chessTraining: JSON.stringify({ items: { a: { box: 1 }, b: { box: 5 } } }),
    chessDailyPlan: JSON.stringify({ completed: ['2026-10-20', '2026-10-21', '2026-10-23'] }),
};
{
    const p = makePage(profile);
    const fresh = p.run('checkAchievements().map(a => a.id)');
    const want = ['win-first', 'win-black', 'beat-1000', 'beat-1400', 'rating-1200', 'brilliant', 'accuracy-90', 'clean-win',
        'puzzle-first', 'puzzle-1500', 'rush-15', 'opening-first', 'opening-master', 'endgame-first', 'endgame-rooks', 'fix-first', 'plan-1'];
    const missing = want.filter(id => !fresh.includes(id));
    const extra = fresh.filter(id => !want.includes(id));
    t.check(!missing.length && !extra.length, `progress unlocks exactly the right badges${missing.length ? ' — missing ' + missing : ''}${extra.length ? ' — unexpected ' + extra : ''}`);
    t.check(p.toasts.length === 1 && /already earned/.test(p.toasts[0].title), 'first run: one summary toast');

    const prog = p.run('Object.fromEntries(evaluateAchievements().filter(a => a.progress).map(a => [a.id, a.progress.join("/")]))');
    t.check(prog['games-10'] === '3/10' && prog['puzzle-100'] === '40/100' && prog['plan-7'] === '2/7' && prog['opening-all'] === '1/25',
        `progress bars (${prog['games-10']}, ${prog['puzzle-100']}, ${prog['plan-7']}, ${prog['opening-all']})`);

    // New progress: a toast per new badge; a lost rating keeps its badge.
    p.store.chessPuzzleRush = JSON.stringify({ best: { 3: 31 } });
    p.store.chessPlayerRatings = JSON.stringify({ blitz: { rating: 1100, games: 20 } });
    const next = p.run('checkAchievements().map(a => a.id)');
    t.check(next.length === 1 && next[0] === 'rush-30' && p.toasts[1].title === 'Rush 30', 'a new badge gets its own toast');
    t.check(p.run('evaluateAchievements().find(a => a.id === "rating-1200").unlocked') !== null, 'earned badges stay earned');
    t.check(p.run('checkAchievements().length') === 0, 'nothing new: nothing announced');
}
t.done('achievements');
