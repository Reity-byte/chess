// ─── GAME REPORT PAGE ──────────────────────────────────────────────────────────
// Drives analysis.html: reads the just-finished game from localStorage (handed
// off by game-script.js's "View Game Report" button), runs it through
// analysis-worker.js, then renders a chess.com-style review — a clickable move
// list, an eval graph, accuracy percentages, and the move's rating shown right
// on the board (a colored badge on the destination square + a caption line).
//
// It also supports "what if" exploration: from any ply, click a piece and a
// destination square to play an alternative move. The engine replies at full
// strength (regardless of the difficulty the original game was played at,
// since here the question is "what does the engine actually think"), and play
// continues indefinitely as a variation, shown as its own inserted line in the
// move list (like lichess's analysis board). Clicking any real move in the main
// list — or "Back to Game" — discards the variation and resumes the recorded
// game at that point; the variation is never saved.
const STORAGE_KEY = 'chessGameForAnalysis';

let report = null;
let selectedPly = -1; // -1 = starting position, no moves played yet
let worker = null;

// ─── VARIATION ("what if") STATE ───────────────────────────────────────────────
let inVariation = false;
let variationBranchPly = -1; // main-line ply index the variation branched from
let variation = [];          // [{ color, san, from:{x,y}, to:{x,y}, details, promo, evalAfter }]
let variationPly = -1;       // index into `variation` currently displayed
let selectedSquare = null;
let currentValidMoves = [];
let engineThinking = false;

// ─── PUZZLE MODE ("try this as a puzzle") ──────────────────────────────────────
// Presents the position right after a Blunder/Miss (the punishing side's turn)
// and asks the user to find the reply the worker already computed as that
// blunder's `actual` when scoring it - see analysis-worker.js's `punishMove`.
let puzzleActive = false;
let puzzlePly = -1;
let puzzleTarget = null; // { fromX, fromY, toX, toY, details }
let puzzleSolved = false;

document.addEventListener('DOMContentLoaded', () => {
    const newGameBtn = document.getElementById('newGameButton');
    const homeBtn = document.getElementById('homeButton');
    const backToGameBtn = document.getElementById('backToGameButton');
    const board = document.getElementById('chessboard');
    const tryPuzzleBtn = document.getElementById('tryPuzzleButton');
    const exitPuzzleBtn = document.getElementById('exitPuzzleButton');

    if (newGameBtn) newGameBtn.addEventListener('click', () => location.href = 'game.html');
    if (homeBtn) homeBtn.addEventListener('click', () => location.href = '../site.html');
    if (backToGameBtn) backToGameBtn.addEventListener('click', () => selectPly(variationBranchPly));
    if (tryPuzzleBtn) tryPuzzleBtn.addEventListener('click', startPuzzle);
    if (exitPuzzleBtn) exitPuzzleBtn.addEventListener('click', () => selectPly(puzzlePly));

    board.addEventListener('click', (e) => {
        const sq = e.target.closest('.square');
        if (sq) onSquareClick(parseInt(sq.dataset.x), parseInt(sq.dataset.y));
    });

    drawEmptyBoard();

    const importBox = document.getElementById('pgnImportBox');
    const analyzePgnBtn = document.getElementById('analyzePgnButton');
    if (analyzePgnBtn) {
        analyzePgnBtn.addEventListener('click', () => {
            const pgnText = document.getElementById('pgnInput').value;
            const sanMoves = parsePGNMovetext(pgnText);
            if (sanMoves.length === 0) { alert('No moves found in that PGN.'); return; }
            if (importBox) importBox.classList.add('hidden');
            startAnalysis(sanMoves);
        });
    }

    let sanMoves = null;
    try { sanMoves = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { sanMoves = null; }

    if (!Array.isArray(sanMoves) || sanMoves.length === 0) {
        document.getElementById('reportProgress').textContent = 'No recent game found — paste a PGN below, or play a game first.';
        document.getElementById('moveCaption').textContent = '';
        if (importBox) importBox.classList.remove('hidden');
        return;
    }

    startAnalysis(sanMoves);
});

// Parses PGN movetext into a plain SAN array: strips header lines ("[Event ..]"),
// `{comments}`, `$NAGs`, move numbers ("12." / "12..."), and the trailing result
// marker (1-0 / 0-1 / 1/2-1/2 / *). Doesn't handle nested variations "(...)" -
// out of scope for a "paste a mainline game" import box.
function parsePGNMovetext(pgnText) {
    let text = pgnText
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\$\d+/g, ' ')
        .replace(/\d+\.(\.\.)?/g, ' ')
        .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ');
    return text.split(/\s+/).map(s => s.trim()).filter(Boolean);
}

