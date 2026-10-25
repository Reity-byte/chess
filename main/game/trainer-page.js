// ─── TRAINER PAGE ──────────────────────────────────────────────────────────────
// Drives trainer.html: reads your games from the history (history-store.js) —
// the kinds of mistakes your reviews found, accuracy by phase, results — and
// turns them into focus areas with tips, a practice list of your own mistakes
// (each opens the review straight in Retry mistakes), your numbers, and a
// suggested next game. Only games against the engine count; reviewed ones
// carry the details (accuracy, motifs, mistakes).
const RECENT_GAMES = 20;    // reviewed games the plan looks at
const PRACTICE_ITEMS = 10;

const MOTIF_INFO = {
    hangs:         { label: 'Hanging pieces', tip: 'Before every move, check each of your pieces: is it attacked, and is it defended enough? Then look at what your opponent can capture after your move.' },
    losesMaterial: { label: 'Losing material in exchanges', tip: 'Count attackers and defenders before you start a trade, and before moving a piece that is defending something.' },
    allowsFork:    { label: 'Walking into forks', tip: 'Watch the squares where an enemy knight or queen could hit two of your pieces at once — loose pieces and your king are the usual targets.' },
    allowsMate:    { label: 'Allowing mate', tip: 'After your planned move, look at every check your opponent would have. Keep an escape square for your king.' },
    missedMate:    { label: 'Missing mates', tip: 'Every move, look at all of your checks first — forcing moves can end the game on the spot.' },
    missedFork:    { label: 'Missing forks', tip: 'Look for moves that attack two things at once, especially knight jumps and queen checks.' },
    missedWin:     { label: 'Missing free material', tip: 'After each opponent move ask: what did that leave undefended? Then look at your captures.' },
};
const PHASE_INFO = {
    opening:    { label: 'Opening', tip: 'Develop knights and bishops, castle early and fight for the centre — and avoid moving the same piece twice or bringing the queen out early.' },
    middlegame: { label: 'Middlegame', tip: 'Most games are decided here. Slow down on every capture and check, and use Coach mode to get each move graded while you play.' },
    endgame:    { label: 'Endgame', tip: 'Activate your king, push passed pawns, and trade pieces (not pawns) when you are ahead.' },
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

document.addEventListener('DOMContentLoaded', render);

// ─── DATA ──────────────────────────────────────────────────────────────────────
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

const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

function moveLabel(m) {
    return `${Math.floor(m.ply / 2) + 1}${m.ply % 2 ? '...' : '.'} ${m.san}`;
}

function dateLabel(g) {
    return new Date(g.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function opponentOf(g) {
    return g.playerColor === 'white' ? g.black : g.white;
}

// ─── RENDER ────────────────────────────────────────────────────────────────────
function render() {
    const games = myGames();
    const reviewed = games.filter(isReviewed).slice(-RECENT_GAMES);
    $('planTitle').textContent = reviewed.length ? 'Here\'s what to work on' : 'Review a game to get your plan';
    $('planSub').textContent = reviewed.length
        ? `Based on your last ${reviewed.length} reviewed game${reviewed.length === 1 ? '' : 's'} (${games.length} played against the engine).`
        : games.length
            ? 'Your plan is built from reviewed games — open one of your games below in the review.'
            : 'Play a game against the engine and review it — your plan is built from what the reviews find.';
    renderRatings();
    renderFocus(reviewed);
    renderPractice(reviewed);
    renderNumbers(games, reviewed);
    renderNextGame(games);
    renderUnreviewed(games);
}

function renderRatings() {
    const ratings = loadPlayerRatings();
    $('ratingTiles').innerHTML = TIME_MODES.map(m => `
        <div class="rating-tile${ratings[m.id].games ? '' : ' dim'}">
            <span class="tm-name">${m.icon} ${m.name}</span>
            <strong>${ratingText(ratings[m.id])}</strong>
        </div>`).join('');
}

// Up to four cards: your most frequent mistake types, your weakest phase, and
// blunders per game when that's high.
function renderFocus(reviewed) {
    const list = $('focusList');
    list.innerHTML = '';
    if (!reviewed.length) {
        list.innerHTML = '<div class="panel focus-card empty"><p class="muted">No reviewed games yet. After a game, open <strong>Game Review</strong> — the trainer reads what it finds.</p></div>';
        return;
    }
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
    const top = Object.entries(motifTotals).filter(([k]) => MOTIF_INFO[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [motif, n] of top) {
        const latest = [...reviewed].reverse().find(g => myReview(g) && myReview(g).motifs && myReview(g).motifs[motif]);
        const mistake = latest && (myReview(latest).mistakes || []).find(m => m.motif === motif);
        cards.push({
            title: MOTIF_INFO[motif].label,
            stat: `${n} time${n === 1 ? '' : 's'} in ${motifGames[motif]} of your last ${reviewed.length} reviewed games`,
            tip: MOTIF_INFO[motif].tip,
            actions: latest ? [{ label: mistake ? `Fix ${moveLabel(mistake)} from ${dateLabel(latest)}` : `Retry the game from ${dateLabel(latest)}`,
                                 run: () => openGameReview(latest, { retry: true, retryPly: mistake ? mistake.ply : null }) }] : [],
        });
    }

    // Weakest phase, when it clearly lags behind the best one.
    const phaseAvg = {};
    for (const p of Object.keys(PHASE_INFO)) {
        phaseAvg[p] = avg(reviewed.map(g => g.phaseAccuracy && g.phaseAccuracy[g.playerColor] ? g.phaseAccuracy[g.playerColor][p] : null)
            .filter(v => v !== null && v !== undefined));
    }
    const known = Object.entries(phaseAvg).filter(([, v]) => v !== null);
    if (known.length >= 2) {
        known.sort((a, b) => a[1] - b[1]);
        const [weak, weakV] = known[0], [, bestV] = known[known.length - 1];
        if (bestV - weakV >= 8) {
            cards.push({
                title: `Your ${PHASE_INFO[weak].label.toLowerCase()}`,
                stat: `${Math.round(weakV)}% accuracy there, against ${Math.round(bestV)}% in your best phase`,
                tip: PHASE_INFO[weak].tip,
                actions: [],
            });
        }
    }

    const blunders = avg(reviewed.map(g => (myReview(g) && myReview(g).counts && myReview(g).counts.Blunder) || 0));
    if (blunders !== null && blunders >= 1) {
        cards.push({
            title: 'Blunder check',
            stat: `${blunders.toFixed(1)} blunders per game on average`,
            tip: 'Before you let go of a piece, take three seconds: what does my opponent want to do after this move? Coach mode grades every move while you play.',
            actions: [{ label: 'Play a game with Coach', run: () => { location.href = 'game.html?coach=on'; } }],
        });
    }

    if (!cards.length) {
        list.innerHTML = '<div class="panel focus-card empty"><p class="muted">Your reviewed games look clean — no repeating mistake types. Try a stronger engine level.</p></div>';
        return;
    }
    cards.slice(0, 4).forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'panel focus-card';
        card.innerHTML = `<div class="focus-rank">${i + 1}</div><h3>${esc(c.title)}</h3><div class="focus-stat">${esc(c.stat)}</div><p>${esc(c.tip)}</p>`;
        const actions = document.createElement('div');
        actions.className = 'focus-actions';
        for (const a of c.actions) {
            const b = document.createElement('button');
            b.className = 'btn btn-primary';
            b.textContent = a.label;
            b.addEventListener('click', a.run);
            actions.appendChild(b);
        }
        const puzzles = document.createElement('a');
        puzzles.className = 'btn';
        puzzles.href = 'puzzles.html';
        puzzles.textContent = 'Puzzles';
        actions.appendChild(puzzles);
        card.appendChild(actions);
        list.appendChild(card);
    });
}

// Your mistakes from reviewed games, newest first; each opens the review in
// Retry mistakes at that move. Games reviewed before mistakes were stored get
// one row for the whole game.
function renderPractice(reviewed) {
    const list = $('practiceList');
    list.innerHTML = '';
    const rows = [];
    for (const g of [...reviewed].reverse()) {
        const r = myReview(g);
        if (!r) continue;
        if (Array.isArray(r.mistakes)) {
            for (const m of [...r.mistakes].sort((a, b) => b.winLoss - a.winLoss)) rows.push({ g, m });
        } else {
            const n = ['Mistake', 'Miss', 'Blunder'].reduce((s, c) => s + ((r.counts && r.counts[c]) || 0), 0);
            if (n) rows.push({ g, n });
        }
        if (rows.length >= PRACTICE_ITEMS) break;
    }
    $('practiceCount').textContent = rows.length ? `${rows.length} to fix` : '';
    if (!rows.length) {
        list.innerHTML = '<div class="moves-empty">Nothing to fix yet — your reviewed games will fill this list.</div>';
        return;
    }
    for (const row of rows.slice(0, PRACTICE_ITEMS)) {
        const el = document.createElement('div');
        el.className = 'practice-row';
        const cat = row.m ? row.m.category : 'Mistake';
        const what = row.m
            ? (row.m.motif && MOTIF_INFO[row.m.motif] ? MOTIF_INFO[row.m.motif].label : `cost ${Math.round(row.m.winLoss)}% winning chances`)
            : `${row.n} mistake${row.n === 1 ? '' : 's'} in this game`;
        el.innerHTML = `<span class="mv-icon" style="background:${CATEGORY_COLORS[cat]}">${CATEGORY_SYMBOLS[cat]}</span>`
            + `<span class="practice-main"><strong>${esc(row.m ? moveLabel(row.m) : 'Whole game')}</strong> <span class="muted">· ${esc(what)}</span>`
            + `<span class="practice-sub">vs ${esc(opponentOf(row.g))} · ${dateLabel(row.g)}</span></span>`;
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = 'Fix it';
        b.addEventListener('click', () => openGameReview(row.g, { retry: true, retryPly: row.m ? row.m.ply : null }));
        el.appendChild(b);
        list.appendChild(el);
    }
}

function renderNumbers(games, reviewed) {
    const acc = reviewed.map(g => g.accuracy[g.playerColor]);
    const last = avg(acc.slice(-10)), before = avg(acc.slice(-20, -10));
    const trend = last !== null && before !== null ? last - before : null;
    const blunders = avg(reviewed.map(g => (myReview(g) && myReview(g).counts && myReview(g).counts.Blunder) || 0));
    const recent = games.slice(-10);
    const w = recent.filter(g => score(g) === 1).length, d = recent.filter(g => score(g) === 0.5).length;
    const tiles = [
        { label: 'Accuracy', value: last !== null ? `${last.toFixed(1)}%` : '–', sub: trend === null ? 'last 10 reviewed' : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(1)} vs the 10 before`, tone: trend === null ? '' : trend >= 0 ? 'up' : 'down' },
        { label: 'Blunders / game', value: blunders !== null ? blunders.toFixed(1) : '–', sub: 'reviewed games' },
        { label: 'Last 10 games', value: recent.length ? `${w} / ${d} / ${recent.length - w - d}` : '–', sub: 'wins / draws / losses' },
        { label: 'Reviewed', value: `${games.filter(isReviewed).length} / ${games.length}`, sub: 'games against the engine' },
    ];
    $('numberGrid').innerHTML = tiles.map(t => `
        <div class="number-tile"><span class="eyebrow">${t.label}</span><strong>${t.value}</strong><span class="number-sub ${t.tone || ''}">${t.sub}</span></div>`).join('');
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
