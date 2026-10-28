// ─── TODAY'S PLAN ──────────────────────────────────────────────────────────────
// A short daily routine built from what each trainer has waiting: the daily
// puzzle, opening lines due, positions from your games to fix, the next
// endgame lesson and a few rated puzzles (in your weakest theme). Shown on the
// Train page and the home page.
//
// The plan is made once a day and then kept, so its items don't shift while you
// work through them. Each item stores a baseline of the trainer's own counters
// (`base`) and is done once the counter has moved on by `target` — nothing
// here writes to another trainer's data. A day with every item done counts
// toward the plan streak.
//
// localStorage['chessDailyPlan'] = { date, items: [{ id, label, sub, href, target, base }], completed: [dates] }
// Uses OPENING_REPERTOIRES, ENDGAME_LESSONS and loadHistory() when the page has
// them loaded (both pages do); an item whose source is missing is left out.
const DAILY_PLAN_KEY = 'chessDailyPlan';
const PLAN_PUZZLES = 5;              // rated puzzles per day
const PLAN_MAX_LINES = 5;            // opening reviews per day, at most
const PLAN_MAX_POSITIONS = 3;        // positions from your games per day, at most
const PLAN_WEAK_THEMES = {           // puzzle themes the plan may pick as "your weakest"
    fork: 'Forks', hangingPiece: 'Hanging pieces', sacrifice: 'Sacrifices', advantage: 'Win material',
    backRankMate: 'Back rank', promotion: 'Promotion', endgame: 'Endgames', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2',
};

