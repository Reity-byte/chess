class ChessPiece {
    constructor(type, color) {
        this.type = type;
        this.color = color;
        this.hasMoved = false;
    }
}

let currentTurn = 'white';
let lastMove = null;

// --- DRAW DETECTION STATE ---
// positionHistory maps a board FEN-like key -> count, for threefold repetition
let positionHistory = {};
// halfMoveClock counts moves since last pawn move or capture (for 50-move rule)
let halfMoveClock = 0;

function initializeBoard() {
    const board = [];
    for (let y = 0; y < 8; y++) {
        const row = [];
        for (let x = 0; x < 8; x++) row.push(null);
        board.push(row);
    }
    const backRow = ['rook','knight','bishop','queen','king','bishop','knight','rook'];
    for (let x = 0; x < 8; x++) {
        board[0][x] = new ChessPiece(backRow[x], 'black');
        board[1][x] = new ChessPiece('pawn', 'black');
        board[6][x] = new ChessPiece('pawn', 'white');
        board[7][x] = new ChessPiece(backRow[x], 'white');
    }
    return board;
}

let gameState = initializeBoard();

// ─── POSITION HASHING (for threefold repetition) ──────────────────────────────
function getBoardKey() {
    let key = currentTurn + '|';
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            key += p ? `${p.color[0]}${p.type[0]}${p.hasMoved?1:0}` : '.';
        }
        key += '/';
    }
    return key;
}

function recordPosition() {
    const key = getBoardKey();
    positionHistory[key] = (positionHistory[key] || 0) + 1;
    return positionHistory[key];
}

// ─── INSUFFICIENT MATERIAL CHECK ──────────────────────────────────────────────
function isInsufficientMaterial() {
    const pieces = { white: [], black: [] };
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.type !== 'king') pieces[p.color].push({ type: p.type, x, y });
        }
    }
    const w = pieces.white;
    const b = pieces.black;

    // K vs K
    if (w.length === 0 && b.length === 0) return true;
    // K vs K+B or K vs K+N
    if (w.length === 0 && b.length === 1 && (b[0].type === 'bishop' || b[0].type === 'knight')) return true;
    if (b.length === 0 && w.length === 1 && (w[0].type === 'bishop' || w[0].type === 'knight')) return true;
    // K+B vs K+B same color squares
    if (w.length === 1 && b.length === 1 && w[0].type === 'bishop' && b[0].type === 'bishop') {
        const wLight = (w[0].x + w[0].y) % 2;
        const bLight = (b[0].x + b[0].y) % 2;
        if (wLight === bLight) return true;
    }
    return false;
}

// ─── MOVE PIECE ───────────────────────────────────────────────────────────────
function movePiece(fromX, fromY, toX, toY, moveDetails = null) {
    const movingPiece = gameState[fromY][fromX];
    const capturedPiece = gameState[toY][toX];

    // Castling: teleport the rook
    if (moveDetails && moveDetails.isCastle) {
        const rook = gameState[fromY][moveDetails.rookFromX];
        gameState[fromY][moveDetails.rookToX] = rook;
        gameState[fromY][moveDetails.rookFromX] = null;
        rook.hasMoved = true;
    }

    // En passant: remove the captured pawn
    if (moveDetails && moveDetails.isEnPassant) {
        gameState[moveDetails.captureY][moveDetails.captureX] = null;
    }

    // Execute the move
    gameState[toY][toX] = movingPiece;
    gameState[fromY][fromX] = null;
    gameState[toY][toX].hasMoved = true;

    lastMove = { piece: gameState[toY][toX], fromX, fromY, toX, toY };

    // Update half-move clock (reset on pawn move or capture, else increment)
    if (movingPiece.type === 'pawn' || capturedPiece || (moveDetails && moveDetails.isEnPassant)) {
        halfMoveClock = 0;
    } else {
        halfMoveClock++;
    }

    // Promotion check
    const isPromotionMove = movingPiece.type === 'pawn' && (toY === 0 || toY === 7);
    if (!isPromotionMove) {
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }

    return isPromotionMove;
}

