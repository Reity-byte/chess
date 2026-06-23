const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isGameRunning = false;

document.addEventListener('DOMContentLoaded', () => {
    const start = document.getElementById('startButton');
    const exit = document.getElementById('exitButton');
    const board = document.getElementById('chessboard');

    if (start && board) {
        start.addEventListener('click', async () => {
            if (isGameRunning) return;
            board.style.display = 'grid';
            await startGame();
            renderBoard();
        });
    }

    if (exit) {
        exit.addEventListener('click', () => {
            location.href = '../site.html';
        });
    }
});

async function startGame() {
    isGameRunning = true;          
    const board = document.getElementById('chessboard');
    
    board.innerHTML = '';

    for(let y = 0; y < 8; y++) {
        for(let x = 0; x < 8; x++) {
            let square = document.createElement('div');
            square.className = 'square';

            square.dataset.x = x;
            square.dataset.y = y;

            if((x + y) % 2 === 0) {
                square.classList.add('white');
            } else {
                square.classList.add('black');
            }
            
            board.appendChild(square);

            await sleep(25);
        }
    }
    isGameRunning = false;          
}

class ChessPiece {      
    constructor(type, color) {
        this.type = type;
        this.color = color;
        this.hasMoved = false;
    }
}

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

async function renderBoard() {
    for(let y = 0; y < 8; y++) {        
        for(let x = 0; x < 8; x++) {    
            const square = document.querySelector(`.square[data-x="${x}"][data-y="${y}"]`);
            square.innerHTML = '';
            const piece = gameState[y][x];
            if(piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece piece-${piece.color} ${piece.type}`;
                square.appendChild(pieceElement);
            }  
            await sleep(25);
        }
    }
}