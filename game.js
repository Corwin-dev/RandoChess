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
        
        // Start compulsory multiplayer search by default (user may cancel)
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('⏳');
            // Register handlers for search and cancel actions
            this.uiManager.onSearchClick(() => this.startMultiplayerSearch());
            this.uiManager.onCancelClick(() => this.cancelMultiplayerSearch());
        }

        // Begin matchmaking immediately
        this.startMultiplayerSearch();
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
            this.uiManager.setOpponentStatus('🤖');
            this.uiManager.showSearchButton();
        }
    }

    startMultiplayerSearch() {
        // Show permanent searching status and update opponent indicator
        this.uiManager.showMessage('🔍', 0);
        if (this.uiManager) {
            // Indicate we're searching but also have an AI opponent available locally
            this.uiManager.setOpponentStatus('🤖🔍');
            // Turn the search control into a cancel control while queued
            this.uiManager.showCancelButton();
        }

        // Connect to multiplayer server with current pieces
        const serializedPieces = PieceSerializer.serialize(this.pieces);
        this.multiplayerClient.connect(this.pieces);
        // While queued, start an AI game locally so the player can play while waiting.
        // When a match is found the multiplayer callback will stop the AI controller.
        if (!(this.currentController instanceof AIGameController)) {
            this.startAIGame();
        }
    }

    cancelMultiplayerSearch() {
        // Disconnect from server and fall back to AI game
        if (this.multiplayerClient) {
            this.multiplayerClient.disconnect();
        }
        if (this.uiManager) {
            this.uiManager.clearMessage();
            this.uiManager.setOpponentStatus('🤖');
            this.uiManager.showSearchButton();
            this.uiManager.showMessage('Search cancelled', 2000);
        }
        // Start AI game when user cancels matchmaking
        this.startAIGame();
    }

    setupMultiplayerCallbacks() {
        this.multiplayerClient.onMatchFound = (color, pieces, placement) => {
            console.log('👤', color);
            
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
            this.uiManager.showMessage(`👤`, 3000);
            // Show that opponent is human and what color they are
            if (this.uiManager) {
                this.uiManager.setOpponentStatus(`👤`);
                this.uiManager.hideSearchButton();
                // Hide any end-of-match controls (we're in a fresh match)
                if (this.uiManager.hideEndmatchControls) this.uiManager.hideEndmatchControls();
            }
        };
        
        this.multiplayerClient.onMove = (move) => {
            if (this.currentController instanceof MultiplayerGameController) {
                this.currentController.applyRemoteMove(move);
            }
        };
        
        // Update rematch UI status when server notifies
        this.multiplayerClient.onRematchStatus = (mySelection, opponentSelection) => {
            if (this.uiManager) {
                this.uiManager.setRematchSelections(mySelection, opponentSelection);
            }
        };

        // Wire end-of-match UI actions
        if (this.uiManager) {
            this.uiManager.onRematchRollClick(() => {
                if (this.multiplayerClient) this.multiplayerClient.sendRematchRequest('roll');
                // toggle our local highlight
                this.uiManager.setRematchSelections('roll', null);
            });
            this.uiManager.onRematchKeepClick(() => {
                if (this.multiplayerClient) this.multiplayerClient.sendRematchRequest('keep');
                this.uiManager.setRematchSelections('keep', null);
            });
            this.uiManager.onNewOpponentClick(() => {
                if (this.multiplayerClient) this.multiplayerClient.leaveAndQueue();
                // hide controls while searching
                this.uiManager.hideEndmatchControls();
                this.uiManager.setOpponentStatus('⏳');
            });
            this.uiManager.onAIMatchClick(() => {
                // Refresh page to reset to AI match — simpler and reliable
                window.location.reload();
            });
        }
        
        this.multiplayerClient.onOpponentLeft = () => {
            // Clear any lingering permanent status (e.g. 'Searching...') before showing this
            this.uiManager.clearMessage();
            this.uiManager.showMessage('👤❌➡️🤖', 3000);
            // Update opponent status immediately so it's obvious
            if (this.uiManager) {
                this.uiManager.setOpponentStatus('🤖');
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