// Local calendar day (the daily puzzle's day), and the UTC day the opening and
// position trainers use for their due dates.
function planDay(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const planUtcDay = () => new Date().toISOString().slice(0, 10);

function planRead(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
}

// ─── WHAT EACH TRAINER HAS (the counters the plan measures) ───────────────────
function planOpenings() {
    const lines = (planRead('chessOpenings', {}).lines) || {};
    const recs = Object.values(lines);
    return {
        due: recs.filter(r => r.box < 5 && r.due <= planUtcDay()).length,
        learned: recs.length,
        reviews: recs.reduce((n, r) => n + (r.reviews || 0), 0),
        total: typeof OPENING_REPERTOIRES !== 'undefined' ? OPENING_REPERTOIRES.reduce((n, r) => n + r.lines.length, 0) : 0,
    };
}

// Positions from your reviewed games (the Train page's list): how many are ready
// (to fix, or a review due), and how many attempts you've made in all.
function planPositions() {
    const t = planRead('chessTraining', {});
    const items = t.items || {};
    const games = typeof loadHistory === 'function' ? loadHistory().filter(g => g.mode === 'human' && g.playerColor) : [];
    let ready = 0;
    for (const g of games) {
        const r = g.review && g.review[g.playerColor];
        if (!r || !Array.isArray(r.mistakes)) continue;
        for (const m of r.mistakes) {
            const rec = items[`${g.id}:${m.ply}`];
            if (!rec || !rec.box || (rec.box < 5 && Date.parse(rec.due) <= Date.now())) ready++;
        }
    }
    const reviewed = games.filter(g => g.accuracy && g.accuracy[g.playerColor] !== null && g.accuracy[g.playerColor] !== undefined).length;
    return { ready, tries: Object.values(items).reduce((n, r) => n + (r.tries || 0), 0), games: games.length, reviewed };
}

function planEndgames() {
    if (typeof ENDGAME_LESSONS === 'undefined') return null;
    const lessons = (planRead('chessEndgames', {}).lessons) || {};
    const stars = (l) => (lessons[l.id] && lessons[l.id].stars) || 0;
    const order = ENDGAME_LESSONS.filter(l => !l.expert).concat(ENDGAME_LESSONS.filter(l => l.expert));
    const next = order.find(l => !stars(l)) || order.find(l => stars(l) < 3) || null;
    const solvedToday = Object.values(lessons).some(r => r.lastSolved === planDay());
    return { next, solvedToday, solved: Object.values(lessons).filter(r => r.stars).length };
}

function planPuzzles() {
    const raw = planRead('chessPuzzleHistory', []);
    const log = Array.isArray(raw) ? raw : [];
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const ratedToday = log.filter(e => e.m === 'rated' && e.at >= midnight.getTime()).length;
    // Weakest theme: lowest share solved without a hint, among themes with 5+ tries.
    const stats = {};
    for (const e of log) for (const th of e.t || []) {
        if (!PLAN_WEAK_THEMES[th]) continue;
        const s = stats[th] || (stats[th] = { n: 0, good: 0 });
        s.n++;
        if (e.ok && !e.h) s.good++;
    }
    const ranked = Object.entries(stats).filter(([, s]) => s.n >= 5).sort((a, b) => a[1].good / a[1].n - b[1].good / b[1].n);
    return { ratedToday, weakest: ranked.length >= 2 ? ranked[0][0] : null };
}

function planDailyPuzzleDone() {
    return planRead('chessPuzzleDaily', {}).date === planDay();
}

// ─── BUILDING AND CHECKING THE PLAN ────────────────────────────────────────────
function buildPlanItems() {
    const items = [{ id: 'daily', label: 'Daily puzzle', sub: 'One puzzle, the same for everyone today', href: 'puzzles.html?daily=1', target: 1, base: 0 }];

    const op = planOpenings();
    if (op.due) {
        const n = Math.min(op.due, PLAN_MAX_LINES);
        items.push({ id: 'openings', label: `Review ${n} opening line${n === 1 ? '' : 's'}`, sub: `${op.due} due today`, href: 'openings.html?start=1', target: n, base: op.reviews });
    } else if (op.total && op.learned < op.total) {
        items.push({ id: 'openingsNew', label: op.learned ? 'Learn a new opening line' : 'Learn your first opening line',
            sub: 'About a minute — then it comes back for review', href: 'openings.html?start=1', target: 1, base: op.learned });
    }

    const pos = planPositions();
    if (pos.ready) {
        const n = Math.min(pos.ready, PLAN_MAX_POSITIONS);
        items.push({ id: 'positions', label: `Fix ${n} position${n === 1 ? '' : 's'} from your games`, sub: 'Find the best move where you went wrong', href: 'trainer.html?train=1', target: n, base: pos.tries });
    } else {
        items.push({ id: 'game', label: 'Play and review a game', sub: 'Its mistakes become tomorrow\'s training', href: 'game.html', target: 1, base: pos.reviewed });
    }

    const eg = planEndgames();
    if (eg && eg.next) {
        items.push({ id: 'endgame', label: `Endgame: ${eg.next.name}`, sub: eg.solved ? 'Next lesson in the endgame trainer' : 'Start the endgame trainer', href: `endgames.html?lesson=${eg.next.id}`, target: 1, base: 0 });
    }

    const pz = planPuzzles();
    items.push({ id: 'puzzles', label: `${PLAN_PUZZLES} rated puzzles`,
        sub: pz.weakest ? `${PLAN_WEAK_THEMES[pz.weakest]} — your weakest theme` : 'Keep your puzzle rating moving',
        href: pz.weakest ? `puzzles.html?theme=${pz.weakest}` : 'puzzles.html', target: PLAN_PUZZLES, base: 0 });
    return items;
}

// How far an item has come: a number from 0 to item.target.
function planProgress(item) {
    let n = 0;
    switch (item.id) {
        case 'daily': n = planDailyPuzzleDone() ? 1 : 0; break;
        case 'openings': n = planOpenings().reviews - item.base; break;
        case 'openingsNew': n = planOpenings().learned - item.base; break;
        case 'positions': n = planPositions().tries - item.base; break;
        case 'game': n = planPositions().reviewed - item.base; break;
        case 'endgame': { const eg = planEndgames(); n = eg && eg.solvedToday ? 1 : 0; break; }
        case 'puzzles': n = planPuzzles().ratedToday; break;
    }
    return Math.max(0, Math.min(item.target, n));
}

// Today's plan (made now if there isn't one for today), each item with its progress.
function loadDailyPlan() {
    const stored = planRead(DAILY_PLAN_KEY, {});
    let plan = stored;
    if (plan.date !== planDay() || !Array.isArray(plan.items)) {
        plan = { date: planDay(), items: buildPlanItems(), completed: Array.isArray(stored.completed) ? stored.completed : [] };
        savePlan(plan);
    }
    const items = plan.items.map(it => ({ ...it, done: planProgress(it) }));
    const allDone = items.every(it => it.done >= it.target);
    if (allDone && !plan.completed.includes(plan.date)) {
        plan.completed = plan.completed.concat(plan.date).slice(-400);
        savePlan(plan);
    }
    return { ...plan, items, allDone };
}

function savePlan(plan) {
    try { localStorage.setItem(DAILY_PLAN_KEY, JSON.stringify(plan)); } catch (e) { /* this visit only */ }
}

// Days in a row with the whole plan done, ending today (or yesterday).
function planStreak(plan) {
    const days = new Set(plan.completed || []);
    const d = new Date();
    if (!days.has(planDay(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(planDay(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
}

// ─── RENDERING ─────────────────────────────────────────────────────────────────
// Fills `el` with the plan card. `prefix` turns the trainers' links into paths
// from the current page ('' on game/ pages, 'game/' on the home page).
function renderDailyPlan(el, prefix = '') {
    if (!el) return;
    const plan = loadDailyPlan();
    const done = plan.items.filter(it => it.done >= it.target).length;
    const streak = planStreak(plan);
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const next = plan.items.find(it => it.done < it.target);
    el.innerHTML = `<div class="plan-head">
            <div><div class="eyebrow">Today's plan</div><h2>${plan.allDone ? 'Done for today ✓' : `${done} of ${plan.items.length} done`}</h2></div>
            <div class="plan-streak${streak ? '' : ' none'}" title="Days in a row with the whole plan done"><strong>${streak}</strong><span>day${streak === 1 ? '' : 's'} 🔥</span></div>
        </div>
        <div class="plan-bar"><div style="width:${Math.round(100 * done / plan.items.length)}%"></div></div>
        <div class="plan-items">${plan.items.map(it => {
            const ok = it.done >= it.target;
            const count = it.target > 1 ? `<span class="plan-count">${it.done}/${it.target}</span>` : '';
            return `<a class="plan-item${ok ? ' done' : ''}${it === next ? ' next' : ''}" href="${esc(prefix + it.href)}">
                <span class="plan-check" aria-hidden="true">${ok ? '✓' : ''}</span>
                <span class="plan-text"><strong>${esc(it.label)}</strong><span>${esc(it.sub)}</span></span>
                ${count}<span class="plan-go" aria-hidden="true">${ok ? '' : '›'}</span>
            </a>`;
        }).join('')}</div>
        ${plan.allDone ? `<p class="plan-done-note">${streak > 1 ? `${streak} days in a row. ` : ''}Come back tomorrow for a new plan — or keep playing.</p>` : ''}`;
}
