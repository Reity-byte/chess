// ─── GAME REVIEW PAGE ──────────────────────────────────────────────────────────
// Drives analysis.html: loads the just-finished game (handed over through
// localStorage by game.html) or a pasted PGN, streams it through
// analysis-worker.js, and renders the review — classified move list, eval bar,
// eval graph, accuracy, move-quality counts, best-move arrows and lines.
//
// Layout: board column + one side panel (game header, coach caption, tabs
// Moves / Summary / Retry, pinned navigation). From any position you can play
// your own moves: each one is judged like a game move and the line shows up in
// the move list; a live engine shows the best lines for whatever is on the board.
const HANDOFF_KEY = 'chessGameForAnalysis';
const MODE_KEY = 'chessAnalysisMode';
const PUZZLE_BANK_KEY = 'chessPuzzleBank';
const PUZZLE_BANK_CAP = 300;
const NOTABLE = new Set(['Brilliant', 'Great', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder']);

let game = null;        // { sanMoves, moves: [{ move, promo }], white, black, result }
let entries = [];       // per-move analysis, filled in as the worker streams it
let report = null;      // the finished report
let startEval = null;
let analyzing = false;
let selectedPly = -1;   // -1 = starting position
let analysisMode = 'standard';
let board = null;
let flipped = false;

// Side lines the player tries on the board. They stay in the move list until
// deleted. A line branches from the game (parent null: alternatives to game
// move branchPly + 1) or from another line (parent { id, index }: alternatives
// to that line's move index + 1). A board position is a "node": { ply } on the
// game itself, or { id, index } on a line.
let variations = [];    // [{ id, branchPly, parent, moves: [{ color, san, move, promo, verdict, engine }] }]
let cursor = null;      // null = the game at selectedPly, else the { id, index } node shown
let nextVariationId = 1;
let puzzle = null;      // { ply, target, solved }
let retry = null;       // see RETRY MISTAKES
let pendingRetry = null; // { ply } — start Retry once the review is ready (asked for by the Trainer)

const $ = (id) => document.getElementById(id);

// ─── STARTUP ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    board = new BoardView($('chessboard'), {
        canSelect: (x, y) => canPlayOnBoard() && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onBoardMove,
    });
    board.setInteractive(true);
    board.render(gameState, { animate: false });

    $('navStart').addEventListener('click', () => goTo(-1));
    $('navPrev').addEventListener('click', stepBack);
    $('navNext').addEventListener('click', stepForward);
    $('navEnd').addEventListener('click', goToEnd);
    $('navFlip').addEventListener('click', flipBoard);
    $('backToGameButton').addEventListener('click', backToGame);
    $('exitPuzzleButton').addEventListener('click', () => selectPly(puzzle ? puzzle.ply : selectedPly));
    $('tryPuzzleButton').addEventListener('click', startPuzzle);
    $('retryButton').addEventListener('click', () => startRetry());
    $('retryExitButton').addEventListener('click', () => exitRetry());
    $('analyzePgnButton').addEventListener('click', importPGN);
    $('cancelLoadButton').addEventListener('click', closeLoadModal);
    $('loadModal').addEventListener('click', (e) => { if (e.target === $('loadModal')) closeLoadModal(); });
    $('loadGameButton').addEventListener('click', () => { closeMenu(); openLoadModal(); });
    $('emptyLoadButton').addEventListener('click', openLoadModal);
    $('copyPgnButton').addEventListener('click', () => { closeMenu(); copyPGN(); });
    $('downloadPgnButton').addEventListener('click', () => { closeMenu(); downloadPGN(); });
    $('menuButton').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
    document.querySelectorAll('.side-tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('walkButton').addEventListener('click', startWalk);
    $('liveToggle').addEventListener('change', (e) => setLiveOn(e.target.checked));
    $('liveMoreButton').addEventListener('click', () => setLiveExpanded(!liveExpanded));
    try { liveOn = localStorage.getItem(LIVE_KEY) !== 'off'; } catch (e) { /* default on */ }
    try { liveExpanded = localStorage.getItem(LIVE_LINES_KEY) === 'all'; } catch (e) { /* default: one line */ }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('loadModal').classList.contains('hidden')) { closeLoadModal(); return; }
        if ((e.target.closest && e.target.closest('textarea, input')) || document.querySelector('.modal-overlay:not(.hidden)')) return;
        const keys = { ArrowLeft: stepBack, ArrowRight: stepForward, Home: () => goTo(-1), End: goToEnd,
                       f: flipBoard, F: flipBoard, ' ': playEngineMove, Escape: leaveTrainingMode };
        if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    });

    try { analysisMode = localStorage.getItem(MODE_KEY) || 'standard'; } catch (e) { /* default */ }
    if (!ANALYSIS_MODES[analysisMode]) analysisMode = 'standard';
    document.querySelectorAll('#modeSelect button').forEach(b => {
        b.addEventListener('click', () => {
            if (b.dataset.mode === analysisMode) return;
            analysisMode = b.dataset.mode;
            try { localStorage.setItem(MODE_KEY, analysisMode); } catch (e) { /* ignore */ }
            syncModeButtons();
            if (game) startAnalysis();
        });
    });
    syncModeButtons();

    let handoff = null;
    try { handoff = JSON.parse(localStorage.getItem(HANDOFF_KEY)); } catch (e) { handoff = null; }
    // Older versions stored a bare SAN array.
    if (Array.isArray(handoff)) handoff = { sanMoves: handoff };
    if (handoff && Array.isArray(handoff.sanMoves) && handoff.sanMoves.length) {
        // The Trainer can ask for Retry mistakes to start (once — the flag is
        // dropped so a later visit opens the review normally).
        if (handoff.retry) {
            pendingRetry = { ply: Number.isInteger(handoff.retryPly) ? handoff.retryPly : null };
            const { retry: _r, retryPly: _p, ...rest } = handoff;
            try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(rest)); } catch (e) { /* fine */ }
        }
        loadGame(handoff);
    } else {
        showEmptyState();
    }
    window.addEventListener('resize', debounce(renderGraph, 120));
});

function syncModeButtons() {
    document.querySelectorAll('#modeSelect button').forEach(b => b.classList.toggle('selected', b.dataset.mode === analysisMode));
}

function showEmptyState() {
    setCaption({ icon: '♟', title: 'No game to review yet', line: 'Play a game, or load one from a PGN.' });
    $('progressText').textContent = 'No game loaded';
    $('movesEmpty').classList.remove('hidden');
    renderCounts();
    renderLive();
    openLoadModal();
}

// ─── SIDE PANEL: TABS, MENU, LOAD / EXPORT ─────────────────────────────────────
let activeTab = 'moves';

// Leaving the Retry tab ends a retry in progress (it owns the board).
function setTab(name) {
    if (name === activeTab) return;
    if (activeTab === 'retry' && retry) exitRetry();
    activeTab = name;
    document.querySelectorAll('.side-tabs button').forEach(b => {
        b.classList.toggle('selected', b.dataset.tab === name);
        b.setAttribute('aria-selected', String(b.dataset.tab === name));
    });
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== name));
    if (name === 'moves') highlightMoveCell();
}

function toggleMenu() {
    const open = $('reviewMenu').classList.toggle('hidden') === false;
    $('menuButton').setAttribute('aria-expanded', String(open));
}
function closeMenu() {
    $('reviewMenu').classList.add('hidden');
    $('menuButton').setAttribute('aria-expanded', 'false');
}

function openLoadModal() {
    $('loadModal').classList.remove('hidden');
    $('pgnInput').focus();
}
function closeLoadModal() { $('loadModal').classList.add('hidden'); }

function gamePGN() {
    const tokens = game.sanMoves.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + san);
    return [`[White "${game.white}"]`, `[Black "${game.black}"]`, `[Result "${game.result}"]`, '', tokens.join(' ') + ' ' + game.result].join('\n');
}

async function copyPGN() {
    if (!game) return;
    try { await navigator.clipboard.writeText(gamePGN()); showToast('PGN copied.'); } catch (e) { showToast('Copying isn\'t allowed here.'); }
}

function downloadPGN() {
    if (!game) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gamePGN() + '\n'], { type: 'application/x-chess-pgn' }));
    a.download = `game-review-${new Date().toISOString().slice(0, 10)}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ─── LOADING A GAME ────────────────────────────────────────────────────────────
function loadGame(data) {
    resetGame();
    const moves = [];
    for (const san of data.sanMoves) {
        const r = resolveSAN(currentTurn, san);
        if (!r) break;
        moves.push(r);
        applyMoveWithPromotion(r.move, r.promo);
    }
    if (moves.length < data.sanMoves.length) {
        showToast(`Stopped at move ${Math.floor(moves.length / 2) + 1}: "${data.sanMoves[moves.length]}" isn't legal here.`, 4000);
    }
    if (moves.length === 0) { showEmptyState(); return; }

    game = {
        sanMoves: data.sanMoves.slice(0, moves.length), moves,
        white: data.white || 'White', black: data.black || 'Black', result: data.result || '*',
        historyId: data.historyId || null,
    };
    variations = [];
    cursor = null;
    flipped = isYou(game.black) && !isYou(game.white);
    board.setFlipped(flipped);
    $('evalBar').classList.toggle('flipped', flipped);
    $('movesEmpty').classList.add('hidden');
    const shortName = (n) => n.replace(/\s*\(.*\)$/, ''); // "Engine (≈960)" -> "Engine" in the header
    $('accWhiteName').textContent = shortName(game.white);
    $('accBlackName').textContent = shortName(game.black);
    $('gameResult').textContent = { '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½' }[game.result] || '';
    stopWalk();
    setTab('moves');
    updatePlayerStrips();
    buildMoveList();
    selectPly(-1);
    startAnalysis();
}

