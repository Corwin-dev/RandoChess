// ===== Multiplayer WebSocket Client =====
// Handles network communication for multiplayer games

class MultiplayerClient {
    constructor() {
        this.ws = null;
        this.sessionId = null;
        this.playerColor = null;
        this.isConnected = false;
        this.pieces = null;
        this.placement = null;
        
        // Callbacks
        this.onMatchFound = null; // (color, pieces, placement) => void
        this.onMove = null; // (move) => void
        this.onOpponentLeft = null; // () => void
        this.onMessage = null; // (message) => void
    }
    
    connect(pieces) {
        this.pieces = pieces;
        // Prevent opening multiple simultaneous connections
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            console.log('WebSocket already open or connecting — skipping connect');
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('Connected to server');
            this.isConnected = true;
            
            // Send pieces to server and join queue
            const serializedPieces = PieceSerializer.serialize(pieces);
            this.ws.send(JSON.stringify({
                type: 'JOIN_QUEUE',
                pieces: serializedPieces
            }));
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (this.onMessage) {
                this.onMessage('Connection error - please refresh');
            }
        };
        
        this.ws.onclose = () => {
            console.log('Disconnected from server');
            this.isConnected = false;
            if (this.onMessage) {
                this.onMessage('Disconnected - please refresh');
            }
        };
    }
    
    handleMessage(data) {
        switch(data.type) {
            case 'WAITING':
                if (this.onMessage) {
                    this.onMessage(data.message);
                }
                break;
                
            case 'MATCHED':
                this.sessionId = data.sessionId;
                this.playerColor = data.color;
                this.placement = data.placement;
                
                console.log('Match found! Color:', data.color);
                
                // Deserialize pieces from server
                const pieces = PieceSerializer.deserialize(data.pieces);
                
                if (this.onMatchFound) {
                    this.onMatchFound(data.color, pieces, data.placement);
                }
                break;
                
            case 'MOVE':
                if (this.onMove && data.move) {
                    this.onMove(data.move);
                }
                
                if (data.gameOver && this.onMessage) {
                    const winner = data.winner || 'Unknown';
                    this.onMessage(`${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`);
                }
                break;
                
            case 'OPPONENT_LEFT':
                if (this.onOpponentLeft) {
                    this.onOpponentLeft();
                }
                if (this.onMessage) {
                    this.onMessage('Opponent left the game');
                }
                break;
                
            case 'ERROR':
                console.error('Server error:', data.message);
                if (this.onMessage) {
                    this.onMessage(data.message);
                }
                break;
        }
    }
    
    sendMove(move, gameOver = false, winner = null) {
        if (!this.isConnected || !this.ws) return;
        
        this.ws.send(JSON.stringify({
            type: 'MOVE',
            move: move,
            gameOver: gameOver,
            winner: winner
        }));
    }
    
    disconnect() {
        if (this.ws) {
            try {
                this.ws.close();
            } catch (e) {
                console.warn('Error while closing WebSocket', e);
            }
        }
        this.ws = null;
        this.isConnected = false;
    }
}

