// ─── TRAINER PAGE ──────────────────────────────────────────────────────────────
// Drives trainer.html. Every mistake your reviews found (your side, in games
// against the engine) becomes a training position, solved right here on the
// page: best move only — the engine's top move, or one it rates just as good.
//
// Progress is kept per position (chessTraining in localStorage), Leitner-style:
// a fix moves it up a box and it comes back for a short review after 1, 3, 7
// and 21 days; after that it's mastered. Showing the solution, or needing
// more than one try, keeps it on the "to fix" list / back at the first box.
// A day streak counts the days you trained. Around that: focus areas from your
// most frequent mistake types (each can be drilled on its own), your numbers,
// a suggested next game and your unreviewed games.
const RECENT_GAMES = 20;      // reviewed games the focus areas look at
const SESSION_SIZE = 10;      // positions per training session
const TRAINING_KEY = 'chessTraining';
const REVIEW_DAYS = [0, 1, 3, 7, 21]; // days until the next review after reaching box 1..4
const MASTERED_BOX = 5;
const ACCEPTED = new Set(['Brilliant', 'Great', 'Best']); // "best move only"
const SOLUTION_MOTIFS = new Set(['missedMate', 'missedFork', 'missedWin']); // reasons that name the answer

const MOTIF_INFO = {
    hangs:         { label: 'Hanging pieces', tip: 'Before every move, check each of your pieces: is it attacked, and is it defended enough? Then look at what your opponent can capture after your move.' },
    losesMaterial: { label: 'Losing material in exchanges', tip: 'Count attackers and defenders before you start a trade, and before moving a piece that is defending something.' },
    allowsFork:    { label: 'Walking into forks', tip: 'Watch the squares where an enemy knight or queen could hit two of your pieces at once — loose pieces and your king are the usual targets.' },
    allowsMate:    { label: 'Allowing mate', tip: 'After your planned move, look at every check your opponent would have. Keep an escape square for your king.' },
    missedMate:    { label: 'Missing mates', tip: 'Every move, look at all of your checks first — forcing moves can end the game on the spot.' },
    missedFork:    { label: 'Missing forks', tip: 'Look for moves that attack two things at once, especially knight jumps and queen checks.' },
    missedWin:     { label: 'Missing free material', tip: 'After each opponent move ask: what did that leave undefended? Then look at your captures.' },
};
// The puzzle theme (puzzles.html?theme=) that practises each motif.
const MOTIF_PUZZLES = {
    hangs: 'hangingPiece', losesMaterial: 'advantage', allowsFork: 'fork', missedFork: 'fork',
    allowsMate: 'mate', missedMate: 'mate', missedWin: 'hangingPiece',
};
const PHASE_INFO = {
    opening:    { label: 'Opening', tip: 'Develop knights and bishops, castle early and fight for the centre — and avoid moving the same piece twice or bringing the queen out early.' },
    middlegame: { label: 'Middlegame', tip: 'Most games are decided here. Slow down on every capture and check, and use Coach mode to get each move graded while you play.' },
    endgame:    { label: 'Endgame', tip: 'Activate your king, push passed pawns, and trade pieces (not pawns) when you are ahead.' },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const DAY = 86400000;

let positionFilter = 'open';

document.addEventListener('DOMContentLoaded', () => {
    $('startTraining').addEventListener('click', () => startSession());
    $('endSession').addEventListener('click', endSession);
    document.querySelectorAll('#positionFilter button').forEach(b => b.addEventListener('click', () => {
        positionFilter = b.dataset.filter;
        document.querySelectorAll('#positionFilter button').forEach(x => x.classList.toggle('selected', x === b));
        renderPositions();
    }));
    render();
});

// ─── GAMES ─────────────────────────────────────────────────────────────────────
function myGames() {
    return loadHistory().filter(g => g.mode === 'human' && g.playerColor && Array.isArray(g.sanMoves) && g.sanMoves.length);
}
function isReviewed(g) {
    return !!(g.accuracy && g.accuracy[g.playerColor] !== null && g.accuracy[g.playerColor] !== undefined);
}
function myReview(g) {
    return g.review && g.review[g.playerColor] ? g.review[g.playerColor] : null;
}
function score(g) {
    if (g.result === '1/2-1/2') return 0.5;
    return (g.result === '1-0') === (g.playerColor === 'white') ? 1 : 0;
}
function moveLabel(ply, san) {
    return `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'} ${san}`;
}
function dateLabel(g) {
    return new Date(g.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function opponentOf(g) {
    return g.playerColor === 'white' ? g.black : g.white;
}

// ─── TRAINING STORE ────────────────────────────────────────────────────────────
// { items: { "<gameId>:<ply>": { box, due, tries, solves } }, days: ["2026-10-27", …] }
function loadTraining() {
    let t = null;
    try { t = JSON.parse(localStorage.getItem(TRAINING_KEY)); } catch (e) { t = null; }
    if (!t || typeof t !== 'object') t = {};
    t.items = t.items || {};
    t.days = Array.isArray(t.days) ? t.days : [];
    return t;
}
function saveTraining(t) {
    try { localStorage.setItem(TRAINING_KEY, JSON.stringify(t)); } catch (e) { /* this visit only */ }
}
const today = () => new Date().toISOString().slice(0, 10);

// Consecutive days with training, ending today (or yesterday, if not yet today).
function streak(t) {
    const days = new Set(t.days);
    let d = new Date(), n = 0;
    if (!days.has(d.toISOString().slice(0, 10))) d = new Date(Date.now() - DAY);
    while (days.has(d.toISOString().slice(0, 10))) { n++; d = new Date(d.getTime() - DAY); }
    return n;
}

// Every training position: your mistakes from reviewed games (newest first).
function trainingItems() {
    const out = [];
    for (const g of myGames().reverse()) {
        const r = myReview(g);
        if (!r || !Array.isArray(r.mistakes)) continue;
        for (const m of r.mistakes) out.push({ key: `${g.id}:${m.ply}`, game: g, ...m });
    }
    return out;
}

// 'open' (to fix), 'due' (fixed, review due now), 'fixed' (waiting), 'mastered'.
function itemStatus(item, t) {
    const rec = t.items[item.key];
    if (!rec || !rec.box) return 'open';
    if (rec.box >= MASTERED_BOX) return 'mastered';
    return Date.parse(rec.due) <= Date.now() ? 'due' : 'fixed';
}

function recordResult(item, clean) {
    const t = loadTraining();
    const rec = t.items[item.key] || { box: 0, tries: 0, solves: 0 };
    rec.tries++;
    if (clean === null) {
        rec.box = 0; // shown the solution: still to fix
    } else {
        rec.solves++;
        rec.box = clean ? Math.min(MASTERED_BOX, rec.box + 1) : 1;
        rec.due = new Date(Date.now() + (REVIEW_DAYS[Math.min(rec.box, REVIEW_DAYS.length - 1)] || 0) * DAY).toISOString();
    }
    t.items[item.key] = rec;
    if (!t.days.includes(today())) t.days.push(today());
    t.days = t.days.slice(-400);
    saveTraining(t);
    return rec;
}

// ─── PAGE ──────────────────────────────────────────────────────────────────────
function render() {
    const games = myGames();
    const reviewed = games.filter(isReviewed).slice(-RECENT_GAMES);
    renderHero(games);
    renderFocus(reviewed);
    renderPositions();
    renderNumbers(games, reviewed);
    renderNextGame(games);
    renderUnreviewed(games);
    renderOpeningsCard();
    renderEndgamesCard();
}

// The Opening Trainer's progress (openings.html, chessOpenings).
function renderOpeningsCard() {
    if (typeof OPENING_REPERTOIRES === 'undefined') return;
    let lines = {};
    try { lines = (JSON.parse(localStorage.getItem('chessOpenings')) || {}).lines || {}; } catch (e) { lines = {}; }
    const all = OPENING_REPERTOIRES.flatMap(r => r.lines);
    const learned = all.filter(l => lines[l.id]).length;
    const due = all.filter(l => lines[l.id] && lines[l.id].box < 5 && lines[l.id].due <= today()).length;
    $('openingsCardSub').textContent = !learned ? `${OPENING_REPERTOIRES.length} repertoires, ${all.length} lines to learn.`
        : `${learned} of ${all.length} lines learned${due ? ` · ${due} due today` : ''}`;
}

function renderEndgamesCard() {
    if (typeof ENDGAME_LESSONS === 'undefined') return;
    let lessons = {};
    try { lessons = (JSON.parse(localStorage.getItem('chessEndgames')) || {}).lessons || {}; } catch (e) { lessons = {}; }
    const stars = (l) => (lessons[l.id] && lessons[l.id].stars) || 0;
    const done = ENDGAME_LESSONS.filter(l => stars(l) > 0).length;
    const total = ENDGAME_LESSONS.reduce((n, l) => n + stars(l), 0);
    $('endgamesCardSub').textContent = !done ? `${ENDGAME_LESSONS.length} lessons: mates, opposition, Lucena and Philidor.`
        : `${done} of ${ENDGAME_LESSONS.length} lessons done · ★ ${total}/${ENDGAME_LESSONS.length * 3}`;
}

function renderHero(games) {
    const t = loadTraining();
    const items = trainingItems();
    const count = (s) => items.filter(i => itemStatus(i, t) === s).length;
    const open = count('open'), due = count('due'), mastered = count('mastered');
    $('statToFix').textContent = open;
    $('statDue').textContent = due;
    $('statMastered').textContent = mastered;
    $('statStreak').textContent = streak(t);
    const ready = open + due;
    $('startTraining').disabled = ready === 0;
    $('startTraining').textContent = ready ? `▶ Train now (${Math.min(ready, SESSION_SIZE)})` : '✓ All caught up';
    $('planTitle').textContent = !items.length ? 'Fix your own mistakes' : ready ? 'Positions from your games are waiting' : 'All caught up';
    $('planSub').textContent = !items.length
        ? (games.length ? 'Review a game (Review tab) and its mistakes show up here as positions to fix.' : 'Play a game against the engine and review it — its mistakes become your training.')
        : ready ? `Find the best move in positions where you went wrong. ${due ? `${due} fixed position${due === 1 ? ' is' : 's are'} due for a quick review.` : ''}`
            : 'Nothing due right now — fixed positions come back for a review after a few days. Play and review more games for new ones.';
}

// Up to four cards: your most frequent mistake types (each can be drilled on
// its own), your weakest phase, and blunders per game when that's high.
function renderFocus(reviewed) {
    const list = $('focusList');
    list.innerHTML = '';
    if (!reviewed.length) {
        list.innerHTML = '<div class="panel focus-card empty"><p class="muted">No reviewed games yet. After a game, open <strong>Game Review</strong> — the trainer reads what it finds.</p></div>';
        return;
    }
    const t = loadTraining();
    const items = trainingItems();
    const cards = [];
    const motifTotals = {}, motifGames = {};
    for (const g of reviewed) {
        const r = myReview(g);
        if (!r || !r.motifs) continue;
        for (const [k, n] of Object.entries(r.motifs)) {
            motifTotals[k] = (motifTotals[k] || 0) + n;
            motifGames[k] = (motifGames[k] || 0) + 1;
        }
    }
    for (const [motif, n] of Object.entries(motifTotals).filter(([k]) => MOTIF_INFO[k]).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
        const own = items.filter(i => i.motif === motif);
        const ready = own.filter(i => ['open', 'due'].includes(itemStatus(i, t))).length;
        cards.push({
            title: MOTIF_INFO[motif].label,
            stat: `${n} time${n === 1 ? '' : 's'} in ${motifGames[motif]} of your last ${reviewed.length} reviewed games`,
            tip: MOTIF_INFO[motif].tip,
            progress: own.length ? `${own.length - ready} of ${own.length} fixed` : null,
            action: ready ? { label: `▶ Train these (${ready})`, run: () => startSession({ motif }) } : null,
            puzzles: MOTIF_PUZZLES[motif],
        });
    }
    const phaseAvg = {};
    for (const p of Object.keys(PHASE_INFO)) {
        phaseAvg[p] = avg(reviewed.map(g => g.phaseAccuracy && g.phaseAccuracy[g.playerColor] ? g.phaseAccuracy[g.playerColor][p] : null)
            .filter(v => v !== null && v !== undefined));
    }
    const known = Object.entries(phaseAvg).filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1]);
    if (known.length >= 2 && known[known.length - 1][1] - known[0][1] >= 8) {
        const [weak, weakV] = known[0];
        cards.push({ title: `Your ${PHASE_INFO[weak].label.toLowerCase()}`,
            stat: `${Math.round(weakV)}% accuracy there, against ${Math.round(known[known.length - 1][1])}% in your best phase`,
            tip: PHASE_INFO[weak].tip,
            action: weak === 'endgame' ? { label: '♚ Endgame trainer', run: () => { location.href = 'endgames.html'; } } : null });
    }
    const blunders = avg(reviewed.map(g => (myReview(g) && myReview(g).counts && myReview(g).counts.Blunder) || 0));
    if (blunders !== null && blunders >= 1) {
        cards.push({ title: 'Blunder check', stat: `${blunders.toFixed(1)} blunders per game on average`,
            tip: 'Before you let go of a piece, take three seconds: what does my opponent want to do after this move? Coach mode grades every move while you play.',
            action: { label: 'Play a game with Coach', run: () => { location.href = 'game.html?coach=on'; } } });
    }
    if (!cards.length) {
        list.innerHTML = '<div class="panel focus-card empty"><p class="muted">Your reviewed games look clean — no repeating mistake types. Try a stronger engine level.</p></div>';
        return;
    }
    cards.slice(0, 4).forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'panel focus-card';
        card.innerHTML = `<div class="focus-rank">${i + 1}</div><h3>${esc(c.title)}</h3><div class="focus-stat">${esc(c.stat)}</div><p>${esc(c.tip)}</p>`
            + (c.progress ? `<div class="focus-progress">${esc(c.progress)}</div>` : '');
        const row = document.createElement('div');
        row.className = 'focus-actions';
        if (c.action) {
            const b = document.createElement('button');
            b.className = 'btn btn-primary';
            b.textContent = c.action.label;
            b.addEventListener('click', c.action.run);
            row.appendChild(b);
        }
        if (c.puzzles) {
            const a = document.createElement('a');
            a.className = 'btn';
            a.href = `puzzles.html?theme=${c.puzzles}`;
            a.textContent = '🧩 Puzzles';
            row.appendChild(a);
        }
        if (row.children.length) card.appendChild(row);
        list.appendChild(card);
    });
}

