// ===== RandoChess - Main Application =====
// Coordinates all modules and manages application state

import { PieceGenerator } from './Generator.js';
import { BoardRenderer, UIManager } from './renderer.js';
import { AIGameController, HotseatController, OnlineGameController } from './controllers.js';

class RandoChessApp {
    constructor() {
        this.pieces = null;
        this.renderer = null;
        this.uiManager = null;
        this.currentController = null;
        this.multiplayerClient = null;
    }

    initialize() {
        // Generate initial pieces. Allow seed from URL query `?seed=NUMBER` or via UI.
        const urlParams = new URLSearchParams(window.location.search || '');
        const seedParam = urlParams.get('seed');
        const seed = seedParam ? Number(seedParam) : null;
        this.seed = seed || null;
        this.pieces = PieceGenerator.generateRandomPieces(this.seed);
        // If no seed was provided, the generator chose one; read it back so
        // the UI can display the actual seed used.
        if (this.seed === null && this.pieces && typeof this.pieces.__seed !== 'undefined') {
            this.seed = this.pieces.__seed;
        }
        
        // Set up UI
        this.renderer = new BoardRenderer(document.getElementById('board'));
        this.uiManager = new UIManager();
        
        // Wire mode buttons
        if (this.uiManager) {
            this.uiManager.onModePlayAIClick(() => this.startAIGame());
            this.uiManager.onModeOTBClick(() => this.startOTBGame());
            this.uiManager.onModeOnlineClick(() => this.startOnlineSearch());
            this.uiManager.setOpponentStatus('🤖');
            // Attach cancel to cancelOnlineSearch so user can cancel searching
            this.uiManager.onCancelClick(() => this.cancelOnlineSearch());
            // Seed control: apply seed from input (or roll a new seed when blank)
            this.uiManager.onSeedRollClick(() => {
                const originalVal = this.uiManager.getSeedInputValue();
                let seedVal = null;
                if (originalVal && originalVal.trim().length > 0) {
                    // try parse as number, fall back to hashing string
                    const n = Number(originalVal);
                    seedVal = Number.isFinite(n) ? n : this.hashStringToSeed(originalVal);
                } else {
                    seedVal = Date.now() % 1000000;
                    // For rolled seeds, show the numeric seed in the input
                    this.uiManager.setSeedInputValue(seedVal);
                }

                this.seed = seedVal;
                this.pieces = PieceGenerator.generateRandomPieces(seedVal);

                // Preserve the user's exact input text when they typed one.
                // Only overwrite the input when it was originally blank (we rolled a seed).
                if (!originalVal || originalVal.trim().length === 0) {
                    if (this.uiManager) this.uiManager.setSeedInputValue(this.seed);
                }

                // restart the current view/game with the new pieces (start AI by default)
                this.startAIGame();
            });
            // If there was a seed from the URL, show it in the input
            if (this.seed) {
                this.uiManager.setSeedInputValue(this.seed);
            }
        }

        // Start default AI game
        this.startAIGame();
    }

    hashStringToSeed(s) {
        // Simple deterministic string -> integer hash (32-bit unsigned)
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h % 1000000;
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
            this.seed
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

    startOTBGame() {
        if (this.currentController) this.currentController.stop();
        this.currentController = new HotseatController(this.pieces, this.renderer, this.uiManager, this.seed);
        this.renderer.attachEventListener((row, col) => this.currentController.handleSquareClick(row, col));
        this.currentController.start(null, 'white');
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('👥');
            this.uiManager.showSearchButton && this.uiManager.showSearchButton();
        }
    }

    startOnlineSearch() {
        // Start local AI while showing searching status — multiplayer server is currently disabled/stubbed
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('⏳');
            this.uiManager.setGameStatus('searching');
            this.uiManager.showCancelButton();
            this.uiManager.setThinking('ready');
        }

        // Establish WebSocket connection to server and join queue
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            this.onlineSocket = new WebSocket(wsUrl);

            this.onlineSocket.onopen = () => {
                const serializedPieces = PieceSerializer.serialize(this.pieces);
                this.onlineSocket.send(JSON.stringify({ type: 'JOIN_QUEUE', pieces: serializedPieces, seed: this.seed }));
            };

            this.onlineSocket.onmessage = (ev) => {
                let data = null;
                try { data = JSON.parse(ev.data); } catch (e) { return; }
                if (!data || !data.type) return;

                if (data.type === 'WAITING') {
                    if (this.uiManager) this.uiManager.showMessage(data.message || '⏳', 2000);
                } else if (data.type === 'MATCHED') {
                    // Deserialize pieces from server
                    const deserialized = PieceSerializer.deserialize(data.pieces);
                    this.pieces = deserialized;
                    // Stop any local controller
                    if (this.currentController) this.currentController.stop();

                    // Start online controller (pass seed if provided)
                    if (data.seed) this.seed = data.seed;
                    this.currentController = new OnlineGameController(this.pieces, this.renderer, this.uiManager, this.onlineSocket, data.color, this.seed);
                    this.renderer.attachEventListener((row, col) => this.currentController.handleSquareClick(row, col));
                    this.currentController.start(data.placement, data.color);
                    if (this.uiManager) {
                        this.uiManager.clearMessage();
                        this.uiManager.setOpponentStatus('👤');
                        this.uiManager.setConnectionStatus('connected');
                    }
                } else if (data.type === 'MOVE') {
                    if (this.currentController && typeof this.currentController.applyRemoteMove === 'function') {
                        this.currentController.applyRemoteMove(data.move);
                    }
                } else if (data.type === 'OPPONENT_LEFT') {
                    if (this.uiManager) {
                        this.uiManager.showMessage('👤❌➡️🤖', 3000);
                        this.uiManager.setOpponentStatus('🤖');
                        this.uiManager.setConnectionStatus('disconnected');
                        this.uiManager.setGameStatus('idle');
                    }
                    setTimeout(() => this.startAIGame(), 500);
                }
            };

            this.onlineSocket.onerror = (e) => { if (this.uiManager) this.uiManager.showMessage('⚠️', 2000); };

            this.onlineSocket.onclose = () => {
                if (this.uiManager) this.uiManager.setConnectionStatus('disconnected');
            };

            // Start AI locally while searching so user can play until matched
            if (!(this.currentController instanceof AIGameController)) this.startAIGame();
        } catch (e) {
            console.warn('Failed to start online search', e);
            if (!(this.currentController instanceof AIGameController)) this.startAIGame();
        }
    }

    cancelOnlineSearch() {
        // Cancel search and ensure AI game is running
        if (this.uiManager) {
            this.uiManager.setGameStatus('idle');
            this.uiManager.setOpponentStatus('🤖');
            this.uiManager.showSearchButton();
            this.uiManager.setThinking('idle');
            this.uiManager.setClock('00:00');
        }
        this.startAIGame();
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
