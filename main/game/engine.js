class ChessPiece {      
    constructor(type, color) {
        this.type = type;
        this.color = color;
        this.hasMoved = false;
    }
}

let currentTurn = 'white';
let lastMove = null;

function initializeBoard() {        
    const board = [];   

    for(let y = 0; y < 8; y++) {
        const row = [];
        for(let x = 0; x < 8; x++) {
            row.push(null);
        }   
        board.push(row);    
    }

    let backRowLayout = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

    for(let x = 0; x < 8; x++) {    
        board[0][x] = new ChessPiece(backRowLayout[x], 'black');
        board[1][x] = new ChessPiece('pawn', 'black');
        board[6][x] = new ChessPiece('pawn', 'white');
        board[7][x] = new ChessPiece(backRowLayout[x], 'white');
    }
    
    return board;       
}

let gameState = initializeBoard();

function movePiece(fromX, fromY, toX, toY, moveDetails = null) {
    
    // 1. Check if this is a Castling move!
    if (moveDetails && moveDetails.isCastle) {
        // Teleport the Rook!
        const rook = gameState[fromY][moveDetails.rookFromX];
        gameState[fromY][moveDetails.rookToX] = rook;
        gameState[fromY][moveDetails.rookFromX] = null;
        rook.hasMoved = true;
    }

    if(moveDetails && moveDetails.isEnPassant)
    {
        gameState[moveDetails.captureY][moveDetails.captureX] = null;
    }


    // 2. Normal move execution (King or any other piece)
    gameState[toY][toX] = gameState[fromY][fromX];
    gameState[fromY][fromX] = null;
    gameState[toY][toX].hasMoved = true;
    
    lastMove = {
        piece: gameState[toY][toX],
        fromX: fromX,
        fromY: fromY,
        toX: toX,
        toY: toY
    };

    // --- PAWN PROMOTION CHECK ---
    let isPromotionMove = false;
    if (gameState[toY][toX].type === 'pawn') {
        if (toY === 0 || toY === 7) {
            isPromotionMove = true;
        }
    }

    // ONLY change the turn if we are NOT promoting.
    // If we are, we wait for the modal to change the turn!
    if (!isPromotionMove) {
        currentTurn = currentTurn === 'white' ? 'black' : 'white';
    }

    return isPromotionMove; // We return this to tell game-script.js what to do!
}

