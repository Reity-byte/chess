// ─── GAME REVIEW PAGE ──────────────────────────────────────────────────────────
// Drives analysis.html: loads the just-finished game (handed over through
// localStorage by game.html) or a pasted PGN, streams it through
// analysis-worker.js, and renders the review — classified move list, eval bar,
// eval graph, accuracy, move-quality counts, best-move arrows and lines.
//
// From any position you can also play your own moves ("what if"): each one is
// judged like a game move, the engine answers at full strength, and the line
// shows up inside the move list. Errors can be replayed as a puzzle.
const HANDOFF_KEY = 'chessGameForAnalysis';
const CACHE_KEY = 'chessAnalysisCache';
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
let worker = null;
let board = null;
let flipped = false;

let variation = null;   // { branchPly, moves: [{ color, san, move, promo, verdict, evalWhite }], index }
let engineBusy = false;
let exploreId = 0;
let puzzle = null;      // { ply, target, solved }
let retry = null;       // { plies, index, status: 'solving'|'checking'|'solved'|'revealed', solved, pending }
let judgeId = 0;

const $ = (id) => document.getElementById(id);

// ─── STARTUP ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initBoardThemePicker();
    board = new BoardView($('chessboard'), {
        canSelect: (x, y) => canPlayOnBoard() && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onBoardMove,
    });
    board.render(gameState, { animate: false });

    $('navStart').addEventListener('click', () => goTo(-1));
    $('navPrev').addEventListener('click', stepBack);
    $('navNext').addEventListener('click', stepForward);
    $('navEnd').addEventListener('click', () => goTo(game ? game.sanMoves.length - 1 : -1));
    $('navFlip').addEventListener('click', flipBoard);
    $('backToGameButton').addEventListener('click', () => selectPly(variation ? variation.branchPly : selectedPly));
    $('exitPuzzleButton').addEventListener('click', () => selectPly(puzzle ? puzzle.ply : selectedPly));
    $('tryPuzzleButton').addEventListener('click', startPuzzle);
    $('retryButton').addEventListener('click', startRetry);
    $('retryHintButton').addEventListener('click', retryHint);
    $('retrySolutionButton').addEventListener('click', retryReveal);
    $('retryNextButton').addEventListener('click', () => showRetryItem(retry.index + 1));
    $('retryExitButton').addEventListener('click', () => exitRetry());
    $('analyzePgnButton').addEventListener('click', importPGN);

    document.addEventListener('keydown', (e) => {
        if (e.target.closest('textarea, input')) return;
        const keys = { ArrowLeft: stepBack, ArrowRight: stepForward, Home: () => goTo(-1),
                       End: () => goTo(game ? game.sanMoves.length - 1 : -1), f: flipBoard, F: flipBoard };
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
    setCaption({ icon: '♟', title: 'No game to review yet', line: 'Play a game, or paste a PGN below.' });
    $('progressText').textContent = 'No game loaded';
    $('movesEmpty').classList.remove('hidden');
    $('pgnInput').focus();
    renderCounts();
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
    flipped = game.black === 'You';
    board.setFlipped(flipped);
    $('evalBar').classList.toggle('flipped', flipped);
    $('movesEmpty').classList.add('hidden');
    $('accWhiteName').textContent = game.white;
    $('accBlackName').textContent = game.black;
    updatePlayerStrips();
    buildMoveList();
    selectPly(-1);
    startAnalysis();
}

function importPGN() {
    const parsed = parsePGN($('pgnInput').value);
    if (parsed.sanMoves.length === 0) { showToast('No moves found in that text.'); return; }
    try { localStorage.setItem(HANDOFF_KEY, JSON.stringify(parsed)); } catch (e) { /* still analyze */ }
    $('pgnInput').value = '';
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
function cacheKey() {
    return `${ANALYSIS_VERSION}|${analysisMode}|${game.sanMoves.join(' ')}`;
}

// The game is cut into ranges of consecutive moves, handed out to a pool of
// workers (one per spare CPU core) — about three ranges per worker so faster
// workers pick up more. When every range is in, one worker builds the final
// report. The first worker stays alive afterwards for "what if" and retries.
const MAX_ANALYSIS_WORKERS = 8;
const MIN_RANGE = 4;
let pool = [];           // analysis workers; pool[0] === worker
let analysisJob = null;  // { run, queue, pending, received }
let analysisRun = 0;     // bumps per analysis; messages from older runs are ignored

function terminatePool() {
    for (const w of pool) w.terminate();
    pool = [];
    worker = null;
    analysisJob = null;
}

function startAnalysis() {
    terminatePool();
    entries = [];
    report = null;
    startEval = null;
    engineBusy = false;
    clearVariation();
    clearPuzzle();
    clearRetry();
    refreshAllMoveCells();
    $('keyMomentsPanel').classList.add('hidden');
    const run = ++analysisRun;

    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { cached = null; }
    if (cached && cached.key === cacheKey() && cached.report) {
        finishAnalysis(cached.report, true);
        return;
    }

    analyzing = true;
    renderSummary();
    renderGraph();
    const n = game.sanMoves.length;
    const cores = navigator.hardwareConcurrency || 2;
    const size = Math.max(1, Math.min(MAX_ANALYSIS_WORKERS, cores - 1, Math.ceil(n / MIN_RANGE)));
    for (let i = 0; i < size; i++) {
        const w = createWorker(run);
        if (!w) break;
        pool.push(w);
    }
    if (!pool.length) {
        $('progressText').textContent = 'Analysis needs the site served over http(s) (Web Workers are blocked here).';
        analyzing = false;
        return;
    }
    worker = pool[0];
    setProgress(0, n);

    const rangeSize = Math.max(MIN_RANGE, Math.ceil(n / (pool.length * 3)));
    const queue = [];
    for (let from = 0; from < n; from += rangeSize) queue.push({ rangeId: queue.length, from, to: Math.min(n, from + rangeSize) });
    analysisJob = { run, queue, pending: queue.length, received: 0 };
    pool.forEach(dispatchRange);
}

function dispatchRange(w) {
    const range = analysisJob && analysisJob.queue.shift();
    if (range) w.postMessage({ type: 'analyzeRange', sanMoves: game.sanMoves, mode: analysisMode, ...range });
}

function analysisFailed(message) {
    analyzing = false;
    engineBusy = false;
    terminatePool();
    $('progressText').textContent = 'Analysis failed: ' + message;
}

function createWorker(run) {
    let w;
    try { w = new Worker('analysis-worker.js?v=10'); } catch (e) { return null; }
    const current = () => run === analysisRun;
    w.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'start') {
            if (current()) renderOpening(d.opening);
        } else if (d.type === 'move') {
            if (!current() || !analysisJob) return;
            if (d.startEval !== null && d.startEval !== undefined) startEval = d.startEval;
            entries[d.entry.ply] = d.entry;
            analysisJob.received++;
            updateMoveCell(d.entry.ply);
            setProgress(analysisJob.received, game.sanMoves.length, d.entry.depth);
            renderGraph();
            renderCounts();
            if (d.entry.ply === selectedPly || (selectedPly === -1 && d.entry.ply === 0)) refreshSelection();
        } else if (d.type === 'rangeDone') {
            if (!current() || !analysisJob) return;
            analysisJob.pending--;
            if (analysisJob.queue.length) dispatchRange(w);
            else if (analysisJob.pending === 0) {
                $('progressText').textContent = 'Building the report…';
                worker.postMessage({ type: 'finalize', entries: entries.filter(Boolean), startEval, sanMoves: game.sanMoves, mode: analysisMode });
            }
        } else if (d.type === 'done') {
            if (current()) finishAnalysis(d.report, false);
        } else if (d.type === 'exploreReply') {
            if (d.requestId === exploreId) onEngineReply(d.result);
        } else if (d.type === 'judgeReply') {
            if (retry && d.requestId === judgeId) onRetryVerdict(d.result);
        } else if (d.type === 'error') {
            if (d.requestType === 'explore' || d.requestType === 'judge') {
                engineBusy = false;
                if (retry && retry.status === 'checking') retry.status = 'solving';
                showToast('Engine error: ' + d.message);
                return;
            }
            if (current()) analysisFailed(d.message);
        }
    };
    w.onerror = (err) => {
        err.preventDefault();
        if (current()) analysisFailed(err.message || 'worker error');
    };
    return w;
}

