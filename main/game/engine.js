class ChessPiece {      
    constructor(type, color) {
        this.type = type;
        this.color = color;
        this.hasMoved = false;
    }
}

let currentTurn = 'white';

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

function movePiece(fromX, fromY, toX, toY) {
    gameState[toY][toX] = gameState[fromY][fromX];
    gameState[fromY][fromX] = null;
    gameState[toY][toX].hasMoved = true;
    currentTurn = currentTurn === 'white' ? 'black' : 'white';
}

function getPseudoLegalMoves(x, y) {
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
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const newX = x + dx;
                const newY = y + dy;
                if(isValidLanding(newX, newY, piece.color)) {
                    moves.push({ x: newX, y: newY });
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
            const enemyMoves = getPseudoLegalMoves(x,y);

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
