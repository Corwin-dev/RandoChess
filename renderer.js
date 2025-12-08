// ===== Board Renderer =====
// Pure UI rendering with no game logic

class BoardRenderer {
    constructor(boardElement) {
        this.boardElement = boardElement;
        this.playerColor = null; // 'white', 'black', or null for white's perspective
        this.selectedSquare = null; // {row, col}
        this.validMoves = []; // [{row, col}]
        this.theoreticalMoves = new Map(); // position -> {canMove, canCapture}
        this.onSquareClick = null; // Callback for square clicks
    }

    setPlayerColor(color) {
        this.playerColor = color;
    }

    setSelection(square, validMoves = [], theoreticalMoves = new Map()) {
        this.selectedSquare = square;
        this.validMoves = validMoves;
        this.theoreticalMoves = theoreticalMoves;
    }

    clearSelection() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.theoreticalMoves = new Map();
    }

    // Render the board state
    render(board) {
        this.boardElement.innerHTML = '';

        // Render from player's perspective
        const startRow = this.playerColor === 'black' ? 7 : 0;
        const endRow = this.playerColor === 'black' ? -1 : 8;
        const rowStep = this.playerColor === 'black' ? -1 : 1;
        const startCol = this.playerColor === 'black' ? 7 : 0;
        const endCol = this.playerColor === 'black' ? -1 : 8;
        const colStep = this.playerColor === 'black' ? -1 : 1;

        for (let row = startRow; row !== endRow; row += rowStep) {
            for (let col = startCol; col !== endCol; col += colStep) {
                const square = document.createElement('div');
                square.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
                square.dataset.row = row;
                square.dataset.col = col;

                const cellData = board[row][col];
                if (cellData) {
                    const piece = document.createElement('span');
                    piece.className = `piece ${cellData.color}`;
                    if (cellData.piece.royal) {
                        piece.classList.add('royal');
                    }
                    piece.textContent = cellData.piece.name;
                    square.appendChild(piece);
                }

                // Highlight selected square
                if (this.selectedSquare && this.selectedSquare.row === row && this.selectedSquare.col === col) {
                    square.classList.add('selected');
                }

                // Show valid moves
                const isValidMove = this.validMoves.some(m => m.row === row && m.col === col);
                if (isValidMove) {
                    square.classList.add('valid-move');
                }

                // Show theoretical moves (hints)
                const key = `${row},${col}`;
                const theoreticalMove = this.theoreticalMoves.get(key);
                if (theoreticalMove) {
                    const dot = document.createElement('div');
                    // Color code based on move type
                    if (theoreticalMove.canMove && theoreticalMove.canCapture) {
                        dot.className = 'move-dot move-both';
                    } else if (theoreticalMove.canCapture) {
                        dot.className = 'move-dot move-capture-only';
                    } else if (theoreticalMove.canMove) {
                        dot.className = 'move-dot move-move-only';
                    }
                    square.appendChild(dot);
                }

                this.boardElement.appendChild(square);
            }
        }
    }

    // Attach click event listener
    attachEventListener(callback) {
        this.onSquareClick = callback;
        
        this.boardElement.addEventListener('click', (e) => {
            const square = e.target.closest('.square');
            if (!square) return;

            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);

            if (this.onSquareClick) {
                this.onSquareClick(row, col);
            }
        });
    }
}

// UI Manager for messages and controls
class UIManager {
    constructor() {
        this.messageElement = document.getElementById('message');
        this.turnElement = document.getElementById('current-turn');
        this.searchButton = document.getElementById('search-opponent-btn');
    }

    showMessage(msg, duration = 3000) {
        if (this.messageElement) {
            this.messageElement.textContent = msg;
            
            if (duration > 0) {
                setTimeout(() => {
                    this.clearMessage();
                }, duration);
            }
        }
    }

    clearMessage() {
        if (this.messageElement) {
            this.messageElement.textContent = '';
        }
    }

    updateTurn(color) {
        if (this.turnElement) {
            this.turnElement.textContent = color.charAt(0).toUpperCase() + color.slice(1);
        }
    }

    disableSearchButton() {
        if (this.searchButton) {
            this.searchButton.disabled = true;
            this.searchButton.textContent = 'Searching...';
        }
    }

    hideSearchButton() {
        if (this.searchButton) {
            this.searchButton.style.display = 'none';
        }
    }

    showSearchButton() {
        if (this.searchButton) {
            this.searchButton.style.display = 'block';
            this.searchButton.disabled = false;
            this.searchButton.textContent = 'Search for Opponent';
        }
    }

    onSearchClick(callback) {
        if (this.searchButton) {
            this.searchButton.addEventListener('click', callback);
        }
    }
}