// "You", or "You (934)" as older handoffs and the game PGN name the player.
function isYou(name) { return /^You\b/.test(name || ''); }

function importPGN() {
    const parsed = parsePGN($('pgnInput').value);
    if (parsed.sanMoves.length === 0) { showToast('No moves found in that text.'); return; }
    try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(parsed)); } catch (e) { /* still analyze */ }
    $('pgnInput').value = '';
    closeLoadModal();
    loadGame(parsed);
}

// PGN (or bare movetext) -> { sanMoves, white, black, result }. Drops headers,
// comments, NAGs, move numbers, nested variations and the result marker.
function parsePGN(text) {
    const headers = {};
    text.replace(/\[(\w+)\s+"([^"]*)"\]/g, (_, k, v) => { headers[k] = v; return ''; });
    let body = text.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
    let prev;
    do { prev = body; body = body.replace(/\([^()]*\)/g, ' '); } while (body !== prev);
    body = body.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ');
    const sanMoves = body.split(/\s+/).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
    return { sanMoves, white: headers.White, black: headers.Black, result: headers.Result };
}

// ─── RUNNING THE ANALYSIS ──────────────────────────────────────────────────────
// The review runs on a worker pool (review-runner.js) and streams into the page
// move by move. When a Quick review of the same game is already cached (the game
// page makes one for its after-game card) it is shown at once, and the chosen
// mode refines it in the background, replacing it when done.
let analysisJob = null;  // runReview() handle while a review runs
let analysisRun = 0;     // bumps per analysis; callbacks from older runs are ignored
let refining = false;    // a cached quicker report is on screen while this run finishes

function stopAnalysisJob() {
    if (analysisJob) analysisJob.cancel();
    analysisJob = null;
}

function startAnalysis() {
    stopAnalysisJob();
    entries = [];
    report = null;
    startEval = null;
    refining = false;
    clearPuzzle();
    clearRetry();
    stopLive();
    refreshAllMoveCells();
    stopWalk();
    renderKeyMoments();
    updateRetryButton();
    const run = ++analysisRun;

    const cached = loadCachedReview(game.sanMoves, analysisMode);
    if (cached) { finishAnalysis(cached, true); return; }
    const quick = analysisMode !== 'quick' ? loadCachedReview(game.sanMoves, 'quick') : null;
    if (quick) {
        finishAnalysis(quick, true);
        refining = true;
    } else {
        analyzing = true;
        renderSummary();
        renderGraph();
    }

    analysisJob = runReview(game.sanMoves, analysisMode, {
        onStart: (opening) => { if (run === analysisRun && !refining) renderOpening(opening); },
        onMove: (entry, start, received) => {
            if (run !== analysisRun) return;
            setProgress(received, game.sanMoves.length, entry.depth);
            if (refining) return; // the quick report stays until the whole run is in
            if (start !== null && start !== undefined) startEval = start;
            entries[entry.ply] = entry;
            updateMoveCell(entry.ply);
            renderGraph();
            renderCounts();
            if (entry.ply === selectedPly || (selectedPly === -1 && entry.ply === 0)) refreshSelection();
        },
        onFinalizing: () => { if (run === analysisRun) $('progressText').textContent = refining ? 'Refining… building the report' : 'Building the report…'; },
        onDone: (finished) => {
            if (run !== analysisRun) return;
            analysisJob = null;
            refining = false;
            finishAnalysis(finished, false);
        },
        onError: (message) => { if (run === analysisRun) analysisFailed(message); },
    });
    if (!analysisJob) {
        $('progressText').textContent = 'Analysis needs the site served over http(s) (Web Workers are blocked here).';
        analyzing = false;
        refining = false;
        return;
    }
    setProgress(0, game.sanMoves.length);
}

function analysisFailed(message) {
    analyzing = false;
    refining = false;
    stopAnalysisJob();
    $('progressBox').classList.remove('hidden');
    $('progressText').textContent = 'Analysis failed: ' + message;
}

function finishAnalysis(finished, fromCache) {
    report = finished;
    entries = finished.perMove.slice();
    startEval = finished.startEval;
    analyzing = false;
    refreshAllMoveCells();
    renderVariations();
    renderOpening(finished.opening);
    renderSummary();
    renderGraph();
    renderCounts();
    renderKeyMoments();
    $('progressBox').classList.add('hidden');
    refreshSelection();
    updateRetryButton();
    if (!fromCache) {
        saveCachedReview(game.sanMoves, analysisMode, finished);
        growPuzzleBank(game.sanMoves, finished.perMove);
    }
    if (game.historyId) saveReviewToHistory(finished);
    updatePlayerStrips();
    if (pendingRetry) {
        const wanted = pendingRetry.ply;
        pendingRetry = null;
        if (retryPlies().length) {
            startRetry();
            const i = retry.plies.indexOf(wanted);
            if (i > 0) showRetryItem(i);
        }
    }
}

function setProgress(done, total, depth) {
    $('progressBox').classList.remove('hidden');
    $('progressFill').style.width = `${total ? (done / total) * 100 : 0}%`;
    const label = ANALYSIS_MODES[analysisMode].label;
    $('progressText').textContent = refining ? `Refining to ${label}… ${done} of ${total}` : `Analyzed ${done} of ${total} moves…`;
    const cores = analysisJob && analysisJob.size > 1 ? `${analysisJob.size} cores · ` : '';
    $('progressDepth').textContent = cores + (depth ? `depth ${depth}` : label);
}

// ─── NAVIGATION ────────────────────────────────────────────────────────────────
function goTo(ply) { if (game) selectPly(ply); }

function stepBack() {
    if (!game || retry) return;
    if (puzzle) { selectPly(puzzle.ply); return; }
    if (cursor) { goToNode(parentNode(cursor)); return; }
    selectPly(Math.max(-1, selectedPly - 1));
}

function stepForward() {
    if (!game || retry || puzzle) return;
    if (cursor) {
        const v = variationById(cursor.id);
        if (cursor.index < v.moves.length - 1) {
            goToNode({ id: v.id, index: cursor.index + 1 });
            playSoundForMove(v.moves[cursor.index].san);
        }
        return;
    }
    if (selectedPly >= game.sanMoves.length - 1) return;
    selectPly(selectedPly + 1);
    playSoundForMove(game.sanMoves[selectedPly]);
}

// End of the line being viewed: the game's last move, or the variation's.
function goToEnd() {
    if (!game || retry) return;
    if (cursor) goToNode({ id: cursor.id, index: variationById(cursor.id).moves.length - 1 });
    else goTo(game.sanMoves.length - 1);
}

// From a variation back to the game position it branched from.
function backToGame() {
    if (!cursor) return;
    let v = variationById(cursor.id);
    while (v.parent) v = variationById(v.parent.id);
    selectPly(v.branchPly);
}

function leaveTrainingMode() {
    if (retry) exitRetry();
    else if (puzzle) selectPly(puzzle.ply);
}

function flipBoard() {
    flipped = !flipped;
    board.setFlipped(flipped);
    $('evalBar').classList.toggle('flipped', flipped);
    updatePlayerStrips();
    refreshEvalBar();
}

function positionAt(ply) {
    resetGame();
    for (let i = 0; i <= ply; i++) applyMoveWithPromotion(game.moves[i].move, game.moves[i].promo);
}

// ─── NODES (game positions and variation positions) ────────────────────────────
function variationById(id) { return variations.find(v => v.id === id); }
function currentNode() { return cursor || { ply: selectedPly }; }
function isGameNode(n) { return n.id === undefined; }

// Every move from the start to node `n` (inclusive): { sans, moves: [{ move, promo }] }.
function nodePath(n) {
    if (isGameNode(n)) return { sans: game.sanMoves.slice(0, n.ply + 1), moves: game.moves.slice(0, n.ply + 1) };
    const v = variationById(n.id);
    const base = nodePath(v.parent || { ply: v.branchPly });
    const tail = v.moves.slice(0, n.index + 1);
    return {
        sans: base.sans.concat(tail.map(m => m.san)),
        moves: base.moves.concat(tail.map(m => ({ move: m.move, promo: m.promo }))),
    };
}

// Ply of a variation's first move.
function variationStartPly(v) {
    return v.parent ? nodePly(v.parent) + 1 : v.branchPly + 1;
}
function nodePly(n) { return isGameNode(n) ? n.ply : variationStartPly(variationById(n.id)) + n.index; }

function parentNode(n) {
    if (isGameNode(n)) return { ply: Math.max(-1, n.ply - 1) };
    if (n.index > 0) return { id: n.id, index: n.index - 1 };
    const v = variationById(n.id);
    return v.parent ? { ...v.parent } : { ply: v.branchPly };
}

function goToNode(n) {
    if (isGameNode(n)) { selectPly(n.ply); return; }
    clearPuzzle();
    clearRetry();
    cursor = { id: n.id, index: n.index };
    resetGame();
    for (const m of nodePath(cursor).moves) applyMoveWithPromotion(m.move, m.promo);
    board.clearSelection();
    board.render(gameState);
    refreshSelection();
}

// Shows a real game position; leaves any variation, puzzle or retry.
function selectPly(ply) {
    if (!game) return;
    clearPuzzle();
    clearRetry();
    cursor = null;
    selectedPly = Math.max(-1, Math.min(ply, game.sanMoves.length - 1));
    positionAt(selectedPly);
    board.clearSelection();
    board.render(gameState);
    refreshSelection();
}

