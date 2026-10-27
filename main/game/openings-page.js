// ─── OPENING TRAINER ───────────────────────────────────────────────────────────
// Drives openings.html: learn the lines of a repertoire (opening-repertoires.js)
// and review them with spaced repetition. A line is learned by playing it with
// the moves shown (arrow + note), then once from memory. Each clean review moves
// it up a box — back in 1 / 3 / 7 / 21 days, box 5 = mastered; a miss sends it
// back to box 0 (due again today).
//
// Progress: localStorage['chessOpenings'] = { lines: { [lineId]: { box, due, reviews, misses } }, repertoire }
// Training days also count toward the Train page's day streak (chessTraining.days).
const OPENINGS_KEY = 'chessOpenings';
const TRAINING_DAYS_KEY = 'chessTraining';
const OPENING_REVIEW_DAYS = [0, 1, 3, 7, 21];
const OPENING_MASTERED = 5;
const REVIEW_SESSION = 8;    // due lines per review session
const REPLY_DELAY = 450;     // ms before the opponent's move

let store = null;
let selected = null;         // repertoire id shown in the line list
let drill = null;            // { queue:[{rep, line, mode}], index, step, moves, status, missed, hinted, results:[], board }
let drillBoard = null;
let replyTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bare = (san) => (san || '').replace(/[+#!?]/g, '');
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function loadStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(OPENINGS_KEY)); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    s.lines = s.lines || {};
    return s;
}
function saveStore() {
    try { localStorage.setItem(OPENINGS_KEY, JSON.stringify(store)); } catch (e) { /* this visit only */ }
}

// Marks today as a training day for the Train page's streak.
function markTrainingDay() {
    try {
        const t = JSON.parse(localStorage.getItem(TRAINING_DAYS_KEY)) || {};
        t.items = t.items || {};
        t.days = Array.isArray(t.days) ? t.days : [];
        if (!t.days.includes(today())) { t.days.push(today()); localStorage.setItem(TRAINING_DAYS_KEY, JSON.stringify(t)); }
    } catch (e) { /* streak just won't count it */ }
}

// new · due · learned (box 1-4, not due) · mastered
function lineStatus(line) {
    const rec = store.lines[line.id];
    if (!rec) return 'new';
    if (rec.box >= OPENING_MASTERED) return 'mastered';
    if (rec.due <= today()) return 'due';
    return 'learned';
}

const repById = (id) => OPENING_REPERTOIRES.find(r => r.id === id);
const allLines = () => OPENING_REPERTOIRES.flatMap(rep => rep.lines.map(line => ({ rep, line })));
const dueLines = (rep) => allLines().filter(x => (!rep || x.rep === rep) && lineStatus(x.line) === 'due');

document.addEventListener('DOMContentLoaded', () => {
    store = loadStore();
    const param = new URLSearchParams(location.search).get('rep');
    selected = repById(param) ? param : repById(store.repertoire) ? store.repertoire : OPENING_REPERTOIRES[0].id;
    drillBoard = new BoardView($('openingBoard'), {
        canSelect: (x, y) => !!drill && drill.status === 'move' && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onDrillMove,
    });
    $('reviewAll').addEventListener('click', () => {
        if (dueLines(null).length) { startDrill(reviewQueue(null)); return; }
        const rep = repById(selected), next = rep.lines.find(l => lineStatus(l) === 'new');
        if (next) startDrill([{ rep, line: next, mode: 'learn' }]);
    });
    $('endDrill').addEventListener('click', endDrill);
    renderAll();
});

function renderAll() {
    renderHero();
    renderRepertoires();
    renderLines();
}

function renderHero() {
    const lines = allLines();
    const counts = { new: 0, due: 0, learned: 0, mastered: 0 };
    for (const { line } of lines) counts[lineStatus(line)]++;
    $('statLearned').textContent = counts.learned + counts.due + counts.mastered;
    $('statDue').textContent = counts.due;
    $('statMastered').textContent = counts.mastered;
    $('statTotal').textContent = lines.length;
    const rep = repById(selected), next = rep.lines.find(l => lineStatus(l) === 'new');
    $('reviewAll').disabled = !counts.due && !next;
    $('reviewAll').textContent = counts.due ? `▶ Review due lines (${counts.due})` : next ? `＋ Learn: ${rep.name} — ${next.name}` : '✓ Nothing due today';
    $('heroSub').textContent = counts.learned + counts.due + counts.mastered === 0
        ? 'Pick a repertoire below and learn your first line — it takes about a minute.'
        : counts.due ? `${counts.due} line${counts.due === 1 ? ' is' : 's are'} due for review today.`
        : 'All caught up. Learn a new line, or come back tomorrow for reviews.';
}

