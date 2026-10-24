// Engine-vs-engine match: the working tree against a git revision, alternating
// colors over a set of openings, fixed time per move. Use it after any change
// to search or evaluation to see whether the engine actually got stronger.
//
//   node tests/match.js                      20 games vs HEAD, 150 ms/move
//   node tests/match.js HEAD~1 40 300        40 games vs HEAD~1, 300 ms/move
//
// The revision must have searchRoot/findBestMove (Session 20 or later).
const { loadEngine, loadRevisionEngine, MATCH_OPENINGS, makePlayer, playGame, eloFromScore } = require('./lib');

const [rev = 'HEAD', gamesArg = '20', msArg = '150'] = process.argv.slice(2);
const GAMES = +gamesArg;
const cfg = { timeMs: +msArg, maxDepth: 64, evalNoise: 0 };

const current = makePlayer(loadEngine(), cfg);
const old = makePlayer(loadRevisionEngine(rev), cfg);
const score = { new: 0, old: 0, draw: 0 };
for (let g = 0; g < GAMES; g++) {
    const newIsWhite = g % 2 === 0;
    const opening = MATCH_OPENINGS[Math.floor(g / 2) % MATCH_OPENINGS.length];
    const r = newIsWhite ? playGame(current, old, opening) : playGame(old, current, opening);
    if (r.result === '1/2-1/2' || r.result === '*') score.draw++;
    else if ((r.result === '1-0') === newIsWhite) score.new++;
    else score.old++;
    console.log(`game ${g + 1}: new plays ${newIsWhite ? 'White' : 'Black'} — ${r.result} (${r.message}, ${r.plies} plies)   new ${score.new} / old ${score.old} / draw ${score.draw}`);
}
const points = score.new + score.draw / 2;
console.log(`\nworking tree vs ${rev}: +${score.new} -${score.old} =${score.draw}  →  ${(points / GAMES * 100).toFixed(1)}%  ` +
    `(≈ ${Math.round(eloFromScore(points, GAMES))} Elo, ±~${Math.round(700 / Math.sqrt(GAMES))} at this sample size)`);
