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
        this.render();
        this.uiManager.updateTurn(this.engine.currentTurn);
    }

    stop() {
        this.isActive = false;
    }

    render() {
        this.renderer.render(this.engine.board);
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
    }

    start(placement = null, playerColor = null) {
        // Randomly assign player color if not specified
        this.playerColor = playerColor || (Math.random() < 0.5 ? 'white' : 'black');
        this.aiColor = this.playerColor === 'white' ? 'black' : 'white';
        
        this.renderer.setPlayerColor(this.playerColor);
        
        super.start(placement);
        
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
        
        // Show check status
        if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('Check!', 2000);
        }
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('Stalemate - Draw!', 0);
            } else {
                this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`, 0);
            }
            this.isActive = false;
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
                this.uiManager.showMessage('Stalemate - Draw!', 0);
            } else {
                this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`, 0);
            }
            this.isActive = false;
        } else if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('Check!', 2000);
        }
    }

    async makeAIMove() {
        if (this.engine.isGameOver() || !this.isActive) return;
        
        setTimeout(async () => {
            const bestMove = await this.ai.getBestMove(this.engine);
            if (bestMove) {
                this.engine.makeMove(bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol);
                
                // Handle AI promotion - always choose first piece (strongest)
                if (this.engine.pendingPromotion) {
                    this.engine.completePromotion(0);
                }
                
                this.render();
                this.uiManager.updateTurn(this.engine.currentTurn);
                
                // Show check status
                if (this.engine.isInCheck(this.engine.currentTurn)) {
                    this.uiManager.showMessage('Check!', 2000);
                }
                
                if (this.engine.isGameOver()) {
                    const winner = this.engine.getWinner();
                    if (winner === 'draw') {
                        this.uiManager.showMessage('Stalemate - Draw!', 0);
                    } else {
                        this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`, 0);
                    }
                    this.isActive = false;
                }
            }
        }, 500); // Small delay to make it feel natural
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
        
        // Send move to server
        this.multiplayerClient.sendMove({
            fromRow: fromRow,
            fromCol: fromCol,
            toRow: toRow,
            toCol: toCol
        }, this.engine.isGameOver(), this.engine.getWinner());
        
        // Show check status
        if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('Check!', 2000);
        }
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('Stalemate - Draw!', 0);
            } else {
                this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`, 0);
            }
            this.isActive = false;
            return;
        }
    }
    
    checkGameState() {
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('Stalemate - Draw!', 0);
            } else {
                this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`, 0);
            }
            this.isActive = false;
        } else if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('Check!', 2000);
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
        
        // Show check status
        if (this.engine.isInCheck(this.engine.currentTurn)) {
            this.uiManager.showMessage('Check!', 2000);
        }
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            if (winner === 'draw') {
                this.uiManager.showMessage('Stalemate - Draw!', 0);
            } else {
                this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins by checkmate!`, 0);
            }
            this.isActive = false;
        }
    }
}
