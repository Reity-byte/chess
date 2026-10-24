// Shared helpers for the Node test scripts. The game's scripts are plain
// browser globals (no modules), so each "engine" is loaded into its own vm
// context, the same way <script> tags share one global scope in the page.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'main', 'game');

// Loads engine.js + ai.js + notation.js (+ extras) from `dir` into a fresh context.
function loadEngine(dir = GAME_DIR, files = ['engine.js', 'ai.js', 'notation.js']) {
    const ctx = vm.createContext({ console, Date, Math, performance, setTimeout });
    const src = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;\n' + FEN_LOADER;
    vm.runInContext(src, ctx, { filename: dir });
    return { ctx, run: (code) => vm.runInContext(code, ctx) };
}

// Runs analysis-worker.js in a context with a fake `self` and importScripts().
// Returns { analyze(sanMoves, mode) -> report, messages }.
function loadAnalysisWorker(dir = GAME_DIR) {
    const messages = [];
    const ctx = vm.createContext({ console, Date, Math, performance });
    ctx.self = { postMessage: (m) => messages.push(m) };
    ctx.importScripts = (...files) => {
        for (const f of files) vm.runInContext(fs.readFileSync(path.join(dir, f.split('?')[0]), 'utf8'), ctx, { filename: f });
    };
    vm.runInContext(fs.readFileSync(path.join(dir, 'analysis-worker.js'), 'utf8'), ctx, { filename: 'analysis-worker.js' });
    const send = (data) => {
        messages.length = 0;
        ctx.self.onmessage({ data });
        const err = messages.find(m => m.type === 'error');
        if (err) throw new Error(err.message);
        return messages.slice();
    };
    return {
        analyze: (sanMoves, mode = 'standard') => send({ type: 'analyze', sanMoves, mode }).find(m => m.type === 'done').report,
        judge: (sanMoves, move) => send({ type: 'judge', sanMoves, move }).find(m => m.type === 'judgeReply').result,
    };
}

// Copies the engine files of a git revision (e.g. HEAD, HEAD~3, a branch) to a
// temp dir, so the current working tree can be compared against it.
function engineAtRevision(rev) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-rev-'));
    for (const f of ['engine.js', 'ai.js', 'notation.js']) {
        const src = execFileSync('git', ['show', `${rev}:main/game/${f}`], { cwd: ROOT, maxBuffer: 1 << 26 });
        fs.writeFileSync(path.join(out, f), src);
    }
    return out;
}

// Loads a revision's engine and stops with a clear message if it predates the
// searchRoot()/findBestMove() -> { move, promo } API these scripts rely on.
function loadRevisionEngine(rev) {
    const engine = loadEngine(engineAtRevision(rev));
    if (engine.run('typeof searchRoot') !== 'function') {
        console.error(`Revision "${rev}" has the pre-Session-20 engine (no searchRoot). Commit the current work, then compare against that commit or later.`);
        process.exit(2);
    }
    return engine;
}

// Movetext ("1. e4 e5 2. Nf3 ...") -> SAN array.
function sanList(movetext) {
    return movetext.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean);
}

// Injected into each engine context: sets up an arbitrary position from FEN.
const FEN_LOADER = `
function __loadFEN(fen) {
    const [placement, side, castling, ep, half] = fen.split(' ');
    resetGame();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) gameState[y][x] = null;
    const map = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    placement.split('/').forEach((row, y) => {
        let x = 0;
        for (const ch of row) {
            if (/\\d/.test(ch)) { x += +ch; continue; }
            const p = new ChessPiece(map[ch.toLowerCase()], ch === ch.toUpperCase() ? 'white' : 'black');
            p.hasMoved = true;
            gameState[y][x++] = p;
        }
    });
    const fresh = (x, y) => { if (gameState[y][x]) gameState[y][x].hasMoved = false; };
    const cr = castling || '-';
    if (cr.includes('K')) { fresh(4, 7); fresh(7, 7); }
    if (cr.includes('Q')) { fresh(4, 7); fresh(0, 7); }
    if (cr.includes('k')) { fresh(4, 0); fresh(7, 0); }
    if (cr.includes('q')) { fresh(4, 0); fresh(0, 0); }
    currentTurn = side === 'w' ? 'white' : 'black';
    lastMove = null;
    if (ep && ep !== '-') {
        const fx = ep.charCodeAt(0) - 97;
        lastMove = +ep[1] === 6
            ? { piece: gameState[3][fx], fromX: fx, fromY: 1, toX: fx, toY: 3 }
            : { piece: gameState[4][fx], fromX: fx, fromY: 6, toX: fx, toY: 4 };
    }
    halfMoveClock = +(half || 0);
    positionHistory = new Map();
}`;

// Minimal assertion helper: collects failures instead of stopping at the first.
function makeChecker() {
    let failures = 0;
    return {
        check(ok, label) {
            console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`);
            if (!ok) failures++;
        },
        done(name) {
            console.log(failures ? `\n${name}: ${failures} FAILED` : `\n${name}: all passed`);
            process.exitCode = failures ? 1 : 0;
        },
    };
}

module.exports = { ROOT, GAME_DIR, loadEngine, loadRevisionEngine, loadAnalysisWorker, engineAtRevision, sanList, makeChecker };
