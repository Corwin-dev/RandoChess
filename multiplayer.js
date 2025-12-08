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
                    // Use placement from server to ensure both players have identical boards
                    window.sessionPlacement = data.placement;
                } else {
                    console.error('No pieces received in MATCHED message');
                    return;
                }
                
                // Transition from AI game to multiplayer game
                // Disable AI mode and reset for multiplayer
                if (window.game) {
                    window.game.isAIGame = false;
                    window.game.aiPlayer = null;
                    window.game.aiColor = null;
                    window.game.pieces = window.sessionPieces;
                } else {
                    window.game = new GameBoard(window.sessionPieces);
                }
                
                // Set player color on game board
                window.game.playerColor = data.color;
                window.game.currentTurn = 'white';
                window.game.gameOver = false;
                window.game.initializeBoard();
                window.game.render();
                
                // Start the chess clock
                window.game.startClock();
                
                this.gameBoard = window.game;
                this.hideWaitingMessage();
                this.hideSearchButton();
                break;
                
            case 'MOVE':
                if (this.gameBoard && data.move) {
                    // Apply opponent's move
                    this.gameBoard.currentTurn = data.currentTurn;
                    this.gameBoard.applyRemoteMove(data.move);
                    
                    if (data.gameOver) {
                        this.gameBoard.gameOver = true;
                        this.gameBoard.showMessage(`${data.winner} wins!`);
                    }
                }
                break;
                
            case 'OPPONENT_LEFT':
                if (data.intentional) {
                    this.showMessage('Opponent left the game. Finding new opponent...');
                } else {
                    this.showMessage('Opponent disconnected. Finding new opponent...');
                }
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
    
    showMessage(message) {
        const messageEl = document.getElementById('message');
        if (messageEl) {
            messageEl.textContent = message;
        }
    }
    
    hideWaitingMessage() {
        // Remove any waiting UI elements
    }
    
    hideSearchButton() {
        const searchBtn = document.getElementById('search-opponent-btn');
        if (searchBtn) {
            searchBtn.style.display = 'none';
        }
    }
}

window.multiplayerClient = new MultiplayerClient();
