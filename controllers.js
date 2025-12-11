// ===== Game Mode Controllers =====
// Manage different game modes (AI vs Multiplayer)

// Base controller for game logic coordination
class GameController {
    constructor(pieces, renderer, uiManager, seed = null) {
        this.engine = new ChessEngine(pieces, seed);
        this.renderer = renderer;
        this.uiManager = uiManager;
        this.selectedSquare = null;
        this.isActive = false;
    }

    start(placement = null) {
        this.engine.initializeBoard(placement);
        this.isActive = true;
        // Hide any previous match result overlay when starting
        if (this.uiManager && this.uiManager.hideResult) this.uiManager.hideResult();
        this.render();
        this.uiManager.updateTurn(this.engine.currentTurn);
    }

    stop() {
        this.isActive = false;
    }

    render() {
        this.renderer.render(this.engine.board, this.engine.lastMove);
    }

    handleSquareClick(row, col) {
        if (!this.isActive || this.engine.isGameOver()) return;

        // Check if clicking a valid move
        const cellData = this.engine.board[row][col];
        
        if (this.selectedSquare) {
            const validMoves = this.engine.getValidMoves(this.selectedSquare.row, this.selectedSquare.col);
            const isValidMove = validMoves.some(m => m.row === row && m.col === col);
            
            if (isValidMove) {
                this.makeMove(this.selectedSquare.row, this.selectedSquare.col, row, col);
                return;
            }
        }

        // Select a piece
        if (cellData && cellData.color === this.engine.currentTurn) {
            this.selectPiece(row, col);
        } else {
            this.clearSelection();
        }
    }

    selectPiece(row, col) {
        this.selectedSquare = { row, col };
        const validMoves = this.engine.getValidMoves(row, col);
        const theoreticalMoves = this.engine.getTheoreticalMoves(row, col);
        const unrestrictedPattern = this.engine.getUnrestrictedPattern(row, col);
        this.renderer.setSelection(this.selectedSquare, validMoves, theoreticalMoves, unrestrictedPattern);
        this.render();
    }

    clearSelection() {
        this.selectedSquare = null;
        this.renderer.clearSelection();
        this.render();
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        // Override in subclasses
    }
}

// AI Game Mode Controller
class AIGameController extends GameController {
    constructor(pieces, renderer, uiManager, difficulty = 'hard', seed = null) {
        super(pieces, renderer, uiManager, seed);
        this.ai = new ChessAI(difficulty);
        this.playerColor = null;
        this.aiColor = null;
        this.aiTimeout = null;
    }

    start(placement = null, playerColor = null) {
        // Randomly assign player color if not specified
        this.playerColor = playerColor || (Math.random() < 0.5 ? 'white' : 'black');
        this.aiColor = this.playerColor === 'white' ? 'black' : 'white';
        
        this.renderer.setPlayerColor(this.playerColor);
        
        super.start(placement);
        // Start the clock for whoever's turn it is initially
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'ai';
            this.uiManager.startClock(owner);
            if (owner === 'ai') this.uiManager.setThinking('thinking');
        }
        
        // Don't clear the message - preserve multiplayer search status
        
        // If AI plays first, make AI move
        if (this.engine.currentTurn === this.aiColor) {
            this.makeAIMove();
        }
    }

    handleSquareClick(row, col) {
        // Only allow clicks when it's player's turn
        if (this.engine.currentTurn !== this.playerColor) return;
        
        super.handleSquareClick(row, col);
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        const success = this.engine.makeMove(fromRow, fromCol, toRow, toCol);
        
        if (!success) return;
        
        this.clearSelection();
        
        // Check for pending promotion (player's choice)
        if (this.engine.pendingPromotion) {
            const { color, promotionPieces } = this.engine.pendingPromotion;
            this.uiManager.showPromotionDialog(promotionPieces, color, (pieceIndex) => {
                this.engine.completePromotion(pieceIndex);
                this.render();
                this.uiManager.updateTurn(this.engine.currentTurn);
                this.checkGameState();
                
                // Make AI move if it's AI's turn after promotion
                if (this.engine.currentTurn === this.aiColor) {
                    this.makeAIMove();
                }
            });
            this.render();
            return;
        }
        
        this.uiManager.updateTurn(this.engine.currentTurn);
        // Update clock for the next player
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'ai';
            this.uiManager.startClock(owner);
            if (owner === 'ai') this.uiManager.setThinking('thinking');
            else this.uiManager.setThinking('');
        }
        
        // Show check status
            if (this.engine.isInCheck(this.engine.currentTurn)) {
                this.uiManager.showMessage('⚠️', 2000);
            }
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('🤝', 0);
            } else {
                this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            }
            this.isActive = false;
            if (this.uiManager) this.uiManager.stopClock();
            // Show end-of-match controls for multiplayer
            if (this.uiManager && this instanceof MultiplayerGameController) {
                this.uiManager.showEndmatchControls();
            }
            return;
        }
        
        // Make AI move if it's AI's turn
        if (this.engine.currentTurn === this.aiColor) {
            this.makeAIMove();
        }
    }
    
    checkGameState() {
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('🤝', 0);
            } else {
                this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            }
            this.isActive = false;
        } else if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('⚠️', 2000);
        }
    }

    async makeAIMove() {
        if (this.engine.isGameOver() || !this.isActive) return;

        // Schedule AI move and keep a handle so we can cancel it if controller is stopped
        this.aiTimeout = setTimeout(async () => {
            // If controller was stopped while waiting, abort
            if (!this.isActive || this.engine.isGameOver()) {
                this.aiTimeout = null;
                return;
            }

            // AI is thinking now
            if (this.uiManager) {
                this.uiManager.setThinking('thinking');
                this.uiManager.startClock('ai');
            }
            const bestMove = await this.ai.getBestMove(this.engine);

            // If controller was stopped while thinking, abort before applying a move
            if (!this.isActive || this.engine.isGameOver()) {
                this.aiTimeout = null;
                return;
            }

            if (bestMove) {
                this.engine.makeMove(bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol);

                // Handle AI promotion - always choose first piece (strongest)
                if (this.engine.pendingPromotion) {
                    this.engine.completePromotion(0);
                }

                this.render();
                if (this.uiManager) this.uiManager.updateTurn(this.engine.currentTurn);
                // After AI move, start the player's clock
                if (this.uiManager) {
                    const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'ai';
                    this.uiManager.startClock(owner);
                    if (owner === 'ai') this.uiManager.setThinking('thinking');
                    else this.uiManager.setThinking('');
                }

                // Show check status
                if (this.engine.isInCheck(this.engine.currentTurn)) {
                    this.uiManager.showMessage('⚠️', 2000);
                }

                if (this.engine.isGameOver()) {
                    const winner = this.engine.getWinner();
                    if (winner === 'draw') {
                        this.uiManager.showMessage('🤝', 0);
                    } else {
                        this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
                    }
                    this.isActive = false;
                }
            }

            this.aiTimeout = null;
        }, 500); // Small delay to make it feel natural
    }

    stop() {
        if (this.aiTimeout) {
            clearTimeout(this.aiTimeout);
            this.aiTimeout = null;
        }
        super.stop();
        if (this.uiManager) {
            this.uiManager.setThinking('');
            try { this.uiManager.stopClock(); } catch (e) {}
        }
    }
}