// The analysis entry for the move that led to the shown position: a game
// move's from the review, a variation move's from judging it (null until then).
function nodeEntry() {
    if (cursor) {
        const m = variationById(cursor.id).moves[cursor.index];
        return m.verdict && m.verdict.category ? m.verdict : null;
    }
    return selectedPly >= 0 ? entries[selectedPly] || null : null;
}

// Redraws everything that depends on the shown position (marks, arrows,
// caption, eval, move-list highlight) and points the live engine at it.
function refreshSelection() {
    if (!game || puzzle || retry) return;
    const entry = nodeEntry();
    const last = cursor ? variationById(cursor.id).moves[cursor.index].move
        : selectedPly >= 0 ? game.moves[selectedPly].move : null;

    board.setLastMove(last ? { x: last.fromX, y: last.fromY } : null, last ? { x: last.toX, y: last.toY } : null);
    board.updateCheckFromGame();
    board.setBadge(entry && last ? {
        x: last.toX, y: last.toY, glyph: CATEGORY_SYMBOLS[entry.category],
        color: CATEGORY_COLORS[entry.category], title: entry.category,
    } : null);
    $('variationBanner').classList.toggle('hidden', !cursor);
    updatePlayerStrips(); // captured pieces follow the shown position

    if (cursor) renderVariationCaption();
    else renderCaption(selectedPly, entry);
    highlightMoveCell();
    renderGraphCursor();
    const atStart = !cursor && selectedPly < 0;
    const atEnd = cursor ? cursor.index >= variationById(cursor.id).moves.length - 1 : selectedPly >= game.sanMoves.length - 1;
    $('navPrev').disabled = atStart;
    $('navStart').disabled = atStart;
    $('navNext').disabled = atEnd;
    $('navEnd').disabled = atEnd;
    renderWalkBar();
    startLive(); // also redraws the arrows and the eval bar
}

const BEST_ARROW = 'rgba(129, 199, 84, 0.85)';   // the better move instead of the one just played
const LIVE_ARROW = 'rgba(72, 142, 232, 0.82)';   // the live engine's move from here
const PLAYED_ARROW = 'rgba(226, 72, 60, 0.6)';   // retry: the move played in the game
const PUNISH_ARROW = 'rgba(226, 72, 60, 0.85)';  // retry: the reply that refutes an attempt

function arrowFor(m, color, width) {
    return { from: { x: m.fromX, y: m.fromY }, to: { x: m.toX, y: m.toY }, color, width };
}

function refreshArrows() {
    if (puzzle || retry) return;
    const arrows = [];
    const entry = nodeEntry();
    if (entry && entry.bestMove && !['Book', 'Forced'].includes(entry.category)) arrows.push(arrowFor(entry.bestMove, BEST_ARROW));
    const top = liveForShownPosition() && live.lines[0];
    if (liveOn && top && top.move) arrows.push(arrowFor(top.move, LIVE_ARROW, 0.13));
    board.setArrows(arrows);
}

function evalAtPly(ply) {
    if (ply < 0) return startEval;
    return entries[ply] ? entries[ply].evalAfter : null;
}

// The shown position's evaluation (White's view): the live engine's once it
// has searched a little, else the review's (or the judged variation move's).
function currentEval() {
    const l = liveForShownPosition();
    const stored = cursor ? (nodeEntry() ? nodeEntry().evalAfter : null) : evalAtPly(selectedPly);
    if (l && l.evalWhite !== undefined && (l.terminal || l.depth >= 8 || l.done || stored === null)) return l.evalWhite;
    return stored;
}

function refreshEvalBar(value) {
    const v = value !== undefined ? value : currentEval();
    const fill = $('evalFill'), label = $('evalLabel');
    if (v === null || v === undefined) {
        fill.style.height = '50%';
        label.textContent = '';
        return;
    }
    fill.style.height = `${(evalToBarFraction(v) * 100).toFixed(1)}%`;
    const whiteAhead = v >= 0;
    label.textContent = formatEval(v).replace(/^[+-]/, '');
    // The label sits on the advantaged side's end of the bar.
    const atBottom = whiteAhead !== flipped;
    label.className = 'eval-label ' + (atBottom ? 'bottom' : 'top');
    label.style.color = whiteAhead ? '#1b1d21' : '#eef0f2';
}

// ─── CAPTION ───────────────────────────────────────────────────────────────────
function moveNumberPrefix(ply) {
    return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`;
}

// SAN list starting at `startPly` -> "12. Nf3 Nc6 13. d4" (or "12... Nc6 13. d4").
function formatLine(sans, startPly, max = 8) {
    const parts = [];
    sans.slice(0, max).forEach((san, i) => {
        const ply = startPly + i;
        if (ply % 2 === 0) parts.push(`${Math.floor(ply / 2) + 1}. ${san}`);
        else parts.push(i === 0 ? `${Math.floor(ply / 2) + 1}... ${san}` : san);
    });
    return parts.join(' ') + (sans.length > max ? ' …' : '');
}

function setCaption({ icon, color, title, evalText, line, line2 }) {
    $('captionIcon').textContent = icon || '';
    $('captionIcon').style.background = color || '';
    const t = $('captionTitle');
    t.textContent = title || '';
    if (evalText) {
        const pill = document.createElement('span');
        pill.className = 'eval-pill' + (evalText.startsWith('+') || evalText === '1-0' || /^M\d/.test(evalText) ? ' white-adv' : '');
        pill.textContent = evalText;
        t.appendChild(pill);
    }
    $('captionLine').innerHTML = line || '';
    $('captionLine2').innerHTML = line2 || '';
}

function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderCaption(ply, entry) {
    const puzzleBtn = $('tryPuzzleButton');
    puzzleBtn.classList.add('hidden');
    if (ply < 0) {
        setCaption({
            icon: '♟', title: 'Starting position',
            evalText: startEval !== null ? formatEval(startEval) : '',
            line: report && report.opening ? `Opening: <strong>${escapeHTML(report.opening)}</strong>` : 'Use → or the move list to step through the game.',
        });
        return;
    }
    const san = game.sanMoves[ply];
    if (!entry) {
        setCaption({ icon: '…', title: `${moveNumberPrefix(ply)} ${san}`, line: analyzing ? 'Analyzing this move…' : 'Not analyzed.' });
        return;
    }
    describeEntry(entry, san, ply);
    if (['Mistake', 'Miss', 'Blunder'].includes(entry.category) && entry.punishMove && !analyzing) puzzleBtn.classList.remove('hidden');
}

function renderVariationCaption() {
    $('tryPuzzleButton').classList.add('hidden');
    const m = variationById(cursor.id).moves[cursor.index];
    const ply = nodePly(cursor);
    if (m.verdict && m.verdict.category) { describeEntry(m.verdict, m.san, ply); return; }
    const line = m.engine ? 'From the engine\'s line.' : m.verdict && m.verdict.failed ? 'This move couldn\'t be checked.' : 'Checking this move…';
    setCaption({ icon: m.engine ? '⚙' : '…', title: `${moveNumberPrefix(ply)} ${m.san}`, line });
}

// Caption for a rated move: its category, the reason, and the better move.
function describeEntry(entry, san, ply) {
    const cat = entry.category;
    let line = '', line2 = '';
    if (cat === 'Book') line = report && report.opening ? `Opening theory — ${escapeHTML(report.opening)}` : 'A known opening move.';
    else if (cat === 'Forced') line = 'The only legal move.';
    else if (cat === 'Brilliant') line = `Gives up ${materialWord(entry.sacrifice)} — and the engine approves.`;
    else if (cat === 'Great') line = 'The only move that keeps the position together.';

    const praised = cat === 'Brilliant' || cat === 'Great';
    if (entry.bestMove && praised) {
        // A brilliant/great move the engine rates level with another: the move's
        // own story leads; the equally good alternative is a footnote.
        line2 = `Also good: <strong>${escapeHTML(entry.bestMove.san)}</strong>`;
    } else if (entry.bestMove) {
        const bestText = `Best was <strong>${escapeHTML(entry.bestMove.san)}</strong> <span class="eval-pill">${formatEval(entry.evalBefore)}</span>`;
        const lineText = entry.bestLine && entry.bestLine.length > 1 ? `<span class="san-line">${escapeHTML(formatLine(entry.bestLine, ply))}</span>` : '';
        if (entry.reason) {
            // The concrete "why" leads; the better move and its line follow.
            line = `<span class="reason">${escapeHTML(entry.reason)}</span>`;
            line2 = bestText + (lineText ? ` · ${lineText}` : '');
        } else {
            line = bestText + (cat === 'Miss' ? ' — an opportunity left on the table.' : '');
            line2 = lineText;
        }
    } else if (entry.punishLine && entry.punishLine.length && !['Book', 'Forced'].includes(cat)) {
        line2 = `Continuation: <span class="san-line">${escapeHTML(formatLine(entry.punishLine, ply + 1, 6))}</span>`;
    }
    if (entry.reason && !entry.bestMove) line = `<span class="reason">${escapeHTML(entry.reason)}</span>`;
    if (!line && cat !== 'Book') line = 'Matches the engine.';

    setCaption({
        icon: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat],
        title: `${moveNumberPrefix(ply)} ${san} is ${CATEGORY_DESCRIPTIONS[cat]}`,
        evalText: formatEval(entry.evalAfter), line, line2,
    });
}

function materialWord(cp) {
    if (cp >= 800) return 'the queen';
    if (cp >= 450) return 'a rook';
    if (cp >= 250) return 'a piece';
    return 'material';
}

// ─── MOVE LIST ─────────────────────────────────────────────────────────────────
function buildMoveList() {
    const grid = $('movesGrid');
    grid.innerHTML = '';
    for (let i = 0; i < game.sanMoves.length; i += 2) {
        const num = document.createElement('div');
        num.className = 'mv-num';
        num.textContent = `${i / 2 + 1}.`;
        grid.appendChild(num);
        for (const ply of [i, i + 1]) {
            const cell = document.createElement('div');
            cell.className = 'mv';
            if (ply < game.sanMoves.length) {
                cell.dataset.ply = ply;
                cell.classList.add('clickable');
                cell.addEventListener('click', () => selectPly(ply));
            }
            grid.appendChild(cell);
        }
    }
    refreshAllMoveCells();
}

function refreshAllMoveCells() {
    if (!game) return;
    for (let i = 0; i < game.sanMoves.length; i++) updateMoveCell(i);
}

function updateMoveCell(ply) {
    const cell = document.querySelector(`#movesGrid .mv[data-ply="${ply}"]`);
    if (!cell) return;
    const entry = entries[ply];
    cell.innerHTML = '';
    if (entry) {
        const icon = document.createElement('span');
        icon.className = 'mv-icon';
        icon.style.background = CATEGORY_COLORS[entry.category];
        icon.textContent = CATEGORY_SYMBOLS[entry.category];
        cell.appendChild(icon);
        cell.title = `${entry.category} · ${formatEval(entry.evalAfter)}`;
    }
    cell.appendChild(document.createTextNode(game.sanMoves[ply]));
    cell.style.opacity = entry || !analyzing ? '' : '0.55';
}

