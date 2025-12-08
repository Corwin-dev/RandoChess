// ===== RandoChess - Main Application =====
// Coordinates all modules and manages application state

class RandoChessApp {
    constructor() {
        this.pieces = null;
        this.renderer = null;
        this.uiManager = null;
        this.currentController = null;
        this.multiplayerClient = null;
    }

    initialize() {
        // Generate initial pieces
        this.pieces = PieceGenerator.generateRandomPieces();
        console.log('Generated pieces:', this.pieces.map(p => p.name));
        
        // Set up UI
        this.renderer = new BoardRenderer(document.getElementById('board'));
        this.uiManager = new UIManager();
        
        // Set up multiplayer client
        this.multiplayerClient = new MultiplayerClient();
        this.setupMultiplayerCallbacks();
        
        // Set up search button
        this.uiManager.onSearchClick(() => this.startMultiplayerSearch());
        
        // Start AI game by default
        this.startAIGame();
    }

    startAIGame(difficulty = 'hard') {
        // Stop current game if any
        if (this.currentController) {
            this.currentController.stop();
        }
        
        // Create and start AI game
        this.currentController = new AIGameController(
            this.pieces,
            this.renderer,
            this.uiManager,
            difficulty
        );
        
        this.renderer.attachEventListener((row, col) => {
            this.currentController.handleSquareClick(row, col);
        });
        
        this.currentController.start();
        this.uiManager.showSearchButton();
    }

    startMultiplayerSearch() {
        this.uiManager.disableSearchButton();
        this.uiManager.showMessage('Searching for opponent...', 0);
        
        // Connect to multiplayer server with current pieces
        const serializedPieces = PieceSerializer.serialize(this.pieces);
        this.multiplayerClient.connect(this.pieces);
    }

    setupMultiplayerCallbacks() {
        this.multiplayerClient.onMatchFound = (color, pieces, placement) => {
            console.log('Match found! Playing as', color);
            
            // Update pieces to server's version (ensures both players have same pieces)
            this.pieces = pieces;
            
            // Stop AI game
            if (this.currentController) {
                this.currentController.stop();
            }
            
            // Create multiplayer controller
            this.currentController = new MultiplayerGameController(
                this.pieces,
                this.renderer,
                this.uiManager,
                this.multiplayerClient
            );
            
            this.renderer.attachEventListener((row, col) => {
                this.currentController.handleSquareClick(row, col);
            });
            
            this.currentController.start(placement, color);
            
            this.uiManager.hideSearchButton();
            this.uiManager.showMessage(`Match found! You are ${color}`, 3000);
        };
        
        this.multiplayerClient.onMove = (move) => {
            if (this.currentController instanceof MultiplayerGameController) {
                this.currentController.applyRemoteMove(move);
            }
        };
        
        this.multiplayerClient.onOpponentLeft = () => {
            this.uiManager.showMessage('Opponent left. Starting new AI game...', 3000);
            setTimeout(() => {
                this.startAIGame();
            }, 3000);
        };
        
        this.multiplayerClient.onMessage = (message) => {
            this.uiManager.showMessage(message, 3000);
        };
    }
}

// Initialize app when page loads
window.addEventListener('DOMContentLoaded', () => {
    const app = new RandoChessApp();
    app.initialize();
    
    // Expose app globally for debugging
    window.randoChessApp = app;
});
