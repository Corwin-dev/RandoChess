// ===== Board Renderer =====
// Pure UI rendering with no game logic

class BoardRenderer {
    constructor(boardElement) {
        this.boardElement = boardElement;
        this.movementOverlay = document.getElementById('movement-overlay');
        this.playerColor = null; // 'white', 'black', or null for white's perspective
        this.selectedSquare = null; // {row, col}
        this.validMoves = []; // [{row, col}]
        this.theoreticalMoves = new Map(); // position -> {canMove, canCapture}
        this.unrestrictedPattern = new Map(); // Extended pattern for visualization
        this.onSquareClick = null; // Callback for square clicks
    }

    setPlayerColor(color) {
        this.playerColor = color;
    }

    setSelection(square, validMoves = [], theoreticalMoves = new Map(), unrestrictedPattern = new Map()) {
        this.selectedSquare = square;
        this.validMoves = validMoves;
        this.theoreticalMoves = theoreticalMoves;
        this.unrestrictedPattern = unrestrictedPattern;
        this.renderMovementOverlay();
    }

    clearSelection() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.theoreticalMoves = new Map();
        this.unrestrictedPattern = new Map();
        this.renderMovementOverlay();
    }

    // Render the extended movement pattern overlay
    renderMovementOverlay() {
        if (!this.movementOverlay) return;
        
        this.movementOverlay.innerHTML = '';
        
        if (!this.selectedSquare || this.unrestrictedPattern.size === 0) {
            this.movementOverlay.style.display = 'none';
            return;
        }
        
        this.movementOverlay.style.display = 'grid';
        
        // Calculate grid bounds based on movement pattern
        let minRow = this.selectedSquare.row;
        let maxRow = this.selectedSquare.row;
        let minCol = this.selectedSquare.col;
        let maxCol = this.selectedSquare.col;
        
        for (const key of this.unrestrictedPattern.keys()) {
            const [row, col] = key.split(',').map(Number);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
        }
        
        // Ensure we show at least some context
        minRow = Math.min(minRow, -2);
        maxRow = Math.max(maxRow, 9);
        minCol = Math.min(minCol, -2);
        maxCol = Math.max(maxCol, 9);
        
        const rows = maxRow - minRow + 1;
        const cols = maxCol - minCol + 1;
        
        // Set up grid with exact square sizes matching the board
        this.movementOverlay.style.gridTemplateColumns = `repeat(${cols}, 75px)`;
        this.movementOverlay.style.gridTemplateRows = `repeat(${rows}, 75px)`;
        
        // Position the overlay so the board squares align perfectly
        // The board always shows row 0 at the top (for white) or row 7 at top (for black)
        // We need to align square [0,0] in both grids
        let offsetRow, offsetCol;
        
        if (this.playerColor === 'black') {
            // Black perspective: row 7 is at top, row 0 at bottom
            offsetRow = maxRow - 7;
            offsetCol = maxCol - 7;
        } else {
            // White perspective: row 0 is at top, row 7 at bottom
            offsetRow = 0 - minRow;
            offsetCol = 0 - minCol;
        }
        
        const topOffset = -offsetRow * 75;
        const leftOffset = -offsetCol * 75;
        
        this.movementOverlay.style.top = `${topOffset}px`;
        this.movementOverlay.style.left = `${leftOffset}px`;
        
        // Render grid from player's perspective
        const startRow = this.playerColor === 'black' ? maxRow : minRow;
        const endRow = this.playerColor === 'black' ? minRow - 1 : maxRow + 1;
        const rowStep = this.playerColor === 'black' ? -1 : 1;
        const startCol = this.playerColor === 'black' ? maxCol : minCol;
        const endCol = this.playerColor === 'black' ? minCol - 1 : maxCol + 1;
        const colStep = this.playerColor === 'black' ? -1 : 1;
        
        for (let row = startRow; row !== endRow; row += rowStep) {
            for (let col = startCol; col !== endCol; col += colStep) {
                const square = document.createElement('div');
                square.className = 'overlay-square';
                
                // Check if this is on the actual board
                const onBoard = row >= 0 && row <= 7 && col >= 0 && col <= 7;
                if (onBoard) {
                    square.classList.add('on-board');
                }
                
                // Add checkerboard pattern
                if ((row + col) % 2 === 0) {
                    square.classList.add('light');
                } else {
                    square.classList.add('dark');
                }
                
                // Check if this square is in the unrestricted pattern
                const key = `${row},${col}`;
                const move = this.unrestrictedPattern.get(key);
                
                // Don't show overlay on legal move squares (they're already highlighted green)
                const isLegalMove = onBoard && this.validMoves.some(m => m.row === row && m.col === col);
                
                if (move && !isLegalMove) {
                    const dot = document.createElement('div');
                    dot.className = 'overlay-dot';
                    square.appendChild(dot);
                }
                
                this.movementOverlay.appendChild(square);
            }
        }
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
        this.promotionDialog = document.getElementById('promotion-dialog');
        this.promotionChoices = document.getElementById('promotion-choices');
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

    showPromotionDialog(pieces, color, onChoose) {
        if (!this.promotionDialog || !this.promotionChoices) return;
        
        // Clear previous choices
        this.promotionChoices.innerHTML = '';
        
        // Create choice buttons for each piece
        pieces.forEach((piece, index) => {
            const choice = document.createElement('div');
            choice.className = `promotion-choice ${color}`;
            choice.textContent = piece.name;
            choice.title = `Promote to ${piece.name}`;
            choice.addEventListener('click', () => {
                this.hidePromotionDialog();
                onChoose(index);
            });
            this.promotionChoices.appendChild(choice);
        });
        
        // Show dialog
        this.promotionDialog.classList.remove('hidden');
    }

    hidePromotionDialog() {
        if (this.promotionDialog) {
            this.promotionDialog.classList.add('hidden');
        }
    }
}
