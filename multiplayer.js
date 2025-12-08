// WebSocket multiplayer client
class MultiplayerClient {
    constructor() {
        this.ws = null;
        this.sessionId = null;
        this.playerColor = null;
        this.isConnected = false;
        this.gameBoard = null;
    }
    
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to server');
            console.log('Sending pieces:', window.sessionPieces);
            this.isConnected = true;
            
            // Send pieces to server and join queue
            this.ws.send(JSON.stringify({
                type: 'JOIN_QUEUE',
                pieces: window.sessionPieces // Send as object, will be JSON.stringify'd
            }));
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.showMessage('Connection error - please refresh');
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.isConnected = false;
            this.showMessage('Disconnected - please refresh');
        };
    }
    
    handleMessage(data) {
        switch(data.type) {
            case 'WAITING':
                this.showMessage(data.message);
                break;
                
            case 'MATCHED':
                this.sessionId = data.sessionId;
                this.playerColor = data.color;
                console.log('MATCHED received:', data);
                this.showMessage(`Match found! You are ${data.color}`);
                
                // Deserialize pieces from server (ensures both players have same pieces)
                if (data.pieces) {
                    console.log('Pieces before deserialize:', window.sessionPieces.map(p => p.name));
                    window.sessionPieces = deserializePieces(data.pieces);
                    console.log('Pieces after deserialize:', window.sessionPieces.map(p => p.name));
                    window.sessionPlacement = null; // Reset placement
                } else {
                    console.error('No pieces received in MATCHED message');
                    return;
                }
                
                // Create game board now that we're matched
                if (!window.game) {
                    window.game = new GameBoard(window.sessionPieces);
                } else {
                    window.game.pieces = window.sessionPieces;
                }
                
                // Set player color on game board
                window.game.playerColor = data.color;
                window.game.currentTurn = 'white';
                window.game.gameOver = false;
                window.game.initializeBoard();
                window.game.render();
                
                this.gameBoard = window.game;
                this.hideWaitingMessage();
                this.showGameControls();
                break;
                
            case 'MOVE':
                if (this.gameBoard && data.move) {
                    // Apply opponent's move
                    this.gameBoard.currentTurn = data.currentTurn;
                    this.gameBoard.applyRemoteMove(data.move);
                    
                    if (data.gameOver) {
                        this.gameBoard.gameOver = true;
                        this.gameBoard.showMessage(`${data.winner} wins!`);
                        this.showRematchButton();
                    }
                }
                break;
                
            case 'REMATCH_REQUESTED':
                this.showMessage('Opponent wants a rematch');
                break;
                
            case 'WAITING_FOR_REMATCH':
                this.showMessage(data.message);
                break;
                
            case 'REMATCH_START':
                this.showMessage('Rematch starting!');
                this.hideRematchButton();
                
                if (this.gameBoard) {
                    // Reset sessionPlacement to null so it gets recalculated with same pieces
                    window.sessionPlacement = null;
                    
                    // Reset game state
                    this.gameBoard.gameOver = false;
                    this.gameBoard.currentTurn = 'white';
                    this.gameBoard.selectedSquare = null;
                    this.gameBoard.validMoves = [];
                    this.gameBoard.initializeBoard();
                    this.gameBoard.render();
                }
                break;
                
            case 'OPPONENT_LEFT':
                if (data.intentional) {
                    this.showMessage('Opponent left the game. Finding new opponent...');
                } else {
                    this.showMessage('Opponent disconnected. Finding new opponent...');
                }
                this.hideRematchButton();
                this.sessionId = null;
                break;
                
            case 'ERROR':
                this.showMessage(`Error: ${data.message}`);
                break;
        }
    }
    
    sendMove(move, gameOver = false, winner = null) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        this.ws.send(JSON.stringify({
            type: 'MOVE',
            move: move,
            gameOver: gameOver,
            winner: winner
        }));
    }
    
    requestRematch() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        this.ws.send(JSON.stringify({
            type: 'REMATCH'
        }));
    }
    
    leaveGame() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        this.ws.send(JSON.stringify({
            type: 'LEAVE'
        }));
        
        this.sessionId = null;
        this.showMessage('Finding new opponent...');
    }
    
    showMessage(message) {
        const messageEl = document.getElementById('message');
        if (messageEl) {
            messageEl.textContent = message;
        }
    }
    
    hideWaitingMessage() {
        // Remove any waiting UI elements
    }
    
    showGameControls() {
        const controls = document.getElementById('game-controls');
        if (controls) {
            controls.style.display = 'flex';
        }
    }
    
    showRematchButton() {
        let rematchBtn = document.getElementById('rematch-btn');
        if (!rematchBtn) {
            rematchBtn = document.createElement('button');
            rematchBtn.id = 'rematch-btn';
            rematchBtn.textContent = 'Rematch';
            rematchBtn.onclick = () => this.requestRematch();
            
            const gameInfo = document.querySelector('.game-info');
            gameInfo.appendChild(rematchBtn);
        }
        rematchBtn.style.display = 'block';
        
        // Also show leave button
        let leaveBtn = document.getElementById('leave-btn');
        if (!leaveBtn) {
            leaveBtn = document.createElement('button');
            leaveBtn.id = 'leave-btn';
            leaveBtn.textContent = 'Find New Opponent';
            leaveBtn.onclick = () => this.leaveGame();
            
            const gameInfo = document.querySelector('.game-info');
            gameInfo.appendChild(leaveBtn);
        }
        leaveBtn.style.display = 'block';
    }
    
    hideRematchButton() {
        const rematchBtn = document.getElementById('rematch-btn');
        if (rematchBtn) {
            rematchBtn.style.display = 'none';
        }
        const leaveBtn = document.getElementById('leave-btn');
        if (leaveBtn) {
            leaveBtn.style.display = 'none';
        }
    }
}

window.multiplayerClient = new MultiplayerClient();
