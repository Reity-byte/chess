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
    let san = letter + disambig + pawnFile + (isCapture ? 'x' : '') + toFile + toRank + promoSuffix;

    // ── Check / Checkmate suffix ──────────────────────────────────────────────
    // Simulate the move to see if opponent's king ends up in check/mate
    const capturedPiece = gameState[toY][toX];
    let epCaptured = null;
    if (moveDetails && moveDetails.isEnPassant) {
        epCaptured = gameState[moveDetails.captureY][moveDetails.captureX];
        gameState[moveDetails.captureY][moveDetails.captureX] = null;
    }
    if (moveDetails && moveDetails.isCastle) {
        const rook = gameState[fromY][moveDetails.rookFromX];
        gameState[fromY][moveDetails.rookToX] = rook;
        gameState[fromY][moveDetails.rookFromX] = null;
    }
    gameState[toY][toX] = piece;
    gameState[fromY][fromX] = null;

    const enemyColor = piece.color === 'white' ? 'black' : 'white';
    const enemyKing  = findKing(enemyColor);
    if (enemyKing) {
        const inCheck = isSquareAttacked(enemyKing.x, enemyKing.y, piece.color);
        if (inCheck) {
            // Is it checkmate? (no legal moves for enemy)
            let hasMate = true;
            outer: for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    const p = gameState[y][x];
                    if (p && p.color === enemyColor && getvalidMoves(x, y).length > 0) {
                        hasMate = false;
                        break outer;
                    }
                }
            }
            san += hasMate ? '#' : '+';
        }
    }

    // Restore the board
    gameState[fromY][fromX] = piece;
    gameState[toY][toX]     = capturedPiece;
    if (moveDetails && moveDetails.isEnPassant) {
        gameState[moveDetails.captureY][moveDetails.captureX] = epCaptured;
    }
    if (moveDetails && moveDetails.isCastle) {
        const rook = gameState[fromY][moveDetails.rookToX];
        gameState[fromY][moveDetails.rookFromX] = rook;
        gameState[fromY][moveDetails.rookToX]   = null;
    }

    return san;
}