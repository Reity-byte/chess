// ─── MOVE YOUR DATA BETWEEN DEVICES ────────────────────────────────────────────
// Everything this site keeps in the browser — games, reviews, ratings, puzzles,
// settings — can be moved to another device two ways:
//   QR:     the sending device compresses it, cuts it into small frames and
//           shows them as a looping series of QR codes; the receiving device
//           films the screen and collects the frames in any order until it has
//           them all (vendor/qrcode.js draws the codes, vendor/jsQR.js reads them).
//   Backup: the same data as a .json file to save and load on another device.
// On import you choose to merge with this device's data or replace it.
// Loaded on demand from the Style panel (style-settings.js).
const TRANSFER_BASE = new URL('.', document.currentScript.src); // the main/ folder
const TRANSFER_SKIP = new Set(['chessAnalysisCache', 'chessGameForAnalysis', 'chessInProgressGame']); // big or temporary
const DEVICE_PREFS = new Set(['chessStyle', 'chessSetup', 'chessSoundMuted', 'chessLiveEngine', 'chessLiveLines', 'chessAnalysisMode', 'chessBoardTheme']);
// Payload per QR code: small codes (≈ version 12 at error level L) are the
// easiest to film off a screen; a lot of data (a few hundred games) uses denser
// codes so one loop stays around 20 seconds.
const FRAME_BYTES_SMALL = 360;
const FRAME_BYTES_LARGE = 640;
const LARGE_DATA = 16 * 1024;
const FRAME_MS = 200;      // how long each code is shown
const MAGIC = [0x43, 0x51]; // "CQ"

function loadVendor(name) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL(`vendor/${name}?v=30`, TRANSFER_BASE).href;
        s.onload = resolve;
        s.onerror = () => reject(new Error(`couldn't load ${name}`));
        document.head.appendChild(s);
    });
}

// ─── THE DATA ──────────────────────────────────────────────────────────────────
function collectData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('chess') && !TRANSFER_SKIP.has(k)) data[k] = localStorage.getItem(k);
    }
    return { app: 'chess', format: 1, created: new Date().toISOString(), data };
}

function parseJSON(text, fallback) {
    try { const v = JSON.parse(text); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

function describeData(data) {
    const games = parseJSON(data.chessGameHistory, []).length;
    const ratings = parseJSON(data.chessPlayerRatings, null);
    const best = ratings ? Object.values(ratings).filter(r => r && r.games).map(r => r.rating) : [];
    const puzzles = Number(data.chessPuzzleSolvedCount || 0);
    return `${games} game${games === 1 ? '' : 's'}` + (best.length ? ` · rating ${Math.max(...best)}` : '')
        + (puzzles ? ` · ${puzzles} puzzles solved` : '');
}

async function compress(text) {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'undefined') return { bytes, packed: false };
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')));
    return { bytes: new Uint8Array(await out.arrayBuffer()), packed: true };
}

async function decompress(bytes, packed) {
    if (!packed) return new TextDecoder().decode(bytes);
    const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    return new TextDecoder().decode(await out.arrayBuffer());
}

// Frame = "CQ", flags (1 = compressed), session (2 bytes), index (2), count (2), payload.
function makeFrames(bytes, packed) {
    const session = Math.floor(Math.random() * 65536);
    const FRAME_BYTES = bytes.length > LARGE_DATA ? FRAME_BYTES_LARGE : FRAME_BYTES_SMALL;
    const count = Math.max(1, Math.ceil(bytes.length / FRAME_BYTES));
    const frames = [];
    for (let i = 0; i < count; i++) {
        const payload = bytes.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES);
        const head = [...MAGIC, packed ? 1 : 0, session >> 8, session & 255, i >> 8, i & 255, count >> 8, count & 255];
        let s = String.fromCharCode(...head);
        for (const b of payload) s += String.fromCharCode(b);
        frames.push(s);
    }
    return frames;
}

