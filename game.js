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
        // Generate initial pieces (seed is internal/hidden)
        this.pieces = PieceGenerator.generateRandomPieces();
        console.log('Generated pieces:', this.pieces.map(p => p.name));
        
        // Set up UI
        this.renderer = new BoardRenderer(document.getElementById('board'));
        this.uiManager = new UIManager();
        
        // Set up multiplayer client
        this.multiplayerClient = new MultiplayerClient();
        this.setupMultiplayerCallbacks();
        
        // Start AI game by default
        this.startAIGame();
        
        // Do not auto-start multiplayer search — make it optional via button
        // Ensure UI shows we're currently playing the AI and expose the search button
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('AI');
            this.uiManager.showSearchButton();
            // Wire search button to start matchmaking on demand
            this.uiManager.onSearchClick(() => this.startMultiplayerSearch());
        }
    }

    // Seed controls and seed display removed; seed remains internal to PieceGenerator

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
            difficulty,
            null
        );
        
        this.renderer.attachEventListener((row, col) => {
            this.currentController.handleSquareClick(row, col);
        });
        
        this.currentController.start();
        // Update UI to show we're playing AI
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('AI');
            this.uiManager.showSearchButton();
        }
    }

    startMultiplayerSearch() {
        // Show permanent searching status and update opponent indicator
        this.uiManager.showMessage('Searching for opponent...', 0);
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('Searching...');
            // Disable the search button while queued
            this.uiManager.disableSearchButton();
        }

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
                this.multiplayerClient,
                color,
                null
            );
            
            this.renderer.attachEventListener((row, col) => {
                this.currentController.handleSquareClick(row, col);
            });
            
            this.currentController.start(placement, color);
            // Clear any permanent "Searching..." status so it doesn't reappear later
            this.uiManager.clearMessage();
            this.uiManager.showMessage(`Match found! You are ${color}`, 3000);
            // Show that opponent is human and what color they are
            if (this.uiManager) {
                this.uiManager.setOpponentStatus(`Human (${color})`);
                this.uiManager.hideSearchButton();
            }
        };
        
        this.multiplayerClient.onMove = (move) => {
            if (this.currentController instanceof MultiplayerGameController) {
                this.currentController.applyRemoteMove(move);
            }
        };
        
        this.multiplayerClient.onOpponentLeft = () => {
            // Clear any lingering permanent status (e.g. 'Searching...') before showing this
            this.uiManager.clearMessage();
            this.uiManager.showMessage('Opponent left. Starting new AI game...', 3000);
            // Update opponent status immediately so it's obvious
            if (this.uiManager) {
                this.uiManager.setOpponentStatus('AI');
            }
            setTimeout(() => {
                this.startAIGame();
                // The server will requeue the remaining player's open socket automatically.
                // Only start a fresh search if the client is not connected (socket closed).
                if (!this.multiplayerClient || !this.multiplayerClient.ws || this.multiplayerClient.ws.readyState === WebSocket.CLOSED) {
                    this.startMultiplayerSearch();
                }
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
