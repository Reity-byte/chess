// Search speed benchmark: fixed-depth searches on a set of positions, best of N
// runs (this machine's timings are noisy). Compare against an older version
// with --rev (any git revision whose ai.js has searchRoot).
//
//   node tests/bench.js                 depth 7, 3 runs, working tree
//   node tests/bench.js 8 2             depth 8, 2 runs
//   node tests/bench.js 6 3 --rev HEAD  the last commit instead
const { loadEngine, loadRevisionEngine } = require('./lib');

const args = process.argv.slice(2);
const revIdx = args.indexOf('--rev');
const rev = revIdx >= 0 ? args.splice(revIdx, 2)[1] : null;
const depth = +(args[0] || 7), reps = +(args[1] || 3);

const POSITIONS = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1',
    'r2q1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 0 1',
    '8/5pk1/6p1/8/3K4/8/5PPP/8 w - - 0 1',
];

const { run } = rev ? loadRevisionEngine(rev) : loadEngine();
let best = Infinity, nodes = 0;
for (let r = 0; r < reps; r++) {
    let total = 0;
    nodes = 0;
    for (const fen of POSITIONS) {
        run(`__loadFEN(${JSON.stringify(fen)}); clearSearchMemory();`);
        const t0 = performance.now();
        nodes += run(`searchRoot(currentTurn, { timeMs: 1e9, maxDepth: ${depth} }); nodeCount`);
        total += performance.now() - t0;
    }
    best = Math.min(best, total);
}
console.log(`${rev || 'working tree'} — depth ${depth}: ${best.toFixed(0)} ms, ${nodes} nodes, ${(nodes / best).toFixed(0)} nodes/ms (best of ${reps})`);
