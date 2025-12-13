// ===== Board Renderer =====
// Pure UI rendering with no game logic

class BoardRenderer {
    constructor(boardElement) {
        this.boardElement = boardElement;
        this.movementOverlay = document.getElementById('movement-overlay');
        this.playerColor = null; // 'white', 'black', or null for white's perspective
        this.defeatedColor = null; // when set to 'white' or 'black', show royal as defeated for that side
        this.selectedSquare = null; // {row, col}
        this.validMoves = []; // [{row, col}]
        this.theoreticalMoves = new Map(); // position -> {canMove, canCapture}
        this.unrestrictedPattern = new Map(); // Extended pattern for visualization
        this.onSquareClick = null; // Callback for square clicks
    }

    setPlayerColor(color) {
        this.playerColor = color;
    }

    setSelection(square, validMoves = [], theoreticalMoves = new Map(), unrestrictedPattern = new Map()) {
        this.selectedSquare = square;
        this.validMoves = validMoves;
        this.theoreticalMoves = theoreticalMoves;
        this.unrestrictedPattern = unrestrictedPattern;
        this.renderMovementOverlay();
    }

    clearSelection() {
        this.selectedSquare = null;
        this.validMoves = [];
        this.theoreticalMoves = new Map();
        this.unrestrictedPattern = new Map();
        this.renderMovementOverlay();
    }

    // Render the extended movement pattern overlay
    renderMovementOverlay() {
        if (!this.movementOverlay) return;
        
        this.movementOverlay.innerHTML = '';
        
        if (!this.selectedSquare || this.unrestrictedPattern.size === 0) {
            this.movementOverlay.style.display = 'none';
            return;
        }
        
        this.movementOverlay.style.display = 'grid';
        
        // Calculate grid bounds based on movement pattern
        let minRow = this.selectedSquare.row;
        let maxRow = this.selectedSquare.row;
        let minCol = this.selectedSquare.col;
        let maxCol = this.selectedSquare.col;
        
        for (const key of this.unrestrictedPattern.keys()) {
            const [row, col] = key.split(',').map(Number);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
        }
        
        // Ensure we show at least some context
        minRow = Math.min(minRow, -2);
        maxRow = Math.max(maxRow, 9);
        minCol = Math.min(minCol, -2);
        maxCol = Math.max(maxCol, 9);
        
        const rows = maxRow - minRow + 1;
        const cols = maxCol - minCol + 1;
        
        // Set up grid with exact square sizes matching the board
        this.movementOverlay.style.gridTemplateColumns = `repeat(${cols}, 75px)`;
        this.movementOverlay.style.gridTemplateRows = `repeat(${rows}, 75px)`;
        
        // Position the overlay so the board squares align perfectly
        // The board always shows row 0 at the top (for white) or row 7 at top (for black)
        // We need to align square [0,0] in both grids
        let offsetRow, offsetCol;
        
        if (this.playerColor === 'black') {
            // Black perspective: row 7 is at top, row 0 at bottom
            offsetRow = maxRow - 7;
            offsetCol = maxCol - 7;
        } else {
            // White perspective: row 0 is at top, row 7 at bottom
            offsetRow = 0 - minRow;
            offsetCol = 0 - minCol;
        }
        
        const topOffset = -offsetRow * 75;
        const leftOffset = -offsetCol * 75;
        
        this.movementOverlay.style.top = `${topOffset}px`;
        this.movementOverlay.style.left = `${leftOffset}px`;
        
        // Render grid from player's perspective
        const startRow = this.playerColor === 'black' ? maxRow : minRow;
        const endRow = this.playerColor === 'black' ? minRow - 1 : maxRow + 1;
        const rowStep = this.playerColor === 'black' ? -1 : 1;
        const startCol = this.playerColor === 'black' ? maxCol : minCol;
        const endCol = this.playerColor === 'black' ? minCol - 1 : maxCol + 1;
        const colStep = this.playerColor === 'black' ? -1 : 1;
        
        for (let row = startRow; row !== endRow; row += rowStep) {
            for (let col = startCol; col !== endCol; col += colStep) {
                const square = document.createElement('div');
                square.className = 'overlay-square';
                
                // Check if this is on the actual board
                const onBoard = row >= 0 && row <= 7 && col >= 0 && col <= 7;
                if (onBoard) {
                    square.classList.add('on-board');
                }
                
                // Add checkerboard pattern
                if ((row + col) % 2 === 0) {
                    square.classList.add('light');
                } else {
                    square.classList.add('dark');
                }
                
                // Check if this square is in the unrestricted pattern
                const key = `${row},${col}`;
                const move = this.unrestrictedPattern.get(key);
                
                // Don't show overlay on legal move squares (they're already highlighted green)
                const isLegalMove = onBoard && this.validMoves.some(m => m.row === row && m.col === col);
                
                if (move && !isLegalMove) {
                    const dot = document.createElement('div');
                    dot.className = 'overlay-dot';
                    square.appendChild(dot);
                }
                
                this.movementOverlay.appendChild(square);
            }
        }
    }

