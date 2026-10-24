// Game Analysis Engine regression test: runs the real analysis-worker.js on
// games whose key moments are well known and checks the classifications.
// Searches are time-limited, so checks are deliberately about clear-cut moves.
//
//   node tests/analysis.js            (Standard mode, ~30 s)
//   node tests/analysis.js deep       (Deep mode, slower)
const { loadAnalysisWorker, sanList, makeChecker } = require('./lib');

const mode = process.argv[2] || 'standard';
const worker = loadAnalysisWorker();
const t = makeChecker();
const ERRORS = ['Inaccuracy', 'Mistake', 'Miss', 'Blunder'];
const at = (report, san) => report.perMove.find(m => m.san === san);

// ── Morphy's Opera Game (1858) ────────────────────────────────────────────────
console.log(`Opera Game (${mode})`);
let t0 = Date.now();
const opera = worker.analyze(sanList(
    '1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 ' +
    '10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8#'), mode);
console.log(`  (${Date.now() - t0} ms, avg depth ${opera.avgDepth})`);
const brilliant = opera.perMove.filter(m => m.category === 'Brilliant').map(m => m.san);
t.check(opera.opening === 'Philidor Defense', `opening identified: ${opera.opening}`);
t.check(at(opera, 'e4').category === 'Book' && at(opera, 'Nf3').category === 'Book', 'opening moves are Book');
t.check(brilliant.includes('Qb8+'), `16.Qb8+ (queen sacrifice into mate) is Brilliant — brilliant: [${brilliant}]`);
t.check(!brilliant.includes('Nxb5'), `10.Nxb5 is not Brilliant (material comes back: ${at(opera, 'Nxb5').category})`);
t.check(brilliant.every(s => s === 'Rxd7' || s === 'Qb8+'), 'only 13.Rxd7 / 16.Qb8+ may be Brilliant');
t.check(at(opera, 'Nxb8').category === 'Forced', '16...Nxb8 is Forced');
t.check(at(opera, 'Rd8#').category === 'Best', '17.Rd8# is Best');
t.check(ERRORS.includes(at(opera, 'Qe6').category), `14...Qe6 is an error (${at(opera, 'Qe6').category})`);
t.check(opera.accuracy.white > opera.accuracy.black, `White more accurate (${opera.accuracy.white} vs ${opera.accuracy.black})`);
t.check(opera.perMove.every(m => typeof m.evalAfter === 'number' && m.category), 'every move has an eval and a category');
t.check(opera.perMove[opera.perMove.length - 1].evalAfter >= 99000, 'final position scored as mate for White');
t.check(!/fork/i.test(at(opera, 'Bxd7+').reason || '') && !at(opera, 'Rd8#').reason,
    `no false forks: 15.Bxd7+ "${at(opera, 'Bxd7+').reason}", 17.Rd8# "${at(opera, 'Rd8#').reason}"`);

// ── Same game through the parallel (range + finalize) path ────────────────────
console.log("\nOpera Game in ranges of 5 (the review page's parallel path)");
t0 = Date.now();
const ranged = worker.analyzeInRanges(sanList(
    '1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 ' +
    '10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8#'), mode);
console.log(`  (${Date.now() - t0} ms)`);
t.check(ranged.perMove.length === opera.perMove.length && ranged.perMove.every((m, i) => m.ply === i), 'every move present, in order');
t.check(ranged.startEval !== null && ranged.opening === 'Philidor Defense', 'start eval and opening carried over');
t.check(at(ranged, 'Qb8+').category === 'Brilliant' && !['Brilliant'].includes(at(ranged, 'Nxb5').category), 'Brilliant verdicts match');
t.check(at(ranged, 'Nxb8').category === 'Forced' && at(ranged, 'Rd8#').category === 'Best', 'Forced / mate verdicts match');
t.check(ERRORS.includes(at(ranged, 'Qe6').category), `14...Qe6 still an error (${at(ranged, 'Qe6').category})`);
t.check(Math.abs(ranged.accuracy.white - opera.accuracy.white) < 6 && ranged.accuracy.white > ranged.accuracy.black,
    `accuracy consistent (${ranged.accuracy.white} vs ${ranged.accuracy.black}; sequential ${opera.accuracy.white})`);

// ── Fool's Mate ───────────────────────────────────────────────────────────────
console.log("\nFool's Mate");
const fool = worker.analyze(['f3', 'e5', 'g4', 'Qh4#'], mode);
t.check(at(fool, 'g4').category === 'Blunder', `2.g4 is a Blunder (${at(fool, 'g4').category})`);
t.check(at(fool, 'Qh4#').category === 'Best', `2...Qh4# is Best (${at(fool, 'Qh4#').category})`);
t.check(fool.accuracy.black > fool.accuracy.white, `Black more accurate (${fool.accuracy.black} vs ${fool.accuracy.white})`);
t.check(at(fool, 'g4').motif === 'allowsMate' && /mate in 1/.test(at(fool, 'g4').reason), `2.g4 explained: "${at(fool, 'g4').reason}"`);

// ── Explanations ──────────────────────────────────────────────────────────────
console.log('\nExplanations');
const hang = worker.analyze(['e4', 'e5', 'Qh5', 'Nc6', 'Qxe5+', 'Nxe5'], mode);
t.check(at(hang, 'Qxe5+').motif === 'hangs' && /queen on e5/.test(at(hang, 'Qxe5+').reason), `3.Qxe5+ explained: "${at(hang, 'Qxe5+').reason}"`);
const forks = worker.run(`(() => {
    replaySANFromStart('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7'.split(' '));
    return forkTargets(5, 1);
})()`);
t.check(forks.includes('queen') && forks.includes('rook'), `knight on f7 forks queen and rook (found: ${forks.join(', ')})`);
const fried = worker.analyze('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7'.split(' '), mode);
t.check(at(fried, 'Nxf7').category === 'Book' && !at(fried, 'Nxf7').reason, `book sacrifice 6.Nxf7 not "explained" (${at(fried, 'Nxf7').reason})`);

// ── Judging single moves (used by "Retry mistakes") ───────────────────────────
console.log('\nJudge');
const mate = worker.judge(['f3', 'e5', 'g4'], { fromX: 3, fromY: 0, toX: 7, toY: 4, details: { x: 7, y: 4 } });
t.check(mate.category === 'Best', `Qh4# judged Best (${mate.category})`);
const quiet = worker.judge(['f3', 'e5', 'g4'], { fromX: 0, fromY: 1, toX: 0, toY: 2, details: { x: 0, y: 2 } });
t.check(ERRORS.includes(quiet.category) && quiet.bestSan === 'Qh4#', `...a6 judged an error, best Qh4# (${quiet.category}, best ${quiet.bestSan})`);

t.done('analysis');
