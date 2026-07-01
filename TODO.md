# Chess Site — Todo & Continuation Prompt

## Context for a fresh session

This is a vanilla JS chess game at `main/game/game.html`, with a landing page at `main/site.html`.
Files: `engine.js` (game state/rules), `ai.js` (negamax AI), `notation.js` (SAN), `game-script.js` (UI), `game.css`, `game.html`.
Landing page: `site.html`, `site.css`, `site-script.js`.

A large rewrite was already completed that added:
- Setup modal with vs-AI / AI-vs-AI mode selection
- Color choice (White / Black / Random) with board perspective flip
- Optimized AI: negamax + alpha-beta + transposition table + quiescence search + iterative deepening + make/unmake (no cloning)
- Move history panel with proper SAN notation
- Fix for threefold repetition key missing en-passant state
- Fix for SAN check/checkmate suffix using post-move board state

Session 2 found and fixed two critical AI bugs during runtime verification:
1. `checkTime()` only fired every 1024 nodes — with expensive move generation per node, searches hung for minutes past their time budget.
2. `SearchTimeUp` exception skipped `undoSearchMove()` calls, permanently corrupting `gameState` on every timeout. Fixed with try/finally in `negamax`, `quiescence`, and the root loop in `findBestMove`.

Session 2 also fixed all 🔴 and 🟡 items:
- `resetGame()` added to engine.js; called by `startGame()` — fixes state surviving across games.
- `getBoardKey()` now uses four castling-rights flags (K/Q/k/q) instead of per-piece `hasMoved` bits.
- Coordinate labels (a–h / 1–8) added in `startGame()`, correctly flipping with the board via `screenX`/`screenY`.
- Thinking indicator: green pulsing "···" on active player's sidebar tag while AI searches; `sleep(0)` yield lets the browser repaint before the synchronous search blocks the thread.
- Restart/"Play Again" now hides the game-over modal and re-opens the setup modal instead of reloading the page.
- `MAX_QDEPTH = 6` constant extracted in ai.js; TT cleared when it exceeds 500 000 entries.
- Verified `#exitButton`'s `../site.html` path is correct relative to `main/game/game.html` — no fix needed.

Session 3 redesigned the landing page (`main/site.html`, `site.css`, `site-script.js`) into a mainstream-style
chess site homepage:
- Sticky nav bar with logo + anchor links (Play / Engine / Rules) + a "Play Now" CTA.
- Hero section with heading, subtitle, two CTAs ("Play vs AI" / "Watch AI vs AI"), and a decorative
  static mini chessboard built from the real piece PNGs (`buildMiniBoard()` in site-script.js).
- "Choose Your Game" card grid (Play vs AI / AI vs AI / Move History) linking into the game with a
  `?mode=human|ai` query param.
- "Under the Hood" section describing the real engine internals (negamax, alpha-beta, iterative deepening,
  quiescence, TT) — no invented/fake features.
- "Full Rule Support" checklist (castling, en passant, promotion, check/mate/stalemate, draw rules).
- `game-script.js` now reads `?mode=` from the URL on load and preselects + auto-opens the setup modal,
  so the landing page CTAs skip the extra "Start" click.
- Verified end-to-end in the preview browser: landing page → CTA click → setup modal preselected →
  Begin → board renders correctly with sidebar tags.

Session 4 scaffolded the future **Game Analysis Engine** (see that section below for the full design)
and implemented **item 1 of the AI Boost Plan** (difficulty selector):
- Added `main/game/analysis.js` (thresholds + stubbed `classifyMove`/`analyzeGame`/`showGameAnalysis`)
  and `main/game/analysis-worker.js` (stubbed Web Worker protocol) — design-only, no real logic yet.
- Wired `analysis.js` into `game.html` and added a "View Game Report" button to the game-over modal
  that calls the `showGameAnalysis()` stub (currently just an alert).
- Implemented the difficulty selector exactly as planned: `#difficultyRow` in the setup modal (compact
  CSS variant so all four buttons fit on one line), `DIFFICULTY` map + `selectedDifficulty` in
  game-script.js, `aiDepth()`/`aiEvalNoise()` reading from it, and `?difficulty=` URL-preselect support
  alongside the existing `?mode=`.
- `ai.js`: `evaluateForColor(color, noise)` now takes optional jitter (only ever passed at the root);
  `findBestMove`/`makeAIMove` gained an `evalNoise` parameter. The root loop tracks the *true* score
  separately from the *jittered* score so noise affects only which move is chosen, not the alpha window
  used to prune sibling searches.
- Verified end-to-end in the preview browser: Beginner selected → `aiDepth()===1`, `aiEvalNoise()===80`
  → AI replied instantly with a legal move, no console errors. `showGameAnalysis()` confirmed wired
  (triggers a real alert dialog).

---

## Todo List

### 🔴 High Priority — Fix These First

