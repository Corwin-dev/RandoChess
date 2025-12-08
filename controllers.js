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
        this.renderer.setSelection(this.selectedSquare, validMoves, theoreticalMoves);
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
        
        this.uiManager.clearMessage();
        
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
        this.uiManager.updateTurn(this.engine.currentTurn);
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`, 0);
            this.isActive = false;
            return;
        }
        
        // Make AI move if it's AI's turn
        if (this.engine.currentTurn === this.aiColor) {
            this.makeAIMove();
        }
    }

    makeAIMove() {
        if (this.engine.isGameOver() || !this.isActive) return;
        
        setTimeout(() => {
            const bestMove = this.ai.getBestMove(this.engine);
            if (bestMove) {
                this.engine.makeMove(bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol);
                this.render();
                this.uiManager.updateTurn(this.engine.currentTurn);
                
                if (this.engine.isGameOver()) {
                    const winner = this.engine.getWinner();
                    this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`, 0);
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
        this.uiManager.updateTurn(this.engine.currentTurn);
        
        // Send move to server
        this.multiplayerClient.sendMove({
            fromRow: fromRow,
            fromCol: fromCol,
            toRow: toRow,
            toCol: toCol
        }, this.engine.isGameOver(), this.engine.getWinner());
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`, 0);
            this.isActive = false;
        }
    }

    // Apply move from opponent
    applyRemoteMove(move) {
        this.engine.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
        this.render();
        this.uiManager.updateTurn(this.engine.currentTurn);
        
        if (this.engine.isGameOver()) {
            const winner = this.engine.getWinner();
            this.uiManager.showMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`, 0);
            this.isActive = false;
        }
    }
}
