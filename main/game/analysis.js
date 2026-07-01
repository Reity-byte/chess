// ─── GAME ANALYSIS ENGINE — SHARED CONSTANTS ──────────────────────────────────
// Post-game move classification in the style of chess.com's "Game Report":
// Book / Best / Excellent / Good / Inaccuracy / Mistake / Blunder / Miss / Brilliant.
//
// This file is loaded by BOTH analysis-worker.js (via importScripts, where the
// actual classification runs) and analysis.html (via a script tag, for rendering
// the review page), which is why it holds only shared, DOM-free constants and a
// pure string-building helper — nothing here touches `document` or `self`.
// Thresholds are win-PROBABILITY-POINT loss (0-100), not raw centipawns. Raw cp
// thresholds looked right in balanced middlegames but badly over-flagged forced
// or already-decided endgame moves: once you're already down a queen, losing an
// extra rook is still ~1500cp of "loss" even though your actual winning chances
// barely moved (roughly 0% either way) - every reply in a lost position came out
// Blunder/Miss even when it was the only legal move. Win-probability naturally
// compresses that tail the way chess.com/lichess do, so only losses that actually
// change the practical outcome get flagged harshly. Checked in ascending order;
// anything above `mistake` is a Blunder.
const ANALYSIS_THRESHOLDS = {
    best:       0,
    excellent:  2,
    good:       5,
    inaccuracy: 10,
    mistake:    20,
};

// Standard logistic win-probability curve (same constant lichess uses), converting
// a centipawn score from the mover's perspective into that mover's win probability
// (0-100). Mate scores (±tens of thousands from ai.js's negamax) saturate cleanly
// to 0/100 rather than overflowing.
function winProbability(cp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

const CATEGORY_COLORS = {
    Brilliant:  '#1baaa6',
    Best:       '#81b64c',
    Excellent:  '#96bc4b',
    Good:       '#7a9a52',
    Book:       '#a67c52',
    Forced:     '#7c8894',
    Inaccuracy: '#e6b422',
    Mistake:    '#e08f2c',
    Blunder:    '#e0402c',
    Miss:       '#c0392b',
};

// Standard chess-annotation glyphs (NAG-style), appended directly after the SAN
// the way real notation does ("Qg5??"), analysis-page-only — the live game in
// game.html never classifies moves during play. Categories with no traditional
// symbol (Good/Book) render with color alone, same as before.
const CATEGORY_SYMBOLS = {
    Brilliant:  '!!',
    Best:       '✓',
    Excellent:  '!',
    Good:       '',
    Book:       '',
    Forced:     '□',
    Inaccuracy: '?!',
    Mistake:    '?',
    Blunder:    '??',
    Miss:       '?',
};

// Builds an inline SVG eval-swing line graph (White's perspective). Used by
// analysis-page.js on the review page.
function buildEvalGraphSVG(evalGraph) {
    const w = 440, h = 120;
    const n = evalGraph.length;
    if (n === 0) return '';

    const clamp = (v) => Math.max(-600, Math.min(600, v));
    const points = evalGraph.map((v, i) => {
        const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
        const y = h / 2 - (clamp(v) / 600) * (h / 2 - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `
        <svg viewBox="0 0 ${w} ${h}" class="eval-graph-svg" preserveAspectRatio="none">
            <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" class="eval-graph-mid" />
            <polyline points="${points}" class="eval-graph-line" />
        </svg>
    `;
}
