// ─── BOARD VIEW ────────────────────────────────────────────────────────────────
// One board component shared by the live game, the Game Review page and the
// Puzzle Trainer. It only draws and collects input; the page decides what a
// move means. Coordinates are always logical board coordinates (x = file 0-7,
// y = row 0-7 with row 0 = rank 8, same as gameState); flipping is handled here.
//
// Pieces are positioned with CSS transforms (compositor-only animation, no
// layout work per frame) and are diffed against the previous render, so a
// piece that moved slides to its new square even when the caller rebuilt the
// whole position from scratch (e.g. stepping through a game in the review).
// Its look (piece set, board colors) comes from style-settings.js.

const PROMOTION_CHOICES = ['queen', 'knight', 'rook', 'bishop'];

// Right-click annotation colors (lichess convention): plain, Shift, Alt, Shift+Alt.
const ANNOTATION_COLORS = {
    green:  'rgba(21, 120, 27, 0.8)',
    red:    'rgba(200, 30, 30, 0.8)',
    blue:   'rgba(0, 48, 136, 0.8)',
    yellow: 'rgba(230, 160, 0, 0.85)',
};

class BoardView {
    // opts: { canSelect(x, y) -> bool, legalMoves(x, y) -> [{ x, y, ...details }],
    //         onMove({ fromX, fromY, toX, toY, details }) }
    constructor(el, opts = {}) {
        this.el = el;
        this.opts = opts;
        this.flipped = false;
        this.interactive = false;
        this.pieces = [];          // [{ el, x, y, color, type }]
        this.selected = null;      // { x, y, moves }
        this.drag = null;
        this.lastMove = null;
        this.checkSquare = null;
        this.promotionResolve = null;
        this.userArrows = [];      // right-click drawn: [{ from, to, color }]
        this.userMarks = [];       // right-click circled squares: [{ x, y, color }]
        this.annotating = null;

        el.classList.add('board');
        el.innerHTML = '';
        this.squareLayer = this.makeLayer('board-squares');
        this.squares = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const sq = document.createElement('div');
                sq.className = 'sq ' + ((x + y) % 2 === 0 ? 'light' : 'dark');
                this.squares.push(sq);
                this.squareLayer.appendChild(sq);
            }
        }
        this.coordLayer = this.makeLayer('board-coords');
        this.pieceLayer = this.makeLayer('board-pieces');
        this.arrowLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.arrowLayer.setAttribute('viewBox', '0 0 8 8');
        this.arrowLayer.classList.add('board-arrows');
        el.appendChild(this.arrowLayer);
        this.badgeLayer = this.makeLayer('board-badges');
        this.promoLayer = this.makeLayer('board-promo hidden');

        this.layoutSquares();
        this.drawCoords();
        this.bindInput();
    }

    makeLayer(cls) {
        const d = document.createElement('div');
        d.className = cls;
        this.el.appendChild(d);
        return d;
    }

    sx(x) { return this.flipped ? 7 - x : x; }
    sy(y) { return this.flipped ? 7 - y : y; }
    square(x, y) { return this.squares[y * 8 + x]; }

    setFlipped(flipped) {
        if (this.flipped === flipped) return;
        this.flipped = flipped;
        this.el.classList.add('no-anim');
        this.layoutSquares();
        this.drawCoords();
        for (const p of this.pieces) this.place(p.el, p.x, p.y);
        this.redrawArrows();
        this.redrawBadge();
        requestAnimationFrame(() => this.el.classList.remove('no-anim'));
    }

    setInteractive(on) {
        this.interactive = on;
        this.el.classList.toggle('interactive', on);
        if (!on) this.clearSelection();
    }

    layoutSquares() {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const sq = this.square(x, y);
                sq.style.gridColumn = this.sx(x) + 1;
                sq.style.gridRow = this.sy(y) + 1;
            }
        }
    }

    drawCoords() {
        this.coordLayer.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const rank = document.createElement('span');
            const y = this.flipped ? 7 - i : i;
            rank.className = 'coord coord-rank ' + (i % 2 === 0 ? 'on-light' : 'on-dark');
            rank.style.top = `${i * 12.5}%`;
            rank.textContent = String(8 - y);
            this.coordLayer.appendChild(rank);

            const file = document.createElement('span');
            const x = this.flipped ? 7 - i : i;
            file.className = 'coord coord-file ' + ((i + 7) % 2 === 0 ? 'on-light' : 'on-dark');
            file.style.left = `${i * 12.5}%`;
            file.textContent = FILE_NAMES[x];
            this.coordLayer.appendChild(file);
        }
    }

    place(el, x, y) {
        el.style.transform = `translate(${this.sx(x) * 100}%, ${this.sy(y) * 100}%)`;
    }

    // ─── PIECES ────────────────────────────────────────────────────────────────
    // Diffs `board` (gameState-shaped) against what's drawn: unchanged pieces
    // stay, moved pieces slide (matched by color+type, nearest first; a pawn may
    // turn into its promoted piece), the rest fade in/out.
    render(board = gameState, { animate = true } = {}) {
        this.clearAnnotations(); // a new position wipes the player's arrows, like on lichess
        if (!animate) this.el.classList.add('no-anim');
        const want = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const p = board[y][x];
                if (p) want.push({ x, y, color: p.color, type: p.type, match: null });
            }
        }
        const free = new Set(this.pieces);
        const take = (w, e) => { w.match = e; free.delete(e); };

        for (const w of want) {
            for (const e of free) {
                if (e.x === w.x && e.y === w.y && e.color === w.color && e.type === w.type) { take(w, e); break; }
            }
        }
        const nearest = (w, predicate) => {
            let best = null, bestD = Infinity;
            for (const e of free) {
                if (!predicate(e)) continue;
                const d = Math.abs(e.x - w.x) + Math.abs(e.y - w.y);
                if (d < bestD) { bestD = d; best = e; }
            }
            return best;
        };
        for (const w of want) {
            if (w.match) continue;
            const e = nearest(w, e => e.color === w.color && e.type === w.type);
            if (e) take(w, e);
        }
        for (const w of want) {
            if (w.match) continue;
            const e = nearest(w, e => e.color === w.color && e.type === 'pawn' && (w.y === 0 || w.y === 7));
            if (e) take(w, e);
        }

        const next = [];
        for (const w of want) {
            let e = w.match;
            const isNew = !e;
            if (isNew) {
                e = { el: document.createElement('div') };
                this.pieceLayer.appendChild(e.el);
            }
            e.x = w.x; e.y = w.y; e.color = w.color; e.type = w.type;
            e.el.className = `piece ${w.color} ${w.type}` + (isNew ? ' snap fade-in' : '');
            this.place(e.el, w.x, w.y);
            if (isNew) {
                // Appear in place (no slide from a8), then fade in.
                const el = e.el;
                requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('snap', 'fade-in')));
            }
            next.push(e);
        }
        for (const e of free) {
            e.el.classList.add('fade-out');
            setTimeout(() => e.el.remove(), 160);
        }
        this.pieces = next;
        if (!animate) requestAnimationFrame(() => this.el.classList.remove('no-anim'));
    }

    pieceAt(x, y) {
        return this.pieces.find(p => p.x === x && p.y === y) || null;
    }

    // ─── HIGHLIGHTS ────────────────────────────────────────────────────────────
    setLastMove(from, to) {
        if (this.lastMove) {
            this.square(this.lastMove.from.x, this.lastMove.from.y).classList.remove('last-move');
            this.square(this.lastMove.to.x, this.lastMove.to.y).classList.remove('last-move');
        }
        this.lastMove = from && to ? { from, to } : null;
        if (this.lastMove) {
            this.square(from.x, from.y).classList.add('last-move');
            this.square(to.x, to.y).classList.add('last-move');
        }
    }

    setCheck(sq) {
        if (this.checkSquare) this.square(this.checkSquare.x, this.checkSquare.y).classList.remove('in-check');
        this.checkSquare = sq || null;
        if (sq) this.square(sq.x, sq.y).classList.add('in-check');
    }

    // Marks the king of the side to move on the real board if it's in check.
    updateCheckFromGame() {
        const kp = findKing(currentTurn);
        this.setCheck(kp && isInCheck(currentTurn) ? { x: kp.x, y: kp.y } : null);
    }

    select(x, y) {
        this.clearSelection();
        const moves = this.opts.legalMoves ? this.opts.legalMoves(x, y) : [];
        this.selected = { x, y, moves };
        this.square(x, y).classList.add('selected');
        for (const m of moves) {
            const occupied = !!this.pieceAt(m.x, m.y) || m.isEnPassant;
            this.square(m.x, m.y).classList.add(occupied ? 'hint-capture' : 'hint');
        }
    }

    clearSelection() {
        if (!this.selected) return;
        this.square(this.selected.x, this.selected.y).classList.remove('selected');
        for (const m of this.selected.moves) this.square(m.x, m.y).classList.remove('hint', 'hint-capture');
        this.selected = null;
    }

    // ─── ARROWS + BADGES ───────────────────────────────────────────────────────
    // arrows: [{ from: {x,y}, to: {x,y}, color, width? }]
    setArrows(arrows) {
        this.arrows = arrows || [];
        this.redrawArrows();
    }

    redrawArrows() {
        const svg = this.arrowLayer;
        svg.innerHTML = '';
        (this.arrows || []).concat(this.userArrows).forEach((a, i) => {
            const x1 = this.sx(a.from.x) + 0.5, y1 = this.sy(a.from.y) + 0.5;
            const x2 = this.sx(a.to.x) + 0.5, y2 = this.sy(a.to.y) + 0.5;
            const len = Math.hypot(x2 - x1, y2 - y1);
            if (len === 0) return;
            const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
            const w = a.width || 0.16, head = 0.42;
            // Shaft stops where the head begins; the head tip sits short of center.
            const tipX = x2 - ux * 0.12, tipY = y2 - uy * 0.12;
            const baseX = tipX - ux * head, baseY = tipY - uy * head;
            const px = -uy, py = ux;
            const sx = x1 + ux * 0.22, sy = y1 + uy * 0.22;
            const pts = [
                [sx + px * w / 2, sy + py * w / 2], [baseX + px * w / 2, baseY + py * w / 2],
                [baseX + px * head * 0.62, baseY + py * head * 0.62], [tipX, tipY],
                [baseX - px * head * 0.62, baseY - py * head * 0.62], [baseX - px * w / 2, baseY - py * w / 2],
                [sx - px * w / 2, sy - py * w / 2],
            ].map(p => p.map(v => v.toFixed(3)).join(',')).join(' ');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts);
            poly.setAttribute('fill', a.color || 'var(--arrow)');
            poly.setAttribute('class', 'arrow' + (i === 0 ? ' arrow-primary' : ''));
            svg.appendChild(poly);
        });
        for (const m of this.userMarks) {
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', this.sx(m.x) + 0.5);
            c.setAttribute('cy', this.sy(m.y) + 0.5);
            c.setAttribute('r', 0.45);
            c.setAttribute('fill', 'none');
            c.setAttribute('stroke', m.color);
            c.setAttribute('stroke-width', 0.08);
            svg.appendChild(c);
        }
    }

    // ─── PLAYER ANNOTATIONS (right-click) ──────────────────────────────────────
    toggleAnnotation(from, to, color) {
        if (from.x === to.x && from.y === to.y) {
            const i = this.userMarks.findIndex(m => m.x === from.x && m.y === from.y);
            if (i >= 0 && this.userMarks[i].color === color) this.userMarks.splice(i, 1);
            else if (i >= 0) this.userMarks[i].color = color;
            else this.userMarks.push({ x: from.x, y: from.y, color });
        } else {
            const same = (a) => a.from.x === from.x && a.from.y === from.y && a.to.x === to.x && a.to.y === to.y;
            const i = this.userArrows.findIndex(same);
            if (i >= 0 && this.userArrows[i].color === color) this.userArrows.splice(i, 1);
            else if (i >= 0) this.userArrows[i].color = color;
            else this.userArrows.push({ from, to, color, width: 0.14 });
        }
        this.redrawArrows();
    }

    clearAnnotations() {
        if (!this.userArrows.length && !this.userMarks.length) return;
        this.userArrows = [];
        this.userMarks = [];
        this.redrawArrows();
    }

    // badge: { x, y, glyph, color, title } or null
    setBadge(badge) {
        this.badge = badge || null;
        this.redrawBadge();
    }

    redrawBadge() {
        this.badgeLayer.innerHTML = '';
        if (!this.badge) return;
        const b = document.createElement('div');
        b.className = 'move-badge-board pop';
        b.style.left = `${(this.sx(this.badge.x) + 1) * 12.5}%`;
        b.style.top = `${this.sy(this.badge.y) * 12.5}%`;
        b.style.background = this.badge.color;
        b.textContent = this.badge.glyph;
        if (this.badge.title) b.title = this.badge.title;
        this.badgeLayer.appendChild(b);
    }

    // ─── PROMOTION PICKER ──────────────────────────────────────────────────────
    // Shows the four promotion pieces in a column over the promotion square.
    // Resolves to the chosen type, or null if the player clicks away.
    askPromotion(x, y, color) {
        return new Promise(resolve => {
            this.promotionResolve = resolve;
            const layer = this.promoLayer;
            layer.innerHTML = '';
            layer.classList.remove('hidden');
            const fromTop = this.sy(y) === 0;
            PROMOTION_CHOICES.forEach((type, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `promo-choice piece-icon ${color} ${type}`;
                b.setAttribute('aria-label', `Promote to ${type}`);
                b.style.left = `${this.sx(x) * 12.5}%`;
                b.style.top = `${(fromTop ? i : 7 - i) * 12.5}%`;
                b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.finishPromotion(type); });
                layer.appendChild(b);
            });
        });
    }

    finishPromotion(type) {
        this.promoLayer.classList.add('hidden');
        this.promoLayer.innerHTML = '';
        const resolve = this.promotionResolve;
        this.promotionResolve = null;
        if (resolve) resolve(type);
    }

    // ─── INPUT: click-to-move and drag-and-drop ───────────────────────────────
    squareFromPoint(clientX, clientY) {
        const r = this.el.getBoundingClientRect();
        const col = Math.floor(((clientX - r.left) / r.width) * 8);
        const row = Math.floor(((clientY - r.top) / r.height) * 8);
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        return { x: this.flipped ? 7 - col : col, y: this.flipped ? 7 - row : row };
    }

    tryMoveTo(x, y) {
        if (!this.selected) return false;
        const target = this.selected.moves.find(m => m.x === x && m.y === y);
        if (!target) return false;
        const from = this.selected;
        this.clearSelection();
        if (this.opts.onMove) this.opts.onMove({ fromX: from.x, fromY: from.y, toX: x, toY: y, details: target });
        return true;
    }

    bindInput() {
        this.el.addEventListener('contextmenu', e => e.preventDefault());
        this.el.addEventListener('pointerdown', (e) => {
            if (this.promotionResolve) { this.finishPromotion(null); return; }
            const sq = this.squareFromPoint(e.clientX, e.clientY);
            if (!sq) return;
            if (e.button === 2) {
                // Right button: start drawing an arrow (or circle, if released on the same square).
                const color = e.shiftKey && e.altKey ? 'yellow' : e.shiftKey ? 'red' : e.altKey ? 'blue' : 'green';
                this.annotating = { from: sq, color: ANNOTATION_COLORS[color] };
                this.capture(e.pointerId);
                return;
            }
            if (e.button !== 0) return;
            this.clearAnnotations();
            if (!this.interactive) return;
            if (this.tryMoveTo(sq.x, sq.y)) return;

            const wasSelected = this.selected && this.selected.x === sq.x && this.selected.y === sq.y;
            if (this.opts.canSelect && this.opts.canSelect(sq.x, sq.y)) {
                if (!wasSelected) this.select(sq.x, sq.y);
                const piece = this.pieceAt(sq.x, sq.y);
                this.drag = { x: sq.x, y: sq.y, piece, startX: e.clientX, startY: e.clientY, active: false, wasSelected };
                this.capture(e.pointerId);
            } else {
                this.clearSelection();
            }
        });
        this.el.addEventListener('pointermove', (e) => {
            const d = this.drag;
            if (!d || !d.piece) return;
            if (!d.active) {
                if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
                d.active = true;
                d.piece.el.classList.add('dragging');
            }
            const r = this.el.getBoundingClientRect();
            const size = r.width / 8;
            const px = (e.clientX - r.left - size / 2) / size * 100;
            const py = (e.clientY - r.top - size / 2) / size * 100;
            d.piece.el.style.transform = `translate(${px}%, ${py}%)`;
            const over = this.squareFromPoint(e.clientX, e.clientY);
            this.setDragOver(over);
        });
        const end = (e) => {
            if (this.annotating) {
                const a = this.annotating;
                this.annotating = null;
                const sq = this.squareFromPoint(e.clientX, e.clientY);
                if (sq && e.type === 'pointerup') this.toggleAnnotation(a.from, sq, a.color);
                return;
            }
            const d = this.drag;
            if (!d) return;
            this.drag = null;
            this.setDragOver(null);
            if (d.piece) d.piece.el.classList.remove('dragging');
            const sq = this.squareFromPoint(e.clientX, e.clientY);
            if (d.active) {
                if (sq && (sq.x !== d.x || sq.y !== d.y) && this.tryMoveTo(sq.x, sq.y)) return;
                if (d.piece) {
                    // Snap back without animating from the drop point.
                    d.piece.el.classList.add('snap');
                    this.place(d.piece.el, d.x, d.y);
                    requestAnimationFrame(() => d.piece && d.piece.el.classList.remove('snap'));
                }
            } else if (d.wasSelected) {
                this.clearSelection();
            }
        };
        this.el.addEventListener('pointerup', end);
        this.el.addEventListener('pointercancel', end);
    }

    // Keeps receiving pointer events if the pointer leaves the board mid-drag.
    // Can throw if the pointer is already gone (e.g. a touch that just ended).
    capture(pointerId) {
        try { this.el.setPointerCapture(pointerId); } catch (e) { /* events still arrive while over the board */ }
    }

    setDragOver(sq) {
        if (this.dragOver) this.square(this.dragOver.x, this.dragOver.y).classList.remove('drag-over');
        this.dragOver = sq;
        if (sq) this.square(sq.x, sq.y).classList.add('drag-over');
    }
}

