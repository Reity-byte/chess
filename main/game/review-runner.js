// ─── REVIEW RUNNER ─────────────────────────────────────────────────────────────
// Runs a whole-game analysis on a pool of analysis-worker.js workers, one per
// spare CPU core. The game is cut into ranges of consecutive moves — about three
// per worker, so faster workers pick up more — and when every range is in, one
// worker builds the report. Shared by the review page and the game page's
// after-game preview, together with the one-entry review cache between them.
const MAX_ANALYSIS_WORKERS = 8;
const MIN_RANGE = 4;
const ANALYSIS_WORKER_URL = 'analysis-worker.js?v=28';
const ANALYSIS_CACHE_KEY = 'chessAnalysisCache';

// callbacks: { onStart(opening), onMove(entry, startEval, received), onFinalizing(),
// onDone(report), onError(message) }. Returns { cancel(), size } or null when no
// worker could be started (e.g. the page was opened as a file).
function runReview(sanMoves, modeKey, callbacks) {
    const cb = callbacks || {};
    const n = sanMoves.length;
    const cores = navigator.hardwareConcurrency || 2;
    const size = Math.max(1, Math.min(MAX_ANALYSIS_WORKERS, cores - 1, Math.ceil(n / MIN_RANGE)));
    const pool = [];
    let stopped = false;
    const stop = () => { stopped = true; pool.forEach(w => w.terminate()); };
    const fail = (message) => { if (stopped) return; stop(); if (cb.onError) cb.onError(message); };

    const queue = [];
    const rangeSize = Math.max(MIN_RANGE, Math.ceil(n / (size * 3)));
    for (let from = 0; from < n; from += rangeSize) queue.push({ rangeId: queue.length, from, to: Math.min(n, from + rangeSize) });
    let pending = queue.length;
    const entries = [];
    let startEval = null;
    const dispatch = (w) => {
        const range = queue.shift();
        if (range) w.postMessage({ type: 'analyzeRange', sanMoves, mode: modeKey, ...range });
    };

    for (let i = 0; i < size; i++) {
        let w;
        try { w = new Worker(ANALYSIS_WORKER_URL); } catch (e) { break; }
        w.onmessage = (e) => {
            if (stopped) return;
            const d = e.data;
            if (d.type === 'start') {
                if (cb.onStart) cb.onStart(d.opening);
            } else if (d.type === 'move') {
                if (d.startEval !== null && d.startEval !== undefined) startEval = d.startEval;
                entries.push(d.entry);
                if (cb.onMove) cb.onMove(d.entry, d.startEval, entries.length);
            } else if (d.type === 'rangeDone') {
                pending--;
                if (queue.length) dispatch(w);
                else if (pending === 0) {
                    if (cb.onFinalizing) cb.onFinalizing();
                    pool[0].postMessage({ type: 'finalize', entries, startEval, sanMoves, mode: modeKey });
                }
            } else if (d.type === 'done') {
                stop();
                cb.onDone(d.report);
            } else if (d.type === 'error') {
                fail(d.message);
            }
        };
        w.onerror = (err) => { err.preventDefault(); fail(err.message || 'worker error'); };
        pool.push(w);
    }
    if (!pool.length) return null;
    pool.forEach(dispatch);
    return { cancel: stop, size: pool.length };
}

// ─── REVIEW CACHE ──────────────────────────────────────────────────────────────
// One finished report, keyed by analysis version, mode and moves.
function reviewCacheKey(sanMoves, modeKey) {
    return `${ANALYSIS_VERSION}|${modeKey}|${sanMoves.join(' ')}`;
}

function loadCachedReview(sanMoves, modeKey) {
    try {
        const cached = JSON.parse(localStorage.getItem(ANALYSIS_CACHE_KEY));
        return cached && cached.key === reviewCacheKey(sanMoves, modeKey) && cached.report ? cached.report : null;
    } catch (e) {
        return null;
    }
}

function saveCachedReview(sanMoves, modeKey, report) {
    try {
        localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify({ key: reviewCacheKey(sanMoves, modeKey), report }));
    } catch (e) { /* the cache is optional */ }
}
