// ─── GAME ANALYSIS ENGINE — SHARED CONSTANTS ──────────────────────────────────
// Post-game move classification in the style of chess.com's "Game Review".
// Loaded by BOTH analysis-worker.js (importScripts, where classification runs)
// and analysis.html (rendering), so it holds only DOM-free constants and pure
// helpers — nothing here touches `document` or `self`.

// Bump whenever the report format or the classification rules change, so cached
// reports from older versions are recomputed instead of reused.
const ANALYSIS_VERSION = 5;

// Engine score encoding (matches ai.js): mates are ±(EVAL_MATE - plies to mate).
const EVAL_MATE = 100000;
const EVAL_MATE_BOUND = EVAL_MATE - 1000;

// Analysis strength presets: per-position time budget and depth cap. Positions
// are spread over several workers (one per spare core), so these are per
// position, not per game.
const ANALYSIS_MODES = {
    quick:    { label: 'Quick',    timeMs: 300,  maxDepth: 12 },
    standard: { label: 'Standard', timeMs: 1200, maxDepth: 18 },
    deep:     { label: 'Deep',     timeMs: 3000, maxDepth: 24 },
};

// Thresholds are win-PROBABILITY-POINT loss (0-100), not raw centipawns: in an
// already-decided position, dropping another rook barely changes the outcome,
// and win probability compresses that tail the way chess.com/lichess do.
// A move is in the first bucket whose limit it doesn't exceed; above `mistake`
// it's a Blunder.
const ANALYSIS_THRESHOLDS = {
    best:       0.25,
    excellent:  2,
    good:       5,
    inaccuracy: 10,
    mistake:    20,
};

// Logistic win-probability curve (lichess's constant): centipawns from the
// mover's view -> that mover's winning chances, 0-100. Mates saturate to 0/100.
function winProbability(cp) {
    if (cp >= EVAL_MATE_BOUND) return 100;
    if (cp <= -EVAL_MATE_BOUND) return 0;
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function isMateScore(cp) {
    return Math.abs(cp) >= EVAL_MATE_BOUND;
}

// Moves until mate (positive: the side whose view `cp` is in delivers it).
function mateInMoves(cp) {
    const plies = EVAL_MATE - Math.abs(cp);
    return Math.sign(cp) * Math.max(1, Math.ceil(plies / 2));
}

// "+1.4", "-0.3", "M3", "-M2", "0.0"; `cp` from White's view. A delivered mate
// (0 plies left) shows as "1-0"/"0-1".
function formatEval(cp) {
    if (cp === null || cp === undefined) return '';
    if (isMateScore(cp)) {
        if (EVAL_MATE - Math.abs(cp) === 0) return cp > 0 ? '1-0' : '0-1';
        const n = mateInMoves(cp);
        return (n > 0 ? 'M' : '-M') + Math.abs(n);
    }
    const v = Math.round(cp / 10) / 10;
    if (v === 0) return '0.0'; // not "-0.0" for a tiny negative score
    return (v > 0 ? '+' : '') + v.toFixed(1);
}

// Eval-bar / graph fill: White's share of the bar, 0..1 (a softened win curve).
function evalToBarFraction(cp) {
    if (isMateScore(cp)) return cp > 0 ? 1 : 0;
    return winProbability(cp) / 100;
}

const CATEGORY_ORDER = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Forced',
                        'Inaccuracy', 'Mistake', 'Miss', 'Blunder'];

const CATEGORY_COLORS = {
    Brilliant:  '#26c2a3',
    Great:      '#5c8bb0',
    Best:       '#81b64c',
    Excellent:  '#96bc4b',
    Good:       '#97af8b',
    Book:       '#a88865',
    Forced:     '#8a96a3',
    Inaccuracy: '#f0c15c',
    Mistake:    '#e6912c',
    Miss:       '#ee6b55',
    Blunder:    '#ca3431',
};

// Glyph shown in the round badge on the board and in the move list.
const CATEGORY_SYMBOLS = {
    Brilliant:  '!!',
    Great:      '!',
    Best:       '★',
    Excellent:  '✓',
    Good:       '✓',
    Book:       '≡',
    Forced:     '□',
    Inaccuracy: '?!',
    Mistake:    '?',
    Miss:       '✗',
    Blunder:    '??',
};

// One-line explanations used in the move caption on the review page.
const CATEGORY_DESCRIPTIONS = {
    Brilliant:  'a brilliant sacrifice',
    Great:      'a great move — the only good one here',
    Best:       'the best move',
    Excellent:  'excellent',
    Good:       'a good move',
    Book:       'a book move',
    Forced:     'forced — the only legal move',
    Inaccuracy: 'an inaccuracy',
    Mistake:    'a mistake',
    Miss:       'a missed opportunity',
    Blunder:    'a blunder',
};
