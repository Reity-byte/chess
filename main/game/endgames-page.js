// ─── ENDGAME TRAINER ───────────────────────────────────────────────────────────
// Drives endgames.html: play the positions in endgame-lessons.js against the
// engine at full strength (ai-worker.js, 'search' from a FEN). A lesson ends in
// success (mate / safe promotion / the draw held) or a failure with the reason —
// stalemate, a lost piece, the 50-move rule — and you can take the move back.
// K+P vs K positions are judged by the exact bitbase (kpkWins in
// endgame-tables.js), so a move that throws away the result fails at once.
//
// Stars: 1 = solved, 2 = without hints or take-backs, 3 = that and (where a par
// is known) within par + a little slack.
// Progress: localStorage['chessEndgames'] = { lessons: { [id]: { stars, best, tries } } }
const ENDGAMES_KEY = 'chessEndgames';
const TRAINING_DAYS_KEY = 'chessTraining';
const ENGINE_TIME_MS = 700;    // the opponent's thinking time per move
const HINT_TIME_MS = 1200;
const REPLY_DELAY = 350;       // minimum pause before the opponent's move
const VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const GOAL_LABEL = { mate: 'Checkmate', promote: 'Promote the pawn', draw: 'Hold the draw' };

let store = null;
let board = null;
let les = null;   // { lesson, user, moves:[{san,from,to,by}], status, help, hint, token, startDiff }
let token = 0;    // bumps on every new lesson / take-back, so stale engine replies are dropped

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const other = (c) => (c === 'white' ? 'black' : 'white');
const lessonById = (id) => ENDGAME_LESSONS.find(l => l.id === id);
const chapterById = (id) => ENDGAME_CHAPTERS.find(c => c.id === id);
const progress = (l) => store.lessons[l.id] || null;
const starsOf = (l) => (progress(l) ? progress(l).stars || 0 : 0);
const userSide = (l) => (l.fen.split(' ')[1] === 'b' ? 'black' : 'white');

function loadStore() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(ENDGAMES_KEY)); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    s.lessons = s.lessons || {};
    return s;
}
function saveStore() {
    try { localStorage.setItem(ENDGAMES_KEY, JSON.stringify(store)); } catch (e) { /* this visit only */ }
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

// ─── ENGINE (worker with synchronous fallback) ─────────────────────────────────
const engine = {
    worker: null,
    broken: false,
    pending: null,
    nextId: 1,

    ensure() {
        if (this.worker || this.broken) return;
        try {
            this.worker = new Worker('ai-worker.js?v=36');
            this.worker.onmessage = (e) => this.onMessage(e.data);
            this.worker.onerror = (e) => { e.preventDefault(); this.fail(); };
        } catch (e) {
            this.broken = true;
        }
    },

    fail() {
        this.broken = true;
        if (this.worker) this.worker.terminate();
        this.worker = null;
        const p = this.pending;
        this.pending = null;
        if (p) p.runLocally();
    },

    cancel() {
        if (!this.pending) return;
        this.pending = null;
        if (this.worker) { this.worker.terminate(); this.worker = null; }
    },

    // Best move for the side to move in the current game -> { move, promo, score }.
    search(timeMs) {
        this.cancel();
        this.ensure();
        const params = { fen: les.lesson.fen, sanMoves: les.moves.map(m => m.san), timeMs, maxDepth: 64 };
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const runLocally = () => setTimeout(() => {
                try { resolve(searchRoot(currentTurn, { timeMs: params.timeMs, maxDepth: params.maxDepth })); } catch (err) { reject(err); }
            }, 30);
            if (!this.worker) { runLocally(); return; }
            this.pending = { id, resolve, reject, runLocally };
            this.worker.postMessage({ type: 'search', id, ...params });
        });
    },

    onMessage(d) {
        if (!this.pending || d.id !== this.pending.id) return;
        const p = this.pending;
        this.pending = null;
        if (d.type === 'error') p.reject(new Error(d.message));
        else p.resolve({ move: d.move, promo: d.promo, score: d.score });
    },
};

// ─── PAGE ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    store = loadStore();
    board = new BoardView($('endgameBoard'), {
        canSelect: (x, y) => !!les && les.status === 'move' && !!gameState[y][x] && gameState[y][x].color === currentTurn,
        legalMoves: (x, y) => getvalidMoves(x, y),
        onMove: onUserMove,
    });
    board.setInteractive(true);
    $('endLesson').addEventListener('click', closeLesson);
    $('continueButton').addEventListener('click', () => { const l = nextLesson(); if (l) startLesson(l); });
    renderAll();
    const param = lessonById(new URLSearchParams(location.search).get('lesson'));
    if (param) startLesson(param);
});

