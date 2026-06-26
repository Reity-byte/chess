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
                positionalBonus = queenEval[rank][x];
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