function readFrame(bytes) {
    if (!bytes || bytes.length < 9 || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) return null;
    return {
        packed: bytes[2] === 1, session: (bytes[3] << 8) | bytes[4],
        index: (bytes[5] << 8) | bytes[6], count: (bytes[7] << 8) | bytes[8],
        payload: Uint8Array.from(bytes.slice(9)),
    };
}

// ─── IMPORT: MERGE OR REPLACE ──────────────────────────────────────────────────
function mergeData(local, incoming) {
    const out = { ...local };
    const byId = (a, b, cap) => {
        const seen = new Map();
        for (const x of [...parseJSON(a, []), ...parseJSON(b, [])]) if (x && x.id && !seen.has(x.id)) seen.set(x.id, x);
        let list = [...seen.values()];
        if (list.length && list[0].date) list.sort((x, y) => String(x.date).localeCompare(String(y.date)));
        return JSON.stringify(cap ? list.slice(-cap) : list);
    };
    for (const [k, v] of Object.entries(incoming)) {
        if (!(k in local)) { out[k] = v; continue; }
        if (DEVICE_PREFS.has(k)) continue; // each device keeps its own look and setup
        if (k === 'chessGameHistory') out[k] = byId(local[k], v, 300);
        else if (k === 'chessPuzzleBank') out[k] = byId(local[k], v, 300);
        else if (k === 'chessPuzzleSolvedIds') out[k] = JSON.stringify([...new Set([...parseJSON(local[k], []), ...parseJSON(v, [])])]);
        else if (k === 'chessPlayerRatings') {
            const a = parseJSON(local[k], {}), b = parseJSON(v, {});
            for (const mode of Object.keys(b)) if (!a[mode] || (b[mode] && b[mode].games > a[mode].games)) a[mode] = b[mode];
            out[k] = JSON.stringify(a);
        } else if (k === 'chessPlayerRating') {
            const a = parseJSON(local[k], null), b = parseJSON(v, null);
            if (!a || (b && b.games > a.games)) out[k] = v;
        } else if (k === 'chessPuzzleRating' || k === 'chessPuzzleStreak') {
            // Follow whichever device has solved more puzzles.
            if (Number(incoming.chessPuzzleSolvedCount || 0) > Number(local.chessPuzzleSolvedCount || 0)) out[k] = v;
        } else if (k === 'chessPuzzleSolvedCount') out[k] = String(Math.max(Number(local[k]) || 0, Number(v) || 0));
        // Anything else: this device's value stays.
    }
    return out;
}

function applyImport(pkg, mode) {
    const local = collectData().data;
    const next = mode === 'replace' ? pkg.data : mergeData(local, pkg.data);
    if (mode === 'replace') for (const k of Object.keys(local)) if (!(k in next)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(next)) localStorage.setItem(k, v);
    localStorage.removeItem('chessAnalysisCache'); // may belong to a game that's no longer here
}

function validPackage(pkg) {
    return pkg && pkg.app === 'chess' && pkg.data && typeof pkg.data === 'object'
        && Object.entries(pkg.data).every(([k, v]) => k.startsWith('chess') && typeof v === 'string');
}

// The Merge / Replace choice, shown inside `host`.
function showImportChoice(host, pkg, onDone) {
    host.innerHTML = `
        <div class="transfer-result">
            <div class="transfer-ok">✓</div>
            <div><strong>Received:</strong> ${escapeTransfer(describeData(pkg.data))}</div>
            <div class="muted">On this device now: ${escapeTransfer(describeData(collectData().data))}</div>
            <div class="modal-actions">
                <button type="button" class="btn btn-primary" data-mode="merge">Merge with this device</button>
                <button type="button" class="btn btn-danger" data-mode="replace">Replace this device's data</button>
            </div>
            <p class="faint transfer-note">Merge keeps every game from both devices and the more-played rating in each mode. Replace makes this device an exact copy.</p>
        </div>`;
    host.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        applyImport(pkg, b.dataset.mode);
        onDone(b.dataset.mode);
    }));
}

