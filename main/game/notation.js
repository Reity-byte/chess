// ─── ALGEBRAIC NOTATION TRANSLATOR ──────────────────────────────────────────
// Converts internal move objects into Standard Algebraic Notation (SAN)
// e.g. { fromX:4, fromY:6, toX:4, toY:4 } → "e4"
//      { fromX:6, fromY:7, toX:5, toY:5 } → "Nf3"
//      castling kingside → "O-O"

const PIECE_LETTER = { pawn: '', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
const FILE_NAMES   = ['a','b','c','d','e','f','g','h'];

/**
 * Call this BEFORE executing the move on the board so we can inspect the
 * pre-move state (needed for disambiguation and capture detection).
 *
 * @param {number} fromX
 * @param {number} fromY
 * @param {number} toX
 * @param {number} toY
 * @param {object|null} moveDetails  – the same details object passed to movePiece()
 * @param {string|null} promoType   – piece type chosen on promotion ('queen', 'rook', …)
 * @returns {string}  SAN string
 */
function moveToSAN(fromX, fromY, toX, toY, moveDetails = null, promoType = null) {
    const piece = gameState[fromY][fromX];
    if (!piece) return '?';

    // ── Castling ─────────────────────────────────────────────────────────────
    if (moveDetails && moveDetails.isCastle) {
        return toX === 6 ? 'O-O' : 'O-O-O';
    }

    const letter   = PIECE_LETTER[piece.type];
    const toFile   = FILE_NAMES[toX];
    const toRank   = 8 - toY;

    // ── Capture? ──────────────────────────────────────────────────────────────
    const isCapture = !!(gameState[toY][toX]) || !!(moveDetails && moveDetails.isEnPassant);

    // ── Disambiguation (two same-type pieces can reach the same square) ───────
    let disambig = '';
    if (piece.type !== 'pawn') {
        const ambiguous = [];
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if (x === fromX && y === fromY) continue;
                const other = gameState[y][x];
                if (other && other.type === piece.type && other.color === piece.color) {
                    // Can this other piece also reach toX,toY legally?
                    if (getvalidMoves(x, y).some(m => m.x === toX && m.y === toY)) {
                        ambiguous.push({ x, y });
                    }
                }
            }
        }
        if (ambiguous.length > 0) {
            const sameFile = ambiguous.some(p => p.x === fromX);
            const sameRank = ambiguous.some(p => p.y === fromY);
            if (!sameFile)       disambig = FILE_NAMES[fromX];          // file is enough
            else if (!sameRank)  disambig = String(8 - fromY);          // rank is enough
            else                 disambig = FILE_NAMES[fromX] + (8 - fromY); // need both
        }
    }

    // ── Pawn capture: always include origin file ───────────────────────────────
    const pawnFile = (piece.type === 'pawn' && isCapture) ? FILE_NAMES[fromX] : '';

    // ── Promotion suffix ──────────────────────────────────────────────────────
    const promoSuffix = promoType ? '=' + PIECE_LETTER[promoType].toUpperCase() : '';

    // ── Assemble base notation ────────────────────────────────────────────────
    // NOTE: this does NOT include the trailing +/# check/checkmate marker.
    // Call this BEFORE the move is applied to the real board, then append
    // getCheckSuffix(<side to move next>) AFTER the move (and any promotion)
    // has actually been applied — that avoids simulating a fake "pawn" check
    // when the moving piece is about to be promoted to something else.
    return letter + disambig + pawnFile + (isCapture ? 'x' : '') + toFile + toRank + promoSuffix;
}

// ─── SAN -> MOVE RESOLUTION ─────────────────────────────────────────────────
// Finds the legal move for `color` matching a SAN string on the current board.
// Shared by every replay path (resume, takeback, analysis, puzzles, PGN import).
// Tolerates check/annotation suffixes ("Nf3+", "Qg5?!"), zero-castling ("0-0")
// and promotions written without "=" ("e8Q"). Returns { move, promo } or null.
function normalizeSAN(raw) {
    let san = String(raw).trim().replace(/[+#!?]+$/, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
    const m = san.match(/^([a-h]?x?[a-h][18])([QRBN])$/);
    if (m) san = `${m[1]}=${m[2]}`;
    return san;
}

const PROMO_FROM_LETTER = { Q: 'queen', R: 'rook', B: 'bishop', N: 'knight' };

function resolveSAN(color, rawSan) {
    const san = normalizeSAN(rawSan);
    const promoMatch = san.match(/=([QRBN])$/);
    const promo = promoMatch ? PROMO_FROM_LETTER[promoMatch[1]] : null;
    // Cheap pre-filter: every non-castling SAN names its destination square, so
    // only moves landing there need the (comparatively costly) moveToSAN call.
    const destMatch = san.match(/([a-h][1-8])(=[QRBN])?$/);
    for (const move of getAllValidMoves(color)) {
        if (destMatch) {
            if (destMatch[1] !== FILE_NAMES[move.toX] + (8 - move.toY)) continue;
        } else if (!move.details.isCastle) {
            continue;
        }
        const isPromo = gameState[move.fromY][move.fromX].type === 'pawn' && (move.toY === 0 || move.toY === 7);
        if (isPromo !== !!promo) continue;
        if (moveToSAN(move.fromX, move.fromY, move.toX, move.toY, move.details, promo) === san) {
            return { move, promo };
        }
    }
    return null;
}

// Replays a SAN list from the initial position, recording repetition history as
// it goes. Stops at the first unresolvable move; returns how many were applied.
function replaySANFromStart(sanList) {
    resetGame();
    recordPosition();
    let applied = 0;
    for (const san of sanList) {
        const resolved = resolveSAN(currentTurn, san);
        if (!resolved) break;
        applyMoveWithPromotion(resolved.move, resolved.promo);
        recordPosition();
        applied++;
    }
    return applied;
}