function highlightMoveCell() {
    document.querySelectorAll('#movesGrid .mv.active, #movesGrid .variation-move.active').forEach(c => c.classList.remove('active'));
    const cell = cursor
        ? document.querySelector(`#movesGrid .variation-move[data-var="${cursor.id}"][data-index="${cursor.index}"]`)
        : document.querySelector(`#movesGrid .mv[data-ply="${selectedPly}"]`);
    if (!cell) return;
    cell.classList.add('active');
    const scroller = $('movesScroll');
    const top = cell.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    if (top < scroller.scrollTop || top > scroller.scrollTop + scroller.clientHeight - 40) {
        scroller.scrollTop = top - scroller.clientHeight / 2;
    }
}

// ─── SUMMARY: ACCURACY, OPENING, COUNTS, PHASES ────────────────────────────────
function renderOpening(name) {
    $('openingLine').innerHTML = name ? `Opening: <strong>${escapeHTML(name)}</strong>` : '';
}

function updatePlayerStrips() {
    const topColor = flipped ? 'white' : 'black';
    const bottomColor = flipped ? 'black' : 'white';
    const name = (c) => game ? (c === 'white' ? game.white : game.black) : (c === 'white' ? 'White' : 'Black');
    $('topName').textContent = name(topColor);
    $('bottomName').textContent = name(bottomColor);
    $('topAvatar').className = `piece-icon ${topColor} king`;
    $('bottomAvatar').className = `piece-icon ${bottomColor} king`;
    renderCaptured($('topCaptured'), topColor);
    renderCaptured($('bottomCaptured'), bottomColor);
    const acc = report ? report.accuracy : null;
    for (const [id, color] of [['topAcc', topColor], ['bottomAcc', bottomColor]]) {
        const v = acc ? acc[color] : null;
        $(id).hidden = v === null || v === undefined;
        if (v !== null && v !== undefined) $(id).textContent = `${v.toFixed(1)}% accuracy`;
    }
}

function renderSummary() {
    const acc = report ? report.accuracy : null;
    $('accWhite').textContent = acc && acc.white !== null ? acc.white.toFixed(1) : '–';
    $('accBlack').textContent = acc && acc.black !== null ? acc.black.toFixed(1) : '–';
    updatePlayerStrips();
    for (const color of ['white', 'black']) {
        const row = $(color === 'white' ? 'phaseWhite' : 'phaseBlack');
        const ph = report && report.phaseAccuracy ? report.phaseAccuracy[color] : {};
        const cells = row.querySelectorAll('span');
        ['opening', 'middlegame', 'endgame'].forEach((p, i) => {
            const v = ph[p];
            cells[i + 1].className = 'phase-chip';
            cells[i + 1].textContent = v === null || v === undefined ? '–' : v;
            cells[i + 1].style.color = v === null || v === undefined ? '' : v >= 90 ? 'var(--accent)' : v >= 75 ? '' : v >= 60 ? 'var(--warning)' : 'var(--danger)';
        });
    }
}

// Move quality as a compact two-column grid: icon, name, White's and Black's
// count (click a count to jump to that side's next such move).
function renderCounts() {
    const grid = $('countsTable');
    grid.innerHTML = '';
    const counts = { white: {}, black: {} };
    entries.forEach(e => { if (e) counts[e.color][e.category] = (counts[e.color][e.category] || 0) + 1; });
    for (const cat of CATEGORY_ORDER) {
        const cell = document.createElement('div');
        cell.className = 'quality-cell';
        cell.innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[cat]}">${CATEGORY_SYMBOLS[cat]}</span><span>${cat}</span>`;
        for (const color of ['white', 'black']) {
            const n = counts[color][cat] || 0;
            const span = document.createElement('span');
            span.className = 'n' + (n ? ' clickable' : ' zero');
            span.textContent = n;
            span.style.color = n ? CATEGORY_COLORS[cat] : '';
            if (n) {
                span.title = `Jump to ${color}'s next ${cat.toLowerCase()} move`;
                span.addEventListener('click', () => { jumpToCategory(color, cat); setTab('moves'); });
            }
            cell.appendChild(span);
        }
        grid.appendChild(cell);
    }
}

// ─── HISTORY ───────────────────────────────────────────────────────────────────
// Stores the review's headline numbers on the game in the history list (the
// history page shows accuracy and tallies the kinds of mistakes made).
function saveReviewToHistory(finished) {
    updateHistoryGame(game.historyId, reviewHistoryFields(finished));
}

// ─── KEY MOMENTS ───────────────────────────────────────────────────────────────
// The handful of moves that decided the game: the biggest swings plus any
// brilliant or great moves, listed in game order with their explanation.
const KEY_MOMENT_COUNT = 5;

function keyMoments() {
    const weight = (e) => e.category === 'Brilliant' ? 40 : e.category === 'Great' ? 15
        : ['Blunder', 'Miss', 'Mistake'].includes(e.category) ? e.winLoss : 0;
    return entries.filter(e => e && weight(e) > 0)
        .sort((a, b) => weight(b) - weight(a))
        .slice(0, KEY_MOMENT_COUNT)
        .sort((a, b) => a.ply - b.ply);
}

function momentText(e) {
    if (e.reason) return e.reason;
    if (e.category === 'Brilliant') return `Gives up ${materialWord(e.sacrifice)} — and it works.`;
    if (e.category === 'Great') return 'The only move that holds the position.';
    return e.bestMove ? `Best was ${e.bestMove.san}.` : CATEGORY_DESCRIPTIONS[e.category];
}

function renderKeyMoments() {
    const list = $('keyMomentsList');
    list.innerHTML = '';
    const moments = report ? keyMoments() : [];
    $('walkButton').disabled = !moments.length;
    if (!report) {
        list.innerHTML = `<div class="moves-empty">${game ? 'Appears when the review is finished.' : 'No game loaded.'}</div>`;
        return;
    }
    if (!moments.length) {
        list.innerHTML = '<div class="moves-empty">A clean game — no big swings.</div>';
        return;
    }
    for (const e of moments) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'moment';
        const name = e.color === 'white' ? game.white : game.black;
        row.innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[e.category]}">${CATEGORY_SYMBOLS[e.category]}</span>`
            + `<span class="moment-body"><span class="moment-title">${moveNumberPrefix(e.ply)} ${escapeHTML(e.san)}`
            + ` <span class="faint">· ${escapeHTML(name)} · ${e.category}</span></span>`
            + `<span class="moment-text">${escapeHTML(momentText(e))}</span></span>`
            + `<span class="moment-eval">${formatEval(e.evalAfter)}</span>`;
        row.addEventListener('click', () => selectPly(e.ply));
        list.appendChild(row);
    }
}

// ─── WALK-THROUGH ──────────────────────────────────────────────────────────────
// "Walk me through it" (only when asked): steps through the key moments, each
// on the board with its explanation in the coach caption, then offers Retry.
let walk = null; // { moments: [ply], index } — index === moments.length is the end card

function startWalk() {
    const moments = keyMoments().map(e => e.ply);
    if (!moments.length) return;
    walk = { moments, index: 0 };
    setTab('moves');
    selectPly(moments[0]);
}

function walkTo(index) {
    walk.index = Math.max(0, Math.min(index, walk.moments.length));
    if (walk.index < walk.moments.length) selectPly(walk.moments[walk.index]);
    else renderWalkBar();
}

function stopWalk() {
    walk = null;
    renderWalkBar();
}

