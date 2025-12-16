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
        this.takebackLocalRequest = false;
        this.takebackOpponentRequest = false;
        this.drawLocalRequest = false;
        this.drawOpponentRequest = false;
        // Rematch vote state when in online finished match
        this.rematchLocalSelection = null; // 'roll'|'keep'|null
        this.rematchOpponentSelection = null;
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
            // Takeback wiring (handles AI / OTB / Online semantics)
            this.uiManager.onTakebackClick(() => {
                try {
                    // AI opponent: revert to before player's last move (controller handles double-undo)
                    if (this.currentController instanceof AIGameController) {
                        if (typeof this.currentController.takeback === 'function') this.currentController.takeback();
                        // clear any pending local takeback UI state
                        if (this.uiManager && typeof this.uiManager.setTakebackRequested === 'function') this.uiManager.setTakebackRequested(false, false);
                        this.takebackLocalRequest = false; this.takebackOpponentRequest = false;
                        return;
                    }

                    // Hotseat / OTB: single ply takeback
                    if (this.currentController instanceof HotseatController) {
                        if (typeof this.currentController.takeback === 'function') this.currentController.takeback();
                        if (this.uiManager && typeof this.uiManager.setTakebackRequested === 'function') this.uiManager.setTakebackRequested(false, false);
                        this.takebackLocalRequest = false; this.takebackOpponentRequest = false;
                        return;
                    }

                    // Online: send a request and highlight until opponent also requests.
                    if (this.currentController instanceof OnlineGameController) {
                        // If opponent already requested, perform agreed takeback now (two ply)
                        if (this.takebackOpponentRequest) {
                            // Perform double takeback if possible
                            try {
                                // Undo last two plies if available
                                if (this.currentController && typeof this.currentController.takeback === 'function') {
                                    // Attempt two undos; if only one available, controller will fallback
                                    this.currentController.takeback();
                                    this.currentController.takeback && this.currentController.takeback();
                                }
                            } catch (e) { console.warn('Ignored error performing double takeback (game.js)', e); }
                            // notify opponent that takeback was performed
                            if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                                this.onlineSocket.send(JSON.stringify({ type: 'TAKEBACK_PERFORM' }));
                            }
                            this.clearTakebackRequests();
                            return;
                        }

                        // Otherwise send a request and highlight locally
                        this.takebackLocalRequest = true;
                        if (this.uiManager && typeof this.uiManager.setTakebackRequested === 'function') this.uiManager.setTakebackRequested(true, this.takebackOpponentRequest);
                        if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                            this.onlineSocket.send(JSON.stringify({ type: 'TAKEBACK_REQUEST' }));
                        }
                        return;
                    }
                } catch (e) { console.warn('Ignored error in takeback click handler (game.js)', e); }
            });
            // Disable until a move is recorded
            if (typeof this.uiManager.setTakebackEnabled === 'function') this.uiManager.setTakebackEnabled(false);
            this.uiManager.setOpponentStatus('🤖');
            // Attach cancel to cancelOnlineSearch so user can cancel searching
            this.uiManager.onCancelClick(() => this.cancelOnlineSearch());
            // Draw / Forfeit handlers
            if (this.uiManager.onDrawClick) {
                this.uiManager.onDrawClick(() => {
                    try {
                        // AI/local: treat draw as immediate agreement
                        if (this.currentController instanceof AIGameController) {
                            // End as draw
                            try { this.currentController.isActive = false; } catch (e) {}
                            if (this.currentController && this.currentController.engine) this.currentController.engine.gameOver = true;
                            if (this.uiManager) this.uiManager.showMessage('🤝', 0);
                            if (this.uiManager) this.uiManager.stopClock && this.uiManager.stopClock();
                            this.clearDrawRequests();
                            return;
                        }

                        // Hotseat: toggle local draw request; second toggle performs draw
                        if (this.currentController instanceof HotseatController) {
                            if (this.drawLocalRequest) {
                                // Both agreed (local double-click)
                                if (this.currentController && this.currentController.engine) this.currentController.engine.gameOver = true;
                                try { this.currentController.isActive = false; } catch (e) {}
                                if (this.uiManager) this.uiManager.showMessage('🤝', 0);
                                this.clearDrawRequests();
                                return;
                            }
                            this.drawLocalRequest = true;
                            if (this.uiManager && typeof this.uiManager.setDrawRequested === 'function') this.uiManager.setDrawRequested(true, false);
                            return;
                        }

                        // Online: send a request and highlight until opponent also requests.
                        if (this.currentController instanceof OnlineGameController) {
                            if (this.drawOpponentRequest) {
                                // Both agreed -> finalize draw
                                if (this.currentController && this.currentController.engine) this.currentController.engine.gameOver = true;
                                try { this.currentController.isActive = false; } catch (e) {}
                                if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                                    this.onlineSocket.send(JSON.stringify({ type: 'DRAW_PERFORM' }));
                                }
                                if (this.uiManager) {
                                    this.uiManager.showMessage('🤝', 0);
                                    this.uiManager.stopClock && this.uiManager.stopClock();
                                    try {
                                        this.uiManager.showEndmatchControls && this.uiManager.showEndmatchControls();
                                        this.uiManager.setRerollEnabled && this.uiManager.setRerollEnabled(true);
                                        this.uiManager.setResetEnabled && this.uiManager.setResetEnabled(true);
                                    } catch (e) { console.warn('Ignored UI endmatch update error (game.js)', e); }
                                }
                                this.clearDrawRequests();
                                return;
                            }

                            this.drawLocalRequest = true;
                            if (this.uiManager && typeof this.uiManager.setDrawRequested === 'function') this.uiManager.setDrawRequested(true, this.drawOpponentRequest);
                            if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                                this.onlineSocket.send(JSON.stringify({ type: 'DRAW_REQUEST' }));
                            }
                            return;
                        }
                    } catch (e) { console.warn('Ignored error in draw click outer handler (game.js)', e); }
                });
            }

            if (this.uiManager.onForfeitClick) {
                this.uiManager.onForfeitClick(() => {
                    try {
                        if (!this.currentController) return;

                        // Determine the resigning side. For online/AI modes prefer the
                        // controller's `playerColor`, otherwise fall back to currentTurn.
                        let resigning = null;
                        if (this.currentController.playerColor) resigning = this.currentController.playerColor;
                        else if (this.currentController.engine && this.currentController.engine.currentTurn) resigning = this.currentController.engine.currentTurn;
                        // Hotseat: assume the local side to move resigns
                        if (!resigning && this.currentController instanceof HotseatController && this.currentController.engine) resigning = this.currentController.engine.currentTurn;

                        const winner = resigning === 'white' ? 'black' : 'white';

                        // Online: notify opponent with explicit winner so receiver can display correctly
                        if (this.currentController instanceof OnlineGameController) {
                            if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                                this.onlineSocket.send(JSON.stringify({ type: 'RESIGN', winner }));
                            }
                        }

                        // Apply local resignation result
                        try { this.currentController.isActive = false; } catch (e) {}
                        const eng = this.currentController.engine;
                        if (eng) eng.gameOver = true;
                        if (this.uiManager) {
                            if (winner === 'white') this.uiManager.showMessage('⚪✋', 0);
                            else this.uiManager.showMessage('⚫✋', 0);
                            this.uiManager.stopClock && this.uiManager.stopClock();
                            // Show rematch controls for online play
                            try {
                                this.uiManager.showEndmatchControls && this.uiManager.showEndmatchControls();
                                this.uiManager.setRerollEnabled && this.uiManager.setRerollEnabled(true);
                                this.uiManager.setResetEnabled && this.uiManager.setResetEnabled(true);
                            } catch (e) { console.warn('Ignored UI endmatch update error in forfeit handler (game.js)', e); }
                        }
                        // Clear any pending draw/takeback state
                        this.clearDrawRequests();
                        this.clearTakebackRequests();
                    } catch (e) { console.warn('Ignored error in forfeit click handler (game.js)', e); }
                });
            }
            // Reroll / Reset controls (no custom seed input)
            if (this.uiManager.onRerollClick) {
                this.uiManager.onRerollClick(() => {
                    // If we're in an online finished match, this button acts as a "rematch: roll" vote
                    try {
                        if (this.currentController instanceof OnlineGameController && this.currentController.engine && this.currentController.engine.isGameOver && this.currentController.engine.isGameOver()) {
                            // mark local selection and send vote
                            this.rematchLocalSelection = 'roll';
                            if (this.uiManager && this.uiManager.rerollBtn) {
                                this.uiManager.rerollBtn.classList.add('draw-requested');
                                this.uiManager.resetBtn && this.uiManager.resetBtn.classList.remove('draw-requested');
                            }
                            if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                                this.onlineSocket.send(JSON.stringify({ type: 'REMATCH_VOTE', choice: 'roll' }));
                            }
                            return;
                        }

                        // Fallback/local behavior: New random seed -> regenerate pieces and restart current mode
                        const seedVal = Date.now() % 1000000;
                        this.seed = seedVal;
                        this.pieces = PieceGenerator.generateRandomPieces(seedVal);
                        try {
                            if (this.currentController instanceof HotseatController) this.startOTBGame();
                            else this.startAIGame();
                        } catch (e) { this.startAIGame(); }
                    } catch (e) { console.warn('Ignored error in reroll click handler (game.js)', e); }
                });
            }

            if (this.uiManager.onResetClick) {
                this.uiManager.onResetClick(() => {
                    // If we're in an online finished match, this button acts as a "rematch: keep/reset" vote
                    try {
                        if (this.currentController instanceof OnlineGameController && this.currentController.engine && this.currentController.engine.isGameOver && this.currentController.engine.isGameOver()) {
                            this.rematchLocalSelection = 'keep';
                            if (this.uiManager && this.uiManager.resetBtn) {
                                this.uiManager.resetBtn.classList.add('draw-requested');
                                this.uiManager.rerollBtn && this.uiManager.rerollBtn.classList.remove('draw-requested');
                            }
                            if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) {
                                this.onlineSocket.send(JSON.stringify({ type: 'REMATCH_VOTE', choice: 'keep' }));
                            }
                            return;
                        }

                        // Local fallback: Recreate pieces from current seed and restart current mode
                        if (!this.seed && this.pieces && typeof this.pieces.__seed !== 'undefined') {
                            this.seed = this.pieces.__seed;
                        }
                        if (!this.seed) return;
                        this.pieces = PieceGenerator.generateRandomPieces(this.seed);
                        try {
                            if (this.currentController instanceof HotseatController) this.startOTBGame();
                            else this.startAIGame();
                        } catch (e) { this.startAIGame(); }
                    } catch (e) { console.warn('Ignored error in reset click handler (game.js)', e); }
                });
            }
            // Enable reroll/reset by default for local play
            if (this.uiManager.setRerollEnabled) this.uiManager.setRerollEnabled(true);
            if (this.uiManager.setResetEnabled) this.uiManager.setResetEnabled(true);
            if (this.uiManager.setDrawEnabled) this.uiManager.setDrawEnabled(true);
            if (this.uiManager.setForfeitEnabled) this.uiManager.setForfeitEnabled(true);
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
        this.clearTakebackRequests();
        // Update UI to show we're playing AI
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('🤖');
            this.uiManager.showCancelButton();
            if (this.uiManager.setRerollEnabled) this.uiManager.setRerollEnabled(true);
            if (this.uiManager.setResetEnabled) this.uiManager.setResetEnabled(true);

        }
    }

    startOTBGame() {
        if (this.currentController) this.currentController.stop();
        this.currentController = new HotseatController(this.pieces, this.renderer, this.uiManager, this.seed);
        this.renderer.attachEventListener((row, col) => this.currentController.handleSquareClick(row, col));
        this.currentController.start(null, 'white');
        this.clearTakebackRequests();
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('👥');
            this.uiManager.showSearchButton && this.uiManager.showSearchButton();
            if (this.uiManager.setRerollEnabled) this.uiManager.setRerollEnabled(true);
            if (this.uiManager.setResetEnabled) this.uiManager.setResetEnabled(true);
        }
    }

    startOnlineSearch() {
        // Start local AI while showing searching status — multiplayer server is currently disabled/stubbed
        if (this.uiManager) {
            this.uiManager.setOpponentStatus('⏳');
            this.uiManager.setGameStatus('searching');
            this.uiManager.showCancelButton();
            this.uiManager.setThinking('ready');
            if (this.uiManager.setRerollEnabled) this.uiManager.setRerollEnabled(false);
            if (this.uiManager.setResetEnabled) this.uiManager.setResetEnabled(false);
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
                    this.clearTakebackRequests();
                    if (this.uiManager) {
                        this.uiManager.clearMessage();
                        this.uiManager.setOpponentStatus('👤');
                        this.uiManager.setConnectionStatus('connected');
                        if (this.uiManager.setRerollEnabled) this.uiManager.setRerollEnabled(false);
                        if (this.uiManager.setResetEnabled) this.uiManager.setResetEnabled(false);
                    }
                } else if (data.type === 'MOVE') {
                    if (this.currentController && typeof this.currentController.applyRemoteMove === 'function') {
                        this.currentController.applyRemoteMove(data.move);
                        // Any remote move clears pending takeback requests
                        this.clearTakebackRequests();
                    }
                } else if (data.type === 'TAKEBACK_REQUEST') {
                    // Opponent requested a takeback - highlight their request
                    this.takebackOpponentRequest = true;
                    if (this.uiManager && typeof this.uiManager.setTakebackRequested === 'function') this.uiManager.setTakebackRequested(this.takebackLocalRequest, true);
                    // If we already requested locally, agree and perform takeback
                    if (this.takebackLocalRequest) {
                        try {
                            this.currentController && this.currentController.takeback && this.currentController.takeback();
                            this.currentController && this.currentController.takeback && this.currentController.takeback();
                        } catch (e) { console.warn('Ignored error responding to TAKEBACK_REQUEST (game.js)', e); }
                        // inform opponent
                        if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) this.onlineSocket.send(JSON.stringify({ type: 'TAKEBACK_PERFORM' }));
                        this.clearTakebackRequests();
                    }
                } else if (data.type === 'TAKEBACK_PERFORM') {
                    // Opponent confirmed/initiated the takeback - perform it locally if not already
                    try {
                        if (this.currentController && typeof this.currentController.takeback === 'function') {
                            this.currentController.takeback();
                            this.currentController.takeback && this.currentController.takeback();
                        }
                    } catch (e) { console.warn('Ignored error performing TAKEBACK_PERFORM locally (game.js)', e); }
                    this.clearTakebackRequests();
                } else if (data.type === 'DRAW_REQUEST') {
                    // Opponent requested a draw - highlight their request
                    this.drawOpponentRequest = true;
                    if (this.uiManager && typeof this.uiManager.setDrawRequested === 'function') this.uiManager.setDrawRequested(this.drawLocalRequest, true);
                    // If we already requested locally, agree and perform draw
                    if (this.drawLocalRequest) {
                        try {
                            if (this.currentController && this.currentController.engine) this.currentController.engine.gameOver = true;
                            try { this.currentController.isActive = false; } catch (e) { console.warn('Ignored error deactivating controller (game.js)', e); }
                        } catch (e) { console.warn('Ignored error while handling DRAW_REQUEST agree flow (game.js)', e); }
                        if (this.onlineSocket && this.onlineSocket.readyState === WebSocket.OPEN) this.onlineSocket.send(JSON.stringify({ type: 'DRAW_PERFORM' }));
                        if (this.uiManager) this.uiManager.showMessage('🤝', 0);
                        this.clearDrawRequests();
                    }
                } else if (data.type === 'DRAW_PERFORM') {
                    // Opponent accepted/initiated draw - finish locally
                    try {
                        if (this.currentController && this.currentController.engine) this.currentController.engine.gameOver = true;
                        try { this.currentController.isActive = false; } catch (e) {}
                    } catch (e) { console.warn('Ignored error finishing DRAW_PERFORM (game.js)', e); }
                    if (this.uiManager) this.uiManager.showMessage('🤝', 0);
                    // Show rematch controls for online play
                    try {
                        this.uiManager.showEndmatchControls && this.uiManager.showEndmatchControls();
                        this.uiManager.setRerollEnabled && this.uiManager.setRerollEnabled(true);
                        this.uiManager.setResetEnabled && this.uiManager.setResetEnabled(true);
                    } catch (e) { console.warn('Ignored error updating REMATCH_STATUS UI (game.js)', e); }
                    this.clearDrawRequests();
                } else if (data.type === 'REMATCH_STATUS') {
                    // Server informs about rematch vote state for this player
                    try {
                        if (this.uiManager) {
                            this.rematchLocalSelection = data.mySelection || null;
                            this.rematchOpponentSelection = data.opponentSelection || null;
                            // Update visual state on reroll/reset buttons using draw-requested classes
                            if (this.uiManager.rerollBtn) this.uiManager.rerollBtn.classList.toggle('draw-requested', this.rematchLocalSelection === 'roll');
                            if (this.uiManager.resetBtn) this.uiManager.resetBtn.classList.toggle('draw-requested', this.rematchLocalSelection === 'keep');
                            if (this.uiManager.rerollBtn) this.uiManager.rerollBtn.classList.toggle('draw-opponent-requested', this.rematchOpponentSelection === 'roll');
                            if (this.uiManager.resetBtn) this.uiManager.resetBtn.classList.toggle('draw-opponent-requested', this.rematchOpponentSelection === 'keep');
                        }
                    } catch (e) { console.warn('Ignored error updating REMATCH_STATUS visual state (game.js)', e); }
                } else if (data.type === 'REMATCH_RESULT') {
                    // Server decided outcome: either 'reset' (both keep) or 'reroll'
                    try {
                            const action = data.action;
                            const placement = (typeof data.placement !== 'undefined') ? data.placement : null;
                            // If server requested a reroll and provided a seed, regenerate
                            // the piece set and deterministic placement locally before
                            // restarting the online controller. This ensures both clients
                            // use the identical pieces/placement without requiring the
                            // server to send the full generated piece objects.
                            //
                            // Steps:
                            // 1. Store the new seed on `this.seed` so subsequent code
                            //    (and UI) can access it.
                            // 2. Call `PieceGenerator.generateRandomPieces(seed)` which
                            //    produces a deterministic set of pieces for the seed.
                            // 3. Derive placement using `PieceGenerator.generatePlacement`
                            //    with the same seed so placement is deterministic.
                            // 4. Prefer a server-sent `placement` when present; otherwise
                            //    fall back to the locally computed placement.
                            if (action === 'reroll' && typeof data.seed !== 'undefined' && data.seed !== null) {
                                try {
                                    this.seed = data.seed;
                                    // regenerate the full piece definitions deterministically
                                    this.pieces = PieceGenerator.generateRandomPieces(this.seed);
                                    try {
                                        if (typeof PieceGenerator.generatePlacement === 'function') {
                                            // generate placement deterministically from the seed
                                            const genPlacement = PieceGenerator.generatePlacement(this.pieces, this.seed);
                                            // prefer server-provided placement when available;
                                            // otherwise, use our locally generated placement
                                            data.placement = placement || genPlacement;
                                        }
                                    } catch (e) { console.warn('Placement generation error during rematch (game.js)', e); }
                                } catch (e) { console.warn('Piece regeneration error during rematch (game.js)', e); }
                            }

                            // Restart online controller with new placement (server-provided or locally generated)
                            try {
                                // Remember previous player color so we can switch on rematch
                                const prevColor = (this.currentController && this.currentController.playerColor) ? this.currentController.playerColor : null;
                                // Stop existing controller
                                if (this.currentController) {
                                    try { this.currentController.stop(); } catch (e) {}
                                }
                                // Always switch colors for rematch: flip previous color if available
                                const color = prevColor ? (prevColor === 'white' ? 'black' : 'white') : (data.color || 'white');
                                // If placement provided, use it; otherwise reuse current pieces/placement
                                const newPlacement = (placement || data.placement) || (this.currentController && this.currentController.engine && this.currentController.engine.placement) || null;
                                this.currentController = new OnlineGameController(this.pieces, this.renderer, this.uiManager, this.onlineSocket, color, this.seed);
                                this.renderer.attachEventListener((row, col) => this.currentController.handleSquareClick(row, col));
                                this.currentController.start(newPlacement, color);
                            } catch (e) { console.warn('Failed to restart after rematch result', e); }

                        // Clear rematch UI highlights
                        this.rematchLocalSelection = null;
                        this.rematchOpponentSelection = null;
                        if (this.uiManager) {
                            if (this.uiManager.rerollBtn) this.uiManager.rerollBtn.classList.remove('draw-requested', 'draw-opponent-requested');
                            if (this.uiManager.resetBtn) this.uiManager.resetBtn.classList.remove('draw-requested', 'draw-opponent-requested');
                            this.uiManager.hideEndmatchControls && this.uiManager.hideEndmatchControls();
                            this.uiManager.setRerollEnabled && this.uiManager.setRerollEnabled(false);
                            this.uiManager.setResetEnabled && this.uiManager.setResetEnabled(false);
                        }
                    } catch (e) { /* ignore */ }
                } else if (data.type === 'RESIGN') {
                    // Opponent resigned - they lose, we win. Use explicit winner from server if provided.
                    try {
                        if (this.currentController && this.currentController.engine) this.currentController.engine.gameOver = true;
                        try { if (this.currentController) this.currentController.isActive = false; } catch (e) {}
                    } catch (e) { /* ignore */ }

                    let winner = data && data.winner ? data.winner : null;
                    // If server didn't include a winner, assume the receiver is the winner when online
                    if (!winner) {
                        const ourColor = (this.currentController && this.currentController.playerColor) ? this.currentController.playerColor : null;
                        if (ourColor) winner = ourColor;
                        else winner = 'white';
                    }

                    if (this.uiManager) {
                        if (winner === 'white') this.uiManager.showMessage('⚪✋', 0);
                        else if (winner === 'black') this.uiManager.showMessage('⚫✋', 0);
                        else this.uiManager.showMessage('🏁', 0);
                        this.uiManager.stopClock && this.uiManager.stopClock();
                        // Show rematch controls for online play
                        try {
                            this.uiManager.showEndmatchControls && this.uiManager.showEndmatchControls();
                            this.uiManager.setRerollEnabled && this.uiManager.setRerollEnabled(true);
                            this.uiManager.setResetEnabled && this.uiManager.setResetEnabled(true);
                        } catch (e) { console.warn('Ignored error finishing REMATCH_RESULT flow (game.js)', e); }
                    }
                    this.clearDrawRequests();
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

    clearTakebackRequests() {
        this.takebackLocalRequest = false;
        this.takebackOpponentRequest = false;
        if (this.uiManager && typeof this.uiManager.setTakebackRequested === 'function') this.uiManager.setTakebackRequested(false, false);
    }

    clearDrawRequests() {
        this.drawLocalRequest = false;
        this.drawOpponentRequest = false;
        if (this.uiManager && typeof this.uiManager.setDrawRequested === 'function') this.uiManager.setDrawRequested(false, false);
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
                if (this.uiManager.setRerollEnabled) this.uiManager.setRerollEnabled(false);
                if (this.uiManager.setResetEnabled) this.uiManager.setResetEnabled(false);
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
