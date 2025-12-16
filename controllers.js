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
        this._history = []; // store engine clones for takeback
    }

    // Record current engine state to history (clone) before applying a move
    recordState() {
        try {
            if (!this.engine) return;
            // Keep a shallow cap to avoid unbounded memory
            this._history.push(this.engine.clone());
            if (this._history.length > 256) this._history.shift();
            if (this.uiManager && typeof this.uiManager.setTakebackEnabled === 'function') {
                this.uiManager.setTakebackEnabled(true);
            }
        } catch (e) { /* ignore */ }
    }

    // Return whether a takeback is available
    canTakeback() {
        return Array.isArray(this._history) && this._history.length > 0;
    }

    // Restore last recorded engine state (single-step takeback)
    takeback() {
        if (!this.canTakeback()) return false;
        try {
            const prev = this._history.pop();
            if (!prev) return false;
            // Replace engine state with cloned version
            this.engine = prev;
            // Update UI/renderer
            if (this.renderer) {
                try { this.renderer.clearSelection(); } catch (e) {}
                this.renderer.render(this.engine.board, this.engine.lastMove, this.engine);
            }
            this.selectedSquare = null;
            if (this.uiManager && typeof this.uiManager.updateTurn === 'function') this.uiManager.updateTurn(this.engine.currentTurn);
            if (this.uiManager && typeof this.uiManager.setTakebackEnabled === 'function') this.uiManager.setTakebackEnabled(this.canTakeback());
            return true;
        } catch (e) {
            return false;
        }
    }

    start(placement = null) {
        this.engine.initializeBoard(placement);
        this.isActive = true;
        // Reset takeback history when starting a fresh game
        this._history = [];
        if (this.uiManager && typeof this.uiManager.setTakebackEnabled === 'function') this.uiManager.setTakebackEnabled(false);
        // Hide any previous match result overlay when starting
        if (this.uiManager && this.uiManager.hideResult) this.uiManager.hideResult();
        this.render();
        this.uiManager.updateTurn(this.engine.currentTurn);
    }

    stop() {
        this.isActive = false;
    }

    render() {
        this.renderer.render(this.engine.board, this.engine.lastMove, this.engine);
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

// Attach controllers to window for backwards compatibility and export as ES module
try {
    if (typeof window !== 'undefined') {
        window.GameController = GameController;
        window.AIGameController = AIGameController;
    }
} catch (e) { /* ignore in non-browser env */ }
export { GameController, AIGameController };

// Hotseat controller: human plays both sides locally (no AI, no networking)
class HotseatController extends GameController {
    constructor(pieces, renderer, uiManager, seed = null) {
        super(pieces, renderer, uiManager, seed);
    }

    start(placement = null, startingColor = 'white') {
        // Ensure engine initialized and front-end ready
        super.start(placement);
        // Set initial turn
        try { this.engine.currentTurn = startingColor; } catch (e) {}
        if (this.uiManager) {
            this.uiManager.updateTurn(this.engine.currentTurn);
            this.uiManager.setOpponentStatus('👥');
        }
    }

    // Allow clicks regardless of who 'playerColor' is — user controls both sides
    handleSquareClick(row, col) {
        if (!this.isActive || this.engine.isGameOver()) return;
        super.handleSquareClick(row, col);
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        // Record state so takeback can restore prior position
        this.recordState();
        const success = this.engine.makeMove(fromRow, fromCol, toRow, toCol);
        if (!success) return;

        this.clearSelection();

        // Handle promotion choices
        if (this.engine.pendingPromotion) {
            const { color, promotionPieces } = this.engine.pendingPromotion;
            this.uiManager.showPromotionDialog(promotionPieces, color, (pieceIndex) => {
                this.engine.completePromotion(pieceIndex);
                this.render();
                this.uiManager.updateTurn(this.engine.currentTurn);
                this.checkGameState();
            });
            this.render();
            return;
        }

        this.uiManager.updateTurn(this.engine.currentTurn);

        if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('⚠️', 2000);
        }

        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') this.uiManager.showMessage('🤝', 0);
            else this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            this.isActive = false;
            if (this.uiManager) this.uiManager.stopClock();
        }
    }

    checkGameState() {
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') this.uiManager.showMessage('🤝', 0);
            else this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            this.isActive = false;
        } else if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('⚠️', 2000);
        }
    }
}

