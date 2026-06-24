   
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isGameRunning = false;
let selectedSquare = null;
let currentValidMoves = [];

document.addEventListener('DOMContentLoaded', () => {
    const start = document.getElementById('startButton');
    const exit = document.getElementById('exitButton');
    const board = document.getElementById('chessboard');

    if (board) {
        board.addEventListener('click', (event) => {
            // Find the square wrapper, regardless of whether they clicked the piece or the empty space
            const clickedSquareDiv = event.target.closest('.square');
            
            // If they clicked the board border (not a square), ignore it
            if (!clickedSquareDiv) return; 

            // Pass the HTML div directly into your function
            handleSquareClick(clickedSquareDiv);
        });
    }

    if (start && board) {
        start.addEventListener('click', async () => {
            if (isGameRunning) return;
            board.style.display = 'grid';
            await startGame();
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

            const piece = gameState[y][x];
            if(piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `piece piece-${piece.color} ${piece.type}`;
                square.appendChild(pieceElement);
            }
            

            board.appendChild(square);
            await sleep(25);
        }
    }
    
    // Check if white is in check at game start
    updateCheckStatus();
    
    isGameRunning = false;          
}


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
        }
    }
}

function handleSquareClick(squareDiv) {
    const targetX = parseInt(squareDiv.dataset.x);
    const targetY = parseInt(squareDiv.dataset.y);
    const targetPiece = gameState[targetY][targetX]; // Fixed the extra spaces here too!

    if(targetPiece && targetPiece.color === currentTurn) {
        if (selectedSquare) {
            selectedSquare.classList.remove('selected');
            clearValidMoveHighlights();
        }
        squareDiv.classList.add('selected');    
        selectedSquare = squareDiv;   
        
        // FIX 1: Lowercase 'v' to match engine.js
        currentValidMoves = getvalidMoves(targetX, targetY); 
        highlightValidMoves(currentValidMoves);   
    }
    else if (selectedSquare) {  
        const isLegalMove = currentValidMoves.some(move => move.x === targetX && move.y === targetY);
        
        if (isLegalMove) {
            const fromX = parseInt(selectedSquare.dataset.x);
            const fromY = parseInt(selectedSquare.dataset.y);
            movePiece(fromX, fromY, targetX, targetY);

            selectedSquare.classList.remove('selected');    
            selectedSquare = null;
            clearValidMoveHighlights();
            currentValidMoves = [];
            
            // FIX 3: Actually redraw the board so the piece moves!
            renderBoard();
            
            // Update check status for the new player
            updateCheckStatus();
        }
        else {
            selectedSquare.classList.remove('selected');    
            selectedSquare = null;
            clearValidMoveHighlights();
            currentValidMoves = [];
        }
    }
}

function highlightValidMoves(moves) {
    for(let move of moves) {    
        // FIX 2: Spelled "document" correctly
        const squareDiv = document.querySelector(`.square[data-x="${move.x}"][data-y="${move.y}"]`);     
        if(squareDiv) squareDiv.classList.add('valid-move');
    }   
}

function clearValidMoveHighlights() {
    const highlightedSquares = document.querySelectorAll('.square.valid-move');
    highlightedSquares.forEach(square => square.classList.remove('valid-move'));
}

function updateCheckStatus() {
    // Remove previous check highlights
    const checkedSquares = document.querySelectorAll('.square.in-check');
    checkedSquares.forEach(square => square.classList.remove('in-check'));
    
    // Find current player's king
    const kingPos = findKing(currentTurn);
    if (!kingPos) return; // King not found (shouldn't happen)
    
    // Get enemy color
    const enemyColor = currentTurn === 'white' ? 'black' : 'white';
    
    // Check if king is under attack
    const kingInCheck = isSquareAttacked(kingPos.x, kingPos.y, enemyColor);
    
    if (kingInCheck) {
        // Highlight the king's square in red
        const kingSquare = document.querySelector(`.square[data-x="${kingPos.x}"][data-y="${kingPos.y}"]`);
        if (kingSquare) {
            kingSquare.classList.add('in-check');
        }
    }
}