- [x] **`positionHistory` and `halfMoveClock` not reset on new game** — fixed: `resetGame()` in engine.js, called from `startGame()`.
- [x] **Threefold repetition key encodes `hasMoved` per piece** — fixed: `getBoardKey()` now encodes four castling-rights flags.
- [x] **`completePromotion` doesn't guard the AI follow-up correctly** — verified correct.
- [x] **Board coordinate labels don't flip with the board** — fixed.

### 🟡 Medium Priority — UX Improvements

- [x] **"Thinking" indicator while AI searches** — fixed.
- [x] **Restart should re-open setup modal, not reload page** — fixed.
- [x] **`#exitButton` path is hard-coded to `../site.html`** — verified correct, no change needed.

### 🟢 Low Priority — Code Quality

- [x] **Quiescence depth cap (6) should be a named constant** — fixed.
- [x] **Transposition table has no size limit** — fixed.

### 🎨 Landing Page Redesign

- [x] **Mainstream-style homepage** — nav, hero with CTA + mini-board, mode cards, engine feature section, rules checklist, footer.

### 🔍 Game Analysis Engine — ✅ IMPLEMENTED (core + visuals + dedicated review page; "what if" branching still open)

Chess.com-style post-game move classification (Book / Best / Excellent / Good / Inaccuracy / Mistake /
Blunder / Miss / Brilliant), on its own review page (`main/game/analysis.html`), not an in-game modal.