// Feeds `sanMoves` into the analysis worker, whether it came from the just-
// finished live game (localStorage) or a pasted PGN. Shared so both entry
// points get identical progress/render/error handling.
function startAnalysis(sanMoves) {
    const progressEl = document.getElementById('reportProgress');
    progressEl.textContent = `Analyzing move 0 / ${sanMoves.length}...`;

    worker = new Worker('analysis-worker.js');
    worker.onmessage = (e) => {
        const data = e.data;
        if (data.type === 'progress') {
            progressEl.textContent = `Analyzing move ${data.ply} / ${data.total}...`;
        } else if (data.type === 'done') {
            progressEl.textContent = '';
            report = data.report;
            renderMoveList();
            renderGraph();
            renderAccuracy();
            growPuzzleBank(sanMoves, report.perMove);
            selectPly(report.perMove.length - 1); // default: final position of the game
        } else if (data.type === 'error') {
            progressEl.textContent = 'Analysis failed: ' + data.message;
        } else if (data.type === 'exploreReply') {
            onEngineReply(data.result);
        }
    };
    worker.onerror = (err) => {
        progressEl.textContent = 'Analysis failed: ' + err.message;
    };
    worker.postMessage({ type: 'analyze', sanMoves });
}

// ─── PUZZLE BANK GROWTH ─────────────────────────────────────────────────────────
// Every analyzed game (live or pasted) contributes its Blunder/Miss positions to
// the same growing pool puzzles.html's Puzzle Trainer draws from, in addition to
// the starter set shipped in puzzle-bank.js. Deduplicates by exact move prefix
// so re-analyzing the same game twice doesn't create duplicate puzzles, and caps
// total size so the bank can't grow unbounded in localStorage.
const PUZZLE_BANK_KEY = 'chessPuzzleBank';
const PUZZLE_BANK_CAP = 300;

// Same heuristic used to rate puzzle-bank.js's starter set: a punish that lands
// on the exact square the blunder's piece just moved to is a simple, "obvious"
// recapture (lower rating); anything else is scored higher, both nudged further
// by how large the centipawn swing was. Not calibrated against real solve-rate
// data - there isn't any for this project - just a rough difficulty proxy.
function estimatePuzzleRating(entry) {
    const isObviousRecapture = entry.punishMove
        && entry.punishMove.toX === entry.to.x && entry.punishMove.toY === entry.to.y;
    let rating = 1000;
    rating += isObviousRecapture ? -200 : 300;
    rating += Math.min(400, entry.centipawnLoss / 4);
    return Math.max(600, Math.min(2200, Math.round(rating)));
}

function growPuzzleBank(sanMoves, perMove) {
    let bank = [];
    try { bank = JSON.parse(localStorage.getItem(PUZZLE_BANK_KEY)) || []; } catch (e) { bank = []; }

    const existingKeys = new Set(bank.map(p => p.sanPrefix.join('|')));
    let added = false;

    perMove.forEach((entry, i) => {
        if ((entry.category !== 'Blunder' && entry.category !== 'Miss') || !entry.punishMove) return;
        const sanPrefix = sanMoves.slice(0, i + 1);
        const key = sanPrefix.join('|');
        if (existingKeys.has(key)) return;
        existingKeys.add(key);
        bank.push({
            id: 'grown-' + Date.now() + '-' + i,
            sanPrefix,
            punishMove: entry.punishMove,
            rating: estimatePuzzleRating(entry),
            category: entry.category,
            centipawnLoss: Math.min(entry.centipawnLoss, 2000),
            blunderSan: entry.san,
        });
        added = true;
    });

    if (!added) return;
    if (bank.length > PUZZLE_BANK_CAP) bank = bank.slice(bank.length - PUZZLE_BANK_CAP);
    localStorage.setItem(PUZZLE_BANK_KEY, JSON.stringify(bank));
}