// The first lesson without stars (expert ones last), else the first below three.
function nextLesson() {
    const order = ENDGAME_LESSONS.filter(l => !l.expert).concat(ENDGAME_LESSONS.filter(l => l.expert));
    return order.find(l => !starsOf(l)) || order.find(l => starsOf(l) < 3) || null;
}

function renderAll() {
    renderHero();
    renderChapters();
}

function renderHero() {
    const all = ENDGAME_LESSONS;
    const done = all.filter(l => starsOf(l) > 0).length;
    const stars = all.reduce((n, l) => n + starsOf(l), 0);
    $('statDone').textContent = done;
    $('statStars').textContent = `${stars}/${all.length * 3}`;
    $('statPerfect').textContent = all.filter(l => starsOf(l) === 3).length;
    $('statTotal').textContent = all.length;
    const next = nextLesson();
    $('continueButton').disabled = !next;
    $('continueButton').textContent = !next ? '★ Every lesson has three stars' : `▶ ${done ? 'Continue' : 'Start'}: ${next.name}`;
    $('heroSub').textContent = !done
        ? 'Play the key endgame positions against the engine until the technique is automatic. Start with the basic checkmates.'
        : next && !starsOf(next) ? `${done} of ${all.length} lessons done. Next up: ${chapterById(next.chapter).name.toLowerCase()}.`
        : 'Every lesson solved — replay them for three stars, faster and without hints.';
}

function renderChapters() {
    const wrap = $('chapters');
    wrap.innerHTML = '';
    for (const ch of ENDGAME_CHAPTERS) {
        const lessons = ENDGAME_LESSONS.filter(l => l.chapter === ch.id);
        const stars = lessons.reduce((n, l) => n + starsOf(l), 0);
        const panel = document.createElement('section');
        panel.className = 'panel endgame-chapter';
        panel.innerHTML = `<div class="panel-header">${esc(ch.name)}<span class="chapter-stars">★ ${stars}/${lessons.length * 3}</span></div>`
            + `<p class="muted chapter-blurb">${esc(ch.blurb)}</p>`;
        const list = document.createElement('div');
        list.className = 'practice-list';
        for (const l of lessons) {
            const s = starsOf(l), rec = progress(l);
            const sub = [GOAL_LABEL[l.goal], userSide(l) === 'black' ? 'as Black' : null, l.par ? `par ${l.par}` : null,
                rec && rec.best ? `best ${rec.best}` : null].filter(Boolean).join(' · ');
            const row = document.createElement('div');
            row.className = 'practice-row';
            row.innerHTML = `<span class="practice-main"><strong>${esc(l.name)}${l.expert ? ' <span class="status-chip due">Expert</span>' : ''}</strong>`
                + `<span class="practice-sub">${esc(sub)}</span></span>`
                + `<span class="lesson-stars" aria-label="${s} of 3 stars">${'★'.repeat(s)}<span>${'★'.repeat(3 - s)}</span></span>`;
            row.appendChild(button(s ? 'Again' : 'Play', () => startLesson(l), s ? '' : 'btn-primary'));
            list.appendChild(row);
        }
        panel.appendChild(list);
        wrap.appendChild(panel);
    }
}

function button(label, fn, cls = '') {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
}

// ─── LESSON ────────────────────────────────────────────────────────────────────
function startLesson(lesson) {
    engine.cancel();
    token++;
    loadFEN(lesson.fen);
    les = { lesson, user: currentTurn, moves: [], status: 'move', help: 0, hint: null, token, startDiff: materialDiff(currentTurn) };
    rebuild();
    const rec = store.lessons[lesson.id] || { stars: 0, tries: 0 };
    rec.tries = (rec.tries || 0) + 1;
    store.lessons[lesson.id] = rec;
    saveStore();

    $('lesson').classList.remove('hidden');
    $('endgamesHero').classList.add('hidden');
    $('lessonChapter').textContent = chapterById(lesson.chapter).name;
    $('lessonTitle').textContent = lesson.name;
    $('lessonGoal').innerHTML = `<span class="status-chip ${lesson.goal === 'draw' ? 'fixed' : 'due'}">${GOAL_LABEL[lesson.goal]}</span>`;
    board.setFlipped(les.user === 'black');
    board.clearSelection();
    board.setArrows([]);
    setFeedback({ icon: '📖', title: 'How to play it', line: esc(lesson.intro) });
    renderTask();
    $('lesson').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeLesson() {
    engine.cancel();
    token++;
    les = null;
    $('lesson').classList.add('hidden');
    $('endgamesHero').classList.remove('hidden');
    renderAll();
}

// Replays the lesson from its FEN through les.moves (after a take-back) and redraws.
function rebuild() {
    replay();
    board.render(gameState, { animate: false });
    const last = les.moves[les.moves.length - 1];
    board.setLastMove(last ? last.from : null, last ? last.to : null);
    board.updateCheckFromGame();
    renderMoves();
}

// Plays a move on the real board; returns its SAN (with check suffix).
function play(move, promo, by) {
    let san = moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo);
    applyMoveWithPromotion(move, promo);
    recordPosition();
    san += getCheckSuffix(currentTurn);
    const from = { x: move.fromX, y: move.fromY }, to = { x: move.toX, y: move.toY };
    les.moves.push({ san, from, to, by });
    board.render(gameState);
    board.setLastMove(from, to);
    board.updateCheckFromGame();
    playSoundForMove(san);
    renderMoves();
    return san;
}