function renderWalkBar() {
    const bar = $('walkBar');
    if (!walk || retry || puzzle) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    const n = walk.moments.length;
    const label = document.createElement('span');
    label.className = 'walk-label';
    bar.appendChild(label);
    const button = (text, fn, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + cls;
        b.textContent = text;
        b.addEventListener('click', fn);
        bar.appendChild(b);
    };
    if (walk.index >= n) {
        const mistakes = retryPlies().length;
        label.textContent = `That's the game — ${n} key moment${n === 1 ? '' : 's'}.`;
        if (mistakes) button(`↻ Retry ${mistakes} mistake${mistakes === 1 ? '' : 's'}`, () => { stopWalk(); startRetry(); }, 'btn-primary');
        button('Close', stopWalk);
        return;
    }
    const onMoment = !cursor && selectedPly === walk.moments[walk.index];
    label.textContent = onMoment ? `Key moment ${walk.index + 1} of ${n}` : 'Walk-through paused';
    if (onMoment) {
        if (walk.index > 0) button('◀', () => walkTo(walk.index - 1));
        button(walk.index + 1 < n ? 'Next moment ▶' : 'Finish', () => walkTo(walk.index + 1), 'btn-primary');
    } else {
        button('Resume ▶', () => walkTo(walk.index), 'btn-primary');
    }
    button('✕', stopWalk);
}

// Cycles through `color`'s moves of category `cat`, starting after the selection.
function jumpToCategory(color, cat) {
    const plies = entries.filter(e => e && e.color === color && e.category === cat).map(e => e.ply);
    if (!plies.length) return;
    const next = plies.find(p => p > selectedPly);
    selectPly(next !== undefined ? next : plies[0]);
}

// ─── EVAL GRAPH ────────────────────────────────────────────────────────────────
// A timeline strip under the board: click or drag along it to jump through the game.
const GRAPH_H = 56;

function graphPoints() {
    const pts = [];
    if (startEval === null) return pts;
    pts.push({ k: 0, v: startEval });
    for (let i = 0; i < game.sanMoves.length; i++) {
        if (!entries[i]) break;
        pts.push({ k: i + 1, v: entries[i].evalAfter, entry: entries[i] });
    }
    return pts;
}

function renderGraph() {
    const svg = $('evalGraph');
    if (!svg) return;
    const W = Math.max(200, svg.clientWidth || 340), H = GRAPH_H;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.appendChild(el); return el; };
    const n = game ? Math.max(1, game.sanMoves.length) : 1;
    const x = (k) => (k / n) * W;
    const y = (v) => H - evalToBarFraction(v) * (H - 4) - 2;

    const pts = game ? graphPoints() : [];
    if (pts.length) {
        let d = `M0,${H} `;
        pts.forEach(p => { d += `L${x(p.k).toFixed(1)},${y(p.v).toFixed(1)} `; });
        d += `L${x(pts[pts.length - 1].k).toFixed(1)},${H} Z`;
        add('path', { d, class: 'area' });
    }
    add('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: 'mid' });
    for (const p of pts) {
        if (!p.entry || !NOTABLE.has(p.entry.category)) continue;
        add('circle', { cx: x(p.k), cy: y(p.v), r: 3.6, fill: CATEGORY_COLORS[p.entry.category], class: 'dot' });
    }
    const cursor = add('line', { x1: 0, y1: 0, x2: 0, y2: H, class: 'cursor', id: 'graphCursor' });
    cursor.style.display = 'none';
    renderGraphCursor();

    svg.onmousemove = (e) => {
        if (!game) return;
        const r = svg.getBoundingClientRect();
        const k = Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n)));
        const tip = $('graphTip');
        const v = k === 0 ? startEval : (entries[k - 1] ? entries[k - 1].evalAfter : null);
        if (v === null || v === undefined) { tip.classList.add('hidden'); return; }
        tip.textContent = k === 0 ? `Start ${formatEval(v)}` : `${moveNumberPrefix(k - 1)} ${game.sanMoves[k - 1]}  ${formatEval(v)}`;
        tip.style.left = `${12 + (k / n) * r.width}px`;
        tip.classList.remove('hidden');
    };
    svg.onmouseleave = () => $('graphTip').classList.add('hidden');
    const jump = (e) => {
        const r = svg.getBoundingClientRect();
        const ply = Math.max(-1, Math.min(game.sanMoves.length - 1, Math.round(((e.clientX - r.left) / r.width) * n) - 1));
        if (ply !== selectedPly || cursor) selectPly(ply);
    };
    svg.onpointerdown = (e) => {
        if (!game || retry) return;
        try { svg.setPointerCapture(e.pointerId); } catch (err) { /* still works while over the strip */ }
        svg.dataset.scrubbing = '1';
        jump(e);
    };
    svg.onpointermove = (e) => { if (svg.dataset.scrubbing) jump(e); };
    svg.onpointerup = svg.onpointercancel = () => { delete svg.dataset.scrubbing; };
}

function renderGraphCursor() {
    const c = $('graphCursor'), svg = $('evalGraph');
    if (!c || !game) return;
    const W = Math.max(200, svg.clientWidth || 340);
    const k = selectedPly + 1;
    const xPos = (k / Math.max(1, game.sanMoves.length)) * W;
    c.setAttribute('x1', xPos); c.setAttribute('x2', xPos);
    c.style.display = '';
}

// ─── ANALYSIS BOARD: PLAYING YOUR OWN MOVES ────────────────────────────────────
// Any position can be continued on the board, for either side. Moves that
// leave the game become variations in the move list (a branch inside a
// variation becomes a nested one); each move the player makes is rated by the
// engine in the background, like a game move.
function canPlayOnBoard() {
    if (!game) return false;
    if (retry) return retry.status === 'solving';
    if (puzzle) return !puzzle.solved;
    return true;
}

function onBoardMove(move) {
    if (retry) { retryAttempt(move); return; }
    if (puzzle) { checkPuzzleGuess(move); return; }
    playVariationMove(move);
}

async function playVariationMove(move) {
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo) return;
    }
    addMove(move, promo);
}

function sameSquares(a, b) {
    return !!a && !!b && a.fromX === b.fromX && a.fromY === b.fromY && a.toX === b.toX && a.toY === b.toY;
}

function sameEntryMove(m, move, promo) {
    return !!m && sameSquares(m.move, move) && (m.promo || null) === (promo || null);
}

// Plays `move` from the shown position: follows the game or an existing line
// when the move is already there, otherwise records it. `opts.engine` marks a
// move taken from the engine's line (not judged); `opts.verdict` supplies a
// rating that is already known.
function addMove(move, promo, opts = {}) {
    const color = currentTurn;
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    const entry = {
        color, san: san + getCheckSuffix(currentTurn), move, promo: promo || null,
        verdict: opts.verdict || null, engine: !!opts.engine,
    };
    playSoundForMove(entry.san);
    let target, created = null;
    if (!cursor) {
        const p = selectedPly;
        if (sameEntryMove(game.moves[p + 1], move, promo)) { selectPly(p + 1); return; }
        let v = variations.find(v => !v.parent && v.branchPly === p && sameEntryMove(v.moves[0], move, promo));
        if (!v) {
            v = { id: nextVariationId++, branchPly: p, parent: null, moves: [entry] };
            variations.push(v);
            created = { v, index: 0 };
        }
        target = { id: v.id, index: 0 };
    } else {
        const v = variationById(cursor.id), i = cursor.index;
        if (sameEntryMove(v.moves[i + 1], move, promo)) {
            target = { id: v.id, index: i + 1 };
        } else if (i === v.moves.length - 1) {
            v.moves.push(entry);
            created = { v, index: i + 1 };
            target = { id: v.id, index: i + 1 };
        } else {
            let c = variations.find(c => c.parent && c.parent.id === v.id && c.parent.index === i && sameEntryMove(c.moves[0], move, promo));
            if (!c) {
                c = { id: nextVariationId++, branchPly: null, parent: { id: v.id, index: i }, moves: [entry] };
                variations.push(c);
                created = { v: c, index: 0 };
            }
            target = { id: c.id, index: 0 };
        }
    }
    renderVariations();
    goToNode(target);
    if (created && !entry.engine && !entry.verdict) judgeVariationMove(created.v, created.index);
}

function judgeVariationMove(v, index) {
    const m = v.moves[index];
    const path = nodePath({ id: v.id, index });
    judgeMove(path.sans.slice(0, -1), m.san).then((verdict) => {
        m.verdict = verdict;
    }).catch(() => {
        m.verdict = { failed: true };
    }).then(() => {
        if (!variationById(v.id)) return; // deleted meanwhile
        renderVariations();
        if (cursor && cursor.id === v.id && cursor.index === index && !retry && !puzzle) refreshSelection();
    });
}

// Plays the engine's SAN line `sans` from the shown position.
function playLine(sans) {
    for (const san of sans) {
        const r = resolveSAN(currentTurn, san);
        if (!r) break;
        addMove(r.move, r.promo, { engine: true });
    }
}

// Space: the live engine's top move.
function playEngineMove() {
    const l = liveForShownPosition();
    if (!canPlayOnBoard() || retry || puzzle || !l || !l.lines.length) return;
    playLine([l.lines[0].san]);
}

function deleteVariation(id) {
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const v of variations) {
            if (v.parent && doomed.has(v.parent.id) && !doomed.has(v.id)) { doomed.add(v.id); grew = true; }
        }
    }
    const v = variationById(id);
    const back = v.parent ? { ...v.parent } : { ply: v.branchPly };
    variations = variations.filter(x => !doomed.has(x.id));
    renderVariations();
    if (cursor && doomed.has(cursor.id)) goToNode(back);
}

