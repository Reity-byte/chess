// ─── ENGINE STRENGTH LADDER ────────────────────────────────────────────────────
// Each level is a set of search settings plus a rating. Weaker levels search
// shallower and add "eval noise": random centipawn jitter on each candidate
// move's score when the engine picks (see searchRoot in ai.js), which produces
// human-looking slips rather than uniformly shallow play.
//
// The ratings are MEASURED, not guessed: tests/calibrate.js plays every pair
// of neighbouring levels against each other and turns each score into an Elo
// gap; the gaps are summed upward from level 0, which is pinned at
// ENGINE_RATING_ANCHOR. Self-play can only measure strength *relative* to the
// other levels, so the absolute anchor is a judgement call — the UI shows the
// numbers as approximate ("≈ 1350"). Re-run the calibration after changing
// the search or evaluation:  node tests/calibrate.js --write
const ENGINE_RATING_ANCHOR = 400;
const ENGINE_MOVE_TIME_MS = 1500; // per-move time cap (untimed games); the deepest level uses all of it

const ENGINE_LEVELS = [
    { rating: 400,  maxDepth: 1,  evalNoise: 800 },
    { rating: 500,  maxDepth: 1,  evalNoise: 400 },
    { rating: 600,  maxDepth: 1,  evalNoise: 200 },
    { rating: 700,  maxDepth: 2,  evalNoise: 250 },
    { rating: 800,  maxDepth: 2,  evalNoise: 120 },
    { rating: 900,  maxDepth: 2,  evalNoise: 60 },
    { rating: 1000, maxDepth: 3,  evalNoise: 80 },
    { rating: 1100, maxDepth: 3,  evalNoise: 35 },
    { rating: 1200, maxDepth: 4,  evalNoise: 40 },
    { rating: 1300, maxDepth: 5,  evalNoise: 25 },
    { rating: 1400, maxDepth: 6,  evalNoise: 15 },
    { rating: 1500, maxDepth: 7,  evalNoise: 10 },
    { rating: 1600, maxDepth: 9,  evalNoise: 5 },
    { rating: 1700, maxDepth: 64, evalNoise: 0 },
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
const LEGACY_DIFFICULTY_LEVEL = { beginner: 2, intermediate: 5, expert: 10, master: ENGINE_LEVELS.length - 1 };