    // Render the board state
    // `lastMove` is optional: {fromRow, fromCol, toRow, toCol}
    // `engine` is optional: provide to enable hover threat computation
    render(board, lastMove = null, engine = null) {
        this.boardElement.innerHTML = '';

        // Render from player's perspective
        const startRow = this.playerColor === 'black' ? 7 : 0;
        const endRow = this.playerColor === 'black' ? -1 : 8;
        const rowStep = this.playerColor === 'black' ? -1 : 1;
        const startCol = this.playerColor === 'black' ? 7 : 0;
        const endCol = this.playerColor === 'black' ? -1 : 8;
        const colStep = this.playerColor === 'black' ? -1 : 1;

        for (let row = startRow; row !== endRow; row += rowStep) {
            for (let col = startCol; col !== endCol; col += colStep) {
                const square = document.createElement('div');
                square.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
                square.dataset.row = row;
                square.dataset.col = col;

                const cellData = board[row][col];
                if (cellData) {
                    // Create canvas icon showing movement pattern (use 80 which divides evenly by 8)
                    // Pass player perspective so pieces flip when viewing as black
                    // Determine if this piece is on its promotion square (automatic move-upgrade promotions)
                    const isPromotionSquare = (cellData.piece.promotionType === 'move-upgrade') &&
                        ((cellData.color === 'white' && row === 0) || (cellData.color === 'black' && row === 7));

                    const defeated = this.defeatedColor && cellData.piece.royal && cellData.color === this.defeatedColor;
                    const pieceIcon = PieceGenerator.createMovementPatternIcon(cellData.piece, 80, cellData.color, this.playerColor, isPromotionSquare, defeated);
                    pieceIcon.className = `piece ${cellData.color}`;
                    if (cellData.piece.royal) {
                        pieceIcon.classList.add('royal');
                    }
                    square.appendChild(pieceIcon);

                    // Attach hover listeners for all pieces so hovering shows threatened
                    // squares for both white and black pieces (previously only attached
                    // for enemy pieces relative to the viewer).
                    {
                        // Add hover listeners on the square to show threatened squares
                        // Use the provided engine if available, otherwise try global app controller
                        square.addEventListener('mouseenter', (e) => {
                            try {
                                const eng = engine || (window && window.randoChessApp && window.randoChessApp.currentController && window.randoChessApp.currentController.engine) || null;
                                if (!eng) return;
                                // Compute legal moves (takes blocking, captures, and king safety into account)
                                const moves = typeof eng.getValidMoves === 'function' ? eng.getValidMoves(row, col) : [];
                                const threatened = [];
                                for (const mv of moves) {
                                    const r = mv.row, c = mv.col;
                                    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
                                    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
                                    const sq = this.boardElement.querySelector(`.square[data-row="${r}"][data-col="${c}"]`);
                                    if (sq) {
                                        sq.classList.add('threat');
                                        threatened.push(sq);
                                    }
                                }
                                // Store for cleanup
                                square._threatenedSquares = threatened;
                            } catch (e) { /* ignore in test env */ }
                        });

                        square.addEventListener('mouseleave', (e) => {
                            const list = square._threatenedSquares;
                            if (list && Array.isArray(list)) {
                                for (const s of list) {
                                    if (s) s.classList.remove('threat');
                                }
                            }
                            square._threatenedSquares = null;
                        });
                    }
                }

                // Highlight selected square
                if (this.selectedSquare && this.selectedSquare.row === row && this.selectedSquare.col === col) {
                    square.classList.add('selected');
                }

                // Show valid moves
                const isValidMove = this.validMoves.some(m => m.row === row && m.col === col);
                if (isValidMove) {
                    square.classList.add('valid-move');
                }

                // Highlight last move (from/to)
                if (lastMove) {
                    const fromMatch = lastMove.fromRow === row && lastMove.fromCol === col;
                    const toMatch = lastMove.toRow === row && lastMove.toCol === col;
                    if (fromMatch || toMatch) {
                        square.classList.add('last-move');
                        if (fromMatch) square.classList.add('last-move-from');
                        if (toMatch) square.classList.add('last-move-to');
                    }
                }

                this.boardElement.appendChild(square);
            }
        }
    }