// ─── TOASTS ────────────────────────────────────────────────────────────────────
// Small non-blocking notices (instead of alert()).
function showToast(message, ms = 2600) {
    let host = document.querySelector('.toast-host');
    if (!host) {
        host = document.createElement('div');
        host.className = 'toast-host';
        host.setAttribute('role', 'status');
        document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, ms);
}

// Small piece sprite element (captured-material rows, avatars, icons).
function pieceIcon(color, type) {
    const s = document.createElement('span');
    s.className = `piece-icon ${color} ${type}`;
    return s;
}

// ─── CAPTURED MATERIAL ─────────────────────────────────────────────────────────
// Fills `el` with the pieces `color` has taken (the opponent's pieces missing
// from `board`) and its material lead in points, as shown under a player's name.
const START_COUNTS = { pawn: 8, knight: 2, bishop: 2, rook: 2, queen: 1 };
const CAPTURE_ORDER = ['queen', 'rook', 'bishop', 'knight', 'pawn'];
const MATERIAL_POINTS = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 };

function renderCaptured(el, color, board = gameState) {
    const enemy = color === 'white' ? 'black' : 'white';
    const counts = { white: {}, black: {} };
    const points = { white: 0, black: 0 };
    for (const row of board) {
        for (const p of row) {
            if (!p || p.type === 'king') continue;
            counts[p.color][p.type] = (counts[p.color][p.type] || 0) + 1;
            points[p.color] += MATERIAL_POINTS[p.type];
        }
    }
    el.innerHTML = '';
    for (const type of CAPTURE_ORDER) {
        const missing = Math.max(0, START_COUNTS[type] - (counts[enemy][type] || 0));
        if (!missing) continue;
        const group = document.createElement('span');
        group.className = 'group';
        for (let i = 0; i < missing; i++) group.appendChild(pieceIcon(enemy, type));
        el.appendChild(group);
    }
    const lead = points[color] - points[enemy];
    if (lead > 0) {
        const d = document.createElement('span');
        d.className = 'material-diff';
        d.textContent = `+${lead}`;
        el.appendChild(d);
    }
}