// ─── PSEUDO-LEGAL MOVE GENERATION ────────────────────────────────────────────
function getPseudoLegalMoves(x, y, checkCastling = true) {
    const piece = gameState[y][x];
    if (!piece) return [];

    const moves = [];

    if (piece.type === 'pawn') {
        const direction = piece.color === 'white' ? -1 : 1;
        const startRow  = piece.color === 'white' ? 6 : 1;

        // Forward
        if (y + direction >= 0 && y + direction < 8) {
            if (gameState[y + direction][x] === null) {
                moves.push({ x, y: y + direction });
                if (y === startRow && gameState[y + 2 * direction][x] === null) {
                    moves.push({ x, y: y + direction * 2 });
                }
            }
        }
        // Diagonal captures
        for (const dx of [-1, 1]) {
            const nx = x + dx;
            const ny = y + direction;
            if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
                const target = gameState[ny][nx];
                if (target && target.color !== piece.color) moves.push({ x: nx, y: ny });
            }
        }
        // En passant
        if (lastMove) {
            for (const dx of [-1, 1]) {
                const nx = x + dx;
                if (nx < 0 || nx >= 8) continue;
                const adjacent = gameState[y][nx];
                if (adjacent && adjacent.color !== piece.color && adjacent.type === 'pawn'
                    && lastMove.toX === nx && lastMove.toY === y
                    && Math.abs(lastMove.fromY - lastMove.toY) === 2) {
                    moves.push({ x: nx, y: y + direction, isEnPassant: true, captureX: nx, captureY: y });
                }
            }
        }

    } else if (piece.type === 'knight') {
        for (const [dx, dy] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]) {
            const nx = x + dx, ny = y + dy;
            if (isValidLanding(nx, ny, piece.color)) moves.push({ x: nx, y: ny });
        }

    } else if (piece.type === 'bishop') {
        for (const [dx, dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
            let cx = x + dx, cy = y + dy;
            while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
                const t = gameState[cy][cx];
                if (t === null) { moves.push({ x: cx, y: cy }); cx += dx; cy += dy; }
                else { if (t.color !== piece.color) moves.push({ x: cx, y: cy }); break; }
            }
        }

    } else if (piece.type === 'rook') {
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            let cx = x + dx, cy = y + dy;
            while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
                const t = gameState[cy][cx];
                if (t === null) { moves.push({ x: cx, y: cy }); cx += dx; cy += dy; }
                else { if (t.color !== piece.color) moves.push({ x: cx, y: cy }); break; }
            }
        }

    } else if (piece.type === 'queen') {
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
            let cx = x + dx, cy = y + dy;
            while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
                const t = gameState[cy][cx];
                if (t === null) { moves.push({ x: cx, y: cy }); cx += dx; cy += dy; }
                else { if (t.color !== piece.color) moves.push({ x: cx, y: cy }); break; }
            }
        }

    } else if (piece.type === 'king') {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (isValidLanding(x + dx, y + dy, piece.color)) moves.push({ x: x + dx, y: y + dy });
            }
        }
        // Castling
        if (checkCastling && !piece.hasMoved) {
            const enemy = piece.color === 'white' ? 'black' : 'white';
            if (!isSquareAttacked(x, y, enemy)) {
                // Kingside
                const kRook = gameState[y][7];
                if (kRook && kRook.type === 'rook' && !kRook.hasMoved
                    && gameState[y][5] === null && gameState[y][6] === null
                    && !isSquareAttacked(5, y, enemy)) {
                    moves.push({ x: 6, y, isCastle: true, rookFromX: 7, rookToX: 5 });
                }
                // Queenside
                const qRook = gameState[y][0];
                if (qRook && qRook.type === 'rook' && !qRook.hasMoved
                    && gameState[y][1] === null && gameState[y][2] === null && gameState[y][3] === null
                    && !isSquareAttacked(3, y, enemy)) {
                    moves.push({ x: 2, y, isCastle: true, rookFromX: 0, rookToX: 3 });
                }
            }
        }
    }

    return moves;
}

function isValidLanding(tx, ty, myColor) {
    if (tx < 0 || tx >= 8 || ty < 0 || ty >= 8) return false;
    const t = gameState[ty][tx];
    return !t || t.color !== myColor;
}

function isSquareAttacked(tx, ty, enemyColor) {
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.color === enemyColor) {
                if (getPseudoLegalMoves(x, y, false).some(m => m.x === tx && m.y === ty)) return true;
            }
        }
    }
    return false;
}

function findKing(color) {
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++)
            if (gameState[y][x]?.type === 'king' && gameState[y][x]?.color === color)
                return { x, y };
    return null;
}

function getvalidMoves(x, y) {
    const piece = gameState[y][x];
    if (!piece) return [];

    const validMoves = [];
    for (const move of getPseudoLegalMoves(x, y)) {
        // Save
        const captured = gameState[move.y][move.x];
        let epCaptured = null;
        if (move.isEnPassant) { epCaptured = gameState[move.captureY][move.captureX]; gameState[move.captureY][move.captureX] = null; }

        gameState[move.y][move.x] = piece;
        gameState[y][x] = null;

        const kp = findKing(piece.color);
        const safe = kp && !isSquareAttacked(kp.x, kp.y, piece.color === 'white' ? 'black' : 'white');

        // Restore
        gameState[y][x] = piece;
        gameState[move.y][move.x] = captured;
        if (move.isEnPassant) gameState[move.captureY][move.captureX] = epCaptured;

        if (safe) validMoves.push(move);
    }
    return validMoves;
}

// ─── GAME OVER CHECK (checkmate, stalemate, draws) ───────────────────────────
function checkGameOver() {
    // 1. Threefold repetition
    const repCount = positionHistory[getBoardKey()] || 0;
    if (repCount >= 3) {
        setTimeout(() => showGameOverModal("Draw by Threefold Repetition!"), 100);
        return;
    }

    // 2. 50-move rule
    if (halfMoveClock >= 100) {  // 100 half-moves = 50 full moves
        setTimeout(() => showGameOverModal("Draw by 50-Move Rule!"), 100);
        return;
    }

    // 3. Insufficient material
    if (isInsufficientMaterial()) {
        setTimeout(() => showGameOverModal("Draw by Insufficient Material!"), 100);
        return;
    }

    // 4. Checkmate / Stalemate
    let hasAnyMove = false;
    outer: for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const p = gameState[y][x];
            if (p && p.color === currentTurn && getvalidMoves(x, y).length > 0) {
                hasAnyMove = true;
                break outer;
            }
        }
    }
    if (hasAnyMove) return;

    const kp = findKing(currentTurn);
    const enemy = currentTurn === 'white' ? 'black' : 'white';
    const inCheck = kp && isSquareAttacked(kp.x, kp.y, enemy);

    if (inCheck) {
        setTimeout(() => showGameOverModal(`Checkmate! ${enemy.toUpperCase()} Wins! ♛`), 100);
    } else {
        setTimeout(() => showGameOverModal("Stalemate! It's a Draw!"), 100);
    }
}