    // Attach click event listener
    attachEventListener(callback) {
        this.onSquareClick = callback;
        
        this.boardElement.addEventListener('click', (e) => {
            const square = e.target.closest('.square');
            if (!square) return;

            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);

            if (this.onSquareClick) {
                this.onSquareClick(row, col);
            }
        });
    }
}

// UI Manager for messages and controls
class UIManager {
    constructor() {
        // HUD elements consolidated into #opponent-status
        this.hudContainer = document.getElementById('opponent-status');
        this.opponentElement = this.hudContainer; // legacy name
        this.opponentIcon = document.getElementById('opponent-icon');
        this.connectionBubble = document.getElementById('connection-bubble');
        this.connectionIcon = document.getElementById('connection-icon');
        this.gameBubble = document.getElementById('game-bubble');
        this.gameIcon = document.getElementById('game-icon');
        this.thinkingBubble = document.getElementById('thinking-bubble');
        this.clockPlayer = document.getElementById('clock-player');
        this.clockOpponent = document.getElementById('clock-opponent');
        this.messageElement = document.getElementById('hud-message'); // unused currently but kept
        this.turnElement = document.getElementById('current-turn');
        this.searchButton = document.getElementById('toggle-search-btn');
        this.endmatchControls = document.getElementById('endmatch-controls');
        this.rematchRollBtn = document.getElementById('rematch-roll-btn');
        this.rematchKeepBtn = document.getElementById('rematch-keep-btn');
        this.newOpponentBtn = document.getElementById('new-opponent-btn');
        this.aiMatchBtn = document.getElementById('ai-match-btn');
        this.promotionDialog = document.getElementById('promotion-dialog');
        this.promotionChoices = document.getElementById('promotion-choices');
        this.modePlayAIButton = document.getElementById('btn-play-ai');
        this.modeOTBButton = document.getElementById('btn-play-otb');
        this.modeOnlineButton = document.getElementById('btn-play-online');
        this.resultOverlay = document.getElementById('result-overlay');
        this.resultEmoji = document.getElementById('result-emoji');
        this.resultTitle = document.getElementById('result-title');
        this.resultSubtitle = document.getElementById('result-subtitle');
        this.permanentStatus = ''; // Store permanent status message (like search status)
        this.messageTimeout = null; // Track active message timeout
        // Clock / time-control state
        this.clockInterval = null;
        this.clockOwner = null; // 'player'|'ai'|'opponent'
        this.timeControl = { base: 300, inc: 15 };
        this.remaining = { player: this.timeControl.base, opponent: this.timeControl.base, ai: this.timeControl.base };
    }

    // Game status bubble (separate from low-level connection status)
    // token can be a short emoji or a semantic key like 'searching'|'idle'|'in-game'
    setGameStatus(token) {
        if (!this.gameBubble) return;
        const map = {
            searching: '🔍',
            waiting: '⏳',
            'in-game': '♟️',
            idle: '⏹️',
            finished: '🏁'
        };
        const emoji = token && token.length <= 2 ? token : (map[token] || token || '⏳');
        if (this.gameIcon) this.gameIcon.textContent = emoji;
        else this.gameBubble.textContent = emoji;
    }

