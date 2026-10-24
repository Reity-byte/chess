// Measures the ratings of the engine strength ladder (main/game/strength.js).
// Every pair of neighbouring levels plays a match (colors alternate, varied
// openings); each score becomes an Elo gap, and the gaps are summed upward from
// level 0 = ENGINE_RATING_ANCHOR. Pairs run in parallel child processes.
//
//   node tests/calibrate.js                    measure and print (40 games/pair)
//   node tests/calibrate.js --games 80 --write measure and write ratings back to strength.js
//   node tests/calibrate.js --pairs 0-4        only some pairs (prints their gaps)
//   node tests/calibrate.js --time 300         per-move time cap (default: ENGINE_MOVE_TIME_MS)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fork } = require('child_process');
const { GAME_DIR, loadEngine, MATCH_OPENINGS, makePlayer, playGame, eloFromScore } = require('./lib');

const STRENGTH_FILE = path.join(GAME_DIR, 'strength.js');
const strength = vm.runInNewContext(fs.readFileSync(STRENGTH_FILE, 'utf8') +
    '\n;({ ENGINE_LEVELS, ENGINE_RATING_ANCHOR, ENGINE_MOVE_TIME_MS })');
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
const [lo, hi] = (arg('--pairs', `0-${LEVELS.length - 2}`)).split('-').map(Number);
const pairs = [];
for (let i = lo; i <= Math.min(hi, LEVELS.length - 2); i++) pairs.push(i);
const jobs = +arg('--jobs', Math.max(1, Math.min(pairs.length, require('os').cpus().length - 2)));
const results = {};
const t0 = Date.now();

function describe(l) { return `depth ${l.maxDepth === 64 ? 'full' : l.maxDepth}, noise ${l.evalNoise}`; }

function runPair(i) {
    return new Promise((resolve, reject) => {
        const child = fork(__filename, ['--child', String(i), '--games', String(GAMES), '--time', String(TIME)]);
        child.on('message', (m) => {
            results[i] = m;
            console.log(`pair ${i}→${i + 1} (${describe(LEVELS[i])} vs ${describe(LEVELS[i + 1])}): stronger +${m.wins} -${m.losses} =${m.draws}` +
                `  → ${Math.round(eloFromScore(m.points, m.games))} Elo  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
        });
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`pair ${i} exited with ${code}`)));
    });
}

(async () => {
    console.log(`Calibrating ${pairs.length} pair(s), ${GAMES} games each, ${TIME} ms/move, ${jobs} in parallel…`);
    const queue = pairs.slice();
    await Promise.all(Array.from({ length: jobs }, async () => {
        while (queue.length) await runPair(queue.shift());
    }));

    if (lo !== 0 || pairs.length !== LEVELS.length - 1) return; // partial run: gaps only
    const ratings = [strength.ENGINE_RATING_ANCHOR];
    for (let i = 0; i < LEVELS.length - 1; i++) {
        ratings.push(ratings[i] + Math.max(0, eloFromScore(results[i].points, results[i].games)));
    }
    console.log('\nlevel  settings                 rating');
    LEVELS.forEach((l, i) => console.log(`${String(i).padStart(5)}  ${describe(l).padEnd(24)} ${Math.round(ratings[i])}`));

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
