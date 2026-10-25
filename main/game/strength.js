// ─── ENGINE STRENGTH LADDER ────────────────────────────────────────────────────
// Each level is a set of search settings plus a rating (see searchRoot and
// findBestMove in ai.js). Weaker levels are weak in two ways, like people:
//   evalNoise – centipawn jitter on each candidate move's score: small,
//               positional imprecision. Kept modest — on its own, large noise
//               made the engine drift aimlessly in quiet openings and endgames
//               yet never hang a piece, so it felt toothless early and
//               merciless once tactics appeared.
//   blunder   – the chance a move is a careless one: the engine overlooks some
//               of its options and looks only about half as deep, so it hangs
//               pieces, walks into forks and misses free captures.
// Depth-limited levels also search 1–2 plies deeper in endgames, where a
// shallow horizon would otherwise make them clearly weaker than in the
// middlegame.
//
// The ratings are MEASURED, not guessed: tests/calibrate.js plays every pair
// of neighbouring levels against each other and turns each score into an Elo
// gap; the gaps are summed upward from level 0. Self-play only measures
// strength *relative* to the other levels, and between versions of one engine
// it exaggerates the gaps, so the chain is scaled to run from
// ENGINE_RATING_ANCHOR to ENGINE_RATING_TOP. Both ends are judgement calls —
// the UI shows the numbers as approximate ("≈ 1350"). Re-run the calibration
// after changing the search or evaluation:
//   node tests/calibrate.js --fresh --games 100 --write
const ENGINE_RATING_ANCHOR = 400;  // level 0 (scored even with the previous ladder's 400 level)
const ENGINE_RATING_TOP = 2300;    // the full-strength level (as before)
const ENGINE_MOVE_TIME_MS = 1500;  // per-move time cap (untimed games); the deepest level uses all of it

// Calibrated 2026-10-25: 100 games per neighbouring pair (80 for the top one)
// at 1500 ms/move, results in tests/calibration.json; measured gaps were scaled
// by 0.76. Depth sets the big steps; blunder rate and noise fill in between
// them (depth 3 with 25% careless moves sits just above depth 2 / 7%).
const ENGINE_LEVELS = [
    { rating: 400,  maxDepth: 1,  evalNoise: 300, blunder: 0.35 },
    { rating: 580,  maxDepth: 1,  evalNoise: 200, blunder: 0.25 },
    { rating: 730,  maxDepth: 1,  evalNoise: 120, blunder: 0.15 },
    { rating: 960,  maxDepth: 2,  evalNoise: 100, blunder: 0.12 },
    { rating: 1130, maxDepth: 2,  evalNoise: 60,  blunder: 0.07 },
    { rating: 1230, maxDepth: 3,  evalNoise: 100, blunder: 0.25 },
    { rating: 1360, maxDepth: 3,  evalNoise: 70,  blunder: 0.14 },
    { rating: 1440, maxDepth: 3,  evalNoise: 50,  blunder: 0.07 },
    { rating: 1530, maxDepth: 3,  evalNoise: 35,  blunder: 0.04 },
    { rating: 1580, maxDepth: 4,  evalNoise: 45,  blunder: 0.13 },
    { rating: 1710, maxDepth: 4,  evalNoise: 25,  blunder: 0.03 },
    { rating: 1840, maxDepth: 5,  evalNoise: 20,  blunder: 0.015 },
    { rating: 2060, maxDepth: 6,  evalNoise: 10,  blunder: 0.005 },
    { rating: 2300, maxDepth: 64, evalNoise: 0,   blunder: 0 },
];

// Index of the level whose rating is closest to `rating`.
function nearestEngineLevel(rating) {
    let best = 0;
    ENGINE_LEVELS.forEach((l, i) => {
        if (Math.abs(l.rating - rating) < Math.abs(ENGINE_LEVELS[best].rating - rating)) best = i;
    });
    return best;
}

function engineLevelTitle(rating) {
    if (rating < 800) return 'Beginner';
    if (rating < 1100) return 'Novice';
    if (rating < 1400) return 'Club player';
    if (rating < 1700) return 'Strong club player';
    if (rating < 2000) return 'Expert';
    return 'Master';
}

// The old four-step difficulty names (saved games, ?difficulty= links).
const LEGACY_DIFFICULTY_LEVEL = { beginner: 1, intermediate: 5, expert: 9, master: ENGINE_LEVELS.length - 1 };