// ─── BOARD ──────────────────────────────────────────────────────────────────────
function drawEmptyBoard() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const sq = document.createElement('div');
            sq.className = 'square ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
            sq.dataset.x = x;
            sq.dataset.y = y;
            sq.style.left = `${x * 12.5}%`;
            sq.style.top  = `${y * 12.5}%`;
            board.appendChild(sq);
        }
    }
}

function applyRecordedMove(entry) {
    const isPromoting = movePiece(entry.from.x, entry.from.y, entry.to.x, entry.to.y, entry.details);
    if (isPromoting) {
        gameState[entry.to.y][entry.to.x].type = entry.promo || 'queen';
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }
}

// Jumps to a real, recorded ply — always discards any active variation, since
// navigating the main line means "show me what was actually played here."
function selectPly(ply) {
    if (!report) return;
    clearVariation();
    clearPuzzle();

    selectedPly = Math.max(-1, Math.min(ply, report.perMove.length - 1));

    resetGame();
    for (let i = 0; i <= selectedPly; i++) applyRecordedMove(report.perMove[i]);

    drawPieces();
    updateMoveListSelection();

    const tryPuzzleBtn = document.getElementById('tryPuzzleButton');

    if (selectedPly < 0) {
        setCaption('Starting position', '');
        clearMoveArrow();
        if (tryPuzzleBtn) tryPuzzleBtn.classList.add('hidden');
    } else {
        const entry = report.perMove[selectedPly];
        addCategoryBadge(entry.to, entry.category, entry.centipawnLoss);
        const moveNum = Math.floor(selectedPly / 2) + 1;
        setCaption(`${moveNum}. ${entry.san} — ${entry.category} (-${entry.centipawnLoss} cp)`, CATEGORY_COLORS[entry.category]);
        drawMoveArrow(entry.from, entry.to);

        const canPuzzle = (entry.category === 'Blunder' || entry.category === 'Miss') && entry.punishMove;
        if (tryPuzzleBtn) tryPuzzleBtn.classList.toggle('hidden', !canPuzzle);
    }
}

function drawPieces() {
    const board = document.getElementById('chessboard');
    board.querySelectorAll('.piece, .on-board-badge').forEach(el => el.remove());
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const piece = gameState[y][x];
            if (!piece) continue;
            const el = document.createElement('div');
            el.className = `piece piece-${piece.color} ${piece.type}`;
            el.style.left = `${x * 12.5}%`;
            el.style.top  = `${y * 12.5}%`;
            board.appendChild(el);
        }
    }
}

function addCategoryBadge(to, category, centipawnLoss) {
    const board = document.getElementById('chessboard');
    const badge = document.createElement('div');
    badge.className = 'on-board-badge';
    badge.style.left = `${(to.x + 1) * 12.5}%`;
    badge.style.top  = `${to.y * 12.5}%`;
    badge.style.backgroundColor = CATEGORY_COLORS[category] || '#888';
    badge.textContent = CATEGORY_SYMBOLS[category] || '';
    badge.title = `${category} (-${centipawnLoss} cp)`;
    board.appendChild(badge);
}

function setCaption(text, color) {
    const caption = document.getElementById('moveCaption');
    caption.textContent = text;
    caption.style.color = color || '';
}

function drawMoveArrow(from, to) {
    const board = document.getElementById('chessboard');
    clearMoveArrow();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('move-arrow-svg');

    const x1 = from.x * 12.5 + 6.25, y1 = from.y * 12.5 + 6.25;
    const x2 = to.x   * 12.5 + 6.25, y2 = to.y   * 12.5 + 6.25;

    svg.innerHTML = `
        <defs>
            <marker id="arrowhead" markerWidth="3" markerHeight="3" refX="1.4" refY="1.5" orient="auto">
                <polygon points="0 0, 3 1.5, 0 3" fill="rgba(255,255,255,0.7)" />
            </marker>
        </defs>
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
              stroke="rgba(255,255,255,0.55)" stroke-width="1.6" marker-end="url(#arrowhead)" />
    `;
    board.appendChild(svg);
}