- [x] **Core classification via bidirectional search** — `analysis-worker.js`'s `runAnalysis()`. For each
  ply: `bestBefore = iterativeDeepen(color, ...).score` (the mover's best available score before the move),
  then the move is actually applied and `actual = -iterativeDeepen(opponent, ...).score` (opponent's best
  reply, negated back to the mover's perspective). `centipawnLoss = max(0, bestBefore - actual)`. This is
  exactly the fix for the previous attempt's bug (a static post-move eval can't see a hung piece — the drop
  only appears once the opponent's capturing reply is actually searched). Verified live: a queen blunder
  (Qg5 walking into Nxg5) was correctly flagged as a **Blunder at -885 cp**.
- [x] **Isolate the analysis board from the live game** — **deviated from the FEN plan**: the worker
  imports engine.js/ai.js/notation.js via `importScripts`, which gives it its own entirely separate
  `gameState`/`currentTurn`/etc. (a Worker is a separate global scope). Replaying the recorded SAN move
  list from `resetGame()` is enough to isolate it — no FEN serialization needed at all.
  `resolveSAN()`/`applyRealMove()` in analysis-worker.js replay each move exactly as the real game played
  it (including the actual promotion piece chosen, not the search's auto-queen shortcut). The worker's
  `perMove` entries also carry `from`/`to`/`details`/`promo` coordinates so analysis.html can replay the
  game directly without re-resolving SAN a second time.
- [x] **Web Worker** — `analysis-worker.js` runs the whole analysis off the main thread.
- [x] **Dedicated review page, not a modal** — originally built as an `#gameReportModal` on `game.html`,
  then **reworked into a separate page** (`main/game/analysis.html` + `analysis-page.js`) per feedback:
  a real chess.com-style review needs its own board to click through move-by-move, which a modal can't
  give room for. `game-script.js`'s "View Game Report" button now serializes the played SAN moves to
  `localStorage` (key `chessGameForAnalysis`) and navigates to `analysis.html`, which spins up its own
  worker, then renders a read-only board + clickable move list + eval graph + accuracy.
- [x] **Move rating visible on the board** — clicking any move in the list (or clicking a point on the eval
  graph) replays the game up to that ply and drops a colored `.on-board-badge` dot on the square the move
  landed on (color = category, via the shared `CATEGORY_COLORS` in analysis.js), plus a text caption below
  the board ("7. Bd7 — Best (-0 cp)"). This is the specific "rating visible on the board" chess.com effect
  that was requested instead of only badges in a side list.
- [x] **Visual output** — `.move-badge` dots in the clickable move list, an inline SVG eval-swing graph
  (also clickable to jump to a ply), and a White/Black accuracy percentage (a simplified
  `100 - avgCentipawnLoss/6` stand-in, not chess.com's real win%-based curve).
- [x] **Book detection** — a move is classified "Book" if it matches a candidate reply in ai.js's
  `OPENING_BOOK` at that exact ply (`isBookMove()` in the worker), skipping the "was this actually the
  engine's best move" question entirely for known theory.
- [x] **Brilliant heuristic** — `looksLikeSacrifice()`: the moved piece lands on a square attacked by an
  enemy piece of equal-or-lesser value, and the move is still the engine's best/near-best. This is a
  **simplified heuristic**, not a full search-based sacrifice justification — documented as such in the
  worker's code comment, since a truly correct "was this sacrifice actually sound" check would need much
  deeper search than is practical per-ply here.
- [x] **"What if" branching** — from any ply, click a piece then a destination square on the board to play
  an alternative move; the engine replies automatically at **full strength** (Master-level search,
  regardless of the original game's difficulty — exploring is "what does the engine actually think," so
  noise/shallow depth would be misleading here) via a new `explore` message type in `analysis-worker.js`
  (`runExplore()`, using the same `iterativeDeepen` the rest of the engine already shares). Play continues
  indefinitely — each of your moves gets an automatic engine reply, building out a full alternate line, not
  just a one-move peek. The variation is shown as its own inserted line in the move list (amber-tinted,
  compact "5.Nc3 c5 6.Nc4 dxc4" flowing format, distinct from the two-column main-line table), an
  "Exploring variation" banner appears above the board, and clicking **any real move in the main list** (or
  the explicit "Back to Game" button) discards the variation and resumes the actual recorded game at that
  point — variations are never saved, matching chess.com/lichess's basic explore behavior.
- [x] **Move arrows** — a semi-transparent arrow (inline SVG) from the origin to destination square is now
  drawn for every move shown on the board, main-line or variation — a nice-to-have the user asked for
  alongside branching, using the same reference screenshot (lichess's analysis board) as the visual model.

Session 5 implemented **the rest of the AI Boost Plan (items 2–5)** — killer moves, history heuristic,
opening book, and endgame/structure evaluation:
- **Killer moves**: `killers[depth] = [move, move]` in ai.js, recorded in `negamax` on a beta cutoff for
  quiet (non-capture) moves via `recordKiller()`. Scored `500000`/`500001` in `moveScore` — above captures,
  below the TT move — per the plan.
- **History heuristic**: `historyTable` keyed by `fromX,fromY,toX,toY`, incremented by `depth*depth` via
  `addHistory()` whenever a quiet move raises alpha. Used as the `moveScore` tiebreaker after killers.
  Both `killers` and `historyTable` are reset at the top of `findBestMove` (per-search caches).
- **Opening book**: implemented as `OPENING_BOOK`, an array of ~20 SAN move sequences (Ruy Lopez, Italian,
  Sicilian, French, Caro-Kann, Queen's Gambit, Slav, King's Indian, Nimzo-Indian, Dutch, Reti, etc.), **not**
  the board-key-keyed format originally sketched in the plan — hand-computing this engine's exact
  `getBoardKey()` strings (which fold in castling rights + en passant) for ~20 lines by hand would've been
  fragile and unverifiable without running the engine. Matching against the played SAN prefix
  (`pickBookMove()` in ai.js, reading the `moveHistory` global from game-script.js) is directly checkable
  against real opening theory instead. `sanToMove()` resolves a book SAN string back to a legal move object
  via the existing move generator + `moveToSAN()`, so a book entry can never produce an illegal move.
- **Better evaluation**: `evaluateBoard()` now adds a bishop-pair bonus (+30), rook open/semi-open file
  bonus (+25/+15), a passed-pawn bonus scaled by distance-to-promotion (`PASSED_PAWN_BONUS`), and a
  phase-blended endgame king PST (`KING_ENDGAME_PST`, blended via `TOTAL_NON_PAWN_MATERIAL` as the phase
  signal) that rewards king centralization once material thins out.
- Verified in the preview browser: an AI vs AI game at Master difficulty opened with the exact Ruy Lopez
  book line (e4 e5 Nf3 Nc6 Bb5), correctly fell back to full search once past the book, and played 20+
  half-moves (including captures and castling) with zero console errors.

Session 6 implemented the **Game Analysis Engine** (design + status detailed in that section above):
- `ai.js`: extracted `iterativeDeepen(color, timeBudgetMs, maxDepth, evalNoise)` returning `{ move, score }`
  from the existing root iterative-deepening loop; `findBestMove` is now a thin wrapper (book-move
  short-circuit, then `iterativeDeepen(...).move`) — a backward-compatible refactor, live play behaves
  bit-for-bit the same, but the analysis worker can now get ground-truth (noise-free, book-free) scores.
- `analysis-worker.js`: full `runAnalysis()` implementation as described above.
- `analysis.js`: real `showGameAnalysis()`/`renderAnalysisReport()`/`applyMoveBadges()`/`buildEvalGraphSVG()`
  replacing the old stubs; `ANALYSIS_THRESHOLDS` stayed as the shared constant (used by both the main
  thread and, via `importScripts`, the worker).
- `game.html`: new `#gameReportModal`; `game.css`: `.move-badge`, `.report-*`, `.eval-graph-*` styles.
- Verified end-to-end in the preview browser: ran a Beginner-difficulty AI vs AI game, triggered analysis
  mid-game, confirmed the actual queen blunder was flagged **Blunder (-885 cp)**, Book moves were detected
  at the start, the eval graph rendered with one point per ply, and accuracy percentages displayed —
  zero console errors throughout.

Session 7 reworked the Game Analysis Engine from an in-page modal into a **dedicated review page**, per
feedback that a real chess.com-style review needs its own board:
- New `main/game/analysis.html` + `main/game/analysis-page.js`: a read-only board, a clickable move list
  (each row jumps to that position), an eval graph (also clickable), and accuracy — plus, per the specific
  request, the move's rating shown **directly on the board** as a colored dot on the square it landed on,
  with a text caption underneath.
- `game.html`: removed `#gameReportModal` and the `analysis.js` script tag (no longer needed there —
  game.html now only hands off data, it doesn't render the report itself).
- `game-script.js`: the "View Game Report" button now writes the played SAN moves to
  `localStorage['chessGameForAnalysis']` and navigates to `analysis.html`, instead of opening a modal.
- `analysis.js`: stripped down to only what's shared between the main thread and the worker —
  `ANALYSIS_THRESHOLDS`, `CATEGORY_COLORS`, and the pure `buildEvalGraphSVG()` string-builder. All the old
  modal-rendering functions (`showGameAnalysis`, `renderAnalysisReport`, `applyMoveBadges`, etc.) were
  removed since analysis-page.js replaces them.
- `analysis-worker.js`: `perMove` entries now also carry `from`/`to`/`details`/`promo`, so the review page
  can replay the game directly (matching engine.js's `movePiece` signature) without re-resolving SAN.
- Verified end-to-end in the preview browser: played a Beginner AI vs AI game, clicked "View Game Report",
  confirmed the handoff/navigation to analysis.html, the worker analyzed the real game (14 plies, 81%/81%
  accuracy), clicking an earlier move in the list correctly rewound the board (pawn back on d4, d2 empty),
  clicking the eval graph jumped to the corresponding ply, and the on-board colored badge + caption
  ("7. Bd7 — Best (-0 cp)") rendered on the correct square. Zero console errors throughout.

Session 8 implemented **"what if" branching** (design discussed first; reference screenshot from
lichess's analysis board — eval-per-move inline, a variation inserted into the move list, move arrows):
- `analysis-worker.js`: new `explore` message type / `runExplore()` — replays the main-line SAN prefix up
  to the branch point plus the variation moves played so far (sent as coordinate objects, no SAN
  re-resolution needed since the page already has them), then runs `iterativeDeepen` for whichever color
  is to move next. `EXPLORE_DEPTH = 6` / `EXPLORE_TIME_MS = 1500` — always full strength per the answered
  design question, independent of `ANALYSIS_DEPTH`/`ANALYSIS_TIME_MS` used for the main-line classification.
- `analysis-page.js`: the board is now interactive (`onSquareClick`, reusing `getvalidMoves` from
  engine.js) whenever it isn't mid-search. Playing a move starts a variation (`inVariation`,
  `variationBranchPly`, `variation[]`), immediately posts an `explore` request to the worker, and applies
  the returned engine move the same way. `selectPly()` (any main-line navigation) always calls
  `clearVariation()` first, so browsing the real game silently abandons any open exploration — no separate
  "did you mean to discard this?" prompt, matching the simple confirmed behavior.
- `analysis.html`: new `#variationBanner` ("Exploring variation — not part of the recorded game" +
  "Back to Game" button, `selectPly(variationBranchPly)` under the hood).
- `game.css`: `.variation-banner`, `.variation-line`, `.variation-move`/`.active-ply`, `.move-arrow-svg`.
- Verified end-to-end in the preview browser: played 1.e4 as a variation from the starting position, the
  engine replied 1...Nc6 at full strength (confirmed via the returned eval), the variation row rendered
  correctly ("1.e4 Nc6"); repeated from a mid-game ply (branch at ply 3) and confirmed the row inserted at
  the correct position in the table and the move-numbering prefix matched standard notation ("3.Nh4 Nc6");
  "Back to Game" correctly restored the exact starting position with the banner/row removed. Zero console
  errors throughout.

Session 9 implemented **move-quality glyphs** (design discussed first — text glyphs confirmed over
image icons, analysis-page-only confirmed over also showing live during play in game.html):
- `analysis.js`: new `CATEGORY_SYMBOLS` map alongside `CATEGORY_COLORS` — `Brilliant: '!!'`, `Best: '✓'`,
  `Excellent: '!'`, `Inaccuracy: '?!'`, `Mistake: '?'`, `Blunder: '??'`, `Miss: '?'` (color still
  disambiguates Miss from Mistake), `Good`/`Book` render with no suffix at all — matching how real chess
  annotation only decorates inaccuracies/mistakes/blunders/brilliancies, not "unremarkable" moves.
- `analysis-page.js`: the move list now appends the glyph directly after the SAN the way real notation
  does ("Qg5??", "Be6?!"), replacing the old plain colored dot; the on-board badge keeps its colored-circle
  shape but now centers the glyph text inside it instead of being empty.
- `game.css`: `.move-badge` restyled from a small dot to bold colored inline text; `.on-board-badge` is now
  a flex-centered circle sized for a short text glyph. Fixed a stale comment that still said badges show up
  in game.html's own history table — they never did (only analysis.html classifies moves); game.html
  itself is unaffected by this whole feature, matching the "analysis-page only" decision.
- Verified end-to-end in the preview browser: real analyzed moves rendered as e.g. `Qb3??`, `Be6?!`,
  `Nh3` (Good, no suffix), `d4` (Book, no suffix) — colors confirmed programmatically (yellow `?!`,
  orange `?`, red `??`) matching `CATEGORY_COLORS`. On-board badge showed the matching glyph
  (e.g. "?" for a Miss) with the correct tooltip. Zero console errors.

All bug-fix, redesign, and AI Boost Plan items are complete. The Game Analysis Engine — core, isolation,
worker, dedicated review page, on-board ratings, "what if" branching with move arrows, and move-quality
glyphs — is fully implemented.

Session 12 fixed **the Game Analysis Engine over-flagging blunders in already-decided positions**
(reported after a real vs-AI game showed White at 88% accuracy but Black at a flat 0%, with nearly every
Black move from the midgame on flagged Blunder/Mistake despite the user having played the endgame
correctly — verified independently on Lichess):
- Root cause: `classify()`/accuracy in `analysis-worker.js` compared **raw centipawn** scores
  (`bestBefore` vs `actual`, from the bidirectional search already described in Session 6). That's fine in
  a balanced middlegame, but once a position is already decisively lost, the "before" search (evaluated one
  ply earlier, `ANALYSIS_DEPTH = 4`) often doesn't yet see how bad it truly is, while the "after" search
  (now one ply deeper, following the opponent's actual best reply) finds the mate/material collapse the
  shallower "before" pass missed — producing a huge apparent centipawn swing on a move that may have been
  completely forced (e.g. the only legal way out of check). Every remaining move in a lost game kept
  re-triggering this, dragging that side's whole game to Blunder-everything / 0% accuracy even though
  nothing was actually thrown away that wasn't already gone.
- Fix: classification and accuracy now run on **win-probability-point loss**, not raw centipawns — the
  same fix real sites use for exactly this reason. `analysis.js` gained `winProbability(cp)` (the standard
  logistic curve Lichess uses) and `ANALYSIS_THRESHOLDS` was rescaled from raw-cp buckets to win-probability
  buckets (`best: 0, excellent: 2, good: 5, inaccuracy: 10, mistake: 20`, all in percentage points, not cp).
  `analysis-worker.js`'s `runAnalysis()` now computes `winLoss = winProbability(bestBefore) -
  winProbability(actual)` and feeds that into `classify()`; `WINNING_THRESHOLD` (was 250cp) became
  `WINNING_WIN_PCT = 65` for the same reason. The raw `centipawnLoss` number is still computed and shown in
  the on-board caption/tooltip (still a useful, concrete number for the user to see) — only the
  classification and accuracy math changed. Accuracy itself switched from the old ad-hoc
  `100 - avgCentipawnLoss/6` stand-in to chess.com's actual published curve
  (`103.1668 * exp(-0.04354 * avgWinLoss) - 3.1669`, clamped 0–100) applied to average win-probability loss,
  which is what naturally produces two differentiated, non-zero percentages instead of one side flooring
  out at 0%.
- Why this doesn't need a separate "forced move" special case: a genuinely forced move in an
  already-lost/already-won position now correctly shows near-zero win-probability loss on its own (both
  before and after are near 0% or 100% win chance already), without any extra logic — the compression is
  exactly what makes real engines stop over-penalizing "no choice" moves deep in a decided game, while a
  forced move that DOES actually change the practical outcome (e.g. the only legal reply drops a piece in
  an otherwise balanced position) still correctly flags as a real mistake.
- Verified in the preview browser: computed `winProbability(-600) - winProbability(-5000)` (representative
  of "9.9%-winning position whose deeper search then finds a much larger, already-decided loss") — the old
  raw-cp method would have scored this a 4400cp Blunder; the new method scores it a 9.9-point loss, landing
  in Mistake territory instead of maxing out to Blunder. Also ran a full 345-ply AI vs AI game (Intermediate
  difficulty, genuinely weak on both sides) through the review page end-to-end and got two differentiated,
  non-zero accuracy numbers (33%/33%, matching how error-prone that specific game actually was for both
  sides) instead of the old floor-at-0% pattern. Zero console errors.

Session 11 added **contempt / draw-avoidance to the AI search** (not from the Next Roadmap list —
requested directly after watching self-play games end in threefold repetition far too often, feeling
listless rather than "trying to win or trying not to lose"):
- Root cause: `positionHistory`/threefold detection only ever ran at the live-game level
  (`checkGameOver()`), completely outside the search tree — negamax had no notion that a position it was
  about to reach would actually be a draw, so it scored a repeated shuffle identically to any other quiet
  move (both regressed to a flat static eval), giving it zero incentive to route around a draw when ahead
  or to avoid drifting into one out of sheer indifference.
- `ai.js`: new `CONTEMPT = 60` constant and `searchPathCounts` (a per-search map of how many times each
  position has been reached so far *within the current search tree*, reset alongside `killers`/
  `historyTable` in `iterativeDeepen`). A new shared helper `makeMoveAndSearch(move, depth, alpha, beta,
  next)` applies a candidate move, computes `(positionHistory[key] || 0) + (searchPathCounts[key] || 0) + 1`
  — i.e. real occurrences so far in the actual game plus hypothetical repeats already made earlier in this
  same search line — and if that would hit 3 (the live game's actual auto-draw threshold), short-circuits
  to `-CONTEMPT` instead of recursing, without ever touching the transposition table for that node (so a
  position's TT-cached "true" score from a non-repeating path is never contaminated by a repeating one).
  Both `negamax`'s move loop and the root loop in `iterativeDeepen` now call this helper instead of
  inlining `applySearchMove`/`negamax`/`undoSearchMove` directly, so root and interior nodes see identical
  draw-avoidance behavior. Stalemate's return value also changed from a flat `0` to `-CONTEMPT` for the
  same reason (a stalemate the losing side steers into on purpose is still a draw, not a special case).
  `negamax` also gained an optional `knownKey` parameter so it can reuse the key `makeMoveAndSearch` already
  computed instead of paying for `getBoardKey()` (an O(64) scan) twice per node.
- Why `-CONTEMPT` for the side to move rather than a sign tied to color: negamax scores are always "from
  the mover's perspective," so treating every draw as a small loss for whoever is to move at that node is
  self-adjusting — a side that's ahead will always find a real alternative move scoring above `-CONTEMPT`
  and take it instead of repeating; a side that's clearly behind (losing by more than 60cp) will prefer the
  draw over its other, worse options and walk into it on purpose. No color-specific logic needed.
- Verified in the preview browser: ran two full AI vs AI self-play games to completion by driving
  `makeAIMove` directly in a tight loop (bypassing the UI's `setTimeout`/sleep scheduling, which is
  throttled heavily by the browser when the preview tab isn't foregrounded — confirmed this was a test-
  harness artifact, not a product bug, by timing `iterativeDeepen` directly: 19ms for a real mid-game
  position against a 500ms budget). Both games ended in an actual **Checkmate** with `Math.max(...
  Object.values(positionHistory))` at 1 and 2 respectively (i.e. no position ever reached the threefold
  count of 3) — a clear contrast to the near-constant repetition draws from before this session. Zero
  console errors across both games.
- Explicitly out of scope for this session (flagged, not started): making the engine strong enough to run
  as an actual Lichess bot. That's a materially bigger project — it needs a UCI-like protocol wrapper (or
  direct use of Lichess's Bot API), a persistent server process (this engine currently only runs synchron-
  ously in a browser tab), and almost certainly a much deeper/faster search than a hobby JS negamax can hit
  in-browser. Worth a dedicated scoping conversation before starting, not something to fold into this fix.

Session 10 implemented **item 1 of the Next Roadmap (sound effects)**:
- New `main/game/sound.js`: tones synthesized via the Web Audio API (`AudioContext` + oscillator +
  gain-ramp envelope, no binary audio assets) — `playMoveSound()` (short click), `playCaptureSound()`
  (lower square-wave thud), `playCheckSound()` (two-tone alert), `playGameOverSound()` (three-tone
  descending sequence). `playSoundForMove(san)` picks move/capture from whether the final SAN string
  contains `'x'`, and layers the check tone on top when it ends in `'+'` — reusing the SAN string
  game-script.js already builds instead of threading capture/check booleans through separately.
- Hook points: `handleSquareClick`'s human-move branch, `playAIMove`'s `result.san`, and
  `completePromotion`'s promotion SAN all call `playSoundForMove(...)` right after `appendHistoryMove`.
  `showGameOverModal()` calls `playGameOverSound()` directly, so it fires for every end condition
  (checkmate, stalemate, threefold, 50-move, insufficient material) with no extra call sites needed.
- Mute toggle: `#soundToggleButton` (🔊/🔇) added next to Start/Exit in the sidebar
  (`game.html`/`game.css`'s `.sound-toggle`), state persisted in `localStorage['chessSoundMuted']` and
  read on load so a reload keeps the last choice; `analysis.html` intentionally has no sound (review tool,
  not live play, per the original proposal).
- Verified end-to-end in the preview browser: ran an AI vs AI Beginner game, instrumented the four sound
  functions and confirmed real move/capture/check calls fired in sequence during actual play (captures and
  a check triggered the right variants), confirmed the mute button flips the icon and persists through a
  page reload, and confirmed zero console errors throughout.

---

## 🆕 Next Roadmap — Proposed by Claude (Session 10+)

Everything above this point was explicitly requested. Nothing below has been asked for yet — this is a
prioritized list of what I think would add the most value given what already exists (a full engine with
difficulty levels and a genuinely capable Game Analysis Engine with branching). Pick any item, reorder, or
ignore all of it; treat this section as a proposal, not a commitment.

### 1. Sound effects (quick win, biggest missing polish) — ✅ IMPLEMENTED (Session 10)

The site is completely silent right now — no move click, no capture thud, no check alert. This is the
single most noticeable "not a real chess site yet" gap.

- New `main/game/sound.js`: synthesize short tones via the **Web Audio API** (`AudioContext` + oscillator
  nodes) rather than sourcing binary audio files — keeps the project asset-free and consistent with the
  "vanilla JS, no frameworks" philosophy already stated on the landing page. A short click for a quiet
  move, a slightly lower/harsher tone for a capture, a two-tone alert for check, a descending tone for
  game-over. Four or five small functions, maybe 60 lines total.
- Hook points: `game-script.js`'s `handleSquareClick` (after a human move resolves) and `playAIMove`
  (after the AI's move resolves) — both already know whether the move was a capture (`gameState[toY][toX]`
  before the move) and whether `updateCheckStatus()` just found a check.
- Add a mute toggle (small speaker icon button in the sidebar), preference persisted in
  `localStorage` so it survives a page reload.
- No sound needed on analysis.html — it's a review tool, not live play.

### 2. PGN import/export

Right now the *only* way to get a game into the Game Analysis Engine is to play it live in this app. PGN
support makes the analysis engine useful for literally any game (a famous game, a game from another site,
one of your own from before), and export lets people save or share what they played.

- **Export**: a "Download PGN" button (game-over modal, and maybe the live sidebar) that builds standard
  PGN text from `moveHistory` plus basic headers (`[Event]`, `[Date]`, `[White]`, `[Black]`, `[Result]`),
  and triggers a download via `new Blob([pgnText], {type:'text/plain'})` + a temporary `<a download>` link.
  No new dependencies needed.
- **Import**: add a "Analyze a PGN" text box directly on `analysis.html` (shown when there's no
  `localStorage` game to load, or always available above the board) — paste PGN movetext, parse it into a
  plain SAN array with a small regex-based stripper (drop move numbers like `1.`/`1...`, `{comments}`,
  `$NAGs`, and the trailing result marker `1-0`/`0-1`/`1/2-1/2`/`*`), then feed that array into the
  **exact same** `{ type: 'analyze', sanMoves }` message the worker already accepts. This reuses the whole
  analysis pipeline with zero changes to `analysis-worker.js` — the parser is the only new code.

### 3. Resign / offer draw / takeback in live play

Currently the *only* way a game vs AI ends is checkmate, stalemate, or a draw rule firing — there's no way
to bail out of a lost position or take back a misclick.

- **Resign**: a button in the live sidebar (vs-AI mode only) that immediately ends the game with
  `showGameOverModal("You resigned — Engine wins!")`, reusing the existing modal.
- **Offer draw**: button that asks the engine to accept/decline. Decision rule: run a quick
  `evaluateForColor(aiColor)` (no search needed, just the static eval) — accept if the engine isn't clearly
  winning (e.g. `score < 150`), otherwise decline with a brief message. Simple, deterministic, no new AI
  plumbing required.
- **Takeback**: pop the last move (or last full move-pair, vs AI) off `moveHistory`, then `resetGame()` and
  replay the remaining moves via `movePiece` — the exact replay pattern `analysis-page.js`'s
  `applyRecordedMove` already established, just reused in game-script.js instead of writing a new undo
  stack from scratch.

### 4. Chess clock (time controls)

A meaningfully bigger feature, but "untimed only" is one of the more obvious gaps versus a real chess site.

- Setup modal gains a time-control row (e.g. 5|0, 10|5, 15|10, Unlimited) alongside the existing
  mode/color/difficulty rows — same `.setup-choice` button pattern, zero new CSS needed.
- Per-side remaining time (ms) as new game-script.js state, decremented on a `setInterval` while it's that
  side's turn (including the AI's own thinking time — the search already has a hard `timeBudgetMs` cutoff,
  so it naturally can't blow past its clock allocation as long as the budget passed in is derived from
  remaining time rather than the fixed `AI_TIME_HUMAN`/`AI_TIME_SELFPLAY` constants).
- Two time displays in the player tags (`#topName`/`#bottomName`'s siblings). Hitting 0 ends the game
  immediately: "X wins on time" via the existing game-over modal.

### 5. Save & resume an in-progress game

Closing the tab mid-game currently loses everything — no persistence at all for a game still being played
(only *finished* games get handed to the analysis page via `localStorage`).

- On every move in game-script.js, serialize `{ moveHistory, gameMode, playerColor, selectedDifficulty }`
  to `localStorage['chessInProgressGame']`.
- On `site.html` load, check for a saved in-progress game; if present, show a "Resume Game" button next to
  "Start" that navigates straight to `game.html?resume=1`, which replays the saved move list (same
  replay pattern as everywhere else in this codebase by now) instead of starting fresh.
- Clear the saved key on checkmate/stalemate/draw/resign (whichever ships from item 3).

### 6. *(Stretch idea)* Puzzle mode generated from your own blunders

The most creative one, and the biggest scope of this list — pairs the Game Analysis Engine with the
"what if" branching machinery that's already built.

- On `analysis.html`, next to any move classified **Blunder** or **Miss**, add a "Try this as a puzzle"
  button. Clicking it sets up the board at the position *right after* the blunder was played (the
  opponent's position, i.e. the punishing side's turn) and challenges the user to find the move that
  exploits it.
- Validate the user's guess against a precomputed "punish" move (the worker already computed the
  opponent's best reply as part of `runAnalysis`'s bidirectional search — `actual = -iterativeDeepen(...)`
  already found this move, it just isn't currently returned to the main thread; would need `perMove`
  entries to also carry the punishing move's coordinates).
- Reuses the exact same click-to-move board interaction already built for "what if" branching — this is
  much less new code than it sounds, mostly UI (a puzzle banner + success/fail feedback) plus one extra
  field in the worker's `perMove` output.

---

### 🚀 AI Boost Plan — Difficulty Levels + Search Strength — ✅ ALL IMPLEMENTED

1. **Difficulty selector** — `#difficultyRow` in the setup modal, `DIFFICULTY` map + `selectedDifficulty`
   in game-script.js, `evalNoise` applied only at the search root in ai.js.
2. **Killer moves** — `killers[depth]`, recorded on beta cutoffs, scored above captures in `moveScore`.
3. **History heuristic** — `historyTable` keyed by move coordinates, `depth²`-weighted, tiebreaker after killers.
4. **Opening book** — `OPENING_BOOK` (SAN-sequence format, ~20 lines), `pickBookMove()`/`sanToMove()`.
5. **Better evaluation** — bishop pair, rook file bonuses, passed pawns, phase-blended endgame king PST.

**Still open / worth revisiting:**
- AI vs AI shares one `selectedDifficulty` for both sides — a per-side picker would be a nice-to-have.
- No automated regression test confirms Beginner blunders more than Master over many games, or that the
  new eval terms actually improve playing strength — worth a manual multi-game spot check (or a simple
  self-play tournament script) if the AI ever feels off after future changes.
- The opening book's ~20 lines are shallow (3–5 plies); expanding coverage is easy — just add more
  `{ weight, moves }` entries to `OPENING_BOOK` in ai.js.
- History heuristic values are cleared per-search; keeping them across moves within the same game was
  considered but not done, to keep the per-search-cache model simple and safe (see the comment above
  `killers`/`historyTable` in ai.js).

---

## Paste this into a new session to continue:

```
I have a vanilla JS chess site:
  main/site.html, site.css, site-script.js   (landing page)
  main/game/game.html, game-script.js, game.css   (the live game)
  main/game/engine.js   (game state, move gen, draw detection)
  main/game/ai.js       (negamax + alpha-beta + TT + quiescence + iterative deepening + killers +
                          history heuristic + opening book + difficulty-aware eval noise + bishop
                          pair/rook-file/passed-pawn/endgame-king eval terms; iterativeDeepen() is the
                          reusable {move, score} search shared with the analysis worker)
  main/game/notation.js (SAN generation)
  main/game/analysis.html, analysis-page.js   (Game Analysis Engine — dedicated review page: board,
                          clickable move list with move-quality glyphs, eval graph, accuracy, on-board
                          move-rating badges, and interactive "what if" branching with engine play-back)
  main/game/analysis.js  (shared constants: ANALYSIS_THRESHOLDS, CATEGORY_COLORS, CATEGORY_SYMBOLS,
                          buildEvalGraphSVG)
  main/game/analysis-worker.js (Game Analysis Engine — bidirectional-search classification + "explore"
                          full-strength search, both off-thread)

Please read TODO.md in the project root. Everything through Session 9 (bug fixes, landing page redesign,
AI Boost Plan, and the full Game Analysis Engine including "what if" branching and move-quality glyphs) is
complete and verified.

The "🆕 Next Roadmap" section at the end is a set of feature ideas I proposed myself (not yet requested in
detail) — sound effects, PGN import/export, resign/draw/takeback, a chess clock, save/resume, and a
stretch idea for a puzzle mode built from blunders. Start with item 1 (sound effects) unless told
otherwise — it's the smallest, highest-polish win. Confirm scope with me before starting anything further
down the list, since none of it has been discussed in detail yet, only proposed.
```