const userMoveCount = () => les.moves.filter(m => m.by === 'user').length;

async function onUserMove(move) {
    if (!les || les.status !== 'move') return;
    const piece = gameState[move.fromY][move.fromX];
    let promo = null;
    if (piece.type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
        promo = await board.askPromotion(move.toX, move.toY, piece.color);
        if (!promo || !les || les.status !== 'move') return;
    }
    board.setArrows([]);
    les.hint = null;
    play(move, promo, 'user');
    if (judge('user', promo ? { x: move.toX, y: move.toY } : null)) return;
    setFeedback(null);
    engineReply();
}

async function engineReply() {
    les.status = 'wait';
    renderTask();
    const mine = les.token;
    const started = Date.now();
    let r = lineMove();
    if (!r) {
        try { r = await engine.search(ENGINE_TIME_MS); } catch (e) { r = null; }
    }
    if (!les || les.token !== mine) return;
    const wait = REPLY_DELAY - (Date.now() - started);
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
    if (!les || les.token !== mine) return;
    if (!r || !r.move) { judge('engine'); return; }
    play(r.move, r.promo, 'engine');
    if (judge('engine')) return;
    les.status = 'move';
    renderTask();
}

// Material balance (pawn = 1) from `color`'s side.
function materialDiff(color) {
    let d = 0;
    for (const row of gameState) for (const p of row) if (p) d += p.color === color ? VALUE[p.type] : -VALUE[p.type];
    return d;
}

function pawnCount(color) {
    let n = 0;
    for (const row of gameState) for (const p of row) if (p && p.type === 'pawn' && p.color === color) n++;
    return n;
}

// After each move: has the lesson been won or lost? Returns true when it ended.
// `promotedOn` = the square the user just promoted on.
function judge(by, promotedOn = null) {
    const { lesson, user } = les;
    const status = getGameStatus();
    if (status) {
        if (status.reason === 'checkmate') {
            const userWon = currentTurn !== user;
            if (userWon) return succeed(lesson.goal === 'mate' ? 'Checkmate!' : 'Checkmate — even better.');
            return failLesson('Checkmated', 'Your king got mated.');
        }
        if (lesson.goal === 'draw') return succeed(`${status.message}. You held it!`);
        const why = {
            stalemate: 'Stalemate — the king had no move and wasn\'t in check. That\'s a draw, not a win.',
            insufficient: 'Not enough material is left to checkmate — a draw.',
            threefold: 'The same position came up three times — a draw by repetition.',
            'fifty-move': '50 moves without a capture or a pawn move — a draw by the 50-move rule. You need a quicker plan.',
        }[status.reason] || status.message;
        return failLesson('Draw', why);
    }

    if (materialDiff(user) <= les.startDiff - 3) {
        return failLesson(lesson.goal === 'draw' ? 'Lost' : 'Material lost',
            lesson.goal === 'draw' ? 'Your opponent won material — the draw is gone.' : 'You gave away material — the win is gone.');
    }

    if (lesson.goal === 'promote') {
        if (promotedOn) {
            const takeable = getAllValidMoves(currentTurn).some(m => m.toX === promotedOn.x && m.toY === promotedOn.y);
            if (!takeable) return succeed('Promoted — and the new piece is safe.');
        }
        if (!pawnCount(user)) return failLesson('Pawn lost', 'Without the pawn there\'s nothing left to win.');
    }

    // K+P vs K: the exact verdict.
    const wins = typeof kpkWins === 'function' ? kpkWins(gameState, currentTurn) : null;
    if (wins !== null && by === 'user') {
        const pawnIsYours = pawnCount(user) > 0;
        if (pawnIsYours && !wins) return failLesson('The win slipped away', 'After this move the position is a draw with best defence. Take it back and look for a better square.');
        if (!pawnIsYours && wins) return failLesson('That loses', 'After this move the pawn can no longer be stopped. Take it back and find a better square.');
    }

    if (lesson.goal === 'draw' && by === 'engine' && userMoveCount() >= lesson.hold) {
        return succeed(`You held the position for ${lesson.hold} moves — that's the draw.`);
    }
    return false;
}