function clearMoveArrow() {
    const old = document.querySelector('.move-arrow-svg');
    if (old) old.remove();
}

// ─── "WHAT IF" EXPLORATION ──────────────────────────────────────────────────────
function onSquareClick(x, y) {
    if (engineThinking || !report) return;

    const piece = gameState[y][x];

    if (piece && piece.color === currentTurn) {
        clearSquareHighlights();
        selectedSquare = { x, y };
        currentValidMoves = getvalidMoves(x, y);
        highlightSelection(x, y, currentValidMoves);
        return;
    }

    if (selectedSquare) {
        const chosen = currentValidMoves.find(m => m.x === x && m.y === y);
        if (chosen) {
            if (puzzleActive) checkPuzzleGuess(selectedSquare.x, selectedSquare.y, x, y, chosen);
            else playVariationMove(selectedSquare.x, selectedSquare.y, x, y, chosen);
        }
        clearSquareHighlights();
        selectedSquare = null;
        currentValidMoves = [];
    }
}

// ─── PUZZLE MODE ────────────────────────────────────────────────────────────────
function startPuzzle() {
    if (selectedPly < 0) return;
    const entry = report.perMove[selectedPly];
    if (!entry.punishMove) return;

    clearVariation();
    puzzleActive = true;
    puzzlePly = selectedPly;
    puzzleTarget = entry.punishMove;
    puzzleSolved = false;

    document.getElementById('puzzleBanner').classList.remove('hidden');
    document.getElementById('tryPuzzleButton').classList.add('hidden');
    clearMoveArrow();
    const toMoveColor = currentTurn === 'white' ? 'White' : 'Black';
    document.getElementById('puzzleBannerText').textContent = `Find ${toMoveColor}'s best move — punish the ${entry.category.toLowerCase()}!`;
    setCaption(`Puzzle: find ${toMoveColor}'s best move`, '#c8c8c6');
}

function checkPuzzleGuess(fromX, fromY, toX, toY, moveDetails) {
    const correct = fromX === puzzleTarget.fromX && fromY === puzzleTarget.fromY
        && toX === puzzleTarget.toX && toY === puzzleTarget.toY;

    if (!correct) {
        setCaption('Not quite — try again!', '#e0402c');
        return;
    }

    puzzleSolved = true;
    const isPawnPromo = gameState[fromY][fromX].type === 'pawn' && (toY === 0 || toY === 7);
    const san = moveToSAN(fromX, fromY, toX, toY, moveDetails, isPawnPromo ? 'queen' : null);
    const wasPromoting = movePiece(fromX, fromY, toX, toY, moveDetails);
    if (wasPromoting) {
        gameState[toY][toX].type = 'queen';
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }
    drawPieces();
    drawMoveArrow({ x: fromX, y: fromY }, { x: toX, y: toY });
    setCaption(`Correct! ${san} punishes it.`, '#81b64c');
    document.getElementById('puzzleBannerText').textContent = 'Solved! Click Exit Puzzle to keep browsing.';
}

// Clears puzzle mode without navigating (selectPly already calls this too, so
// any real move-list/graph navigation silently abandons an active puzzle, same
// behavior as clearVariation()).
function clearPuzzle() {
    if (!puzzleActive) return;
    puzzleActive = false;
    puzzlePly = -1;
    puzzleTarget = null;
    puzzleSolved = false;
    selectedSquare = null;
    currentValidMoves = [];
    clearSquareHighlights();
    document.getElementById('puzzleBanner').classList.add('hidden');
}

function highlightSelection(x, y, moves) {
    const sq = document.querySelector(`.square[data-x="${x}"][data-y="${y}"]`);
    if (sq) sq.classList.add('selected');
    for (const m of moves) {
        const target = document.querySelector(`.square[data-x="${m.x}"][data-y="${m.y}"]`);
        if (target) target.classList.add(gameState[m.y][m.x] ? 'capture-hint' : 'move-hint');
    }
}