    showMessage(msg, duration = 3000) {
        // If this looks like a permanent game result token (used across controllers), show the large overlay
        const resultMap = {
            '🤝': { emoji: '🤝', title: 'Stalemate', subtitle: 'Draw' },
            '⚪🏁': { emoji: '⚪', title: 'Checkmate', subtitle: 'White wins' },
            '⚫🏁': { emoji: '⚫', title: 'Checkmate', subtitle: 'Black wins' }
        };
        if (duration === 0 && resultMap[msg]) {
            const info = resultMap[msg];
            this.showResult(info.emoji, info.title, info.subtitle);
            return;
        }
        // Show short, emoji-only messages in the connection bubble if available.
        // Store previous connection icon so we can restore it after the timeout.
        if (this.connectionIcon || this.connectionBubble) {
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
                this.messageTimeout = null;
            }

            if (duration === 0) {
                // Permanent status: store as permanentConnection and show
                this.permanentStatus = msg;
                if (this.connectionIcon) this.connectionIcon.textContent = msg;
                else if (this.connectionBubble) this.connectionBubble.textContent = msg;
            } else {
                // Temporary message: show then restore previous permanent
                // Keep current shown to restore later
                const prev = this.connectionIcon ? this.connectionIcon.textContent : (this.connectionBubble ? this.connectionBubble.textContent : '');
                if (this.connectionIcon) this.connectionIcon.textContent = msg;
                else if (this.connectionBubble) this.connectionBubble.textContent = msg;
                this.messageTimeout = setTimeout(() => {
                    if (this.permanentStatus) {
                        if (this.connectionIcon) this.connectionIcon.textContent = this.permanentStatus;
                        else if (this.connectionBubble) this.connectionBubble.textContent = this.permanentStatus;
                    } else {
                        if (this.connectionIcon) this.connectionIcon.textContent = prev;
                        else if (this.connectionBubble) this.connectionBubble.textContent = prev;
                    }
                    this.messageTimeout = null;
                }, duration);
            }
            return;
        }