// ─── MOVE LIST: VARIATIONS ─────────────────────────────────────────────────────
// Each line that branches from the game sits under the row of the game move
// it replaces; lines branching inside it are shown in parentheses.
function renderVariations() {
    const grid = $('movesGrid');
    grid.querySelectorAll('.variation-line').forEach(el => el.remove());
    if (!game) return;
    const lastRow = Math.floor((game.sanMoves.length - 1) / 2);
    const rowOf = (v) => Math.min(lastRow, Math.floor((v.branchPly + 1) / 2));
    const top = variations.filter(v => !v.parent);
    // Bottom-up, so the game rows' cell indices stay valid while inserting.
    const rows = [...new Set(top.map(rowOf))].sort((a, b) => b - a);
    for (const r of rows) {
        let anchor = grid.children[r * 3 + 2];
        for (const v of top.filter(v => rowOf(v) === r)) {
            const line = document.createElement('div');
            line.className = 'variation-line';
            line.appendChild(deleteButton(v.id));
            appendVariationMoves(line, v);
            anchor.after(line);
            anchor = line;
        }
    }
    highlightMoveCell();
}

function deleteButton(id) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'variation-delete';
    del.title = 'Delete this line';
    del.setAttribute('aria-label', 'Delete this line');
    del.textContent = '×';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteVariation(id); });
    return del;
}

function appendVariationMoves(container, v) {
    const start = variationStartPly(v);
    let numbered = false;
    v.moves.forEach((m, i) => {
        const ply = start + i;
        const span = document.createElement('span');
        span.className = 'variation-move' + (m.engine ? ' engine' : '');
        span.dataset.var = v.id;
        span.dataset.index = i;
        const prefix = ply % 2 === 0 ? `${ply / 2 + 1}. ` : !numbered ? `${Math.floor(ply / 2) + 1}... ` : '';
        span.textContent = prefix + m.san;
        if (m.verdict && m.verdict.category && m.verdict.category !== 'Book') {
            const icon = document.createElement('span');
            icon.className = 'mv-icon inline';
            icon.style.background = CATEGORY_COLORS[m.verdict.category];
            icon.textContent = CATEGORY_SYMBOLS[m.verdict.category];
            icon.title = m.verdict.category;
            span.appendChild(icon);
        }
        span.addEventListener('click', () => goToNode({ id: v.id, index: i }));
        container.append(span, ' ');
        numbered = true;
        // Lines branching after the previous move are alternatives to this one.
        for (const c of variations.filter(c => c.parent && c.parent.id === v.id && c.parent.index === i - 1)) {
            const nested = document.createElement('span');
            nested.className = 'variation-nested';
            nested.append('(');
            nested.appendChild(deleteButton(c.id));
            appendVariationMoves(nested, c);
            nested.append(')');
            container.append(nested, ' ');
            numbered = false;
        }
    });
}

// ─── LIVE ENGINE ───────────────────────────────────────────────────────────────
// Its own worker searches the shown position deeper and deeper and reports the
// top three lines. A worker can't be interrupted, so it's replaced whenever
// the position changes (after a short pause, so stepping through moves with
// the arrow keys doesn't start a search per move).
const LIVE_KEY = 'chessLiveEngine';
let liveOn = true;
let liveWorker = null;
let liveRun = 0;
let liveTimer = null;
let live = null; // latest report: { key, depth, lines: [{ move, san, pv, evalWhite }], evalWhite, terminal, done }

function shownPositionKey() { return nodePath(currentNode()).sans.join(' '); }
function liveForShownPosition() { return live && game && live.key === shownPositionKey() ? live : null; }

function stopLive() {
    clearTimeout(liveTimer);
    liveRun++;
    if (liveWorker) { liveWorker.terminate(); liveWorker = null; }
}

function startLive() {
    if (!game) return;
    const key = shownPositionKey();
    if (!(live && live.key === key && (live.done || liveWorker))) {
        stopLive();
        live = null;
        if (liveOn && !analyzing && !refining && !retry && !puzzle) {
            const run = liveRun;
            liveTimer = setTimeout(() => {
                if (run !== liveRun) return;
                try { liveWorker = new Worker('analysis-worker.js?v=25'); } catch (e) { return; }
                liveWorker.onmessage = (e) => {
                    const d = e.data;
                    if (run !== liveRun || d.type !== 'live') return;
                    live = { ...live, ...d, key, lines: d.lines && d.lines.length ? d.lines : live ? live.lines : [] };
                    if (d.done) { liveWorker.terminate(); liveWorker = null; }
                    renderLive();
                };
                liveWorker.postMessage({ type: 'live', sanMoves: key ? key.split(' ') : [], requestId: run });
            }, 150);
        }
    }
    renderLive();
}

function setLiveOn(on) {
    liveOn = on;
    try { localStorage.setItem(LIVE_KEY, on ? 'on' : 'off'); } catch (e) { /* this visit only */ }
    if (!on) { stopLive(); live = null; }
    startLive();
}

// The strip shows the best line; expanded, all three.
const LIVE_LINES_KEY = 'chessLiveLines';
let liveExpanded = false;

function setLiveExpanded(on) {
    liveExpanded = on;
    try { localStorage.setItem(LIVE_LINES_KEY, on ? 'all' : 'one'); } catch (e) { /* this visit only */ }
    renderLive();
}

function renderLive() {
    $('liveToggle').checked = liveOn;
    const more = $('liveMoreButton');
    more.textContent = liveExpanded ? '1 line ▴' : '3 lines ▾';
    more.setAttribute('aria-expanded', String(liveExpanded));
    more.classList.toggle('hidden', !liveOn);
    const list = $('liveLines');
    const l = liveForShownPosition();
    list.innerHTML = '';
    $('liveDepth').textContent = liveOn && l && l.depth ? `depth ${l.depth}${l.done ? '' : '…'}` : '';
    const pill = $('liveEval');
    pill.textContent = liveOn && l && l.evalWhite !== undefined ? (l.terminal ? '' : formatEval(l.evalWhite)) : '';
    pill.className = 'eval-pill' + (l && l.evalWhite >= 0 ? ' white-adv' : '') + (pill.textContent ? '' : ' hidden');
    const note = (text) => { list.innerHTML = `<div class="engine-note">${escapeHTML(text)}</div>`; };
    if (!liveOn) note('Engine off — switch it on to see the best lines for any position.');
    else if (!game) note('Load a game to analyze.');
    else if (analyzing || refining) note('The live engine starts when the review is finished.');
    else if (!l) note('Thinking…');
    else if (l.terminal) note(l.terminal);
    else {
        const startPly = nodePly(currentNode()) + 1;
        for (const line of l.lines.slice(0, liveExpanded ? 3 : 1)) {
            const row = document.createElement('div');
            row.className = 'engine-line';
            row.innerHTML = `<span class="eval-pill${line.evalWhite >= 0 ? ' white-adv' : ''}">${formatEval(line.evalWhite)}</span>`;
            const pv = document.createElement('span');
            pv.className = 'engine-pv';
            line.pv.slice(0, 10).forEach((san, k) => {
                const ply = startPly + k;
                const prefix = ply % 2 === 0 ? `${ply / 2 + 1}. ` : k === 0 ? `${Math.floor(ply / 2) + 1}... ` : '';
                const s = document.createElement('span');
                s.className = 'pv-move';
                s.textContent = prefix + san;
                s.title = 'Play the line up to here';
                s.addEventListener('click', () => playLine(line.pv.slice(0, k + 1)));
                pv.append(s, ' ');
            });
            row.appendChild(pv);
            list.appendChild(row);
        }
    }
    refreshEvalBar();
    refreshArrows();
}

// ─── MOVE JUDGE ────────────────────────────────────────────────────────────────
// A worker of its own rates single moves (variation moves, retry attempts) so
// it never waits behind the live engine. Requests are answered in order.
let judgeWorker = null;
let judgeSeq = 0;
const judgeWaiting = new Map();

function judgeMove(sanMoves, san) {
    if (!judgeWorker) {
        try { judgeWorker = new Worker('analysis-worker.js?v=25'); } catch (e) { return Promise.reject(e); }
        judgeWorker.onmessage = (e) => {
            const d = e.data;
            const waiting = judgeWaiting.get(d.requestId);
            if (!waiting) return;
            judgeWaiting.delete(d.requestId);
            if (d.type === 'error') waiting.reject(new Error(d.message));
            else waiting.resolve(d.entry);
        };
    }
    const requestId = ++judgeSeq;
    return new Promise((resolve, reject) => {
        judgeWaiting.set(requestId, { resolve, reject });
        judgeWorker.postMessage({ type: 'judgeMove', sanMoves, san, requestId });
    });
}

// ─── PUZZLE MODE ───────────────────────────────────────────────────────────────
function startPuzzle() {
    const entry = entries[selectedPly];
    if (!entry || !entry.punishMove) return;
    const ply = selectedPly;
    stopLive();
    puzzle = { ply, target: entry.punishMove, solved: false };
    renderWalkBar();
    positionAt(ply);
    board.render(gameState);
    board.setArrows([]);
    board.setBadge(null);
    board.setLastMove({ x: entry.from.x, y: entry.from.y }, { x: entry.to.x, y: entry.to.y });
    $('puzzleBanner').classList.remove('hidden');
    $('enginePanel').classList.add('hidden');
    const side = currentTurn === 'white' ? 'White' : 'Black';
    $('puzzleBannerText').textContent = `${side} to move — punish ${entry.san}!`;
    setCaption({ icon: '🧩', title: `Find ${side}'s best move`, line: `${moveNumberPrefix(ply)} ${escapeHTML(entry.san)} was ${CATEGORY_DESCRIPTIONS[entry.category]}. How do you exploit it?` });
    $('tryPuzzleButton').classList.add('hidden');
}