function getPseudoLegalMoves(x, y, checkCastling = true) {
    const piece = gameState[y][x];
    if (!piece) return [];

    const moves = [];
    if (piece.type === 'pawn') {
        const direction = piece.color === 'white' ? -1 : 1;
        const startRow = piece.color === 'white' ? 6 : 1;

        if(y + direction >= 0 && y + direction < 8) {   
            if (gameState[y + direction][x] === null) { 
                moves.push({ x: x, y: y + direction });
                if (y === startRow && gameState[y + 2 * direction][x] === null) {
                    moves.push({ x: x, y: y + direction * 2 });
                }
            }
        }
        if(x - 1 >= 0 && y + direction >= 0 && y + direction < 8) {
            const targetLeft = gameState[y + direction][x - 1];
            if (targetLeft && targetLeft.color !== piece.color) {
                moves.push({ x: x - 1, y: y + direction });
            }
        }
        if(x + 1 < 8 && y + direction >= 0 && y + direction < 8) {
            const targetRight = gameState[y + direction][x + 1];
            if (targetRight && targetRight.color !== piece.color) {
                moves.push({ x: x + 1, y: y + direction });
            }
        }
        // --- EN PASSANT ---
        if (lastMove) {
            
            // 1. LEFT SIDE EN PASSANT
            if (x - 1 >= 0) { // Don't fall off the left edge!
                const leftPiece = gameState[y][x - 1];

                // Is there a piece? Is it an ENEMY? Is it a PAWN?
                if (leftPiece && leftPiece.color !== piece.color && leftPiece.type === 'pawn') {
                    
                    // Was THIS EXACT square the destination of the last move?
                    if (lastMove.toX === x - 1 && lastMove.toY === y) {
                        
                        // Did that pawn do a double-jump?
                        if (Math.abs(lastMove.fromY - lastMove.toY) === 2) {
                            
                            // It's a legal En Passant!
                            moves.push({ 
                                x: x - 1, 
                                y: y + direction, 
                                isEnPassant: true, 
                                captureX: x - 1, 
                                captureY: y 
                            });
                        }
                    }
                }
            }
            //2. RIGHT SIDE EN PASSANT
            if(x + 1 >= 0)
            {
                const rightPiece = gameState[y][x + 1];
                if(rightPiece && rightPiece.color !== piece.color && rightPiece.type === 'pawn')
                {
                    if(lastMove.toX === x + 1 && lastMove.toY === y)
                    {
                        if(Math.abs(lastMove.fromY - lastMove.toY) === 2)
                        {
                            moves.push({
                                x: x + 1,
                                y: y + direction,
                                isEnPassant: true,
                                captureX: x - 1,
                                captureY: y
                            });
                        }
                    }
                }
            }
        }
    } else if (piece.type === 'rook') {
    
    // 1. Raycast RIGHT (+x)
    let currentX = x + 1;
    while (currentX < 8) {
        const targetSquare = gameState[y][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: y });
            currentX++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: y });
            break; 
        }
    }

    // 2. Raycast LEFT (-x)
    currentX = x - 1;
    while (currentX >= 0) {
        const targetSquare = gameState[y][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: y });
            currentX--; // Notice we subtract here!
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: y });
            break; 
        }
    }

    // 3. Raycast DOWN (+y)
    let currentY = y + 1;
    while (currentY < 8) {
        const targetSquare = gameState[currentY][x]; // Notice y is changing, x is static
        if (targetSquare === null) {
            moves.push({ x: x, y: currentY });
            currentY++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: x, y: currentY });
            break; 
        }
    }

    // 4. Raycast UP (-y)
    currentY = y - 1;
    while (currentY >= 0) {
        const targetSquare = gameState[currentY][x];
        if (targetSquare === null) {
            moves.push({ x: x, y: currentY });
            currentY--; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: x, y: currentY });
            break; 
        }
    }

    }
        else if (piece.type === 'knight') {
        const knightMoves = [
            [2, 1], [2, -1], [-2, +1], [-2, -1],
            [1, 2], [1, -2], [-1, 2], [-1, -2]
        ];

        for(let offset of knightMoves) {    
            const newX = x + offset[0];
            const newY = y + offset[1];
            if(isValidLanding(newX, newY, piece.color)) {
                moves.push({ x: newX, y: newY });
            }
        }
    } else if (piece.type === 'bishop') {

    // 1. Raycast DOWN-RIGHT (+x, +y)
    let currentX = x + 1;
    let currentY = y + 1;
    
    // We must check BOTH boundaries!
    while (currentX < 8 && currentY < 8) {
        const targetSquare = gameState[currentY][currentX]; 
        
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            
            // Increment BOTH to keep moving diagonally
            currentX++; 
            currentY++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }
    }

    // 2. Raycast DOWN-LEFT (-x, +y)
    currentX = x - 1;
    currentY = y + 1;
    while (currentX >= 0 && currentY < 8) {
        const targetSquare = gameState[currentY][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            currentX--; 
            currentY++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }
    }
    // 3. Raycast UP-RIGHT (+x, -y)
    currentX = x + 1;
    currentY = y - 1;
    while (currentX < 8 && currentY >= 0) {
        const targetSquare = gameState[currentY][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            currentX++; 
            currentY--; 
        }
        else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }   
    }
    // 4. Raycast UP-LEFT (-x, -y)
    currentX = x - 1;
    currentY = y - 1;
    while (currentX >= 0 && currentY >= 0) {
        const targetSquare = gameState[currentY][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            currentX--; 
            currentY--; 
        }
        else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }
    }

    } else if (piece.type === 'queen') {
        // 1. Raycast RIGHT (+x)
    let currentX = x + 1;
    while (currentX < 8) {
        const targetSquare = gameState[y][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: y });
            currentX++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: y });
            break; 
        }
    }

    // 2. Raycast LEFT (-x)
    currentX = x - 1;
    while (currentX >= 0) {
        const targetSquare = gameState[y][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: y });
            currentX--; // Notice we subtract here!
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: y });
            break; 
        }
    }

    // 3. Raycast DOWN (+y)
    let currentY = y + 1;
    while (currentY < 8) {
        const targetSquare = gameState[currentY][x]; // Notice y is changing, x is static
        if (targetSquare === null) {
            moves.push({ x: x, y: currentY });
            currentY++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: x, y: currentY });
            break; 
        }
    }

    // 4. Raycast UP (-y)
    currentY = y - 1;
    while (currentY >= 0) {
        const targetSquare = gameState[currentY][x];
        if (targetSquare === null) {
            moves.push({ x: x, y: currentY });
            currentY--; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: x, y: currentY });
            break; 
        }
    }

    // 1. Raycast DOWN-RIGHT (+x, +y)
    currentX = x + 1;
    currentY = y + 1;
    
    // We must check BOTH boundaries!
    while (currentX < 8 && currentY < 8) {
        const targetSquare = gameState[currentY][currentX]; 
        
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            
            // Increment BOTH to keep moving diagonally
            currentX++; 
            currentY++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }
    }

    // 2. Raycast DOWN-LEFT (-x, +y)
    currentX = x - 1;
    currentY = y + 1;
    while (currentX >= 0 && currentY < 8) {
        const targetSquare = gameState[currentY][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            currentX--; 
            currentY++; 
        } else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }
    }
    // 3. Raycast UP-RIGHT (+x, -y)
    currentX = x + 1;
    currentY = y - 1;
    while (currentX < 8 && currentY >= 0) {
        const targetSquare = gameState[currentY][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            currentX++; 
            currentY--; 
        }
        else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }   
    }
    // 4. Raycast UP-LEFT (-x, -y)
    currentX = x - 1;
    currentY = y - 1;
    while (currentX >= 0 && currentY >= 0) {
        const targetSquare = gameState[currentY][currentX];
        if (targetSquare === null) {
            moves.push({ x: currentX, y: currentY });
            currentX--; 
            currentY--; 
        }
        else {
            if (targetSquare.color !== piece.color) moves.push({ x: currentX, y: currentY });
            break; 
        }
    }

    } else if (piece.type === 'king') {
        
        // 1. Standard Movement
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const newX = x + dx;
                const newY = y + dy;
                // piece.color is passed here
                if(isValidLanding(newX, newY, piece.color)) {
                    moves.push({ x: newX, y: newY });
                }
            }
        }

        // 2. Special Move: Castling (Outside the dx/dy loops!)
        if (checkCastling && piece.hasMoved === false) {
            
            const enemyColor = piece.color === 'white' ? 'black' : 'white';

            // Castling Rule: You cannot castle OUT of check!
            if (isSquareAttacked(x, y, enemyColor) === false) {
                
                // --- KINGSIDE (Right) ---
                const rightRook = gameState[y][7];
                if (rightRook && rightRook.type === 'rook' && rightRook.hasMoved === false) {
                    
                    if (gameState[y][5] === null && gameState[y][6] === null) {
                        // Is the square the King skips over safe?
                        if (isSquareAttacked(5, y, enemyColor) === false) {
                            
                            // Valid! The King lands on 6. Include the special flags!
                            moves.push({ 
                                x: 6, 
                                y: y, 
                                isCastle: true, 
                                rookFromX: 7, 
                                rookToX: 5 
                            });
                        }
                    }
                }

                // --- QUEENSIDE (Left) --- (Independent IF statement!)
                const leftRook = gameState[y][0];
                if (leftRook && leftRook.type === 'rook' && leftRook.hasMoved === false) {
                    
                    if (gameState[y][1] === null && gameState[y][2] === null && gameState[y][3] === null) {
                        // Is the square the King skips over safe?
                        if (isSquareAttacked(3, y, enemyColor) === false) {
                            
                            // Valid! The King lands on 2. Include the special flags!
                            moves.push({ 
                                x: 2, 
                                y: y, 
                                isCastle: true, 
                                rookFromX: 0, 
                                rookToX: 3 
                            });
                        }
                    }
                }
            }
        }
    }

    return moves;
}