// Your training positions, filtered by status.
function renderPositions() {
    const list = $('practiceList');
    list.innerHTML = '';
    const t = loadTraining();
    const items = trainingItems();
    const wanted = positionFilter === 'open' ? ['open', 'due'] : [positionFilter];
    const shown = items.filter(i => wanted.includes(itemStatus(i, t)));
    const legacy = myGames().filter(g => isReviewed(g) && myReview(g) && !Array.isArray(myReview(g).mistakes)).length;
    if (!shown.length) {
        const empty = positionFilter === 'open' ? (items.length ? 'Nothing to fix right now — well done.' : 'No positions yet — review a game to get some.')
            : positionFilter === 'fixed' ? 'Positions you fix show up here until they are mastered.' : 'Positions fixed on every review over three weeks end up here.';
        list.innerHTML = `<div class="moves-empty">${empty}</div>`;
    }
    for (const item of shown.slice(0, 30)) {
        const status = itemStatus(item, t);
        const rec = t.items[item.key];
        const el = document.createElement('div');
        el.className = 'practice-row';
        const what = item.motif && MOTIF_INFO[item.motif] ? MOTIF_INFO[item.motif].label : `cost ${Math.round(item.winLoss)}% winning chances`;
        const chip = status === 'open' ? '<span class="status-chip new">To fix</span>'
            : status === 'due' ? '<span class="status-chip due">Review</span>'
            : status === 'mastered' ? '<span class="status-chip mastered">★ Mastered</span>'
            : `<span class="status-chip fixed">✓ next in ${Math.max(1, Math.ceil((Date.parse(rec.due) - Date.now()) / DAY))}d</span>`;
        el.innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[item.category]}">${CATEGORY_SYMBOLS[item.category]}</span>`
            + `<span class="practice-main"><strong>${esc(moveLabel(item.ply, item.san))}</strong> <span class="muted">· ${esc(what)}</span>`
            + `<span class="practice-sub">vs ${esc(opponentOf(item.game))} · ${dateLabel(item.game)}</span></span>${chip}`;
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = status === 'mastered' || status === 'fixed' ? 'Again' : 'Train';
        b.addEventListener('click', () => startSession({ first: item.key, any: true }));
        el.appendChild(b);
        list.appendChild(el);
    }
    if (legacy && positionFilter === 'open') {
        const note = document.createElement('div');
        note.className = 'practice-note';
        note.textContent = `${legacy} older review${legacy === 1 ? '' : 's'} only saved totals — open ${legacy === 1 ? 'it' : 'them'} in Review once more to add ${legacy === 1 ? 'its' : 'their'} positions here.`;
        list.appendChild(note);
    }
}