function finishAnalysis(finished, fromCache) {
    report = finished;
    entries = finished.perMove.slice();
    startEval = finished.startEval;
    analyzing = false;
    // Keep one worker for "what if" / retries; the rest have done their job.
    if (pool.length > 1) { pool.slice(1).forEach(w => w.terminate()); pool = [pool[0]]; }
    if (!worker) { worker = createWorker(analysisRun); pool = worker ? [worker] : []; }
    analysisJob = null;
    refreshAllMoveCells();
    renderOpening(finished.opening);
    renderSummary();
    renderGraph();
    renderCounts();
    renderKeyMoments();
    $('progressBox').classList.add('hidden');
    refreshSelection();
    updateRetryButton();
    if (!fromCache) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey(), report: finished })); } catch (e) { /* cache is optional */ }
        growPuzzleBank(game.sanMoves, finished.perMove);
    }
    if (game.historyId) saveReviewToHistory(finished);
    updatePlayerStrips();
}

function setProgress(done, total, depth) {
    $('progressBox').classList.remove('hidden');
    $('progressFill').style.width = `${total ? (done / total) * 100 : 0}%`;
    $('progressText').textContent = `Analyzed ${done} of ${total} moves…`;
    const cores = pool.length > 1 ? `${pool.length} cores · ` : '';
    $('progressDepth').textContent = cores + (depth ? `depth ${depth}` : ANALYSIS_MODES[analysisMode].label);
}