function isValidLanding(targetX, targetY, myColor) {
    if (targetX < 0 || targetX >= 8 || targetY < 0 || targetY >= 8) {
        return false;
    }

    const targetPiece = gameState[targetY][targetX];
    if (targetPiece) {
        return targetPiece.color !== myColor;
    }

    return true;
}

function isSquareAttacked(targetX, targetY, enemyColor)
{
    for (let y = 0; y < 8; y++)
    {
        for (let x = 0; x < 8; x++)
        {
           const piece = gameState[y][x]; 
           
           if(piece && piece.color === enemyColor)
           {
            // Pass FALSE here to prevent the infinite loop!
            const enemyMoves = getPseudoLegalMoves(x, y, false);

            const hitsTarget = enemyMoves.some(move => move.x === targetX && move.y === targetY);
            if (hitsTarget)
            {
                return true;
            }
           }
        }
    }
    return false;
}

function findKing(color){
    for (let y = 0; y < 8; y++)
    {
        for (let x = 0; x < 8; x++)
        {
            const piece = gameState[y][x];
            if(piece && piece.type === 'king' && piece.color === color){
                return {x:x, y:y};
            }
        }
    }
    return null;
}

function getvalidMoves(x, y){
    const piece = gameState[y][x];
    if (!piece) return [];
    
    const pseudoLegal = getPseudoLegalMoves(x, y);
    const validMoves = [];
    
    // For each pseudo-legal move, simulate it and check if king is in check
    for (let move of pseudoLegal) {
        // Save the state
        const capturedPiece = gameState[move.y][move.x];
        
        // Make the move
        gameState[move.y][move.x] = piece;
        gameState[y][x] = null;
        
        // Find our king
        const kingPos = findKing(piece.color);
        const enemyColor = piece.color === 'white' ? 'black' : 'white';
        
        // Check if king is under attack
        const kingInCheck = isSquareAttacked(kingPos.x, kingPos.y, enemyColor);
        
        // Undo the move
        gameState[y][x] = piece;
        gameState[move.y][move.x] = capturedPiece;
        
        // If move doesn't leave king in check, it's legal
        if (!kingInCheck) {
            validMoves.push(move);
        }
    }
    
    return validMoves;
}

function checkGameOver(){
    let hasAnyValidMoves = false;

    for(let y = 0; y < 8; y++)
    {
        for(let x = 0; x < 8; x++)
        {
            const piece = gameState[y][x];

            if(piece && piece.color === currentTurn)
            {
                const moves = getvalidMoves(x, y);

                if(moves.length > 0)
                {
                    hasAnyValidMoves = true;
                    break; //Found at least one move
                }  
            }
        }
        if(hasAnyValidMoves) break;
    }
    if(hasAnyValidMoves) return;
    
    const kingPos = findKing(currentTurn);
    const enemyColor = currentTurn === 'white' ? 'black' : 'white';

    const isCheck = isSquareAttacked(kingPos.x, kingPos.y, enemyColor);

    if (isCheck) {
        console.log(`RESULT: Checkmate! ${enemyColor} wins!`);
        // Use the new modal instead of alert!
        setTimeout(() => showGameOverModal(`Checkmate! ${enemyColor.toUpperCase()} Wins!`), 100);
    } else {
        console.log(`RESULT: Stalemate!`);
        // Use the new modal instead of alert!
        setTimeout(() => showGameOverModal("Stalemate! It's a draw!"), 100);
    }
}