function renderRepertoires() {
    const grid = $('repertoireGrid');
    grid.innerHTML = '';
    for (const rep of OPENING_REPERTOIRES) {
        const statuses = rep.lines.map(lineStatus);
        const learned = statuses.filter(s => s !== 'new').length;
        const due = statuses.filter(s => s === 'due').length;
        const card = document.createElement('button');
        card.className = 'panel repertoire-card' + (rep.id === selected ? ' selected' : '');
        card.innerHTML = `<div class="repertoire-top"><span class="side-badge ${rep.color}">${rep.color === 'white' ? 'White' : 'Black'}</span>`
            + (due ? `<span class="status-chip due">${due} due</span>` : '') + '</div>'
            + `<h3>${esc(rep.name)}</h3><p>${esc(rep.blurb)}</p>`
            + `<div class="repertoire-progress"><div style="width:${Math.round(100 * learned / rep.lines.length)}%"></div></div>`
            + `<div class="repertoire-count">${learned} of ${rep.lines.length} lines learned</div>`;
        card.addEventListener('click', () => {
            selected = rep.id;
            store.repertoire = rep.id;
            saveStore();
            renderAll();
            $('linePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        grid.appendChild(card);
    }
}

function renderLines() {
    const rep = repById(selected);
    $('linePanelTitle').textContent = `${rep.name} · ${rep.color === 'white' ? 'as White' : 'as Black'}`;
    const actions = $('linePanelActions');
    actions.innerHTML = '';
    const next = rep.lines.find(l => lineStatus(l) === 'new');
    const due = dueLines(rep);
    if (due.length) actions.appendChild(button(`▶ Review (${due.length})`, () => startDrill(reviewQueue(rep)), 'btn-primary'));
    if (next) actions.appendChild(button('＋ Learn next line', () => startDrill([{ rep, line: next, mode: 'learn' }]), due.length ? '' : 'btn-primary'));
    if (!next && !due.length) actions.appendChild(button('▶ Practise all', () => startDrill(shuffle(rep.lines.map(line => ({ rep, line, mode: 'quiz' }))).slice(0, REVIEW_SESSION))));

    const list = $('lineList');
    list.innerHTML = '';
    for (const line of rep.lines) {
        const status = lineStatus(line);
        const rec = store.lines[line.id];
        const chip = status === 'new' ? '<span class="status-chip new-line">New</span>'
            : status === 'due' ? '<span class="status-chip due">Review</span>'
            : status === 'mastered' ? '<span class="status-chip mastered">★ Mastered</span>'
            : `<span class="status-chip fixed">✓ next in ${Math.max(1, Math.round((Date.parse(rec.due) - Date.parse(today())) / 86400000))}d</span>`;
        const moves = parseOpeningLine(line.moves).map(m => m.san);
        const row = document.createElement('div');
        row.className = 'practice-row';
        row.innerHTML = `<span class="practice-main"><strong>${esc(line.name)}</strong>`
            + `<span class="practice-sub san-line">${esc(formatMoves(moves, 10))}</span></span>${chip}`;
        row.appendChild(button(status === 'new' ? 'Learn' : 'Practise', () => startDrill([{ rep, line, mode: status === 'new' ? 'learn' : 'quiz' }])));
        list.appendChild(row);
    }
}

function button(label, fn, cls = '') {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
}

function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

// "1.e4 e5 2.Nf3 Nc6 …" — the first `max` plies.
function formatMoves(moves, max = Infinity) {
    const out = [];
    moves.slice(0, max).forEach((san, i) => out.push(i % 2 === 0 ? `${i / 2 + 1}.${san}` : san));
    return out.join(' ') + (moves.length > max ? ' …' : '');
}

// Due lines, the most overdue first.
function reviewQueue(rep) {
    return dueLines(rep).sort((a, b) => (store.lines[a.line.id].due < store.lines[b.line.id].due ? -1 : 1))
        .slice(0, REVIEW_SESSION).map(x => ({ ...x, mode: 'quiz' }));
}

// ─── DRILL ─────────────────────────────────────────────────────────────────────
function startDrill(queue) {
    if (!queue.length) return;
    drill = { queue, index: -1, results: [] };
    $('drill').classList.remove('hidden');
    $('openingsHero').classList.add('hidden');
    $('drill').scrollIntoView({ behavior: 'smooth', block: 'start' });
    nextLine();
}

function endDrill() {
    clearTimeout(replyTimer);
    drill = null;
    $('drill').classList.add('hidden');
    $('openingsHero').classList.remove('hidden');
    renderAll();
}

function nextLine() {
    clearTimeout(replyTimer);
    drill.index++;
    if (drill.index >= drill.queue.length) { showSummary(); return; }
    const item = drill.queue[drill.index];
    drill.item = item;
    drill.moves = parseOpeningLine(item.line.moves);
    drill.step = 0;
    drill.missed = false;
    drill.missedThisMove = false;
    drill.status = 'wait';
    resetGame();
    recordPosition();
    drillBoard.setFlipped(item.rep.color === 'black');
    drillBoard.render(gameState, { animate: false });
    drillBoard.setLastMove(null, null);
    drillBoard.setArrows([]);
    drillBoard.setCheck(null);
    setFeedback(null);
    $('drillTitle').textContent = `${item.rep.name} · ${item.line.name}`;
    $('drillCount').textContent = `${drill.index + 1} / ${drill.queue.length}`;
    $('drillFill').style.width = `${Math.round(100 * drill.index / drill.queue.length)}%`;
    $('drillMode').innerHTML = item.mode === 'learn' ? '<span class="status-chip new-line">Learning</span>' : '<span class="status-chip due">From memory</span>';
    renderMoves();
    advance();
}

const userColor = () => drill.item.rep.color;

// Plays the opponent's moves until it's your turn (or the line ends).
function advance() {
    if (drill.step >= drill.moves.length) { lineDone(); return; }
    if (currentTurn !== userColor()) {
        drill.status = 'wait';
        renderTask();
        replyTimer = setTimeout(() => {
            if (!drill) return;
            playMove(drill.moves[drill.step].san);
            drill.step++;
            renderMoves();
            advance();
        }, drill.step === 0 ? 500 : REPLY_DELAY);
        return;
    }
    drill.status = 'move';
    drill.hinted = false;
    renderTask();
    if (drill.item.mode === 'learn') showExpected();
}

function playMove(san) {
    const r = resolveSAN(currentTurn, san);
    applyMoveWithPromotion(r.move, r.promo);
    recordPosition();
    drillBoard.render(gameState);
    drillBoard.setLastMove({ x: r.move.fromX, y: r.move.fromY }, { x: r.move.toX, y: r.move.toY });
    drillBoard.updateCheckFromGame();
    playSoundForMove(san);
    return r;
}

// Arrow for the repertoire move (+ its note when learning).
function showExpected() {
    const expected = drill.moves[drill.step];
    const r = resolveSAN(currentTurn, expected.san);
    drillBoard.setArrows([{ from: { x: r.move.fromX, y: r.move.fromY }, to: { x: r.move.toX, y: r.move.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
    if (drill.item.mode === 'learn') {
        setFeedback({ kind: '', icon: '📖', title: `Play ${moveNumber(drill.step)}${esc(expected.san)}`, line: expected.note ? esc(expected.note) : '' });
    }
}

function moveNumber(step) {
    return step % 2 === 0 ? `${step / 2 + 1}.` : `${(step + 1) / 2}…`;
}

async function onDrillMove(move) {
    if (!drill || drill.status !== 'move') return;
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await drillBoard.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || !drill || drill.status !== 'move') return;
    }
    const san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    const expected = drill.moves[drill.step];
    if (bare(san) !== bare(expected.san)) { wrongMove(san); return; }

    drillBoard.setArrows([]);
    playMove(expected.san);
    const learning = drill.item.mode === 'learn';
    if (learning || drill.missedThisMove) setFeedback(null);
    else setFeedback({ kind: 'good', icon: '✓', title: `${moveNumber(drill.step)}${esc(expected.san)}`, line: expected.note ? esc(expected.note) : '' });
    drill.missedThisMove = false;
    drill.step++;
    renderMoves();
    advance();
}

// Not the repertoire move: the board stays, the right move is shown.
function wrongMove(san) {
    flash('bad');
    drillBoard.render(gameState, { animate: false });
    const expected = drill.moves[drill.step];
    if (drill.item.mode === 'learn') {
        setFeedback({ kind: 'bad', icon: '↺', title: `Not ${esc(san)} — play ${moveNumber(drill.step)}${esc(expected.san)}`, line: expected.note ? esc(expected.note) : '' });
        return;
    }
    drill.missed = true;
    drill.missedThisMove = true;
    showExpected();
    setFeedback({ kind: 'bad', icon: '✗', title: `${esc(san)} isn't your repertoire move — it's ${moveNumber(drill.step)}${esc(expected.san)}`,
        line: (expected.note ? esc(expected.note) + ' ' : '') + 'Play it to continue.' });
    renderActions();
}

function hint() {
    if (!drill || drill.status !== 'move' || drill.item.mode === 'learn') return;
    drill.hinted = true;
    drill.missed = true;
    const expected = drill.moves[drill.step];
    const r = resolveSAN(currentTurn, expected.san);
    drillBoard.select(r.move.fromX, r.move.fromY);
    setFeedback({ kind: '', icon: '💡', title: `Move the ${gameState[r.move.fromY][r.move.fromX].type}.`, line: 'A hint counts as a miss — this line comes back today.' });
    renderActions();
}

function lineDone() {
    drill.status = 'done';
    drillBoard.setArrows([]);
    const { line, mode } = drill.item;
    if (mode === 'learn') {
        // Now once from memory, right away.
        drill.queue.splice(drill.index + 1, 0, { ...drill.item, mode: 'quiz', fresh: true });
        drill.results.push({ line, outcome: 'learned' });
        setFeedback({ kind: 'good', icon: '✓', title: 'Line played through', line: 'Now play it once from memory — no arrows.' });
    } else {
        const rec = store.lines[line.id] || { box: 0, reviews: 0, misses: 0 };
        rec.reviews++;
        if (drill.missed) {
            rec.misses++;
            rec.box = 0;
            rec.due = today();
        } else {
            rec.box = drill.item.fresh ? 1 : Math.min(OPENING_MASTERED, rec.box + 1);
            rec.due = addDays(OPENING_REVIEW_DAYS[Math.min(rec.box, OPENING_REVIEW_DAYS.length - 1)] || 21);
        }
        store.lines[line.id] = rec;
        saveStore();
        markTrainingDay();
        drill.results.push({ line, outcome: drill.missed ? 'missed' : 'clean' });
        if (drill.missed) {
            flash('bad');
            setFeedback({ kind: 'bad', icon: '↺', title: 'Line finished with a miss', line: 'It stays due — it comes back at the end of this session.' });
            if (!drill.queue.slice(drill.index + 1).some(q => q.line === line)) drill.queue.push({ ...drill.item, fresh: false });
        } else {
            flash('good');
            playTone(660, 0.09, { type: 'sine' }); playTone(880, 0.12, { type: 'sine', at: 0.09 });
            const days = rec.box >= OPENING_MASTERED ? null : OPENING_REVIEW_DAYS[rec.box] || 21;
            setFeedback({ kind: 'good', icon: rec.box >= OPENING_MASTERED ? '★' : '✓', title: rec.box >= OPENING_MASTERED ? 'Mastered!' : 'Perfect line',
                line: days ? `Next review in ${days} day${days === 1 ? '' : 's'}.` : 'This line won\'t come back unless you practise it.' });
        }
    }
    renderTask();
    renderActions();
}

function renderTask() {
    const you = userColor() === 'white' ? 'White' : 'Black';
    const task = drill.status === 'done' ? `<strong>${esc(drill.item.line.name)}</strong> — done`
        : drill.status === 'wait' ? '<span class="muted">Opponent to move…</span>'
        : drill.item.mode === 'learn' ? `<strong>Your move</strong> <span class="muted">as ${you} — follow the arrow</span>`
        : `<strong>Your move</strong> <span class="muted">as ${you} — what does your repertoire play?</span>`;
    $('drillTask').innerHTML = task;
    renderActions();
}

function renderMoves() {
    const played = drill.moves.slice(0, drill.step).map(m => m.san);
    const total = drill.moves.length;
    $('drillMoves').innerHTML = `<span class="san-line">${esc(formatMoves(played)) || '<span class="muted">Starting position</span>'}</span>`
        + `<span class="line-progress">${drill.step} / ${total}</span>`;
}

function renderActions() {
    const box = $('drillActions');
    box.innerHTML = '';
    if (!drill) return;
    if (drill.status === 'done') {
        const last = drill.index === drill.queue.length - 1;
        box.appendChild(button(last ? 'See results' : 'Next line →', nextLine, 'btn-primary'));
        return;
    }
    if (drill.item.mode === 'quiz' && drill.status === 'move' && !drill.hinted && !drill.missedThisMove) box.appendChild(button('💡 Hint', hint));
    if (drill.item.mode === 'quiz' && drill.status === 'move' && !drill.missedThisMove) {
        box.appendChild(button('Show move', () => { drill.missed = true; drill.missedThisMove = true; showExpected();
            const e = drill.moves[drill.step];
            setFeedback({ kind: 'bad', icon: '👁', title: `It's ${moveNumber(drill.step)}${esc(e.san)}`, line: (e.note ? esc(e.note) + ' ' : '') + 'Play it to continue.' });
            renderActions(); }));
    }
    box.appendChild(button('Restart line', restartLine));
}

// Back to the start of the line; a miss already made still counts.
function restartLine() {
    const missed = drill.missed;
    drill.index--;
    nextLine();
    drill.missed = missed;
}

function setFeedback(fb) {
    const el = $('drillFeedback');
    if (!fb) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.className = 'session-feedback ' + (fb.kind || '');
    el.innerHTML = `<span class="caption-icon">${fb.icon || ''}</span><div><div class="session-feedback-title">${fb.title}</div>`
        + (fb.line ? `<div class="caption-line">${fb.line}</div>` : '') + '</div>';
}

function flash(kind) {
    const el = $('openingBoard');
    el.classList.remove('flash-good', 'flash-bad');
    void el.offsetWidth; // restart the animation
    el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
    if (kind === 'bad' && navigator.vibrate) navigator.vibrate(60);
}

function showSummary() {
    const reviewed = drill.results.filter(r => r.outcome !== 'learned');
    const clean = reviewed.filter(r => r.outcome === 'clean').length;
    const learned = drill.results.filter(r => r.outcome === 'learned').length;
    drill.status = 'summary';
    $('drillCount').textContent = 'Done';
    $('drillFill').style.width = '100%';
    $('drillMode').innerHTML = '';
    $('drillTask').innerHTML = `<strong>${clean} of ${reviewed.length} line${reviewed.length === 1 ? '' : 's'} perfect</strong>${learned ? ` <span class="muted">· ${learned} new</span>` : ''}`;
    $('drillMoves').innerHTML = '';
    setFeedback({ kind: clean === reviewed.length ? 'good' : '', icon: clean === reviewed.length ? '★' : '✓',
        title: clean === reviewed.length ? 'Session complete' : 'Session complete — misses come back today',
        line: 'Lines you know come back after 1, 3, 7 and 21 days, then they are mastered.' });
    const box = $('drillActions');
    box.innerHTML = '';
    const rep = drill.item.rep;
    const next = rep.lines.find(l => lineStatus(l) === 'new');
    const due = dueLines(null);
    if (due.length) box.appendChild(button(`▶ Review due (${due.length})`, () => startDrill(reviewQueue(null)), 'btn-primary'));
    if (next) box.appendChild(button('＋ Learn next line', () => startDrill([{ rep, line: next, mode: 'learn' }]), due.length ? '' : 'btn-primary'));
    box.appendChild(button('Done', endDrill));
}
