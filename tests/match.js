// Engine-vs-engine match: the working tree against a git revision, alternating
// colors over a set of openings, fixed time per move. Use it after any change
// to search or evaluation to see whether the engine actually got stronger.
//
//   node tests/match.js                      20 games vs HEAD, 150 ms/move
//   node tests/match.js HEAD~1 40 300        40 games vs HEAD~1, 300 ms/move
//
// Both sides must have searchRoot/findBestMove (any revision from Session 20 on).
const { loadEngine, loadRevisionEngine } = require('./lib');

const [rev = 'HEAD', gamesArg = '20', msArg = '150'] = process.argv.slice(2);
const GAMES = +gamesArg, MS = +msArg;
const OPENINGS = [
    [], ['e4', 'e5'], ['d4', 'd5'], ['e4', 'c5'], ['c4', 'e5'], ['e4', 'e6'], ['d4', 'Nf6', 'c4', 'g6'],
    ['e4', 'c6'], ['Nf3', 'd5'], ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], ['d4', 'd5', 'c4', 'e6'], ['e4', 'd5'],
];

function player(makeEngine) {
    const e = makeEngine();
    e.run('resetGame(); recordPosition(); clearSearchMemory();');
    return {
        think: () => e.run(`(() => {
            const r = findBestMove(currentTurn, ${MS}, 64, 0, []);
            const isPromo = gameState[r.move.fromY][r.move.fromX].type === 'pawn' && (r.move.toY === 0 || r.move.toY === 7);
            return moveToSAN(r.move.fromX, r.move.fromY, r.move.toX, r.move.toY, r.move.details, isPromo ? (r.promo || 'queen') : null);
        })()`),
        play: (san) => e.run(`(() => { const r = resolveSAN(currentTurn, ${JSON.stringify(san)}); if (!r) return false;
            applyMoveWithPromotion(r.move, r.promo); recordPosition(); return true; })()`),
        status: () => e.run('getGameStatus()'),
    };
}

const score = { new: 0, old: 0, draw: 0 };
for (let g = 0; g < GAMES; g++) {
    const newIsWhite = g % 2 === 0;
    const A = player(() => loadEngine()), B = player(() => loadRevisionEngine(rev));
    const sans = [];
    for (const san of OPENINGS[Math.floor(g / 2) % OPENINGS.length]) { A.play(san); B.play(san); sans.push(san); }
    let status = null;
    while (!status && sans.length < 240) {
        const mover = (sans.length % 2 === 0) === newIsWhite ? A : B;
        const san = mover.think();
        if (!A.play(san) || !B.play(san)) { status = { result: '*', message: `desync on ${san}` }; break; }
        sans.push(san);
        status = A.status();
    }
    status = status || { result: '1/2-1/2', message: 'move cap' };
    if (status.result === '1/2-1/2' || status.result === '*') score.draw++;
    else if ((status.result === '1-0') === newIsWhite) score.new++;
    else score.old++;
    console.log(`game ${g + 1}: new plays ${newIsWhite ? 'White' : 'Black'} — ${status.result} (${status.message}, ${sans.length} plies)   new ${score.new} / old ${score.old} / draw ${score.draw}`);
}
const pct = (score.new + score.draw / 2) / GAMES;
const elo = pct <= 0 ? '< -400' : pct >= 1 ? '> +400' : `${Math.round(-400 * Math.log10(1 / pct - 1))}`;
console.log(`\nworking tree vs ${rev}: +${score.new} -${score.old} =${score.draw}  →  ${(pct * 100).toFixed(1)}%  (≈ ${elo} Elo, ±~${Math.round(700 / Math.sqrt(GAMES))} at this sample size)`);