function renderNumbers(games, reviewed) {
    const acc = reviewed.map(g => g.accuracy[g.playerColor]);
    const last = avg(acc.slice(-10)), before = avg(acc.slice(-20, -10));
    const trend = last !== null && before !== null ? last - before : null;
    const blunders = avg(reviewed.map(g => (myReview(g) && myReview(g).counts && myReview(g).counts.Blunder) || 0));
    const recent = games.slice(-10);
    const w = recent.filter(g => score(g) === 1).length, d = recent.filter(g => score(g) === 0.5).length;
    const t = loadTraining();
    const solves = Object.values(t.items).reduce((s, r) => s + (r.solves || 0), 0), tries = Object.values(t.items).reduce((s, r) => s + (r.tries || 0), 0);
    const tiles = [
        { label: 'Accuracy', value: last !== null ? `${last.toFixed(1)}%` : '–', sub: trend === null ? 'last 10 reviewed' : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(1)} vs the 10 before`, tone: trend === null ? '' : trend >= 0 ? 'up' : 'down' },
        { label: 'Blunders / game', value: blunders !== null ? blunders.toFixed(1) : '–', sub: 'reviewed games' },
        { label: 'Last 10 games', value: recent.length ? `${w} / ${d} / ${recent.length - w - d}` : '–', sub: 'wins / draws / losses' },
        { label: 'Training', value: tries ? `${Math.round((solves / tries) * 100)}%` : '–', sub: tries ? `${solves} of ${tries} positions solved` : 'no positions tried yet' },
    ];
    $('numberGrid').innerHTML = tiles.map(t2 => `
        <div class="number-tile"><span class="eyebrow">${t2.label}</span><strong>${t2.value}</strong><span class="number-sub ${t2.tone || ''}">${t2.sub}</span></div>`).join('');
}

// A level to play next in your most-played mode: your rating's level, one up
// after a winning streak, one down after a losing one.
function renderNextGame(games) {
    const ratings = loadPlayerRatings();
    const mode = TIME_MODES.reduce((best, m) => ratings[m.id].games > ratings[best.id].games ? m : best, TIME_MODES[TIME_MODES.length - 1]);
    const inMode = games.filter(g => historyTimeMode(g) === mode.id).slice(-5);
    const pct = inMode.length >= 3 ? avg(inMode.map(score)) : null;
    let level = nearestEngineLevel(ratings[mode.id].rating), why = `The level closest to your ${mode.name} rating.`;
    if (pct !== null && pct >= 0.6 && level < ENGINE_LEVELS.length - 1) { level++; why = `You've scored ${Math.round(pct * 100)}% in your last ${inMode.length} — time for a step up.`; }
    else if (pct !== null && pct <= 0.3 && level > 0) { level--; why = `Only ${Math.round(pct * 100)}% in your last ${inMode.length} — build confidence one step lower.`; }
    const lastControl = [...games].reverse().find(g => historyTimeMode(g) === mode.id);
    const control = lastControl && mode.controls.includes(lastControl.timeControl) ? lastControl.timeControl : mode.defaultControl;
    const href = `game.html?level=${level}&time=${encodeURIComponent(control)}`;
    $('nextGame').innerHTML = `
        <div class="next-game">
            <div><div class="next-rating">≈ ${ENGINE_LEVELS[level].rating}</div><div class="muted">${engineLevelTitle(ENGINE_LEVELS[level].rating)} · ${esc(timeControlTitle(control))}</div></div>
            <p class="muted">${esc(why)}</p>
            <div class="focus-actions"><a class="btn btn-primary" href="${href}">Play it</a><a class="btn" href="${href}&coach=on">With Coach</a></div>
        </div>`;
}

function renderUnreviewed(games) {
    const pending = games.filter(g => !isReviewed(g)).reverse();
    $('unreviewedPanel').classList.toggle('hidden', !pending.length);
    $('unreviewedCount').textContent = pending.length ? `${pending.length}` : '';
    const list = $('unreviewedList');
    list.innerHTML = '';
    for (const g of pending.slice(0, 5)) {
        const el = document.createElement('div');
        el.className = 'practice-row';
        const s = score(g);
        el.innerHTML = `<span class="result-badge ${s === 1 ? 'win' : s === 0 ? 'loss' : 'draw'}">${s === 1 ? 'Win' : s === 0 ? 'Loss' : 'Draw'}</span>`
            + `<span class="practice-main"><strong>vs ${esc(opponentOf(g))}</strong><span class="practice-sub">${esc(timeControlTitle(g.timeControl || 'unlimited'))} · ${dateLabel(g)}</span></span>`;
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = 'Review';
        b.addEventListener('click', () => openGameReview(g));
        el.appendChild(b);
        list.appendChild(el);
    }
}

// ─── THE ENGINE (best moves and judging attempts) ──────────────────────────────
let engineWorker = null, engineSeq = 0;
const engineWaiting = new Map();

function askEngine(message) {
    if (!engineWorker) {
        try { engineWorker = new Worker('analysis-worker.js?v=38'); } catch (e) { return Promise.resolve(null); }
        engineWorker.onmessage = (e) => {
            const d = e.data;
            const done = engineWaiting.get(d.requestId);
            if (!done) return;
            engineWaiting.delete(d.requestId);
            done(d.type === 'error' ? null : d.type === 'hintReply' ? d.hint : d.entry);
        };
    }
    const requestId = ++engineSeq;
    return new Promise((resolve) => {
        engineWaiting.set(requestId, resolve);
        engineWorker.postMessage({ ...message, requestId });
    });
}

// ─── TRAINING SESSION ──────────────────────────────────────────────────────────
// session = { queue: [item], index, results: [true|false|null], streak, board,
//             item, sans (moves before the position), best, status, tries, hinted }
//   status: 'loading' | 'solving' | 'checking' | 'solved' | 'shown'
let session = null;

// opts: { motif } — only that mistake type; { first: key, any: true } — start
// with that position (fixed and mastered ones included).
function startSession(opts = {}) {
    const t = loadTraining();
    let items = trainingItems();
    if (opts.motif) items = items.filter(i => i.motif === opts.motif);
    const rank = { due: 0, open: 1, fixed: 2, mastered: 3 };
    let queue = items.filter(i => opts.any || ['open', 'due'].includes(itemStatus(i, t)))
        .sort((a, b) => rank[itemStatus(a, t)] - rank[itemStatus(b, t)]);
    if (opts.first) {
        const first = items.find(i => i.key === opts.first);
        queue = [first, ...queue.filter(i => i.key !== opts.first && ['open', 'due'].includes(itemStatus(i, t)))];
    }
    queue = queue.filter(Boolean).slice(0, SESSION_SIZE);
    if (!queue.length) return;
    $('trainSession').classList.remove('hidden');
    $('trainHero').classList.add('hidden');
    $('sessionTitle').textContent = opts.motif ? `Training · ${MOTIF_INFO[opts.motif].label}` : 'Training';
    if (!session || !session.board) {
        const board = new BoardView($('trainBoard'), {
            canSelect: (x, y) => session && session.status === 'solving' && !!gameState[y][x] && gameState[y][x].color === currentTurn,
            legalMoves: (x, y) => getvalidMoves(x, y),
            onMove: onTrainMove,
        });
        board.setInteractive(true);
        session = { board };
    }
    Object.assign(session, { queue, index: -1, results: queue.map(() => undefined), streak: 0 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showItem(0);
}

function endSession() {
    $('trainSession').classList.add('hidden');
    $('trainHero').classList.remove('hidden');
    if (session) session.status = 'ended';
    render();
}

async function showItem(i) {
    if (i >= session.queue.length) { showSummary(); return; }
    const item = session.queue[i];
    Object.assign(session, { index: i, item, status: 'loading', tries: 0, hinted: false, best: null });
    const sans = item.game.sanMoves.slice(0, item.ply);
    session.sans = sans;
    replaySANFromStart(sans);
    const b = session.board;
    b.setFlipped(item.game.playerColor === 'black');
    b.clearSelection();
    b.setArrows([]);
    b.setBadge(null);
    b.render(gameState, { animate: false });
    b.setLastMove(lastMove ? { x: lastMove.fromX, y: lastMove.fromY } : null, lastMove ? { x: lastMove.toX, y: lastMove.toY } : null);
    b.updateCheckFromGame();
    renderSessionHead();
    const side = currentTurn === 'white' ? 'White' : 'Black';
    $('sessionTask').innerHTML = `<strong>${side} to move — find the best move.</strong>`;
    $('sessionClue').innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[item.category]}">${CATEGORY_SYMBOLS[item.category]}</span>`
        + `<span>In your game vs ${esc(opponentOf(item.game))} you played <strong>${esc(moveLabel(item.ply, item.san))}</strong> — ${esc(clueFor(item))}</span>`;
    setFeedback(null);
    renderActions();
    // The best move: stored with newer reviews, else asked from the engine.
    if (item.best) {
        session.best = { san: item.best, line: item.line || [] };
    } else {
        setFeedback({ icon: '…', title: 'Setting up the position…' });
        const hint = await askEngine({ type: 'hint', sanMoves: sans });
        if (!session || session.item !== item) return;
        setFeedback(null);
        session.best = hint ? { san: hint.san, line: hint.line || [] } : null;
    }
    session.status = 'solving';
    renderActions();
}

// What went wrong in the game, without naming the answer.
function clueFor(item) {
    if (item.motif && !SOLUTION_MOTIFS.has(item.motif) && item.reason) return item.reason;
    if (item.motif === 'missedMate') return 'there was a forced mate.';
    if (item.motif === 'missedFork') return 'a fork was available.';
    if (item.motif === 'missedWin') return 'there was a way to win material.';
    return `it cost about ${Math.round(item.winLoss)}% winning chances.`;
}

const bare = (san) => String(san || '').replace(/[+#!?]/g, '');

async function onTrainMove(move) {
    if (!session || session.status !== 'solving') return;
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await session.board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || session.status !== 'solving') return;
    }
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    const full = san + getCheckSuffix(currentTurn);
    const b = session.board;
    b.render(gameState);
    b.setLastMove({ x: move.fromX, y: move.fromY }, { x: move.toX, y: move.toY });
    b.updateCheckFromGame();
    playSoundForMove(full);
    session.tries++;
    if (session.best && bare(full) === bare(session.best.san)) { solved(full, 'Best'); return; }
    // Not the stored best move: maybe it's just as good.
    session.status = 'checking';
    renderActions();
    setFeedback({ icon: '…', title: `Checking ${esc(full)}…` });
    const item = session.item;
    const verdict = await askEngine({ type: 'judgeMove', sanMoves: session.sans, san: full });
    if (!session || session.item !== item) return;
    if (verdict && ACCEPTED.has(verdict.category)) { solved(full, verdict.category); return; }
    wrong(full, verdict);
}

function solved(san, category) {
    const clean = session.tries === 1 && !session.hinted;
    session.status = 'solved';
    session.results[session.index] = clean;
    session.streak = clean ? session.streak + 1 : 0;
    const rec = recordResult(session.item, clean);
    flash('good');
    playTone(660, 0.09, { type: 'sine' }); playTone(880, 0.12, { type: 'sine', at: 0.09 });
    const next = rec.box >= MASTERED_BOX ? 'Mastered — it won\'t come back.'
        : `Next review in ${REVIEW_DAYS[Math.min(rec.box, REVIEW_DAYS.length - 1)] || 1} day${(REVIEW_DAYS[Math.min(rec.box, REVIEW_DAYS.length - 1)] || 1) === 1 ? '' : 's'}.`;
    const line = session.best && session.best.line && session.best.line.length > 1 && bare(san) === bare(session.best.san)
        ? `Line: <span class="san-line">${esc(session.best.line.slice(0, 6).join(' '))}</span>` : '';
    setFeedback({ kind: 'good', icon: '✓', title: `${esc(san)} — ${category === 'Best' ? 'the best move!' : CATEGORY_DESCRIPTIONS[category] + '!'}`,
        line: clean ? `First try. ${next}` : `Solved after ${session.tries} tr${session.tries === 1 ? 'y' : 'ies'}${session.hinted ? ' and a hint' : ''} — it comes back tomorrow to make it stick.`,
        line2: line });
    renderSessionHead();
    renderActions();
}

function wrong(san, verdict) {
    session.status = 'solving';
    session.streak = 0;
    flash('bad');
    const cat = verdict ? verdict.category : null;
    const close = cat === 'Excellent' || cat === 'Good';
    const why = verdict && verdict.reason && !SOLUTION_MOTIFS.has(verdict.motif) ? verdict.reason : null;
    setFeedback({ kind: 'bad', icon: cat ? CATEGORY_SYMBOLS[cat] : '✗', title: close ? `${esc(san)} is close — but there's a better move` : `${esc(san)} isn't it`,
        line: why ? esc(why) : close ? 'Look for something even stronger.' : 'Try again.' });
    renderSessionHead();
    // Put the position back after a beat.
    const item = session.item;
    setTimeout(() => {
        if (!session || session.item !== item || session.status !== 'solving') return;
        replaySANFromStart(session.sans);
        session.board.render(gameState);
        session.board.setLastMove(lastMove ? { x: lastMove.fromX, y: lastMove.fromY } : null, lastMove ? { x: lastMove.toX, y: lastMove.toY } : null);
        session.board.updateCheckFromGame();
        renderActions();
    }, 900);
}

function hint() {
    if (!session || session.status !== 'solving' || !session.best) return;
    const r = resolveSAN(currentTurn, session.best.san);
    if (!r) return;
    session.hinted = true;
    session.board.select(r.move.fromX, r.move.fromY);
    setFeedback({ icon: '💡', title: `Look at your ${gameState[r.move.fromY][r.move.fromX].type}.`, line: 'It has the best move.' });
    renderActions();
}

function showSolution() {
    if (!session || !['solving', 'checking'].includes(session.status) || !session.best) return;
    replaySANFromStart(session.sans);
    const r = resolveSAN(currentTurn, session.best.san);
    session.status = 'shown';
    session.results[session.index] = null;
    session.streak = 0;
    recordResult(session.item, null);
    if (r) {
        applyMoveWithPromotion(r.move, r.promo);
        session.board.render(gameState);
        session.board.setLastMove({ x: r.move.fromX, y: r.move.fromY }, { x: r.move.toX, y: r.move.toY });
        session.board.updateCheckFromGame();
        session.board.setArrows([{ from: { x: r.move.fromX, y: r.move.fromY }, to: { x: r.move.toX, y: r.move.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
    }
    const why = session.item.motif && SOLUTION_MOTIFS.has(session.item.motif) && session.item.reason ? `<span class="reason">${esc(session.item.reason)}</span>` : '';
    setFeedback({ kind: 'reveal', icon: '★', title: `The best move was ${esc(session.best.san)}`,
        line: why || (session.best.line.length > 1 ? `Line: <span class="san-line">${esc(session.best.line.slice(0, 6).join(' '))}</span>` : ''),
        line2: 'It stays on your list — you\'ll get it again.' });
    renderSessionHead();
    renderActions();
}

function renderSessionHead() {
    const n = session.queue.length;
    $('sessionCount').textContent = `${Math.min(session.index + 1, n)} / ${n}`;
    $('sessionFill').style.width = `${(session.results.filter(r => r !== undefined).length / n) * 100}%`;
    $('sessionStreak').textContent = session.streak >= 2 ? `🔥 ${session.streak} in a row` : '';
}

function renderActions() {
    const box = $('sessionActions');
    box.innerHTML = '';
    const add = (label, fn, cls = '') => {
        const b = document.createElement('button');
        b.className = 'btn ' + cls;
        b.textContent = label;
        b.addEventListener('click', fn);
        box.appendChild(b);
    };
    const last = session.index === session.queue.length - 1;
    if (session.status === 'solving' || session.status === 'checking' || session.status === 'loading') {
        if (!session.hinted) add('💡 Hint', hint);
        add('Show solution', showSolution);
        add(last ? 'Finish' : 'Skip →', () => showItem(session.index + 1));
        box.querySelectorAll('.btn').forEach(b => { b.disabled = session.status !== 'solving'; });
    } else {
        add('Open the game', () => openGameReview(session.item.game));
        add(last ? 'See results' : 'Next position →', () => showItem(session.index + 1), 'btn-primary');
    }
}

function setFeedback(fb) {
    const el = $('sessionFeedback');
    if (!fb) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.className = 'session-feedback ' + (fb.kind || '');
    el.innerHTML = `<span class="caption-icon">${fb.icon || ''}</span><div><div class="session-feedback-title">${fb.title}</div>`
        + (fb.line ? `<div class="caption-line">${fb.line}</div>` : '') + (fb.line2 ? `<div class="caption-line">${fb.line2}</div>` : '') + '</div>';
}

// A short green / red pulse around the board (and a shake when wrong).
function flash(kind) {
    const el = $('trainBoard');
    el.classList.remove('flash-good', 'flash-bad');
    void el.offsetWidth; // restart the animation
    el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
    if (kind === 'bad' && navigator.vibrate) navigator.vibrate(60);
}

function showSummary() {
    const r = session.results;
    const clean = r.filter(x => x === true).length, later = r.filter(x => x === false).length, shown = r.filter(x => x === null).length;
    session.status = 'done';
    session.board.setArrows([]);
    $('sessionCount').textContent = 'Done';
    $('sessionFill').style.width = '100%';
    $('sessionStreak').textContent = `🔥 ${streak(loadTraining())}-day streak`;
    $('sessionTask').innerHTML = `<strong>${clean + later} of ${r.length} fixed</strong>`;
    $('sessionClue').innerHTML = `<span>${clean} on the first try${later ? ` · ${later} after a retry` : ''}${shown ? ` · ${shown} shown` : ''}${r.length - clean - later - shown ? ` · ${r.length - clean - later - shown} skipped` : ''}.</span>`;
    setFeedback({ kind: clean === r.length ? 'good' : '', icon: clean === r.length ? '★' : '✓',
        title: clean === r.length ? 'Perfect session!' : 'Session complete',
        line: 'Fixed positions come back for a short review in a few days, until they are mastered.' });
    const box = $('sessionActions');
    box.innerHTML = '';
    const more = trainingItems().filter(i => ['open', 'due'].includes(itemStatus(i, loadTraining()))).length;
    const again = document.createElement('button');
    again.className = 'btn btn-primary';
    again.textContent = more ? `▶ Keep going (${Math.min(more, SESSION_SIZE)})` : 'Back to the plan';
    again.addEventListener('click', () => more ? startSession() : endSession());
    const done = document.createElement('button');
    done.className = 'btn';
    done.textContent = 'Done';
    done.addEventListener('click', endSession);
    box.append(again, done);
}