function checkPuzzleGuess(move) {
    const t = puzzle.target;
    if (move.fromX !== t.fromX || move.fromY !== t.fromY || move.toX !== t.toX || move.toY !== t.toY) {
        setCaption({ icon: '✗', color: CATEGORY_COLORS.Blunder, title: 'Not quite — try again', line: 'Look for checks, captures and threats.' });
        return;
    }
    puzzle.solved = true;
    applyMoveWithPromotion(move, t.promo || (gameState[move.fromY][move.fromX].type === 'pawn' && (move.toY === 0 || move.toY === 7) ? 'queen' : null));
    board.render(gameState);
    board.setLastMove({ x: move.fromX, y: move.fromY }, { x: move.toX, y: move.toY });
    board.updateCheckFromGame();
    const entry = entries[puzzle.ply];
    const line = entry.punishLine && entry.punishLine.length > 1
        ? `Line: <span class="san-line">${escapeHTML(formatLine(entry.punishLine, puzzle.ply + 1))}</span>` : '';
    setCaption({ icon: '✓', color: CATEGORY_COLORS.Best, title: `Correct! ${t.san || ''} punishes it.`, line });
    $('puzzleBannerText').textContent = 'Solved! Press Exit to continue the review.';
}

function clearPuzzle() {
    if (!puzzle) return;
    puzzle = null;
    $('puzzleBanner').classList.add('hidden');
    $('enginePanel').classList.remove('hidden');
}

// ─── RETRY MISTAKES ────────────────────────────────────────────────────────────
// Walks through the reviewed player's errors (both sides when neither is "You"),
// each from the position before the mistake, with the game move shown as a red
// arrow and a clue about what went wrong that doesn't give the answer away.
// Any move the engine rates Good or better fixes it; a move that doesn't is
// shown with the reason and the reply that refutes it. After each one the
// position can be explored on the analysis board.
//   retry = { plies, index, status, results, attempt, hinted, token }
//   status: 'solving' | 'checking' | 'wrong' | 'solved' | 'revealed' | 'finished'
//   results[i]: null | 'solved' | 'revealed' | 'skipped'
const RETRY_CATEGORIES = new Set(['Mistake', 'Miss', 'Blunder']);
const RETRY_ACCEPTED = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book']);

function retryPlies() {
    if (!report) return [];
    const sides = isYou(game.white) ? ['white'] : isYou(game.black) ? ['black'] : ['white', 'black'];
    return entries.filter(e => e && RETRY_CATEGORIES.has(e.category) && sides.includes(e.color) && e.bestMove).map(e => e.ply);
}

// The Retry tab's start card and badge.
function updateRetryButton() {
    const n = retryPlies().length;
    $('retryButton').disabled = n === 0;
    $('retryCount').textContent = !report ? (game ? 'Available when the review is finished.' : 'Load a game first.')
        : n === 0 ? 'No mistakes to retry — nicely played.'
        : `${n} moment${n === 1 ? '' : 's'} where a better move was there. Find it from the same position.`;
    $('retryBadge').textContent = n;
    $('retryBadge').classList.toggle('hidden', !report || n === 0);
}

function startRetry(plies = retryPlies()) {
    if (!plies.length) return;
    clearPuzzle();
    stopLive();
    stopWalk();
    setTab('retry');
    cursor = null;
    retry = { plies, index: -1, status: 'solving', results: plies.map(() => null), attempt: null, hinted: false, token: 0 };
    $('retryFooter').classList.add('hidden');
    $('retryPanel').classList.remove('hidden');
    $('captionCard').classList.add('hidden');
    $('variationBanner').classList.add('hidden');
    showRetryItem(0);
}

// Reasons that name the better move.
const SOLUTION_MOTIFS = new Set(['missedMate', 'missedFork', 'missedWin']);

// A move that went wrong — what to say about it without naming the fix.
function retryClue(entry) {
    switch (entry.motif) {
        case 'allowsMate': case 'hangs': case 'losesMaterial': case 'allowsFork': return entry.reason;
        case 'missedMate': return 'There was a forced mate.';
        case 'missedFork': return 'A fork was available.';
        case 'missedWin': return 'There was a way to win material.';
        default: return `It cost about ${Math.round(entry.winLoss)}% winning chances.`;
    }
}

function retryEntry() { return entries[retry.plies[retry.index]]; }

function showRetryItem(i) {
    if (!retry) return;
    if (i >= retry.plies.length) { finishRetry(); return; }
    retry.index = i;
    retry.status = 'solving';
    retry.attempt = null;
    retry.hinted = false;
    retry.token++;
    const ply = retry.plies[i];
    const entry = entries[ply];
    selectedPly = ply - 1;
    resetRetryBoard();
    highlightMoveCell();
    renderGraphCursor();
    refreshEvalBar(evalAtPly(ply - 1));

    const side = entry.color === 'white' ? 'White' : 'Black';
    $('retryTask').innerHTML = `<strong>${side} to move.</strong> Find a better move than `
        + `<span class="retry-played">${moveNumberPrefix(ply)} ${escapeHTML(entry.san)}</span>.`;
    $('retryWhat').innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[entry.category]}">${CATEGORY_SYMBOLS[entry.category]}</span>`
        + `<span>In the game it was ${CATEGORY_DESCRIPTIONS[entry.category]}. ${escapeHTML(retryClue(entry))}</span>`;
    $('retryWhat').classList.remove('hidden');
    $('retryTask').classList.remove('hidden');
    setRetryFeedback(null);
    renderRetry();
}

// The position before the mistake, with the game move as a red arrow.
function resetRetryBoard() {
    const ply = retry.plies[retry.index];
    positionAt(ply - 1);
    board.clearSelection();
    board.render(gameState);
    const prev = ply > 0 ? game.moves[ply - 1].move : null;
    board.setLastMove(prev && { x: prev.fromX, y: prev.fromY }, prev && { x: prev.toX, y: prev.toY });
    board.updateCheckFromGame();
    board.setBadge(null);
    board.setArrows([arrowFor(game.moves[ply].move, PLAYED_ARROW, 0.12)]);
    updatePlayerStrips();
}

function setRetryFeedback(fb) {
    const el = $('retryFeedback');
    if (!fb) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.className = 'retry-feedback ' + (fb.kind || '');
    el.innerHTML = `<span class="caption-icon" style="background:${fb.color || ''}">${fb.icon || ''}</span>`
        + `<div><div class="retry-feedback-title">${fb.title}</div>${fb.line ? `<div class="caption-line">${fb.line}</div>` : ''}`
        + `${fb.line2 ? `<div class="caption-line">${fb.line2}</div>` : ''}</div>`;
}

// Counter, progress dots and the buttons that fit the current state.
function renderRetry() {
    const n = retry.plies.length;
    $('retryCounter').textContent = retry.status === 'finished' ? `${n} / ${n}` : `${retry.index + 1} / ${n}`;
    const dots = $('retryDots');
    dots.innerHTML = '';
    retry.plies.forEach((ply, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'retry-dot ' + (retry.results[i] || 'todo') + (i === retry.index && retry.status !== 'finished' ? ' current' : '');
        d.title = `${moveNumberPrefix(ply)} ${entries[ply].san}` + (retry.results[i] ? ` · ${retry.results[i]}` : '');
        d.addEventListener('click', () => { if (retry.status !== 'checking') showRetryItem(i); });
        dots.appendChild(d);
    });

    const actions = $('retryActions');
    actions.innerHTML = '';
    const add = (label, fn, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + cls;
        b.textContent = label;
        b.disabled = retry.status === 'checking';
        b.addEventListener('click', fn);
        actions.appendChild(b);
    };
    const last = retry.index === n - 1;
    const s = retry.status;
    if (s === 'finished') {
        const missed = retry.plies.filter((_, i) => retry.results[i] !== 'solved');
        if (missed.length) add(`↻ Retry the ${missed.length} I missed`, () => startRetry(missed), 'btn-primary');
        add('Back to the review', () => exitRetry());
        return;
    }
    if (s === 'solving' || s === 'checking') {
        if (!retry.hinted) add('💡 Hint', retryHint);
        add('Show solution', retryReveal);
        add(last ? 'Finish' : 'Skip →', retrySkip);
    } else if (s === 'wrong') {
        add('↺ Try again', retryTryAgain, 'btn-primary');
        add('Show solution', retryReveal);
        add(last ? 'Finish' : 'Skip →', retrySkip);
    } else {
        add('Explore this position', exploreFromRetry);
        add(last ? 'Finish' : 'Next mistake →', () => showRetryItem(retry.index + 1), 'btn-primary');
    }
}

async function retryAttempt(move) {
    const ply = retry.plies[retry.index];
    const entry = entries[ply];
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || !retry || retry.status !== 'solving') return;
    }
    if (sameEntryMove(game.moves[ply], move, promo)) {
        setRetryFeedback({ icon: '↺', title: `${escapeHTML(entry.san)} is the move from the game`, line: 'Try something different.' });
        return;
    }
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    const fullSan = san + getCheckSuffix(currentTurn);
    board.render(gameState);
    board.setLastMove({ x: move.fromX, y: move.fromY }, { x: move.toX, y: move.toY });
    board.updateCheckFromGame();
    board.setArrows([]);
    retry.status = 'checking';
    retry.attempt = { move, promo, san: fullSan, verdict: null };
    setRetryFeedback({ icon: '…', title: `Checking ${escapeHTML(fullSan)}…`, line: 'The engine is looking at it.' });
    renderRetry();

    const token = retry.token;
    let verdict;
    try {
        verdict = await judgeMove(game.sanMoves.slice(0, ply), fullSan);
    } catch (err) {
        if (!retry || retry.token !== token) return;
        retry.status = 'solving';
        resetRetryBoard();
        setRetryFeedback({ icon: '!', title: 'That move couldn\'t be checked', line: escapeHTML(err.message) });
        renderRetry();
        return;
    }
    if (!retry || retry.token !== token) return;
    retry.attempt.verdict = verdict;
    if (RETRY_ACCEPTED.has(verdict.category)) retryGood(verdict);
    else retryWrong(verdict);
}

