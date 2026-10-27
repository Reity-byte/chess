// ─── COACH & HINTS (game page) ─────────────────────────────────────────────────
// Asks an analysis worker of its own about the live game:
//   💡 Hint — first press: which piece, plus a clue that doesn't name the move;
//             second press: the move as an arrow. Using one makes the game unrated.
//   Coach mode — an option in the game setup (unrated): every move you play is
//             graded like in the review (Best, Inaccuracy, Blunder…) with the
//             reason and the better move, while the engine thinks about its reply.
// Both show up in the coach card in the side panel. game-script.js calls
// resetCoach() on a new game, coachAfterMove() after each of your moves and
// clearHint() on a takeback.
const COACH_GOOD = new Set(['Brilliant', 'Great', 'Best', 'Excellent', 'Book']);
const COACH_TALLY = ['Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder'];

let coachWorker = null;
let coachSeq = 0;
const coachWaiting = new Map();
let coachOn = false;     // Coach mode for the current game
let coachTally = {};     // category -> count of your graded moves this game
let hint = null;         // { ply, step: 0|1|2, data, pending } for the position on the board

function askCoach(message) {
    if (!coachWorker) {
        try { coachWorker = new Worker('analysis-worker.js?v=30'); } catch (e) { return Promise.resolve(null); }
        coachWorker.onmessage = (e) => {
            const d = e.data;
            const waiting = coachWaiting.get(d.requestId);
            if (!waiting) return;
            coachWaiting.delete(d.requestId);
            waiting(d.type === 'error' ? null : d.type === 'hintReply' ? d.hint : d.entry);
        };
    }
    const requestId = ++coachSeq;
    return new Promise((resolve) => {
        coachWaiting.set(requestId, resolve);
        coachWorker.postMessage({ ...message, requestId });
    });
}

// ─── COACH CARD ────────────────────────────────────────────────────────────────
function showCoach({ icon, color, title, line, tally }) {
    const $ = (id) => document.getElementById(id);
    $('coachCard').classList.remove('hidden');
    $('coachIcon').textContent = icon || '🎓';
    $('coachIcon').style.background = color || '';
    $('coachTitle').textContent = title || '';
    $('coachLine').innerHTML = line || '';
    $('coachTally').classList.toggle('hidden', !tally);
    if (tally) renderCoachTally();
}

function renderCoachTally() {
    const el = document.getElementById('coachTally');
    el.innerHTML = '';
    for (const cat of COACH_TALLY) {
        if (!coachTally[cat]) continue;
        const chip = document.createElement('span');
        chip.className = 'tally-chip';
        chip.title = cat;
        chip.innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[cat]}">${CATEGORY_SYMBOLS[cat]}</span>${coachTally[cat]}`;
        el.appendChild(chip);
    }
}

function resetCoach(on) {
    coachOn = on;
    coachTally = {};
    clearHint();
    document.getElementById('coachCard').classList.toggle('hidden', !on);
    if (on) showCoach({ title: 'Coach is watching', line: 'Play your moves — each one gets graded here while the engine thinks.' });
}

// ─── GRADING YOUR MOVES ────────────────────────────────────────────────────────
function coachPrefix(ply) {
    return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}`;
}

// `sansBefore` = the game before your move, `san` = your move.
function coachAfterMove(sansBefore, san) {
    clearHint();
    if (!coachOn) return;
    const token = gameToken, ply = sansBefore.length;
    showCoach({ icon: '…', title: `${coachPrefix(ply)} ${san}`, line: 'Checking your move…', tally: true });
    askCoach({ type: 'judgeMove', sanMoves: sansBefore, san }).then((entry) => {
        if (!entry || token !== gameToken || !coachOn) return;
        const cat = entry.category;
        coachTally[cat] = (coachTally[cat] || 0) + 1;
        const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const best = entry.bestMove ? `<strong>${esc(entry.bestMove.san)}</strong>` : '';
        let line;
        if (entry.reason) line = `<span class="reason">${esc(entry.reason)}</span>${best && !COACH_GOOD.has(cat) ? ` Better was ${best}.` : ''}`;
        else if (cat === 'Book') line = 'Opening theory — a known good move.';
        else if (cat === 'Best' || cat === 'Great' || cat === 'Brilliant') line = cat === 'Best' ? 'Spot on — the engine\'s choice too.' : 'The only good move here — well found.';
        else if (cat === 'Excellent') line = 'Nearly the best move.';
        else if (cat === 'Good') line = best ? `Fine, though ${best} was a little stronger.` : 'A solid move.';
        else line = best ? `Better was ${best}.` : 'There was a better move.';
        showCoach({ icon: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat],
            title: `${coachPrefix(ply)} ${san} is ${CATEGORY_DESCRIPTIONS[cat]}`, line, tally: true });
        // Badge the move on the board while it's still the latest one.
        if (sanList().length === ply + 1 && lastMove) {
            board.setBadge({ x: lastMove.toX, y: lastMove.toY, glyph: CATEGORY_SYMBOLS[cat], color: CATEGORY_COLORS[cat], title: cat });
        }
    });
}

// ─── HINTS ─────────────────────────────────────────────────────────────────────
async function requestHint() {
    if (!gameActive || gameMode !== 'human' || !isHumanTurn() || aiThinking) return;
    const ply = sanList().length;
    if (!hint || hint.ply !== ply) hint = { ply, step: 0, data: null, pending: false };
    if (hint.pending || hint.step >= 2) return;
    if (rated) {
        rated = false;
        showToast('Hint used — this game no longer counts toward your rating.', 3200);
        updateStatus();
    }
    if (!hint.data) {
        hint.pending = true;
        syncHintButton();
        showCoach({ icon: '💡', color: 'var(--warning)', title: 'Looking for a hint…', tally: coachOn });
        const token = gameToken;
        const data = await askCoach({ type: 'hint', sanMoves: sanList() });
        if (!hint || hint.ply !== ply || token !== gameToken) return;
        hint.pending = false;
        hint.data = data;
        if (!data) { clearHint(); return; }
    }
    hint.step++;
    const d = hint.data;
    if (hint.step === 1) {
        board.select(d.move.fromX, d.move.fromY);
        showCoach({ icon: '💡', color: 'var(--warning)', title: `Hint: look at your ${d.piece}`, line: d.clue, tally: coachOn });
    } else {
        board.setArrows([{ from: { x: d.move.fromX, y: d.move.fromY }, to: { x: d.move.toX, y: d.move.toY }, color: 'rgba(129, 199, 84, 0.85)' }]);
        showCoach({ icon: '💡', color: 'var(--warning)', title: `Hint: ${d.san}`, line: d.clue, tally: coachOn });
    }
    syncHintButton();
}

function clearHint() {
    if (hint && hint.step >= 1) board.clearSelection();
    if (hint && hint.step >= 2) board.setArrows([]);
    hint = null;
    syncHintButton();
    if (!coachOn) document.getElementById('coachCard').classList.add('hidden');
}

function syncHintButton() {
    const btn = document.getElementById('hintButton');
    if (!btn) return;
    btn.classList.toggle('hidden', gameMode === 'local'); // no engine help between two players
    const canAsk = gameActive && gameMode === 'human' && isHumanTurn() && !aiThinking;
    btn.disabled = !canAsk || (hint && (hint.pending || hint.step >= 2));
    btn.textContent = hint && hint.step === 1 ? '💡 Show move' : '💡 Hint';
}