// showToast from board-ui.js where the page has it, else a toast of our own.
function transferToast(message, ms = 2600) {
    if (typeof showToast === 'function') { showToast(message, ms); return; }
    let host = document.querySelector('.toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    host.appendChild(t);
    setTimeout(() => t.remove(), ms);
}

function escapeTransfer(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ─── THE PANEL ─────────────────────────────────────────────────────────────────
// action: 'send' | 'receive' | 'save' | 'load'
async function openTransferPanel(action = 'send') {
    if (action === 'save') { saveBackupFile(); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transferTitle">
            <h2 id="transferTitle">Move your data</h2>
            <p class="modal-sub">Games, reviews, ratings, puzzles and settings, from one device to another.</p>
            <div class="segmented transfer-tabs">
                <button type="button" data-tab="send">Send from here</button>
                <button type="button" data-tab="receive">Receive here</button>
            </div>
            <div class="transfer-body"></div>
            <div class="modal-actions"><button type="button" class="btn" data-close>Close</button></div>
        </div>`;
    document.body.appendChild(overlay);
    const body = overlay.querySelector('.transfer-body');
    let stop = () => {};
    const close = () => { stop(); overlay.remove(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    const show = async (tab) => {
        stop();
        stop = () => {};
        overlay.querySelectorAll('.transfer-tabs button').forEach(b => b.classList.toggle('selected', b.dataset.tab === tab));
        if (tab === 'send') stop = await startSending(body);
        else if (tab === 'receive') stop = await startReceiving(body, () => close());
        else if (tab === 'load') loadBackupFile(body, () => close());
    };
    overlay.querySelectorAll('.transfer-tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    show(action);
}

function finishImport(mode) {
    transferToast(mode === 'replace' ? 'Data replaced — reloading…' : 'Data merged — reloading…', 2000);
    setTimeout(() => location.reload(), 900);
}

// ─── SENDING ───────────────────────────────────────────────────────────────────
async function startSending(host) {
    host.innerHTML = '<p class="muted">Preparing…</p>';
    try { if (typeof qrcode !== 'function') await loadVendor('qrcode.js'); } catch (e) { host.innerHTML = `<p class="muted">${escapeTransfer(e.message)}</p>`; return () => {}; }
    const pkg = collectData();
    const { bytes, packed } = await compress(JSON.stringify(pkg));
    const frames = makeFrames(bytes, packed);
    host.innerHTML = `
        <div class="transfer-send">
            <canvas class="qr-canvas" aria-label="QR code"></canvas>
            <div class="transfer-progress"><div class="progress-track"><div class="progress-fill"></div></div><span class="transfer-count"></span></div>
            <p class="transfer-help"><strong>${escapeTransfer(describeData(pkg.data))}</strong> · ${(bytes.length / 1024).toFixed(1)} KB in ${frames.length} code${frames.length === 1 ? '' : 's'}.<br>
            On the other device open <strong>Style → Move your data → Receive here</strong> and point its camera at this screen. Keep it open until that device says it's done.</p>
        </div>`;
    const canvas = host.querySelector('canvas');
    const fill = host.querySelector('.progress-fill'), count = host.querySelector('.transfer-count');
    let i = 0;
    const draw = () => {
        drawQR(canvas, frames[i]);
        fill.style.width = `${((i + 1) / frames.length) * 100}%`;
        count.textContent = `Code ${i + 1} of ${frames.length}`;
        i = (i + 1) % frames.length;
    };
    draw();
    const timer = frames.length > 1 ? setInterval(draw, FRAME_MS) : null;
    // Keep the screen awake while sending, where the browser allows it.
    let lock = null;
    try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* fine */ }
    return () => { if (timer) clearInterval(timer); if (lock) lock.release().catch(() => {}); };
}

function drawQR(canvas, binary) {
    const qr = qrcode(0, 'L');
    qr.addData(binary, 'Byte');
    qr.make();
    const n = qr.getModuleCount(), quiet = 4, total = n + quiet * 2;
    const css = Math.min(440, window.innerWidth - 64);
    const scale = Math.max(1, Math.floor((css * (window.devicePixelRatio || 1)) / total));
    canvas.width = canvas.height = total * scale;
    canvas.style.width = canvas.style.height = `${css}px`;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
}

// ─── RECEIVING ─────────────────────────────────────────────────────────────────
async function startReceiving(host, onClose) {
    host.innerHTML = `
        <div class="transfer-receive">
            <div class="camera-box"><video playsinline muted></video><div class="camera-frame"></div></div>
            <div class="transfer-progress"><div class="progress-track"><div class="progress-fill"></div></div><span class="transfer-count">Starting the camera…</span></div>
            <p class="transfer-help">On the other device choose <strong>Send from here</strong>, then hold this camera so the QR code fills the square. Codes can arrive in any order — it fills up as they come.</p>
        </div>`;
    const video = host.querySelector('video');
    const fill = host.querySelector('.progress-fill'), count = host.querySelector('.transfer-count');
    let stream = null, timer = null, stopped = false;
    const stop = () => { stopped = true; if (timer) clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); };
    try {
        if (typeof jsQR !== 'function') await loadVendor('jsQR.js');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
        count.textContent = e.name === 'NotAllowedError' ? 'Camera permission was refused — allow it in the browser to receive.' : `No camera available (${e.message}).`;
        return stop;
    }
    if (stopped) { stop(); return stop; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    count.textContent = 'Looking for codes…';

    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    let session = null, chunks = [], got = 0, packed = false;
    const scan = async () => {
        if (stopped) return;
        if (video.videoWidth) {
            // A centred square, scaled down: faster to read and matches the on-screen frame.
            const side = Math.min(video.videoWidth, video.videoHeight), size = Math.min(side, 720);
            canvas.width = canvas.height = size;
            g.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
            const code = jsQR(g.getImageData(0, 0, size, size).data, size, size, { inversionAttempts: 'dontInvert' });
            const frame = code && readFrame(code.binaryData);
            if (frame) {
                if (frame.session !== session) { session = frame.session; chunks = new Array(frame.count); got = 0; packed = frame.packed; }
                if (!chunks[frame.index]) {
                    chunks[frame.index] = frame.payload;
                    got++;
                    fill.style.width = `${(got / frame.count) * 100}%`;
                    count.textContent = `Got ${got} of ${frame.count} codes`;
                    if (navigator.vibrate) navigator.vibrate(15);
                }
                if (got === frame.count) {
                    stop();
                    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
                    let at = 0;
                    for (const c of chunks) { all.set(c, at); at += c.length; }
                    let pkg = null;
                    try { pkg = JSON.parse(await decompress(all, packed)); } catch (e) { pkg = null; }
                    if (!validPackage(pkg)) { count.textContent = 'That data could not be read — try again.'; return; }
                    showImportChoice(host, pkg, (mode) => { onClose(); finishImport(mode); });
                    return;
                }
            }
        }
        timer = setTimeout(scan, 90);
    };
    scan();
    return stop;
}

// ─── BACKUP FILE ───────────────────────────────────────────────────────────────
function saveBackupFile() {
    const pkg = collectData();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg)], { type: 'application/json' }));
    a.download = `chess-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    transferToast(`Backup saved — ${describeData(pkg.data)}.`, 3000);
}

function loadBackupFile(host, onClose) {
    host.innerHTML = `<div class="transfer-receive"><p class="transfer-help">Choose a backup file saved with <strong>Save backup file</strong> on any device.</p>
        <input type="file" accept="application/json,.json" class="backup-input"></div>`;
    const input = host.querySelector('input');
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const pkg = parseJSON(await file.text(), null);
        if (!validPackage(pkg)) { transferToast('That file is not a Chess backup.'); return; }
        showImportChoice(host, pkg, (mode) => { onClose(); finishImport(mode); });
    });
    input.click();
}