try { if (typeof window !== 'undefined') window.HotseatController = HotseatController; } catch (e) {}
export { HotseatController };

// Lightweight online controller: talks to server via WebSocket
class OnlineGameController extends GameController {
    constructor(pieces, renderer, uiManager, ws, color, seed = null) {
        super(pieces, renderer, uiManager, seed);
        this.ws = ws;
        this.playerColor = color;
    }

    start(placement = null, playerColor = null) {
        if (playerColor) this.playerColor = playerColor;
        this.renderer.setPlayerColor(this.playerColor);
        super.start(placement);
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'opponent';
            this.uiManager.startClock(owner);
            if (owner !== 'player') this.uiManager.setThinking('');
        }
    }

    handleSquareClick(row, col) {
        if (this.engine.currentTurn !== this.playerColor) return;
        super.handleSquareClick(row, col);
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        // Record state before applying move (so we can undo locally)
        this.recordState();
        const success = this.engine.makeMove(fromRow, fromCol, toRow, toCol);
        if (!success) return;
        this.clearSelection();

        if (this.engine.pendingPromotion) {
            const { color, promotionPieces } = this.engine.pendingPromotion;
            this.uiManager.showPromotionDialog(promotionPieces, color, (pieceIndex) => {
                this.engine.completePromotion(pieceIndex);
                this.render();
                this.uiManager.updateTurn(this.engine.currentTurn);
                // send promotion move
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'MOVE', move: { fromRow, fromCol, toRow, toCol, promotion: pieceIndex }, gameOver: this.engine.isGameOver(), winner: this.engine.getWinner() }));
                }
                this.checkGameState();
            });
            this.render();
            return;
        }

        this.uiManager.updateTurn(this.engine.currentTurn);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'MOVE', move: { fromRow, fromCol, toRow, toCol }, gameOver: this.engine.isGameOver(), winner: this.engine.getWinner() }));
        }

        if (this.engine.isInCheck(this.engine.currentTurn)) this.uiManager.showMessage('⚠️', 2000);

        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') this.uiManager.showMessage('🤝', 0);
            else this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            this.isActive = false;
            if (this.uiManager) this.uiManager.stopClock();
        }
    }

    applyRemoteMove(move) {
        this.engine.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
        if (this.engine.pendingPromotion && move.promotion !== undefined) this.engine.completePromotion(move.promotion);
        this.render();
        this.uiManager.updateTurn(this.engine.currentTurn);
        if (this.uiManager) {
            const owner = this.engine.currentTurn === this.playerColor ? 'player' : 'opponent';
            this.uiManager.startClock(owner);
            this.uiManager.setThinking('');
        }
        if (this.engine.isInCheck(this.engine.currentTurn)) this.uiManager.showMessage('⚠️', 2000);
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') this.uiManager.showMessage('🤝', 0);
            else this.uiManager.showMessage(winner === 'white' ? '⚪🏁' : '⚫🏁', 0);
            this.isActive = false;
            if (this.uiManager) this.uiManager.stopClock();
        }
    }
}

try { if (typeof window !== 'undefined') window.OnlineGameController = OnlineGameController; } catch (e) {}
export { OnlineGameController };

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
        // Record state before applying move so user can takeback
        this.recordState();
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

    // AI-specific takeback: revert to the state before the player's last move.
    // This typically requires undoing both the AI's reply and the player's move.
    takeback() {
        // If there are at least two snapshots, pop twice. Otherwise, fall back to single.
        if (!this.canTakeback()) return false;
        try {
            if (this._history.length >= 2) {
                super.takeback(); // undo AI move (or last ply)
                super.takeback(); // undo player's move
            } else {
                super.takeback();
            }
            // Stop any pending AI thinking and clear thinking UI
            if (this.aiTimeout) {
                clearTimeout(this.aiTimeout);
                this.aiTimeout = null;
            }
            if (this.uiManager) {
                this.uiManager.setThinking('idle');
                this.uiManager.updateTurn(this.engine.currentTurn);
            }
            return true;
        } catch (e) { return false; }
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
                // Record current state so AI moves can be undone as well
                this.recordState();
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
// Multiplayer support removed — MultiplayerGameController deleted