// ─── NAVIGATION ────────────────────────────────────────────────────────────────
function goTo(ply) { if (game) selectPly(ply); }

function stepBack() {
    if (!game) return;
    if (variation) {
        if (variation.index > 0) selectVariationMove(variation.index - 1);
        else selectPly(variation.branchPly);
        return;
    }
    if (puzzle) { selectPly(puzzle.ply); return; }
    if (retry) return;
    selectPly(Math.max(-1, selectedPly - 1));
}

function stepForward() {
    if (!game) return;
    if (variation) {
        if (variation.index < variation.moves.length - 1) selectVariationMove(variation.index + 1);
        return;
    }
    if (retry) return;
    selectPly(Math.min(game.sanMoves.length - 1, selectedPly + 1));
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

// Shows a real game position; leaves any variation or puzzle.
function selectPly(ply) {
    if (!game) return;
    clearVariation();
    clearPuzzle();
    clearRetry();
    selectedPly = Math.max(-1, Math.min(ply, game.sanMoves.length - 1));
    positionAt(selectedPly);
    board.clearSelection();
    board.render(gameState);
    refreshSelection();
}

// Redraws everything that depends on the selected ply (marks, arrows, caption…).
function refreshSelection() {
    if (!game || variation || puzzle || retry) return;
    const ply = selectedPly;
    const entry = ply >= 0 ? entries[ply] : null;
    const played = ply >= 0 ? game.moves[ply].move : null;

    board.setLastMove(played ? { x: played.fromX, y: played.fromY } : null, played ? { x: played.toX, y: played.toY } : null);
    board.updateCheckFromGame();
    board.setBadge(entry ? {
        x: played.toX, y: played.toY, glyph: CATEGORY_SYMBOLS[entry.category],
        color: CATEGORY_COLORS[entry.category], title: entry.category,
    } : null);

    // Green arrow: what the engine would have played instead.
    const best = entry && entry.bestMove && !['Book', 'Forced'].includes(entry.category) ? entry.bestMove : null;
    board.setArrows(best ? [{ from: { x: best.fromX, y: best.fromY }, to: { x: best.toX, y: best.toY }, color: 'rgba(129, 199, 84, 0.85)' }] : []);

    renderCaption(ply, entry);
    refreshEvalBar();
    highlightMoveCell();
    renderGraphCursor();
    $('navPrev').disabled = ply < 0;
    $('navStart').disabled = ply < 0;
    $('navNext').disabled = ply >= game.sanMoves.length - 1;
    $('navEnd').disabled = ply >= game.sanMoves.length - 1;
}

function evalAtPly(ply) {
    if (ply < 0) return startEval;
    return entries[ply] ? entries[ply].evalAfter : null;
}

function refreshEvalBar(value) {
    const v = value !== undefined ? value : (variation ? currentVariationEval() : evalAtPly(selectedPly));
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
    if (['Mistake', 'Miss', 'Blunder'].includes(cat) && entry.punishMove && !analyzing) puzzleBtn.classList.remove('hidden');
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
    document.querySelectorAll('#movesGrid .mv.active').forEach(c => c.classList.remove('active'));
    const cell = document.querySelector(`#movesGrid .mv[data-ply="${selectedPly}"]`);
    if (cell && !variation) {
        cell.classList.add('active');
        const scroller = $('movesScroll');
        const top = cell.offsetTop - scroller.offsetTop;
        if (top < scroller.scrollTop || top > scroller.scrollTop + scroller.clientHeight - 40) {
            scroller.scrollTop = top - scroller.clientHeight / 2;
        }
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

function renderCounts() {
    const table = $('countsTable');
    table.innerHTML = '';
    const counts = { white: {}, black: {} };
    entries.forEach(e => { if (e) counts[e.color][e.category] = (counts[e.color][e.category] || 0) + 1; });
    for (const cat of CATEGORY_ORDER) {
        const tr = document.createElement('tr');
        const label = document.createElement('td');
        label.innerHTML = `<span class="cat"><span class="mv-icon" style="background:${CATEGORY_COLORS[cat]}">${CATEGORY_SYMBOLS[cat]}</span>${cat}</span>`;
        tr.appendChild(label);
        for (const color of ['white', 'black']) {
            const td = document.createElement('td');
            const n = counts[color][cat] || 0;
            td.className = 'n' + (n ? ' clickable' : ' zero');
            td.textContent = n;
            td.style.color = n ? CATEGORY_COLORS[cat] : '';
            if (n) {
                td.title = `Jump to ${color}'s next ${cat.toLowerCase()} move`;
                td.addEventListener('click', () => jumpToCategory(color, cat));
            }
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
}

// ─── HISTORY ───────────────────────────────────────────────────────────────────
// Stores the review's headline numbers on the game in the history list (the
// history page shows accuracy and tallies the kinds of mistakes made).
function saveReviewToHistory(finished) {
    const side = (color) => {
        const moves = finished.perMove.filter(m => m.color === color);
        const motifs = {};
        for (const m of moves) if (m.motif && m.winLoss >= 5) motifs[m.motif] = (motifs[m.motif] || 0) + 1;
        return { counts: finished.counts[color], motifs };
    };
    updateHistoryGame(game.historyId, {
        accuracy: finished.accuracy, reviewMode: finished.mode,
        review: { white: side('white'), black: side('black') },
    });
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
    $('keyMomentsPanel').classList.toggle('hidden', !report);
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

// Cycles through `color`'s moves of category `cat`, starting after the selection.
function jumpToCategory(color, cat) {
    const plies = entries.filter(e => e && e.color === color && e.category === cat).map(e => e.ply);
    if (!plies.length) return;
    const next = plies.find(p => p > selectedPly);
    selectPly(next !== undefined ? next : plies[0]);
}

// ─── EVAL GRAPH ────────────────────────────────────────────────────────────────
const GRAPH_H = 110;

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
    svg.onclick = (e) => {
        if (!game) return;
        const r = svg.getBoundingClientRect();
        const k = Math.round(((e.clientX - r.left) / r.width) * n);
        selectPly(Math.max(-1, Math.min(game.sanMoves.length - 1, k - 1)));
    };
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

// ─── "WHAT IF" EXPLORATION ─────────────────────────────────────────────────────
function canPlayOnBoard() {
    if (!game || !report || analyzing || engineBusy || !worker) return false;
    if (retry) return retry.status === 'solving';
    return !(puzzle && puzzle.solved);
}

function onBoardMove(move) {
    if (retry) { retryGuess(move); return; }
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
    if (!variation) {
        variation = { branchPly: selectedPly, moves: [], index: -1 };
        $('variationBanner').classList.remove('hidden');
    } else if (variation.index < variation.moves.length - 1) {
        variation.moves = variation.moves.slice(0, variation.index + 1); // playing from earlier in the line replaces its tail
    }
    const color = currentTurn;
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    const fullSan = san + getCheckSuffix(currentTurn);
    variation.moves.push({ color, san: fullSan, move, promo, verdict: null, evalWhite: null });
    variation.index = variation.moves.length - 1;

    board.render(gameState);
    board.setLastMove({ x: move.fromX, y: move.fromY }, { x: move.toX, y: move.toY });
    board.updateCheckFromGame();
    board.setArrows([]);
    board.setBadge(null);
    renderVariationLine();
    setCaption({ icon: '…', title: `${fullSan} — engine is thinking…` });
    requestEngineReply();
}

function requestEngineReply() {
    engineBusy = true;
    exploreId++;
    worker.postMessage({
        type: 'explore', requestId: exploreId,
        sanMoves: game.sanMoves.slice(0, variation.branchPly + 1),
        variationMoves: variation.moves.map(v => ({ ...v.move, promo: v.promo })),
    });
}

function onEngineReply(result) {
    engineBusy = false;
    if (!variation) return;
    const userEntry = variation.moves[variation.moves.length - 1];
    userEntry.verdict = result.userVerdict;
    userEntry.evalWhite = result.evalWhite;

    if (!result.move) {
        renderVariationLine();
        showVariationCaption(variation.moves.length - 1, 'No legal reply — the line ends here.');
        return;
    }
    const color = currentTurn;
    applyMoveWithPromotion(result.move, result.move.promo);
    variation.moves.push({ color, san: result.san, move: result.move, promo: result.move.promo, verdict: null, evalWhite: result.evalWhite, pv: result.pv });
    variation.index = variation.moves.length - 1;
    board.render(gameState);
    board.setLastMove({ x: result.move.fromX, y: result.move.fromY }, { x: result.move.toX, y: result.move.toY });
    board.updateCheckFromGame();
    renderVariationLine();
    showVariationCaption(variation.index);
}

function currentVariationEval() {
    if (!variation) return null;
    for (let i = variation.index; i >= 0; i--) if (variation.moves[i].evalWhite !== null) return variation.moves[i].evalWhite;
    return evalAtPly(variation.branchPly);
}

function showVariationCaption(i, note) {
    const vm = variation.moves[i];
    const ply = variation.branchPly + 1 + i;
    const isUser = i % 2 === 0;
    const verdict = isUser ? vm.verdict : null;
    let title, icon = '↳', color = '';
    if (verdict) {
        title = `${moveNumberPrefix(ply)} ${vm.san} would be ${CATEGORY_DESCRIPTIONS[verdict.category]}`;
        icon = CATEGORY_SYMBOLS[verdict.category];
        color = CATEGORY_COLORS[verdict.category];
    } else {
        title = `${moveNumberPrefix(ply)} ${vm.san}${isUser ? '' : ' — engine reply'}`;
    }
    const line = verdict && verdict.bestSan ? `Engine prefers <strong>${escapeHTML(verdict.bestSan)}</strong>.` : (note || '');
    const pv = !isUser && vm.pv && vm.pv.length > 1 ? `Engine line: <span class="san-line">${escapeHTML(formatLine(vm.pv, ply, 8))}</span>` : '';
    setCaption({ icon, color, title, evalText: vm.evalWhite !== null ? formatEval(vm.evalWhite) : '', line, line2: pv });
    refreshEvalBar();
}

function selectVariationMove(i) {
    if (!variation || engineBusy) return;
    variation.index = i;
    positionAt(variation.branchPly);
    for (let k = 0; k <= i; k++) applyMoveWithPromotion(variation.moves[k].move, variation.moves[k].promo);
    const vm = variation.moves[i];
    board.render(gameState);
    board.setLastMove({ x: vm.move.fromX, y: vm.move.fromY }, { x: vm.move.toX, y: vm.move.toY });
    board.updateCheckFromGame();
    renderVariationLine();
    showVariationCaption(i);
}

function renderVariationLine() {
    const old = $('variationRow');
    if (old) old.remove();
    if (!variation || variation.moves.length === 0) return;
    const line = document.createElement('div');
    line.id = 'variationRow';
    line.className = 'variation-line';
    variation.moves.forEach((vm, i) => {
        const ply = variation.branchPly + 1 + i;
        const span = document.createElement('span');
        span.className = 'variation-move' + (i === variation.index ? ' active' : '');
        const prefix = ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}. ` : (i === 0 ? `${Math.floor(ply / 2) + 1}... ` : '');
        span.textContent = prefix + vm.san;
        if (vm.verdict) {
            const icon = document.createElement('span');
            icon.className = 'mv-icon';
            icon.style.cssText = `display:inline-grid; margin-left:4px; vertical-align:-3px; background:${CATEGORY_COLORS[vm.verdict.category]}`;
            icon.textContent = CATEGORY_SYMBOLS[vm.verdict.category];
            span.appendChild(icon);
        }
        span.addEventListener('click', () => selectVariationMove(i));
        line.appendChild(span);
        line.appendChild(document.createTextNode(' '));
    });
    const grid = $('movesGrid');
    const row = Math.floor(variation.branchPly / 2);
    if (variation.branchPly < 0) grid.prepend(line);
    else grid.children[row * 3 + 2].after(line);
    highlightMoveCell();
    line.scrollIntoView({ block: 'nearest' });
}

function clearVariation() {
    if (!variation) return;
    variation = null;
    engineBusy = false;
    exploreId++;
    $('variationBanner').classList.add('hidden');
    const old = $('variationRow');
    if (old) old.remove();
}

// ─── PUZZLE MODE ───────────────────────────────────────────────────────────────
function startPuzzle() {
    const entry = entries[selectedPly];
    if (!entry || !entry.punishMove) return;
    const ply = selectedPly;
    clearVariation();
    puzzle = { ply, target: entry.punishMove, solved: false };
    positionAt(ply);
    board.render(gameState);
    board.setArrows([]);
    board.setBadge(null);
    board.setLastMove({ x: entry.from.x, y: entry.from.y }, { x: entry.to.x, y: entry.to.y });
    $('puzzleBanner').classList.remove('hidden');
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
}

// ─── RETRY MISTAKES ────────────────────────────────────────────────────────────
// Walks through the reviewed player's errors (both sides when neither is "You"),
// each from the position before the mistake. The engine's top move solves it,
// and so does any other move the engine rates Good or better.
const RETRY_CATEGORIES = new Set(['Mistake', 'Miss', 'Blunder']);
const RETRY_ACCEPTED = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Good']);

function retryPlies() {
    if (!report) return [];
    const sides = game.white === 'You' ? ['white'] : game.black === 'You' ? ['black'] : ['white', 'black'];
    return entries.filter(e => e && RETRY_CATEGORIES.has(e.category) && sides.includes(e.color) && e.bestMove).map(e => e.ply);
}

function updateRetryButton() {
    const n = retryPlies().length;
    $('retryFooter').classList.toggle('hidden', !report);
    $('retryButton').disabled = n === 0;
    $('retryCount').textContent = n === 0 ? 'No mistakes to retry — nicely played.' : `${n} moment${n === 1 ? '' : 's'} to fix`;
}

function startRetry() {
    const plies = retryPlies();
    if (!plies.length) return;
    clearVariation();
    clearPuzzle();
    retry = { plies, index: -1, status: 'solving', solved: 0, pending: null };
    $('retryBanner').classList.remove('hidden');
    showRetryItem(0);
}

function showRetryItem(i) {
    if (!retry) return;
    if (i >= retry.plies.length) { finishRetry(); return; }
    retry.index = i;
    retry.status = 'solving';
    judgeId++;
    const ply = retry.plies[i];
    const entry = entries[ply];
    selectedPly = ply - 1;
    positionAt(ply - 1);
    board.clearSelection();
    board.render(gameState);
    const prev = ply > 0 ? game.moves[ply - 1].move : null;
    board.setLastMove(prev && { x: prev.fromX, y: prev.fromY }, prev && { x: prev.toX, y: prev.toY });
    board.updateCheckFromGame();
    board.setArrows([]);
    board.setBadge(null);
    highlightMoveCell();
    renderGraphCursor();
    refreshEvalBar(evalAtPly(ply - 1));

    $('retryText').textContent = `Retry ${i + 1} of ${retry.plies.length} · ${entry.color === 'white' ? 'White' : 'Black'} to move`;
    $('retryHintButton').disabled = false;
    $('retrySolutionButton').disabled = false;
    $('retryNextButton').textContent = i + 1 < retry.plies.length ? 'Skip →' : 'Finish';
    setCaption({
        icon: CATEGORY_SYMBOLS[entry.category], color: CATEGORY_COLORS[entry.category],
        title: `${moveNumberPrefix(ply)} ${entry.san} was ${CATEGORY_DESCRIPTIONS[entry.category]}`,
        line: 'Find a better move for this position.',
    });
}

function sameSquares(a, b) {
    return !!a && !!b && a.fromX === b.fromX && a.fromY === b.fromY && a.toX === b.toX && a.toY === b.toY;
}

async function retryGuess(move) {
    const ply = retry.plies[retry.index];
    const entry = entries[ply];
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || !retry || retry.status !== 'solving') return;
    }
    const played = game.moves[ply];
    if (sameSquares(move, played.move) && (promo || null) === (played.promo || null)) {
        setCaption({ icon: '↺', title: `${entry.san} is the move from the game`, line: 'Try something different.' });
        return;
    }
    const best = entry.bestMove;
    if (sameSquares(move, best) && (!promo || promo === (best.promo || 'queen'))) {
        retrySolved(move, promo, { category: 'Best', bestSan: null });
        return;
    }
    // Any other move: let the engine judge it.
    retry.status = 'checking';
    retry.pending = { move, promo };
    board.select(move.fromX, move.fromY);
    setCaption({ icon: '…', title: 'Checking your move…', line: 'The engine is looking at it.' });
    judgeId++;
    worker.postMessage({ type: 'judge', requestId: judgeId, sanMoves: game.sanMoves.slice(0, ply), move: { ...move, promo } });
}

function onRetryVerdict(verdict) {
    board.clearSelection();
    const { move, promo } = retry.pending;
    if (RETRY_ACCEPTED.has(verdict.category)) {
        retrySolved(move, promo, verdict);
        return;
    }
    retry.status = 'solving';
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    setCaption({
        icon: CATEGORY_SYMBOLS[verdict.category], color: CATEGORY_COLORS[verdict.category],
        title: `${san} would be ${CATEGORY_DESCRIPTIONS[verdict.category]}`,
        line: 'Not good enough yet — try again, or use a hint.',
    });
}

function retrySolved(move, promo, verdict) {
    const ply = retry.plies[retry.index];
    const entry = entries[ply];
    retry.status = 'solved';
    retry.solved++;
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    board.render(gameState);
    board.setLastMove({ x: move.fromX, y: move.fromY }, { x: move.toX, y: move.toY });
    board.updateCheckFromGame();
    board.setBadge({ x: move.toX, y: move.toY, glyph: CATEGORY_SYMBOLS[verdict.category], color: CATEGORY_COLORS[verdict.category] });
    const best = entry.bestMove;
    if (verdict.bestSan) board.setArrows([{ from: { x: best.fromX, y: best.fromY }, to: { x: best.toX, y: best.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
    const line = verdict.bestSan
        ? `That works! The engine's top choice was <strong>${escapeHTML(best.san)}</strong>.`
        : (entry.bestLine && entry.bestLine.length > 1 ? `Line: <span class="san-line">${escapeHTML(formatLine(entry.bestLine, ply))}</span>` : 'That fixes it.');
    setCaption({ icon: '✓', color: CATEGORY_COLORS.Best, title: `${san} — ${CATEGORY_DESCRIPTIONS[verdict.category]}`, line });
    afterRetryAttempt();
}

function retryHint() {
    if (!retry || retry.status !== 'solving') return;
    const best = entries[retry.plies[retry.index]].bestMove;
    board.select(best.fromX, best.fromY);
    $('retryHintButton').disabled = true;
    setCaption({ icon: '💡', title: 'Hint', line: 'The highlighted piece has a much better move.' });
}

function retryReveal() {
    if (!retry || (retry.status !== 'solving' && retry.status !== 'checking')) return;
    judgeId++; // drop a verdict that may still be on its way
    const ply = retry.plies[retry.index];
    const entry = entries[ply];
    const best = entry.bestMove;
    retry.status = 'revealed';
    board.clearSelection();
    const legal = getvalidMoves(best.fromX, best.fromY).find(m => m.x === best.toX && m.y === best.toY);
    applyMoveWithPromotion({ ...best, details: legal || best.details }, best.promo || null);
    board.render(gameState);
    board.setLastMove({ x: best.fromX, y: best.fromY }, { x: best.toX, y: best.toY });
    board.updateCheckFromGame();
    board.setArrows([{ from: { x: best.fromX, y: best.fromY }, to: { x: best.toX, y: best.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
    const line = entry.bestLine && entry.bestLine.length > 1 ? `<span class="san-line">${escapeHTML(formatLine(entry.bestLine, ply))}</span>` : '';
    setCaption({ icon: '★', color: CATEGORY_COLORS.Best, title: `The best move was ${best.san}`, line });
    afterRetryAttempt();
}

function afterRetryAttempt() {
    $('retryHintButton').disabled = true;
    $('retrySolutionButton').disabled = true;
    $('retryNextButton').textContent = retry.index + 1 < retry.plies.length ? 'Next →' : 'Finish';
}

function finishRetry() {
    const { solved, plies } = retry;
    showToast(`Retry finished — fixed ${solved} of ${plies.length} mistake${plies.length === 1 ? '' : 's'}.`, 3500);
    exitRetry(plies[plies.length - 1]);
}

function exitRetry(ply) {
    const target = ply !== undefined ? ply : (retry ? retry.plies[retry.index] : selectedPly);
    clearRetry();
    selectPly(target);
}

function clearRetry() {
    if (!retry) return;
    retry = null;
    judgeId++;
    $('retryBanner').classList.add('hidden');
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
