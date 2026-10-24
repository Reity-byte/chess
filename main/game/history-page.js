// ─── HISTORY PAGE ──────────────────────────────────────────────────────────────
// Drives history.html: your rating over time, results by color, accuracy and
// most common error from reviewed games, and the list of finished games with a
// one-click review. Data comes from history-store.js and the player rating
// that game-script.js keeps in localStorage.
const PLAYER_RATING_KEY = 'chessPlayerRating';
const ANALYSIS_HANDOFF_KEY = 'chessGameForAnalysis';
const PROVISIONAL_GAMES = 20;

const MOTIF_LABELS = {
    allowsMate: 'Allowing mate',
    missedMate: 'Missing mate',
    hangs: 'Hanging pieces',
    losesMaterial: 'Losing material',
    allowsFork: 'Walking into forks',
    missedFork: 'Missing forks',
    missedWin: 'Missing winning tactics',
};

let filter = 'all';
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#historyFilter button').forEach(b => b.addEventListener('click', () => {
        filter = b.dataset.filter;
        document.querySelectorAll('#historyFilter button').forEach(x => x.classList.toggle('selected', x === b));
        renderGames();
    }));
    $('clearHistoryButton').addEventListener('click', () => {
        if (!loadHistory().length) return;
        if (!confirm('Delete all saved games from this browser? Your rating is kept.')) return;
        saveHistory([]);
        render();
    });
    window.addEventListener('resize', () => renderGraph(ratedGames()));
    render();
});

function playerRating() {
    try {
        const r = JSON.parse(localStorage.getItem(PLAYER_RATING_KEY));
        if (r && Number.isFinite(r.rating)) return r;
    } catch (e) { /* default */ }
    return { rating: 800, games: 0 };
}

function ratedGames() {
    return loadHistory().filter(g => g.rated && Number.isFinite(g.ratingAfter));
}

// 1 / 0.5 / 0 from the human's point of view.
function playerScore(g) {
    if (g.result === '1/2-1/2') return 0.5;
    return (g.result === '1-0') === (g.playerColor === 'white') ? 1 : 0;
}

function render() {
    const me = playerRating();
    const rated = ratedGames();
    $('ratingNow').textContent = me.rating;
    $('ratingSub').textContent = me.games === 0
        ? 'Play a game against the engine to get rated.'
        : me.games < PROVISIONAL_GAMES
            ? `Provisional — settles after ${PROVISIONAL_GAMES} rated games (${me.games} so far).`
            : `Established over ${me.games} rated games.`;
    const peak = rated.reduce((m, g) => Math.max(m, g.ratingAfter), rated.length ? rated[0].ratingBefore : me.rating);
    $('ratingPeak').textContent = rated.length ? peak : '–';
    $('ratingGames').textContent = me.games;
    const wins = rated.filter(g => playerScore(g) === 1).length;
    const draws = rated.filter(g => playerScore(g) === 0.5).length;
    $('ratingRecord').textContent = rated.length ? `${wins} / ${draws} / ${rated.length - wins - draws}` : '–';
    renderGraph(rated);
    renderStats();
    renderGames();
}