function clearSquareHighlights() {
    document.querySelectorAll('.square.selected, .square.move-hint, .square.capture-hint')
        .forEach(sq => sq.classList.remove('selected', 'move-hint', 'capture-hint'));
}

function playVariationMove(fromX, fromY, toX, toY, moveDetails) {
    const color = currentTurn;
    const isPawnPromo = gameState[fromY][fromX].type === 'pawn' && (toY === 0 || toY === 7);
    const promo = isPawnPromo ? 'queen' : null; // no promotion picker on this board — auto-queen
    const san = moveToSAN(fromX, fromY, toX, toY, moveDetails, promo);

    if (!inVariation) {
        inVariation = true;
        variationBranchPly = selectedPly;
        variation = [];
        document.getElementById('variationBanner').classList.remove('hidden');
    }

    const entry = { color, san, from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, details: moveDetails, promo, evalAfter: null };
    applyRecordedMove(entry);
    variation.push(entry);
    variationPly = variation.length - 1;

    drawPieces();
    renderVariationInMoveList();
    setCaption(`${san} (your move)`, '#c8c8c6');
    drawMoveArrow(entry.from, entry.to);

    requestEngineReply();
}

function requestEngineReply() {
    engineThinking = true;
    setCaption('Engine is thinking...', '#c8c8c6');

    const mainLineSAN = report.perMove.slice(0, variationBranchPly + 1).map(m => m.san);
    const variationMoves = variation.map(v => ({
        fromX: v.from.x, fromY: v.from.y, toX: v.to.x, toY: v.to.y, details: v.details, promo: v.promo,
    }));

    worker.postMessage({ type: 'explore', sanMoves: mainLineSAN, variationMoves, color: currentTurn });
}

function onEngineReply(result) {
    engineThinking = false;

    if (!result.move) {
        setCaption('No legal moves for the engine here — game over in this line.', '#c8c8c6');
        return;
    }

    const color = currentTurn;
    const entry = {
        color, san: result.san,
        from: { x: result.move.fromX, y: result.move.fromY },
        to:   { x: result.move.toX,   y: result.move.toY },
        details: result.move.details, promo: result.move.promo, evalAfter: result.score,
    };
    applyRecordedMove(entry);
    variation.push(entry);
    variationPly = variation.length - 1;

    drawPieces();
    renderVariationInMoveList();
    const evalText = (result.score / 100).toFixed(1);
    setCaption(`Engine plays ${result.san} (eval ${evalText >= 0 ? '+' : ''}${evalText})`, '#c8c8c6');
    drawMoveArrow(entry.from, entry.to);
}

function clearVariation() {
    if (!inVariation) return;
    inVariation = false;
    variation = [];
    variationBranchPly = -1;
    variationPly = -1;
    selectedSquare = null;
    currentValidMoves = [];
    clearSquareHighlights();
    document.getElementById('variationBanner').classList.add('hidden');
    const old = document.getElementById('variationRow');
    if (old) old.remove();
}

// ─── MOVE LIST ─────────────────────────────────────────────────────────────────
function renderMoveList() {
    const panel = document.getElementById('move-history-body');
    panel.innerHTML = '';

    for (let i = 0; i < report.perMove.length; i += 2) {
        const tr = document.createElement('tr');

        const tdNum = document.createElement('td');
        tdNum.className = 'move-num';
        tdNum.textContent = (i / 2 + 1) + '.';
        tr.appendChild(tdNum);

        [i, i + 1].forEach((idx) => {
            const td = document.createElement('td');
            td.className = 'move-san ' + (idx % 2 === 0 ? 'move-white' : 'move-black');
            const entry = report.perMove[idx];
            if (entry) {
                td.dataset.ply = idx;
                td.title = `${entry.category} (-${entry.centipawnLoss} cp)`;

                td.appendChild(document.createTextNode(entry.san));

                // Suffix glyph appended directly after the SAN, the way real chess
                // notation does ("Qg5??") — colored by category. Categories with no
                // traditional symbol (Good/Book) render with no suffix at all.
                const symbol = CATEGORY_SYMBOLS[entry.category];
                if (symbol) {
                    const badge = document.createElement('span');
                    badge.className = 'move-badge';
                    badge.style.color = CATEGORY_COLORS[entry.category] || '#888';
                    badge.textContent = symbol;
                    td.appendChild(badge);
                }

                td.addEventListener('click', () => selectPly(idx));
            }
            tr.appendChild(td);
        });

        panel.appendChild(tr);
    }
}