        // Fallback: if no connection bubble, use messageElement if present
        if (this.messageElement) {
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
                this.messageTimeout = null;
            }
            if (duration === 0) {
                this.permanentStatus = msg;
                this.messageElement.textContent = msg;
            } else {
                this.messageElement.textContent = msg;
                this.messageTimeout = setTimeout(() => {
                    this.restorePermanentStatus();
                    this.messageTimeout = null;
                }, duration);
            }
        }
    }

    restorePermanentStatus() {
        // Restore permanent connection/icon status
        if ((this.connectionIcon || this.connectionBubble) && this.permanentStatus) {
            if (this.connectionIcon) this.connectionIcon.textContent = this.permanentStatus;
            else if (this.connectionBubble) this.connectionBubble.textContent = this.permanentStatus;
            return;
        }

        if (this.messageElement && this.permanentStatus) {
            this.messageElement.textContent = this.permanentStatus;
            return;
        }

        this.clearMessage();
    }

    clearMessage() {
        this.permanentStatus = '';
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
        if (this.connectionIcon) this.connectionIcon.textContent = '';
        if (this.connectionBubble) this.connectionBubble.textContent = '';
        if (this.messageElement) this.messageElement.textContent = '';
    }

    updateTurn(color) {
        if (this.turnElement) {
            const emoji = color === 'white' ? '⚪' : (color === 'black' ? '⚫' : '🤝');
            this.turnElement.textContent = emoji;
        }
        // Toggle body classes so CSS can change visuals for each turn
        try {
            document.body.classList.toggle('turn-black', color === 'black');
            document.body.classList.toggle('turn-white', color === 'white');
        } catch (e) {
            // ignore when document isn't available (tests / non-browser env)
        }
    }

    disableSearchButton() {
        if (this.searchButton) {
            this.searchButton.disabled = true;
            this.searchButton.textContent = '⏳';
        }
    }

    hideSearchButton() {
        if (this.searchButton) {
            this.searchButton.style.display = 'none';
        }
    }

    showSearchButton() {
        if (this.searchButton) {
            this.searchButton.style.display = 'block';
            this.searchButton.disabled = false;
            // Use a distinct start glyph so the connection bubble owns the magnifier
            this.searchButton.textContent = '▶';
            this.searchButton.classList.remove('cancel');
            this.searchButton.classList.add('search');
            this.searchButton.title = 'Start search';
            // Ensure the active click handler matches the search handler if present
            if (this._searchHandler) this.searchButton.onclick = this._searchHandler;
        }
    }

    showCancelButton() {
        if (this.searchButton) {
            this.searchButton.style.display = 'block';
            this.searchButton.disabled = false;
            this.searchButton.textContent = '⏹';
            // Make cancel visually prominent
            this.searchButton.classList.remove('search');
            this.searchButton.classList.add('cancel');
            this.searchButton.title = 'Cancel search';
            // Attach cancel handler if present
            if (this._cancelHandler) this.searchButton.onclick = this._cancelHandler;
        }
    }

    // Set a persistent opponent type/status: 'AI', 'Human', 'Searching', or custom text
    setOpponentStatus(text) {
        // Primary visual is the opponent icon (emoji)
        if (this.opponentIcon) {
            this.opponentIcon.textContent = text;
        }
    }

    clearOpponentStatus() {
        if (this.opponentIcon) this.opponentIcon.textContent = '';
        if (this.messageElement) this.messageElement.textContent = '';
        if (this.connectionBubble) this.connectionBubble.textContent = '';
        if (this.connectionIcon) this.connectionIcon.textContent = '';
        if (this.thinkingBubble) this.thinkingBubble.textContent = '';
        if (this.clockPlayer) this.clockPlayer.textContent = '';
        if (this.clockOpponent) this.clockOpponent.textContent = '';
    }

    // Connection/search status bubble
    // Accept either an emoji/symbol or a semantic key. Keep HUD alingual.
    setConnectionStatus(token) {
        if (!this.connectionBubble) return;
        // If caller passed an explicit emoji/token, use it. Otherwise map keys.
        const map = {
            searching: '🔍',
            connected: '✅',
            disconnected: '❌',
            idle: '⏹️'
        };
        const emoji = token && token.length <= 2 ? token : (map[token] || token || '⚡');
        // update icon node if present, otherwise set bubble text
        if (this.connectionIcon) this.connectionIcon.textContent = emoji;
        else this.connectionBubble.textContent = emoji;
    }

    // Indicate thinking state or short text in the thinking bubble
    setThinking(token) {
        if (!this.thinkingBubble) return;
        const map = {
            ready: '🧠',
            thinking: '💭',
            idle: '—'
        };
        const emoji = token && token.length <= 2 ? token : (map[token] || token || '');
        this.thinkingBubble.textContent = emoji;
    }

    // Set both clocks manually (keeps alingual format). If passed a numeric string like '00:00', applies to both.
    setClock(text) {
        const hasDigits = /\d/.test(text || '');
        const content = hasDigits ? `⏱️ ${text}` : (text || '⏱️ 00:00');
        if (this.clockPlayer) this.clockPlayer.textContent = content;
        if (this.clockOpponent) this.clockOpponent.textContent = content;
    }

    // Time-control setup: base seconds and increment seconds
    setTimeControl(baseSeconds, incrementSeconds) {
        this.timeControl.base = Number(baseSeconds) || 300;
        this.timeControl.inc = Number(incrementSeconds) || 15;
        // Initialize remaining times
        this.remaining.player = this.timeControl.base;
        this.remaining.opponent = this.timeControl.base;
        this.remaining.ai = this.timeControl.base;
        this.renderClocks();
    }

    // Add increment to owner's remaining time (owner: 'player'|'opponent'|'ai')
    addIncrement(owner) {
        if (!owner) return;
        const inc = this.timeControl.inc || 0;
        if (!this.remaining[owner]) this.remaining[owner] = 0;
        this.remaining[owner] = Math.max(0, this.remaining[owner] + inc);
        this.renderClocks();
    }

    // Render both clock displays from remaining times
    renderClocks() {
        if (this.clockPlayer) this.clockPlayer.textContent = `⏱️ ${this.formatTime(this.remaining.player)}`;
        if (this.clockOpponent) this.clockOpponent.textContent = `⏱️ ${this.formatTime(this.remaining.opponent)}`;
    }

    // Start decrementing the clock for the given owner (player/opponent/ai)
    startClock(owner) {
        if (!owner) return;
        // stop any existing interval
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
        this.clockOwner = owner;
        // Ensure remaining time exists
        if (typeof this.remaining[owner] === 'undefined') this.remaining[owner] = this.timeControl.base;
        // Show thinking icon if AI
        if (owner === 'ai') this.setThinking('thinking');
        else this.setThinking('');
        this.renderClocks();

        this.clockInterval = setInterval(() => {
            if (typeof this.remaining[owner] === 'undefined') return;
            this.remaining[owner] = Math.max(0, this.remaining[owner] - 1);
            this.renderClocks();
            // If time runs out, stop interval and show timeout symbol
            if (this.remaining[owner] <= 0) {
                clearInterval(this.clockInterval);
                this.clockInterval = null;
                this.setThinking('');
                if (this.connectionIcon) this.connectionIcon.textContent = '⏳';
            }
        }, 1000);
    }

    stopClock() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
        this.clockOwner = null;
    }

    formatTime(seconds) {
        const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
        const ss = (seconds % 60).toString().padStart(2, '0');
        return `${mm}:${ss}`;
    }

    onSearchClick(callback) {
        // Register a search handler and attach it when the button is in search mode
        this._searchHandler = callback;
        if (this.searchButton && this.searchButton.textContent === '🔍') {
            this.searchButton.onclick = callback;
        }
    }

    onCancelClick(callback) {
        // Register a cancel handler and attach it when the button is in cancel mode
        this._cancelHandler = callback;
        if (this.searchButton && this.searchButton.textContent === '✖') {
            this.searchButton.onclick = callback;
        }
    }

    // End-of-match controls
    showEndmatchControls() {
        if (this.endmatchControls) {
            this.endmatchControls.classList.remove('hidden');
        }
    }

    hideEndmatchControls() {
        if (this.endmatchControls) {
            this.endmatchControls.classList.add('hidden');
        }
        // clear any rematch highlights
        if (this.rematchRollBtn) this.rematchRollBtn.classList.remove('selected');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.remove('selected');
        if (this.rematchRollBtn) this.rematchRollBtn.classList.remove('opponent-selected');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.remove('opponent-selected');
    }

    onRematchRollClick(callback) {
        if (this.rematchRollBtn) this.rematchRollBtn.addEventListener('click', callback);
    }

    onRematchKeepClick(callback) {
        if (this.rematchKeepBtn) this.rematchKeepBtn.addEventListener('click', callback);
    }

    onModePlayAIClick(callback) {
        if (this.modePlayAIButton) this.modePlayAIButton.addEventListener('click', callback);
    }

    onModeOTBClick(callback) {
        if (this.modeOTBButton) this.modeOTBButton.addEventListener('click', callback);
    }

    onModeOnlineClick(callback) {
        if (this.modeOnlineButton) this.modeOnlineButton.addEventListener('click', callback);
    }

    onNewOpponentClick(callback) {
        if (this.newOpponentBtn) this.newOpponentBtn.addEventListener('click', callback);
    }

    onAIMatchClick(callback) {
        if (this.aiMatchBtn) this.aiMatchBtn.addEventListener('click', callback);
    }

    // Visualize rematch selection state. mySelection: 'roll'|'keep'|null, opponentSelection: same
    setRematchSelections(mySelection, opponentSelection) {
        if (this.rematchRollBtn) this.rematchRollBtn.classList.toggle('selected', mySelection === 'roll');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.toggle('selected', mySelection === 'keep');

        // Indicate opponent selection by adding a faint highlight
        if (this.rematchRollBtn) this.rematchRollBtn.classList.toggle('opponent-selected', opponentSelection === 'roll');
        if (this.rematchKeepBtn) this.rematchKeepBtn.classList.toggle('opponent-selected', opponentSelection === 'keep');
    }

    showPromotionDialog(pieces, color, onChoose) {
        if (!this.promotionDialog || !this.promotionChoices) return;

        // Clear previous choices
        this.promotionChoices.innerHTML = '';

        // Build list of visible choices (preserve original indices) and exclude royals
        const choices = pieces
            .map((piece, idx) => ({ piece, idx }))
            .filter(item => !item.piece.royal);

        if (choices.length === 0) {
            // Nothing to choose (shouldn't normally happen) - fallback to first piece
            console.warn('No promotion choices available (all pieces royal?). Defaulting to first.');
            this.hidePromotionDialog();
            onChoose(0);
            return;
        }

        // Create choice buttons showing only the generated icon on a neutral gray background
        choices.forEach(({ piece, idx }) => {
            const choice = document.createElement('div');
            choice.className = 'promotion-choice';
            // Neutral gray background for each icon
            choice.style.background = '#808080';
            choice.style.width = '100px';
            choice.style.height = '100px';
            choice.style.display = 'flex';
            choice.style.alignItems = 'center';
            choice.style.justifyContent = 'center';
            choice.style.cursor = 'pointer';
            choice.style.border = 'none';
            choice.style.padding = '6px';

            // Try to generate and add the movement pattern icon
                try {
                const icon = PieceGenerator.createMovementPatternIcon(piece, 80, 'white', 'white', false, false);
                icon.style.display = 'block';
                icon.style.width = '80px';
                icon.style.height = '80px';
                icon.style.background = 'transparent';
                icon.style.boxSizing = 'border-box';
                choice.appendChild(icon);
            } catch (error) {
                console.error('Error creating icon for promotion choice:', error);
                // Fallback: show piece symbol or name minimally
                const fallback = document.createElement('div');
                fallback.textContent = '❓';
                fallback.style.color = '#fff';
                choice.appendChild(fallback);
            }

            choice.addEventListener('click', () => {
                this.hidePromotionDialog();
                onChoose(idx);
            });

            this.promotionChoices.appendChild(choice);
        });

        // Show dialog
        this.promotionDialog.classList.remove('hidden');
    }

    hidePromotionDialog() {
        if (this.promotionDialog) {
            this.promotionDialog.classList.add('hidden');
        }
    }

    // Show a prominent result overlay for checkmate/stalemate
    showResult(emoji, title, subtitle) {
        if (!this.resultOverlay) return;
        if (this.resultEmoji) this.resultEmoji.textContent = emoji || '🏁';
        if (this.resultTitle) this.resultTitle.textContent = title || 'Game Over';
        if (this.resultSubtitle) this.resultSubtitle.textContent = subtitle || '';
        this.resultOverlay.classList.remove('hidden');
        // Make overlay catch pointer events while visible
        this.resultOverlay.style.pointerEvents = 'auto';
        // Determine defeated color from subtitle when possible (e.g. 'White wins' -> black defeated)
        let defeated = null;
        if (subtitle && typeof subtitle === 'string') {
            if (subtitle.toLowerCase().includes('white wins')) defeated = 'black';
            else if (subtitle.toLowerCase().includes('black wins')) defeated = 'white';
        }
        this.defeatedColor = defeated;
        // Also set the global renderer's defeatedColor (if available) so board icons update
        try {
            if (window && window.randoChessApp && window.randoChessApp.renderer) {
                window.randoChessApp.renderer.defeatedColor = defeated;
                // Re-render the current board to show the defeated styling immediately
                const app = window.randoChessApp;
                if (app.currentController && app.currentController.engine && app.renderer) {
                    app.renderer.render(app.currentController.engine.board, app.currentController.engine.lastMove, app.currentController.engine);
                }
            }
        } catch (e) { /* ignore in non-browser/test env */ }
    }

    hideResult() {
        if (!this.resultOverlay) return;
        this.resultOverlay.classList.add('hidden');
        this.resultOverlay.style.pointerEvents = 'none';
    }
}

// Attach to window for backwards compatibility and export as ES module
try {
    if (typeof window !== 'undefined') {
        window.BoardRenderer = BoardRenderer;
        window.UIManager = UIManager;
    }
} catch (e) { /* ignore if not in browser env */ }

export { BoardRenderer, UIManager };