function retryGood(verdict) {
    const ply = retry.plies[retry.index];
    const a = retry.attempt;
    retry.status = 'solved';
    if (retry.results[retry.index] !== 'revealed') retry.results[retry.index] = 'solved';
    const cat = verdict.category === 'Book' ? 'Best' : verdict.category;
    board.setBadge({ x: a.move.toX, y: a.move.toY, glyph: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat] });
    const line = verdict.reason ? `<span class="reason">${escapeHTML(verdict.reason)}</span>`
        : verdict.bestMove ? `That works. The engine's top choice was <strong>${escapeHTML(verdict.bestMove.san)}</strong>.` : 'That fixes it.';
    const cont = verdict.punishLine && verdict.punishLine.length
        ? `Line: <span class="san-line">${escapeHTML(formatLine([a.san].concat(verdict.punishLine), ply, 7))}</span>` : '';
    setRetryFeedback({ kind: 'good', icon: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat],
        title: `${escapeHTML(a.san)} — ${CATEGORY_DESCRIPTIONS[cat]}!`, line, line2: cont });
    refreshEvalBar(verdict.evalAfter);
    renderRetry();
}

function retryWrong(verdict) {
    const a = retry.attempt;
    retry.status = 'wrong';
    const cat = verdict.category;
    board.setBadge({ x: a.move.toX, y: a.move.toY, glyph: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat] });
    // The reply that refutes it, on the board.
    if (verdict.punishMove) board.setArrows([arrowFor(verdict.punishMove, PUNISH_ARROW, 0.14)]);
    // "Misses X, which wins…" would name the answer — give the clue instead.
    const line = verdict.reason && !SOLUTION_MOTIFS.has(verdict.motif) ? `<span class="reason">${escapeHTML(verdict.reason)}</span>`
        : SOLUTION_MOTIFS.has(verdict.motif) ? escapeHTML(retryClue(verdict))
        : `It still gives away about ${Math.round(verdict.winLoss)}% winning chances.`;
    setRetryFeedback({ kind: 'bad', icon: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat],
        title: `${escapeHTML(a.san)} is ${CATEGORY_DESCRIPTIONS[cat]}`, line,
        line2: verdict.punishMove ? `The red arrow shows the answer to it: <strong>${escapeHTML(verdict.punishMove.san)}</strong>.` : '' });
    refreshEvalBar(verdict.evalAfter);
    renderRetry();
}

function retryTryAgain() {
    retry.status = 'solving';
    retry.attempt = null;
    retry.token++;
    resetRetryBoard();
    setRetryFeedback(null);
    refreshEvalBar(evalAtPly(retry.plies[retry.index] - 1));
    renderRetry();
}

function retryHint() {
    if (!retry || retry.status !== 'solving') return;
    const best = retryEntry().bestMove;
    retry.hinted = true;
    board.select(best.fromX, best.fromY);
    setRetryFeedback({ icon: '💡', color: 'var(--warning)', title: 'Hint', line: `Look at your ${gameState[best.fromY][best.fromX].type} — it has a much better move.` });
    renderRetry();
}

// A legal, playable version of a move stored by the worker (fresh details).
function playableMove(m) {
    const legal = getvalidMoves(m.fromX, m.fromY).find(t => t.x === m.toX && t.y === m.toY);
    return { fromX: m.fromX, fromY: m.fromY, toX: m.toX, toY: m.toY, details: legal || m.details };
}

function retryReveal() {
    if (!retry || !['solving', 'checking', 'wrong'].includes(retry.status)) return;
    retry.token++; // drop a verdict that may still be on its way
    const ply = retry.plies[retry.index];
    const entry = entries[ply];
    resetRetryBoard();
    const best = playableMove(entry.bestMove);
    applyMoveWithPromotion(best, entry.bestMove.promo || null);
    board.render(gameState);
    board.setLastMove({ x: best.fromX, y: best.fromY }, { x: best.toX, y: best.toY });
    board.updateCheckFromGame();
    board.setArrows([arrowFor(best, BEST_ARROW)]);
    retry.status = 'revealed';
    retry.attempt = null;
    retry.results[retry.index] = 'revealed';
    const why = SOLUTION_MOTIFS.has(entry.motif) ? `<span class="reason">${escapeHTML(entry.reason)}</span>` : '';
    const line = entry.bestLine && entry.bestLine.length > 1 ? `Line: <span class="san-line">${escapeHTML(formatLine(entry.bestLine, ply, 7))}</span>` : '';
    setRetryFeedback({ kind: 'reveal', icon: '★', color: CATEGORY_COLORS.Best, title: `The best move was ${escapeHTML(entry.bestMove.san)}`,
        line: why || line, line2: why ? line : '' });
    refreshEvalBar(entry.evalBefore);
    renderRetry();
}

function retrySkip() {
    retry.token++;
    if (!retry.results[retry.index]) retry.results[retry.index] = 'skipped';
    showRetryItem(retry.index + 1);
}

function finishRetry() {
    retry.status = 'finished';
    retry.token++;
    const count = (r) => retry.results.filter(x => x === r).length;
    const solved = count('solved'), revealed = count('revealed'), skipped = retry.results.length - solved - revealed;
    $('retryTask').classList.add('hidden');
    $('retryWhat').classList.add('hidden');
    const parts = [`${revealed} shown`, `${skipped} skipped`].filter(p => !p.startsWith('0 '));
    setRetryFeedback({ kind: 'good', icon: solved === retry.results.length ? '★' : '✓', color: CATEGORY_COLORS.Best,
        title: `You fixed ${solved} of ${retry.results.length}`, line: parts.length ? parts.join(' · ') : 'Every one of them — well done.' });
    renderRetry();
}

// Leaves the trainer for the analysis board at this position, keeping the
// fix (yours or the shown solution) as a variation to continue from.
function exploreFromRetry() {
    const ply = retry.plies[retry.index];
    const entry = entries[ply];
    const a = retry.status === 'solved' ? retry.attempt : null;
    const revealed = retry.status === 'revealed';
    exitRetry(ply - 1);
    if (a) addMove(playableMove(a.move), a.promo, { verdict: a.verdict });
    else if (revealed) addMove(playableMove(entry.bestMove), entry.bestMove.promo || null, { engine: true });
}

function exitRetry(ply) {
    const target = ply !== undefined ? ply : (retry ? retry.plies[Math.min(retry.index, retry.plies.length - 1)] : selectedPly);
    clearRetry();
    setTab('moves');
    selectPly(target);
}

function clearRetry() {
    if (!retry) return;
    retry = null;
    $('retryPanel').classList.add('hidden');
    $('retryFooter').classList.remove('hidden');
    $('captionCard').classList.remove('hidden');
    board.clearSelection();
}

// ─── PUZZLE BANK GROWTH ────────────────────────────────────────────────────────
// Every analyzed game adds its Blunder/Miss positions to the pool the Puzzle
// Trainer (puzzles.html) draws from. Deduplicated by move prefix and capped.
function estimatePuzzleRating(entry) {
    const isRecapture = entry.punishMove && entry.punishMove.toX === entry.to.x && entry.punishMove.toY === entry.to.y;
    let rating = 1000 + (isRecapture ? -200 : 300) + Math.min(400, entry.centipawnLoss / 4);
    if (entry.punishLine && entry.punishLine.length >= 5) rating += 100;
    return Math.max(600, Math.min(2200, Math.round(rating)));
}

function growPuzzleBank(sanMoves, perMove) {
    let bank = [];
    try { bank = JSON.parse(localStorage.getItem(PUZZLE_BANK_KEY)) || []; } catch (e) { bank = []; }
    const existing = new Set(bank.map(p => p.sanPrefix.join('|')));
    let added = false;
    perMove.forEach((entry, i) => {
        if ((entry.category !== 'Blunder' && entry.category !== 'Miss') || !entry.punishMove) return;
        const sanPrefix = sanMoves.slice(0, i + 1);
        const key = sanPrefix.join('|');
        if (existing.has(key)) return;
        existing.add(key);
        const p = entry.punishMove;
        bank.push({
            id: 'grown-' + Date.now() + '-' + i,
            sanPrefix,
            punishMove: { fromX: p.fromX, fromY: p.fromY, toX: p.toX, toY: p.toY, details: p.details, promo: p.promo || null, san: p.san },
            solutionLine: entry.punishLine || [],
            rating: estimatePuzzleRating(entry),
            category: entry.category,
            centipawnLoss: Math.min(entry.centipawnLoss, 2000),
            blunderSan: entry.san,
        });
        added = true;
    });
    if (!added) return;
    if (bank.length > PUZZLE_BANK_CAP) bank = bank.slice(bank.length - PUZZLE_BANK_CAP);
    try { localStorage.setItem(PUZZLE_BANK_KEY, JSON.stringify(bank)); } catch (e) { /* bank is optional */ }
}

function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
