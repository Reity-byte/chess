// Measures the ratings of the engine strength ladder (main/game/strength.js).
// Every pair of neighbouring levels plays a match (colors alternate, varied
// openings); each score becomes an Elo gap, and the gaps are summed upward from
// level 0 = ENGINE_RATING_ANCHOR, then scaled so the top level lands on
// ENGINE_RATING_TOP. Pairs run in parallel child processes; results are kept
// in tests/calibration.json (see below).
//
//   node tests/calibrate.js --fresh            measure every pair from scratch (40 games/pair)
//   node tests/calibrate.js --games 80 --write measure and write ratings back to strength.js
//   node tests/calibrate.js --pairs 0-4        only some pairs (others come from calibration.json)
//   node tests/calibrate.js --pairs 0-4 --add  play more games for those pairs, pooled with the stored ones
//   node tests/calibrate.js --pairs 0-0 --games 0 --write   just recompute ratings from calibration.json
//   node tests/calibrate.js --time 300         per-move time cap (default: ENGINE_MOVE_TIME_MS)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fork } = require('child_process');
const { GAME_DIR, loadEngine, MATCH_OPENINGS, makePlayer, playGame, eloFromScore } = require('./lib');

const STRENGTH_FILE = path.join(GAME_DIR, 'strength.js');
const strength = vm.runInNewContext(fs.readFileSync(STRENGTH_FILE, 'utf8') +
    '\n;({ ENGINE_LEVELS, ENGINE_RATING_ANCHOR, ENGINE_RATING_TOP, ENGINE_MOVE_TIME_MS })');
const LEVELS = strength.ENGINE_LEVELS;

const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
};
const GAMES = +arg('--games', 40);
const TIME = +arg('--time', strength.ENGINE_MOVE_TIME_MS);

// ─── CHILD: play one pair ─────────────────────────────────────────────────────
if (process.argv.includes('--child')) {
    const pair = +arg('--child');
    const weak = { ...LEVELS[pair], timeMs: TIME }, strong = { ...LEVELS[pair + 1], timeMs: TIME };
    const W = makePlayer(loadEngine(), weak), S = makePlayer(loadEngine(), strong);
    let points = 0, wins = 0, losses = 0, draws = 0;
    for (let g = 0; g < GAMES; g++) {
        const strongWhite = g % 2 === 0;
        const opening = MATCH_OPENINGS[Math.floor(g / 2) % MATCH_OPENINGS.length];
        const r = strongWhite ? playGame(S, W, opening) : playGame(W, S, opening);
        if (r.result === '1/2-1/2' || r.result === '*') { draws++; points += 0.5; }
        else if ((r.result === '1-0') === strongWhite) { wins++; points += 1; }
        else losses++;
    }
    process.send({ pair, points, games: GAMES, wins, losses, draws });
    process.exit(0);
}

// ─── PARENT: schedule pairs, sum the gaps ─────────────────────────────────────
// Every pair's result is stored in tests/calibration.json, keyed by both levels'
// settings, so partial runs combine: ratings are printed (and written) once
// every neighbouring pair of the current ladder has a stored result. A rerun
// replaces a pair's result; with --add its games are pooled with the stored
// ones instead (only valid while the engine itself is unchanged — after a
// search/eval change start over with --fresh).
const RESULTS_FILE = path.join(__dirname, 'calibration.json');
const [lo, hi] = (arg('--pairs', `0-${LEVELS.length - 2}`)).split('-').map(Number);
const pairs = [];
for (let i = lo; i <= Math.min(hi, LEVELS.length - 2); i++) pairs.push(i);
const jobs = +arg('--jobs', Math.max(1, Math.min(pairs.length, require('os').cpus().length - 2)));
const t0 = Date.now();

function describe(l) { return `depth ${l.maxDepth === 64 ? 'full' : l.maxDepth}, noise ${l.evalNoise}, blunder ${l.blunder || 0}`; }
const pairKey = (i) => `${describe(LEVELS[i])} → ${describe(LEVELS[i + 1])}`;

