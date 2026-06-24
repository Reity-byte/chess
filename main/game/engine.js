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