// ─── RATING GRAPH ──────────────────────────────────────────────────────────────
function renderGraph(rated) {
    const svg = $('ratingGraph');
    const W = Math.max(240, svg.clientWidth || 600), H = 160, padL = 40, padB = 8, padT = 10;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    const add = (tag, attrs, text) => {
        const el = document.createElementNS(NS, tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        if (text !== undefined) el.textContent = text;
        svg.appendChild(el);
        return el;
    };
    if (!rated.length) {
        add('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'graph-empty' }, 'Your rating graph appears after your first rated game.');
        return;
    }
    const points = [{ rating: rated[0].ratingBefore, game: null }].concat(rated.map(g => ({ rating: g.ratingAfter, game: g })));
    const values = points.map(p => p.rating);
    let lo = Math.min(...values), hi = Math.max(...values);
    const pad = Math.max(20, (hi - lo) * 0.15);
    lo = Math.floor((lo - pad) / 50) * 50; hi = Math.ceil((hi + pad) / 50) * 50;
    const x = (i) => padL + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - padL - 8));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

    for (const v of [lo, (lo + hi) / 2, hi]) {
        add('line', { x1: padL, x2: W - 4, y1: y(v), y2: y(v), class: 'grid' });
        add('text', { x: padL - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, Math.round(v));
    }
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
    add('path', { d: `${path} L${x(points.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`, class: 'area' });
    add('path', { d: path, class: 'line' });
    points.forEach((p, i) => {
        if (!p.game) return;
        const s = playerScore(p.game);
        add('circle', { cx: x(i), cy: y(p.rating), r: 3.5, class: 'dot ' + (s === 1 ? 'win' : s === 0 ? 'loss' : 'draw') });
    });

    svg.onmousemove = (e) => {
        const r = svg.getBoundingClientRect();
        const rel = ((e.clientX - r.left) / r.width) * W;
        let best = 0;
        points.forEach((p, i) => { if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i; });
        const p = points[best];
        const tip = $('ratingTip');
        tip.textContent = p.game
            ? `${p.rating} · ${['Loss', 'Draw', 'Win'][playerScore(p.game) * 2]} vs ≈${p.game.engineRatings[p.game.playerColor === 'white' ? 'black' : 'white']} · ${new Date(p.game.date).toLocaleDateString()}`
            : `${p.rating} · start`;
        tip.style.left = `${(x(best) / W) * r.width + 12}px`;
        tip.classList.remove('hidden');
    };
    svg.onmouseleave = () => $('ratingTip').classList.add('hidden');
}

// ─── STATS ─────────────────────────────────────────────────────────────────────
function renderStats() {
    const human = loadHistory().filter(g => g.mode === 'human');
    for (const color of ['white', 'black']) {
        const games = human.filter(g => g.playerColor === color);
        const w = games.filter(g => playerScore(g) === 1).length, d = games.filter(g => playerScore(g) === 0.5).length;
        const key = color === 'white' ? 'statWhite' : 'statBlack';
        $(key).textContent = games.length ? `${Math.round(((w + d / 2) / games.length) * 100)}%` : '–';
        $(key + 'Sub').textContent = games.length ? `${w}W ${d}D ${games.length - w - d}L in ${games.length} game${games.length === 1 ? '' : 's'}` : 'no games yet';
    }
    const reviewed = human.filter(g => g.accuracy && g.accuracy[g.playerColor] !== null && g.accuracy[g.playerColor] !== undefined);
    $('statAccuracy').textContent = reviewed.length
        ? `${(reviewed.reduce((a, g) => a + g.accuracy[g.playerColor], 0) / reviewed.length).toFixed(1)}%` : '–';
    $('statAccuracySub').textContent = reviewed.length ? `over ${reviewed.length} reviewed game${reviewed.length === 1 ? '' : 's'}` : 'review a game to see it';

    const motifs = {};
    for (const g of reviewed) {
        const m = g.review && g.review[g.playerColor] ? g.review[g.playerColor].motifs : {};
        for (const k in m) motifs[k] = (motifs[k] || 0) + m[k];
    }
    const top = Object.entries(motifs).sort((a, b) => b[1] - a[1])[0];
    $('statMotif').textContent = top ? MOTIF_LABELS[top[0]] || top[0] : '–';
    $('statMotifSub').textContent = top ? `${top[1]} time${top[1] === 1 ? '' : 's'} in reviewed games` : 'from reviewed games';
}

// ─── GAMES LIST ────────────────────────────────────────────────────────────────
function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderGames() {
    const list = $('gamesList');
    const games = loadHistory().filter(g => filter === 'all' || g.mode === filter).reverse();
    list.innerHTML = '';
    if (!games.length) {
        list.innerHTML = '<div class="moves-empty">No games here yet — finished games are saved automatically.</div>';
        return;
    }
    for (const g of games) {
        const row = document.createElement('div');
        row.className = 'game-row';
        let badge, badgeClass;
        if (g.mode === 'human') {
            const s = playerScore(g);
            badge = s === 1 ? 'Win' : s === 0 ? 'Loss' : 'Draw';
            badgeClass = s === 1 ? 'win' : s === 0 ? 'loss' : 'draw';
        } else {
            badge = g.result === '1/2-1/2' ? '½–½' : g.result.replace('-', '–');
            badgeClass = 'neutral';
        }
        const myAcc = g.mode === 'human' && g.accuracy ? g.accuracy[g.playerColor] : null;
        const delta = g.rated ? g.ratingAfter - g.ratingBefore : null;
        const color = g.playerColor || 'white';
        row.innerHTML = `
            <span class="result-badge ${badgeClass}">${badge}</span>
            <span class="game-main">
                <span class="game-title"><span class="turn-swatch ${color} tiny"></span>${escapeHTML(g.white)} <span class="faint">vs</span> ${escapeHTML(g.black)}</span>
                <span class="game-sub">${escapeHTML(g.reason || '')} · ${Math.ceil(g.plies / 2)} moves · ${new Date(g.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </span>
            <span class="game-acc">${myAcc !== null && myAcc !== undefined ? `${myAcc.toFixed(1)}%` : ''}</span>
            <span class="game-delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${delta === null ? (g.mode === 'human' ? 'unrated' : '') : (delta >= 0 ? '+' : '') + delta}</span>`;
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = g.accuracy ? 'Review' : '★ Review';
        btn.title = g.accuracy ? 'Open the review' : 'Not reviewed yet';
        btn.addEventListener('click', () => openReview(g));
        row.appendChild(btn);
        list.appendChild(row);
    }
}

function openReview(g) {
    const plainName = (n) => /^You\b/.test(n) ? 'You' : n;
    try {
        localStorage.setItem(ANALYSIS_HANDOFF_KEY, JSON.stringify({
            sanMoves: g.sanMoves, white: plainName(g.white), black: plainName(g.black), result: g.result, historyId: g.id,
        }));
    } catch (e) { return; }
    location.href = 'analysis.html';
}