// Multiplayer Game Mode Controller
class MultiplayerGameController extends GameController {
    constructor(pieces, renderer, uiManager, multiplayerClient, color, seed = null) {
        super(pieces, renderer, uiManager, seed);
        this.multiplayerClient = multiplayerClient;
        this.playerColor = null;
    }

    start(placement = null, playerColor = 'white') {
        this.playerColor = playerColor;
        this.renderer.setPlayerColor(this.playerColor);
        
        super.start(placement);
        // Start the clock for whoever's turn it is initially
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'opponent';
            this.uiManager.startClock(owner);
            if (owner !== 'player') this.uiManager.setThinking('');
        }
    }

    handleSquareClick(row, col) {
        // Only allow clicks when it's player's turn
        if (this.engine.currentTurn !== this.playerColor) return;
        
        super.handleSquareClick(row, col);
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        const success = this.engine.makeMove(fromRow, fromCol, toRow, toCol);
        
        if (!success) return;
        
        this.clearSelection();
        
        // Check for pending promotion (player's choice)
        if (this.engine.pendingPromotion) {
            const { color, promotionPieces } = this.engine.pendingPromotion;
            this.uiManager.showPromotionDialog(promotionPieces, color, (pieceIndex) => {
                this.engine.completePromotion(pieceIndex);
                this.render();
                this.uiManager.updateTurn(this.engine.currentTurn);
                
                // Send promotion info to server (as a separate message if needed)
                this.multiplayerClient.sendMove({
                    fromRow: fromRow,
                    fromCol: fromCol,
                    toRow: toRow,
                    toCol: toCol,
                    promotion: pieceIndex
                }, this.engine.isGameOver(), this.engine.getWinner());
                
                this.checkGameState();
            });
            this.render();
            return;
        }
        
        this.uiManager.updateTurn(this.engine.currentTurn);
        // Update clock for the next player (local player vs opponent)
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'opponent';
            this.uiManager.startClock(owner);
            this.uiManager.setThinking('');
        }
        
        // Send move to server
        this.multiplayerClient.sendMove({
            fromRow: fromRow,
            fromCol: fromCol,
            toRow: toRow,
            toCol: toCol
        }, this.engine.isGameOver(), this.engine.getWinner());
        
        // Show check status
        if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('⚠️', 2000);
        }
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('🤝', 0);
            } else {
                this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            }
            this.isActive = false;
            if (this.uiManager) this.uiManager.stopClock();
            return;
        }
    }
    
    checkGameState() {
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('🤝', 0);
            } else {
                this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            }
            this.isActive = false;
        } else if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('⚠️', 2000);
        }
    }

    // Apply move from opponent
    applyRemoteMove(move) {
        this.engine.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
        
        // Handle opponent's promotion choice
        if (this.engine.pendingPromotion && move.promotion !== undefined) {
            this.engine.completePromotion(move.promotion);
        }
        
        this.render();
        this.uiManager.updateTurn(this.engine.currentTurn);
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'opponent';
            this.uiManager.startClock(owner);
            this.uiManager.setThinking('');
        }
        
        // Show check status
        if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('⚠️', 2000);
        }
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('🤝', 0);
            } else {
                this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            }
            this.isActive = false;
            if (this.uiManager && this instanceof MultiplayerGameController) {
                this.uiManager.showEndmatchControls();
            }
            if (this.uiManager) this.uiManager.stopClock();
        }
    }
}