function updateMoveListSelection() {
    document.querySelectorAll('#move-history-body .move-san').forEach(td => {
        td.classList.toggle('active-ply', Number(td.dataset.ply) === selectedPly);
    });
}

// Inserts the current variation as its own line right after the branch point's
// row, in the compact flowing "5.Nc3 c5 6.Nc4 dxc4" style (not the two-column
// White/Black table layout), matching a standard analysis-board variation.
function renderVariationInMoveList() {
    const old = document.getElementById('variationRow');
    if (old) old.remove();
    if (!inVariation || variation.length === 0) return;

    const tbody = document.getElementById('move-history-body');
    const rows = tbody.querySelectorAll('tr');
    const branchRowIndex = Math.floor(variationBranchPly / 2);

    const tr = document.createElement('tr');
    tr.id = 'variationRow';
    const td = document.createElement('td');
    td.colSpan = 3;
    const line = document.createElement('div');
    line.className = 'variation-line';

    variation.forEach((entry, i) => {
        const ply = variationBranchPly + 1 + i;
        const moveNum = Math.floor(ply / 2) + 1;
        const isWhite = ply % 2 === 0;
        const prefix = isWhite ? `${moveNum}.` : (i === 0 ? `${moveNum}...` : '');

        const span = document.createElement('span');
        span.className = 'variation-move';
        span.dataset.varIdx = i;
        span.textContent = `${prefix}${entry.san}`;
        span.addEventListener('click', () => selectVariationPly(i));
        line.appendChild(span);
    });

    td.appendChild(line);
    tr.appendChild(td);

    if (branchRowIndex >= 0 && rows[branchRowIndex]) rows[branchRowIndex].after(tr);
    else tbody.prepend(tr);

    updateVariationSelection();
}

function updateVariationSelection() {
    document.querySelectorAll('.variation-move').forEach(span => {
        span.classList.toggle('active-ply', Number(span.dataset.varIdx) === variationPly);
    });
}

function selectVariationPly(i) {
    variationPly = i;

    resetGame();
    for (let k = 0; k <= variationBranchPly; k++) applyRecordedMove(report.perMove[k]);
    for (let k = 0; k <= i; k++) applyRecordedMove(variation[k]);

    drawPieces();
    updateVariationSelection();

    const entry = variation[i];
    if (entry.evalAfter !== null) {
        const evalText = (entry.evalAfter / 100).toFixed(1);
        setCaption(`${entry.san} (eval ${evalText >= 0 ? '+' : ''}${evalText})`, '#c8c8c6');
    } else {
        setCaption(`${entry.san} (your move)`, '#c8c8c6');
    }
    drawMoveArrow(entry.from, entry.to);
}

// ─── EVAL GRAPH ─────────────────────────────────────────────────────────────────
function renderGraph() {
    const graphEl = document.getElementById('reportGraph');
    graphEl.innerHTML = buildEvalGraphSVG(report.evalGraph);

    const svg = graphEl.querySelector('svg');
    if (svg) {
        svg.addEventListener('click', (e) => {
            const rect = svg.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            const ply = Math.round(frac * (report.evalGraph.length - 1));
            selectPly(ply);
        });
    }
}

function renderAccuracy() {
    const accEl = document.getElementById('reportAccuracy');
    accEl.innerHTML =
        `<div class="report-accuracy-side">White accuracy<br><strong>${report.accuracy.white}%</strong></div>` +
        `<div class="report-accuracy-side">Black accuracy<br><strong>${report.accuracy.black}%</strong></div>`;
}
