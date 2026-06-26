// White's perspective (y=0 is the top of the board, y=7 is the bottom)
const pawnEvalWhite = [
    [  0,  0,  0,  0,  0,  0,  0,  0],
    [ 50, 50, 50, 50, 50, 50, 50, 50],
    [ 10, 10, 20, 30, 30, 20, 10, 10],
    [  5,  5, 10, 25, 25, 10,  5,  5],
    [  0,  0,  0, 20, 20,  0,  0,  0],
    [  5, -5,-10,  0,  0,-10, -5,  5],
    [  5, 10, 10,-20,-20, 10, 10,  5],
    [  0,  0,  0,  0,  0,  0,  0,  0]
];

const knightEval = [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
];

const bishopEval = [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
];

// Rook Table: Encourages getting to the 7th rank and staying centralized
const rookEval = [
    [  0,  0,  0,  0,  0,  0,  0,  0],
    [  5, 10, 10, 10, 10, 10, 10,  5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [  0,  0,  0,  5,  5,  0,  0,  0]
];

// Queen Table: Mostly keeps her away from the corners
const queenEval = [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
];

// King (Midgame) Table: Heavily encourages castling and hiding in the corners!
const kingEval = [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20]
];

function evaluateBoard()
{
    let evalscore = 0;
    for (let y = 0; y < 8; y++)
    {
        for(let x = 0; x < 8; x++)
        {
            const piece = gameState[y][x];
            if(piece)
            {
                let pieceValue = 0;
            if(piece && piece.type === 'pawn')
            {
                pieceValue += 100;
            }
            if(piece && piece.type === 'rook')
            {
                pieceValue += 500;
            }
            if(piece && piece.type === 'knight')
            {
                pieceValue += 300; 
            }
            if(piece && piece.type === 'bishop')
            {
                pieceValue += 330;
            }
            if(piece && piece.type === 'queen')
            {
                pieceValue += 900;
            }
            if(piece && piece.type === 'king')
            {
                pieceValue += 10000;
            }

            let positionalBonus = 0;

            const rank = piece.color === 'white' ? y: (7 - y);

            if (piece.type === 'pawn')
            {
                positionalBonus = pawnEvalWhite[rank][x];
            }
            else if(piece.type === 'knight')
            {
                positionalBonus = knightEval[rank][x];
            }
            else if(piece.type === 'bishop')
            {
                positionalBonus = bishopEval[rank][x];
            }
            else if(piece.type === 'rook')
            {
                positionalBonus = rookEval[rank][x];
            }
            else if(piece.type === 'queen')
            {
                positionalBonus = queenEval[rank][x];
            }
            else if(piece.type === 'king')
            {
                positionalBonus = kingEval[rank][x];
            }

            pieceValue += positionalBonus;

            if(piece.color === 'white')
            {
                evalscore += pieceValue;
            }
            else
            {
                evalscore -= pieceValue;
            }
            }
        }
    }
    return evalscore;
}

function getAllValidMoves(color)
{
    const allMoves = [];

    for(let y = 0; y < 8; y++)
    {
        for (let x = 0; x < 8; x++)
        {
            const piece = gameState[y][x];
            if(piece && piece.color === color)
            {
                const moves = getvalidMoves(x,y);

                for(let move of moves)
                {
                    allMoves.push({
                        fromX: x,
                        fromY: y,
                        toX: move.x,
                        toY: move.y,
                        details: move //secret flags here!!
                    });
                }
            }
        }
    }

    return allMoves;
}

function cloneGameState(state)
{
    const clone = [];

    for(let y = 0; y < 8; y++)
    {
        let row = [];
        for(let x = 0; x < 8; x++)
        {
            if(state[y][x])
            {
                let p = new ChessPiece(state[y][x].type, state[y][x].color);
                p.hasMoved = state[y][x].hasMoved;
                row.push(p);
            }
            else
            {
                row.push(null);
            }
        }
        clone.push(row);
    }
    return clone;
}

function minimax(depth, isMaximizingPlayer)
{
    if(depth === 0)
    {
        return evaluateBoard();
    }

    const possibleMoves = getAllValidMoves(currentTurn);

    if (possibleMoves.length === 0) return evaluateBoard();

    const savedState = cloneGameState(gameState);
    const savedTurn = currentTurn;
    const savedLastMove = lastMove ? { ...lastMove } :null;

    if(isMaximizingPlayer)
    {
        let bestScore = -Infinity;

        for(let move of possibleMoves)
        {
            movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);

            if (gameState[move.toY][move.toX].type === 'pawn' && (move.toY === 0 || move.toY === 7))
            {
                gameState[move.toY][move.toX].type = 'queen';
                currentTurn = 'black';
            }

            let score = minimax(depth - 1, false);

            bestScore = Math.max(bestScore, score);

            gameState = cloneGameState(savedState);
            currentTurn = savedTurn;
            lastMove = savedLastMove;
        }
        return bestScore;
    }
    else
    {
        let bestScore = +Infinity; // Start at the best possible score
        
        for (let move of possibleMoves) {
            
            // A. PLAY THE MOVE
            movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);
            
            // Auto-Queen for the AI so it doesn't get stuck on the modal
            if (gameState[move.toY][move.toX].type === 'pawn' && (move.toY === 0 || move.toY === 7)) {
                gameState[move.toY][move.toX].type = 'queen';
                currentTurn = 'white'; // Force turn change
            }

            let score = minimax(depth - 1, true);
            
            bestScore = Math.min(bestScore, score);
            
            gameState = cloneGameState(savedState);
            currentTurn = savedTurn;
            lastMove = savedLastMove ? { ...savedLastMove } : null;
        }
        return bestScore;
    }
}

function makeAIMove()
{
    console.log("AI is thinking....");

    const possibleMoves = getAllValidMoves('black');

    if(possibleMoves.length === 0) return;

    let bestScore = +Infinity
    let bestMove = null;

    for(let move of possibleMoves)
    {
        const savedState = cloneGameState(gameState);
        const savedTurn = currentTurn;
        const savedLastMove = lastMove ? { ...lastMove } : null;

        movePiece(move.fromX, move.fromY, move.toX, move.toY, move.details);
        
        if (gameState[move.toY][move.toX].type === 'pawn' && (move.toY === 7)) {
            gameState[move.toY][move.toX].type = 'queen';
            currentTurn = 'white';
        }

        let score = minimax(2, true);

        gameState = cloneGameState(savedState);
        currentTurn = savedTurn;
        lastMove = savedLastMove ? { ...lastMove } : null;

        if(score < bestScore)
        {
            bestScore = score;
            bestMove = move;
        }
    }

    if(bestMove)
    {
        console.log(`AI chose move with score: ${bestScore}`);
        movePiece(bestMove.fromX, bestMove.fromY, bestMove.toX, bestMove.toY, bestMove.details);

        if (gameState[bestMove.toY][bestMove.toX].type === 'pawn' && bestMove.toY === 7) {
            gameState[bestMove.toY][bestMove.toX].type = 'queen';
            currentTurn = 'white'; 
        }
    }
}