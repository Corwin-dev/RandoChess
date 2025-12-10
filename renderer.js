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
    // `lastMove` is optional: {fromRow, fromCol, toRow, toCol}
    render(board, lastMove = null) {
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
                    // Create canvas icon showing movement pattern (use 80 which divides evenly by 8)
                    // Pass player perspective so pieces flip when viewing as black
                    // Determine if this piece is on its promotion square (automatic move-upgrade promotions)
                    const isPromotionSquare = (cellData.piece.promotionType === 'move-upgrade') &&
                        ((cellData.color === 'white' && row === 0) || (cellData.color === 'black' && row === 7));

                    const pieceIcon = PieceGenerator.createMovementPatternIcon(cellData.piece, 80, cellData.color, this.playerColor, isPromotionSquare);
                    pieceIcon.className = `piece ${cellData.color}`;
                    if (cellData.piece.royal) {
                        pieceIcon.classList.add('royal');
                    }
                    square.appendChild(pieceIcon);
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

                // Highlight last move (from/to)
                if (lastMove) {
                    const fromMatch = lastMove.fromRow === row && lastMove.fromCol === col;
                    const toMatch = lastMove.toRow === row && lastMove.toCol === col;
                    if (fromMatch || toMatch) {
                        square.classList.add('last-move');
                        if (fromMatch) square.classList.add('last-move-from');
                        if (toMatch) square.classList.add('last-move-to');
                    }
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
        this.opponentElement = document.getElementById('opponent-status');
        this.endmatchControls = document.getElementById('endmatch-controls');
        this.rematchRollBtn = document.getElementById('rematch-roll-btn');
        this.rematchKeepBtn = document.getElementById('rematch-keep-btn');
        this.newOpponentBtn = document.getElementById('new-opponent-btn');
        this.aiMatchBtn = document.getElementById('ai-match-btn');
        this.promotionDialog = document.getElementById('promotion-dialog');
        this.promotionChoices = document.getElementById('promotion-choices');
        this.permanentStatus = ''; // Store permanent status message (like search status)
        this.messageTimeout = null; // Track active message timeout
    }

    showMessage(msg, duration = 3000) {
        if (this.messageElement) {
            // Clear any existing timeout
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
                this.messageTimeout = null;
            }
            
            // If duration is 0, this is a permanent status message
            if (duration === 0) {
                this.permanentStatus = msg;
                this.messageElement.textContent = msg;
            } else {
                // Temporary message - show it and restore permanent status after
                this.messageElement.textContent = msg;
                this.messageTimeout = setTimeout(() => {
                    this.restorePermanentStatus();
                    this.messageTimeout = null;
                }, duration);
            }
        }
    }

    restorePermanentStatus() {
        if (this.messageElement && this.permanentStatus) {
            this.messageElement.textContent = this.permanentStatus;
        } else {
            this.clearMessage();
        }
    }

    clearMessage() {
        if (this.messageElement) {
            this.permanentStatus = '';
            this.messageElement.textContent = '';
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
                this.messageTimeout = null;
            }
        }
    }

    updateTurn(color) {
        if (this.turnElement) {
            const emoji = color === 'white' ? '⚪' : (color === 'black' ? '⚫' : '🤝');
            this.turnElement.textContent = emoji;
        }
        // Toggle body classes so CSS can change visuals for each turn
        try {
            document.body.classList.toggle('turn-black', color === 'black');
            document.body.classList.toggle('turn-white', color === 'white');
        } catch (e) {
            // ignore when document isn't available (tests / non-browser env)
        }
    }

    disableSearchButton() {
        if (this.searchButton) {
            this.searchButton.disabled = true;
            this.searchButton.textContent = '⏳';
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
            this.searchButton.textContent = '🔍';
            // Ensure the active click handler matches the search handler if present
            if (this._searchHandler) this.searchButton.onclick = this._searchHandler;
        }
    }

    showCancelButton() {
        if (this.searchButton) {
            this.searchButton.style.display = 'block';
            this.searchButton.disabled = false;
            this.searchButton.textContent = '✖';
            // Attach cancel handler if present
            if (this._cancelHandler) this.searchButton.onclick = this._cancelHandler;
        }
    }

    // Set a persistent opponent type/status: 'AI', 'Human', 'Searching', or custom text
    setOpponentStatus(text) {
        if (this.opponentElement) {
            this.opponentElement.textContent = text;
        }
    }

    clearOpponentStatus() {
        if (this.opponentElement) {
            this.opponentElement.textContent = '';
        }
    }

    onSearchClick(callback) {
        // Register a search handler and attach it when the button is in search mode
        this._searchHandler = callback;
        if (this.searchButton && this.searchButton.textContent === '🔍') {
            this.searchButton.onclick = callback;
        }
    }

    onCancelClick(callback) {
        // Register a cancel handler and attach it when the button is in cancel mode
        this._cancelHandler = callback;
        if (this.searchButton && this.searchButton.textContent === '✖') {
            this.searchButton.onclick = callback;
        }
    }

    // End-of-match controls
    showEndmatchControls() {
        if (this.endmatchControls) {
            this.endmatchControls.classList.remove('hidden');
        }
    }

    hideEndmatchControls() {
        if (this.endmatchControls) {
            this.endmatchControls.classList.add('hidden');
        }
        // clear any rematch highlights
        if (this.rematchRollBtn) this.rematchRollBtn.classList.remove('selected');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.remove('selected');
        if (this.rematchRollBtn) this.rematchRollBtn.classList.remove('opponent-selected');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.remove('opponent-selected');
    }

    onRematchRollClick(callback) {
        if (this.rematchRollBtn) this.rematchRollBtn.addEventListener('click', callback);
    }

    onRematchKeepClick(callback) {
        if (this.rematchKeepBtn) this.rematchKeepBtn.addEventListener('click', callback);
    }

    onNewOpponentClick(callback) {
        if (this.newOpponentBtn) this.newOpponentBtn.addEventListener('click', callback);
    }

    onAIMatchClick(callback) {
        if (this.aiMatchBtn) this.aiMatchBtn.addEventListener('click', callback);
    }

    // Visualize rematch selection state. mySelection: 'roll'|'keep'|null, opponentSelection: same
    setRematchSelections(mySelection, opponentSelection) {
        if (this.rematchRollBtn) this.rematchRollBtn.classList.toggle('selected', mySelection === 'roll');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.toggle('selected', mySelection === 'keep');

        // Indicate opponent selection by adding a faint highlight
        if (this.rematchRollBtn) this.rematchRollBtn.classList.toggle('opponent-selected', opponentSelection === 'roll');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.toggle('opponent-selected', opponentSelection === 'keep');
    }

    showPromotionDialog(pieces, color, onChoose) {
        if (!this.promotionDialog || !this.promotionChoices) return;

        // Clear previous choices
        this.promotionChoices.innerHTML = '';

        // Build list of visible choices (preserve original indices) and exclude royals
        const choices = pieces
            .map((piece, idx) => ({ piece, idx }))
            .filter(item => !item.piece.royal);

        if (choices.length === 0) {
            // Nothing to choose (shouldn't normally happen) - fallback to first piece
            console.warn('No promotion choices available (all pieces royal?). Defaulting to first.');
            this.hidePromotionDialog();
            onChoose(0);
            return;
        }

        // Create choice buttons showing only the generated icon on a neutral gray background
        choices.forEach(({ piece, idx }) => {
            const choice = document.createElement('div');
            choice.className = 'promotion-choice';
            // Neutral gray background for each icon
            choice.style.background = '#808080';
            choice.style.width = '100px';
            choice.style.height = '100px';
            choice.style.display = 'flex';
            choice.style.alignItems = 'center';
            choice.style.justifyContent = 'center';
            choice.style.cursor = 'pointer';
            choice.style.border = 'none';
            choice.style.padding = '6px';

            // Try to generate and add the movement pattern icon
                try {
                const icon = PieceGenerator.createMovementPatternIcon(piece, 80);
                icon.style.display = 'block';
                icon.style.width = '80px';
                icon.style.height = '80px';
                icon.style.background = 'transparent';
                icon.style.boxSizing = 'border-box';
                choice.appendChild(icon);
            } catch (error) {
                console.error('Error creating icon for promotion choice:', error);
                // Fallback: show piece symbol or name minimally
                const fallback = document.createElement('div');
                fallback.textContent = '❓';
                fallback.style.color = '#fff';
                choice.appendChild(fallback);
            }

            choice.addEventListener('click', () => {
                this.hidePromotionDialog();
                onChoose(idx);
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
