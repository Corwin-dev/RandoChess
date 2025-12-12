// ===== RandoChess - Main Application =====
// Coordinates all modules and manages application state

import { PieceGenerator } from './pieces.js';
import { BoardRenderer, UIManager } from './renderer.js';
import { MultiplayerClient } from './multiplayer.js';
import { AIGameController, MultiplayerGameController } from './controllers.js';

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
            this.uiManager.showCancelButton();

        }
    }

    startMultiplayerSearch() {
        // Show searching status and update opponent indicator
        if (this.uiManager) {
            // Indicate we're showing an AI locally but searching for a human (emoji-only)
            this.uiManager.setOpponentStatus('🤖');
            // Game-level status: we're matchmaking/searching (separate from WS connection)
            this.uiManager.setGameStatus('searching');
            // Turn the search control into a cancel control while queued
            this.uiManager.showCancelButton();
            // Show small thinking indicator for local AI play
            this.uiManager.setThinking('ready');
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
            // Game-level idle state
            this.uiManager.setGameStatus('idle');
            this.uiManager.setOpponentStatus('🤖');
            this.uiManager.showSearchButton();
            this.uiManager.setThinking('idle');
            this.uiManager.setClock('00:00');
        }
        // Start AI game when user cancels matchmaking
        this.startAIGame();
    }

    setupMultiplayerCallbacks() {
        // Wire low-level ws lifecycle to UI
        this.multiplayerClient.onOpen = () => {
            if (this.uiManager) this.uiManager.setConnectionStatus('connected');
        };
        this.multiplayerClient.onClose = () => {
            if (this.uiManager) this.uiManager.setConnectionStatus('disconnected');
        };

        this.multiplayerClient.onMatchFound = (color, pieces, placement, moveHistory = [], currentTurn = 'white') => {
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
            // If this was a rejoin/resume, set engine turn and replay move history to reach current state
            try {
                if (this.currentController && this.currentController.engine) {
                    this.currentController.engine.currentTurn = currentTurn;
                }
            } catch (e) {}

            if (Array.isArray(moveHistory) && moveHistory.length > 0) {
                for (const entry of moveHistory) {
                    try {
                        if (this.currentController && typeof this.currentController.applyRemoteMove === 'function') {
                            this.currentController.applyRemoteMove(entry.move);
                        }
                    } catch (e) { console.warn('Failed to replay move', e); }
                }
            }
            // Clear any permanent "Searching..." status so it doesn't reappear later
            this.uiManager.clearMessage();
            this.uiManager.showMessage(`👤`, 3000);
            // Show that opponent is human and what color they are
            if (this.uiManager) {
                this.uiManager.setOpponentStatus(`👤`);
                this.uiManager.setConnectionStatus('connected');
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
        
        this.multiplayerClient.onOpponentLeft = (data) => {
            // Clear any lingering permanent status (e.g. 'Searching...') before showing this
            this.uiManager.clearMessage();
            this.uiManager.showMessage('👤❌➡️🤖', 3000);
            // Update opponent status immediately so it's obvious
            if (this.uiManager) {
                this.uiManager.setOpponentStatus('🤖');
                this.uiManager.setConnectionStatus('disconnected');
                // Game is no longer in a matched state
                this.uiManager.setGameStatus('idle');
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
            // Map server shorthand to connection status where appropriate
            if (!this.uiManager) return;
            if (typeof message === 'string') {
                // common tokens: '⏳' (waiting), '🔌❌' (disconnected), etc.
                if (message.includes('⏳') || message.includes('🔍')) {
                    // These are game-level status hints (matchmaking / waiting)
                    this.uiManager.setGameStatus('searching');
                    this.uiManager.showMessage(message, 2000);
                    return;
                }
                if (message.includes('🔌❌') || message.includes('❌')) {
                    this.uiManager.setConnectionStatus('disconnected');
                    this.uiManager.showMessage(message, 2000);
                    return;
                }
            }
            this.uiManager.showMessage(message, 3000);
        };

        this.multiplayerClient.onLeftQueue = () => {
            if (this.uiManager) {
                // Left matchmaking queue — update game-level status
                this.uiManager.setGameStatus('idle');
                this.uiManager.showMessage('⏹️', 1500);
                this.uiManager.showSearchButton();
            }
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

// Attach and export the app class for module usage
try {
    if (typeof window !== 'undefined') {
        window.RandoChessApp = RandoChessApp;
    }
} catch (e) { /* ignore in non-browser env */ }

export { RandoChessApp };