const load = () => {
    try { return JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')); } catch (e) { return {}; } // first run
};
if (process.argv.includes('--fresh') && GAMES > 0) fs.writeFileSync(RESULTS_FILE, '{}\n');
let stored = load();
const save = () => fs.writeFileSync(RESULTS_FILE, JSON.stringify(stored, null, 2) + '\n');

function runPair(i) {
    return new Promise((resolve, reject) => {
        const child = fork(__filename, ['--child', String(i), '--games', String(GAMES), '--time', String(TIME)]);
        child.on('message', (m) => {
            stored = load(); // another calibrate run may have saved meanwhile
            const prev = process.argv.includes('--add') && stored[pairKey(i)];
            const r = prev
                ? { wins: prev.wins + m.wins, losses: prev.losses + m.losses, draws: prev.draws + m.draws, games: prev.games + m.games }
                : { wins: m.wins, losses: m.losses, draws: m.draws, games: m.games };
            stored[pairKey(i)] = r;
            save();
            console.log(`pair ${i}→${i + 1} (${pairKey(i)}): stronger +${m.wins} -${m.losses} =${m.draws}` +
                `  → ${Math.round(eloFromScore(m.points, m.games))} Elo` +
                (prev ? `; pooled +${r.wins} -${r.losses} =${r.draws} → ${Math.round(gapOf(r))} Elo` : '') +
                `  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
        });
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pair ${i} exited with ${code}`)));
    });
}

const gapOf = (r) => eloFromScore(r.wins + r.draws / 2, r.games);

(async () => {
    if (GAMES > 0) console.log(`Calibrating ${pairs.length} pair(s), ${GAMES} games each, ${TIME} ms/move, ${jobs} in parallel…`);
    const queue = GAMES > 0 ? pairs.slice() : [];
    await Promise.all(Array.from({ length: jobs }, async () => {
        while (queue.length) await runPair(queue.shift());
    }));

    stored = load();
    const missing = LEVELS.slice(0, -1).map((_, i) => i).filter(i => !stored[pairKey(i)]);
    if (missing.length) {
        console.log(`\nNo stored result yet for pair(s) ${missing.join(', ')} — ratings not computed.`);
        return;
    }
    // Self-play between versions of one engine exaggerates rating gaps, so the
    // measured chain is scaled to run from the bottom anchor to the top one.
    const raw = [0];
    for (let i = 0; i < LEVELS.length - 1; i++) raw.push(raw[i] + Math.max(0, gapOf(stored[pairKey(i)])));
    const bottom = strength.ENGINE_RATING_ANCHOR, top = strength.ENGINE_RATING_TOP;
    const scale = (top - bottom) / raw[raw.length - 1];
    const ratings = raw.map(r => bottom + r * scale);
    console.log(`\nlevel  settings                                 games  gap   raw   rating   (gaps × ${scale.toFixed(2)})`);
    LEVELS.forEach((l, i) => {
        const r = i ? stored[pairKey(i - 1)] : null;
        console.log(`${String(i).padStart(5)}  ${describe(l).padEnd(40)} ${String(r ? r.games : '').padStart(5)}  ${String(r ? Math.round(gapOf(r)) : '').padStart(4)}  ` +
            `${String(Math.round(bottom + raw[i])).padStart(4)}  ${String(Math.round(ratings[i])).padStart(6)}`);
    });

    if (process.argv.includes('--write')) {
        let i = 0;
        const src = fs.readFileSync(STRENGTH_FILE, 'utf8').replace(/\{ rating: \d+,(\s*)/g, (_, sp) => {
            const r = Math.round(ratings[i++] / 10) * 10;
            return `{ rating: ${String(r)},${' '.repeat(Math.max(1, 5 - String(r).length))}`;
        });
        fs.writeFileSync(STRENGTH_FILE, src);
        console.log(`\nWrote ${i} ratings to main/game/strength.js`);
    }
})();