function succeed(message) {
    engine.cancel();
    les.status = 'won';
    const { lesson } = les;
    const moves = userMoveCount();
    const slack = lesson.par ? Math.max(2, Math.ceil(lesson.par * 0.3)) : 0;
    const stars = les.help ? 1 : lesson.par && moves > lesson.par + slack ? 2 : 3;
    const rec = store.lessons[lesson.id] || { stars: 0, tries: 1 };
    rec.stars = Math.max(rec.stars || 0, stars);
    if (lesson.goal === 'mate' && !les.help && (!rec.best || moves < rec.best)) rec.best = moves;
    store.lessons[lesson.id] = rec;
    saveStore();
    markTrainingDay();
    flash('good');
    playTone(660, 0.09, { type: 'sine' }); playTone(880, 0.12, { type: 'sine', at: 0.09 });

    const notes = [];
    if (lesson.goal === 'mate') notes.push(`${moves} move${moves === 1 ? '' : 's'}${lesson.par ? ` — the fastest possible is ${lesson.par}` : ''}.`);
    if (les.help) notes.push('Solved with help — play it again without hints or take-backs for more stars.');
    else if (stars === 2) notes.push(`Three stars for ${lesson.par + slack} moves or fewer.`);
    setFeedback({ kind: 'good', icon: '★', title: `${message} ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, line: esc(notes.filter(Boolean).join(' ')) });
    renderTask();
    return true;
}

function failLesson(title, line) {
    engine.cancel();
    les.status = 'failed';
    flash('bad');
    setFeedback({ kind: 'bad', icon: '✗', title: esc(title), line: esc(line) });
    renderTask();
    return true;
}

// Undoes your last move (and the reply to it).
function takeBack() {
    if (!les || !userMoveCount() || les.status === 'won') return;
    engine.cancel();
    token++;
    les.token = token;
    while (les.moves.length && les.moves[les.moves.length - 1].by !== 'user') les.moves.pop();
    les.moves.pop();
    les.help++;
    les.hint = null;
    les.status = 'move';
    board.setArrows([]);
    board.clearSelection();
    rebuild();
    setFeedback({ icon: '↶', title: 'Taken back', line: esc(les.lesson.tip) });
    renderTask();
}

// First press: which piece to move. Second: the move itself (arrow).
async function hint() {
    if (!les || les.status !== 'move') return;
    if (les.hint) {
        const { move } = les.hint;
        board.setArrows([{ from: { x: move.fromX, y: move.fromY }, to: { x: move.toX, y: move.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
        setFeedback({ icon: '💡', title: 'Play the arrow', line: esc(les.lesson.tip) });
        return;
    }
    let r = lineMove();
    if (!r && les.lesson.engineHints === false) {
        // Off the textbook line, where the engine's move would mislead: the plan instead.
        setFeedback({ icon: '💡', title: 'The plan', line: esc(les.lesson.tip) });
        return;
    }
    les.help++;
    if (!r) {
        les.status = 'thinking';
        renderTask();
        const mine = les.token;
        try { r = await engine.search(HINT_TIME_MS); } catch (e) { r = null; }
        if (!les || les.token !== mine) return;
        les.status = 'move';
        if (!r || !r.move) { renderTask(); return; }
        r = keepsResult(r) || r;
    }
    les.hint = r;
    const { move } = les.hint;
    board.select(move.fromX, move.fromY);
    setFeedback({ icon: '💡', title: `Move your ${gameState[move.fromY][move.fromX].type}.`, line: esc(les.lesson.tip) });
    renderTask();
}

// The next move of the lesson's textbook line, if the game has followed it so
// far -> { move, promo } (null off the line or past its end).
function lineMove() {
    if (!les.lesson.line) return null;
    const line = les.lesson.line.split(/\s+/);
    const bare = (san) => san.replace(/[+#!?]/g, '');
    if (les.moves.length >= line.length || les.moves.some((m, i) => bare(m.san) !== bare(line[i]))) return null;
    return resolveSAN(currentTurn, line[les.moves.length]);
}

// In K+P vs K the engine's move might not be the exact one: check it against
// the bitbase and, if needed, swap in a move that keeps the result.
function keepsResult(r) {
    if (typeof kpkWins !== 'function' || kpkWins(gameState, currentTurn) === null) return r;
    const mine = pawnCount(les.user) > 0;
    const good = (move, promo) => {
        applyMoveWithPromotion(move, promo);
        const w = kpkWins(gameState, currentTurn);
        replay(); // back to the real position
        return w === null ? true : mine ? w : !w;
    };
    if (good(r.move, r.promo)) return r;
    for (const m of getAllValidMoves(currentTurn)) {
        const promo = gameState[m.fromY][m.fromX].type === 'pawn' && (m.toY === 0 || m.toY === 7) ? 'queen' : null;
        if (good(m, promo)) return { move: m, promo };
    }
    return r;
}

// The real board: the lesson's FEN plus les.moves.
function replay() {
    loadFEN(les.lesson.fen);
    recordPosition();
    for (const m of les.moves) {
        const r = resolveSAN(currentTurn, m.san);
        applyMoveWithPromotion(r.move, r.promo);
        recordPosition();
    }
}

// ─── RENDERING ─────────────────────────────────────────────────────────────────
function renderTask() {
    if (!les) return;
    const you = les.user === 'white' ? 'White' : 'Black';
    const goal = { mate: 'checkmate the king', promote: 'promote the pawn', draw: `hold the draw (${les.lesson.hold} moves)` }[les.lesson.goal];
    const moves = userMoveCount();
    const count = les.lesson.par ? `${moves} / par ${les.lesson.par}` : les.lesson.goal === 'draw' ? `${moves} / ${les.lesson.hold}` : `${moves}`;
    $('lessonTask').innerHTML = les.status === 'wait' ? '<span class="muted">Opponent to move…</span>'
        : les.status === 'thinking' ? '<span class="muted">Looking for a hint…</span>'
        : les.status === 'won' ? `<strong>Solved</strong> <span class="muted">· ${moves} move${moves === 1 ? '' : 's'}</span>`
        : les.status === 'failed' ? '<strong>Not this time</strong> <span class="muted">— take the move back or start again</span>'
        : `<strong>Your move</strong> <span class="muted">as ${you} — ${goal}</span>`;
    $('lessonMoves').querySelector('.line-progress').textContent = `Moves ${count}`;
    renderActions();
}

function renderMoves() {
    const black = les.lesson.fen.split(' ')[1] === 'b';
    const parts = [];
    les.moves.forEach((m, i) => {
        const ply = i + (black ? 1 : 0);
        if (ply % 2 === 0) parts.push(`${ply / 2 + 1}.${m.san}`);
        else parts.push(i === 0 ? `1…${m.san}` : m.san);
    });
    $('lessonMoves').innerHTML = `<span class="san-line">${parts.length ? esc(parts.join(' ')) : '<span class="muted">Starting position</span>'}</span>`
        + '<span class="line-progress"></span>';
}

function renderActions() {
    const box = $('lessonActions');
    box.innerHTML = '';
    if (!les) return;
    const { status } = les;
    if (status === 'won') {
        const i = ENDGAME_LESSONS.indexOf(les.lesson);
        const next = nextLesson();
        const after = next && next !== les.lesson ? next : ENDGAME_LESSONS[i + 1];
        if (after) box.appendChild(button(`Next: ${after.name} →`, () => startLesson(after), 'btn-primary'));
        box.appendChild(button('↻ Play again', () => startLesson(les.lesson)));
        box.appendChild(button('Done', closeLesson));
        return;
    }
    if (status === 'move') box.appendChild(button(les.hint ? '💡 Show the move' : '💡 Hint', hint));
    if ((status === 'move' || status === 'failed') && userMoveCount()) box.appendChild(button('↶ Take back', takeBack, status === 'failed' ? 'btn-primary' : ''));
    if (status !== 'wait' && status !== 'thinking') box.appendChild(button('↻ Restart', () => startLesson(les.lesson)));
}

function setFeedback(fb) {
    const el = $('lessonFeedback');
    if (!fb) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.className = 'session-feedback ' + (fb.kind || '');
    el.innerHTML = `<span class="caption-icon">${fb.icon || ''}</span><div><div class="session-feedback-title">${fb.title}</div>`
        + (fb.line ? `<div class="caption-line">${fb.line}</div>` : '') + '</div>';
}

function flash(kind) {
    const el = $('endgameBoard');
    el.classList.remove('flash-good', 'flash-bad');
    void el.offsetWidth; // restart the animation
    el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
    if (kind === 'bad' && navigator.vibrate) navigator.vibrate(60);
}
