   
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isGameRunning = false;
let selectedSquare = null;
let currentValidMoves = [];
let promoTargetX = null;
let promoTargetY = null;

document.addEventListener('DOMContentLoaded', () => {
    const start = document.getElementById('startButton');
    const exit = document.getElementById('exitButton');
    const board = document.getElementById('chessboard');
    const restartBtn = document.getElementById('restartButton');
    const closeBtn = document.getElementById('closeModalButton');
    const modal = document.getElementById('gameOverModal');

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

    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            // The cleanest way to restart the game is just to reload the page!
            location.reload(); 
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden'); // Just hide the modal to let them look at the final board
        });
    }

    const promoPieces = document.querySelectorAll('.promo-piece');
    promoPieces.forEach(img => {
        img.addEventListener('click', (event) => {
            const chosenType = event.target.getAttribute('data-type');
            completePromotion(chosenType);
        });
    });
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
    const targetPiece = gameState[targetY][targetX]; 

    if(targetPiece && targetPiece.color === currentTurn) {
        if (selectedSquare) {
            selectedSquare.classList.remove('selected');
            clearValidMoveHighlights();
        }
        squareDiv.classList.add('selected');    
        selectedSquare = squareDiv;   
        
        currentValidMoves = getvalidMoves(targetX, targetY); 
        highlightValidMoves(currentValidMoves);   
    }
    else if (selectedSquare) {  
        
        // --- THIS IS THE CHANGED PART ---
        // We use .find() instead of .some() to grab the actual move object!
        const chosenMove = currentValidMoves.find(move => move.x === targetX && move.y === targetY);
        
        // If chosenMove exists, it was a legal move!
        if (chosenMove) {
            const fromX = parseInt(selectedSquare.dataset.x);
            const fromY = parseInt(selectedSquare.dataset.y);
            
            // Capture whether the move resulted in a promotion
            const isPromoting = movePiece(fromX, fromY, targetX, targetY, chosenMove);

            selectedSquare.classList.remove('selected');    
            selectedSquare = null;
            clearValidMoveHighlights();
            currentValidMoves = [];
            
            renderBoard(); // Render the pawn landing on the final square
            
            if (isPromoting) {
                // Pause the game flow and ask the user what they want!
                showPromotionModal(targetX, targetY, currentTurn);
            } else {
                // Not a promotion. Finish turn normally!
                if (typeof updateCheckStatus === 'function') updateCheckStatus();
                checkGameOver();
            }
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

function showGameOverModal(message) {
    const modal = document.getElementById('gameOverModal');
    const messageElement = document.getElementById('modalMessage');
    
    // Set the winning/drawing text
    messageElement.textContent = message;
    
    // Unhide the modal
    modal.classList.remove('hidden');
}

function showPromotionModal(x, y, color) {
    promoTargetX = x;
    promoTargetY = y;
    
    // The image paths differ based on your folder structure, usually 'pieces/queen-w.png'
    const suffix = color === 'white' ? 'w' : 'b';
    
    document.getElementById('promo-queen').src = `pieces/queen-${suffix}.png`;
    document.getElementById('promo-rook').src = `pieces/rook-${suffix}.png`;
    document.getElementById('promo-bishop').src = `pieces/bishop-${suffix}.png`;
    document.getElementById('promo-knight').src = `pieces/knight-${suffix}.png`;

    document.getElementById('promotionModal').classList.remove('hidden');
}

function completePromotion(pieceType) {
    // 1. Transform the pawn into the selected piece
    gameState[promoTargetY][promoTargetX].type = pieceType;

    // 2. Hide the modal
    document.getElementById('promotionModal').classList.add('hidden');

    // 3. Now that the choice is made, manually flip the turn!
    currentTurn = currentTurn === 'white' ? 'black' : 'white';

    // 4. Finish the visual updates
    renderBoard();
    if (typeof updateCheckStatus === 'function') updateCheckStatus();
    checkGameOver();
}