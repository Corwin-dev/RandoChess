const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(__dirname));

// Game sessions: { sessionId: { pieces, players: [{ws, color}], currentTurn, gameActive } }
const gameSessions = new Map();
// Queue for players waiting to be matched
const waitingQueue = [];

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'JOIN_QUEUE':
                    console.log('JOIN_QUEUE received, pieces:', data.pieces ? 'present' : 'missing');
                    matchPlayer(ws, data.pieces);
                    break;
                case 'MOVE':
                    handleMove(ws, data);
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        handleDisconnect(ws);
    });
});

function matchPlayer(ws, pieces = null) {
    console.log('matchPlayer called with pieces:', pieces ? `array of ${pieces.length}` : 'null/undefined');
    
    if (waitingQueue.length > 0) {
        // Match with waiting player
        const waitingPlayer = waitingQueue.shift();
        console.log('Matching with waiting player. Waiting player pieces:', waitingPlayer.pieces ? `array of ${waitingPlayer.pieces.length}` : 'null/undefined');
        createGameSession(waitingPlayer.ws, ws, waitingPlayer.pieces);
    } else {
        // Add to queue with their pieces
        console.log('Adding to queue with pieces:', pieces ? `array of ${pieces.length}` : 'null/undefined');
        waitingQueue.push({ ws: ws, pieces: pieces });
        ws.send(JSON.stringify({
            type: 'WAITING',
            message: 'Waiting for opponent...'
        }));
        console.log('Player added to queue');
    }
}

function createGameSession(player1, player2, pieces) {
    const sessionId = generateSessionId();
    
    console.log('Creating game session');
    console.log('Pieces received:', pieces ? `array of ${pieces.length}` : 'null/undefined');
    
    if (!pieces) {
        console.error('ERROR: No pieces provided to createGameSession!');
    }
    
    // Randomly assign colors
    const colors = Math.random() < 0.5 ? ['white', 'black'] : ['black', 'white'];
    
    // Generate placement once on server to ensure both players have identical boards
    const placement = generatePlacement(pieces);
    
    const session = {
        sessionId: sessionId,
        pieces: pieces, // Use pieces from first player
        placement: placement, // Shared placement for both players
        players: [
            { ws: player1, color: colors[0], ready: false },
            { ws: player2, color: colors[1], ready: false }
        ],
        currentTurn: 'white',
        gameActive: true
    };
    
    gameSessions.set(sessionId, session);
    player1.sessionId = sessionId;
    player2.sessionId = sessionId;
    
    // Notify both players with the same pieces and placement
    const matchedMessage = {
        type: 'MATCHED',
        color: colors[0],
        sessionId: sessionId,
        pieces: pieces,
        placement: placement
    };
    console.log('Sending to player1, pieces:', matchedMessage.pieces ? `array of ${matchedMessage.pieces.length}` : 'missing');
    player1.send(JSON.stringify(matchedMessage));
    
    matchedMessage.color = colors[1];
    console.log('Sending to player2, pieces:', matchedMessage.pieces ? `array of ${matchedMessage.pieces.length}` : 'missing');
    player2.send(JSON.stringify(matchedMessage));
    
    console.log(`Game created: ${sessionId}, Players: ${colors[0]} vs ${colors[1]}`);
}

function handleMove(ws, data) {
    const session = gameSessions.get(ws.sessionId);
    if (!session) return;
    
    const player = session.players.find(p => p.ws === ws);
    if (!player) return;
    
    // Verify it's the player's turn
    if (player.color !== session.currentTurn) {
        ws.send(JSON.stringify({
            type: 'ERROR',
            message: 'Not your turn'
        }));
        return;
    }
    
    // Update game state
    session.currentTurn = session.currentTurn === 'white' ? 'black' : 'white';
    
    // Broadcast move to opponent only (not the sender)
    session.players.forEach(p => {
        if (p.ws !== ws) {
            p.ws.send(JSON.stringify({
                type: 'MOVE',
                move: data.move,
                currentTurn: session.currentTurn,
                gameOver: data.gameOver || false,
                winner: data.winner || null
            }));
        }
    });
    
    if (data.gameOver) {
        session.gameActive = false;
    }
}

function handleDisconnect(ws, intentional = false) {
    // Remove from waiting queue if present
    const queueIndex = waitingQueue.findIndex(item => item.ws === ws);
    if (queueIndex !== -1) {
        waitingQueue.splice(queueIndex, 1);
        console.log('Player removed from queue');
        return;
    }
    
    if (!ws.sessionId) return;
    
    const session = gameSessions.get(ws.sessionId);
    if (!session) return;
    
    // Notify other player
    session.players.forEach(player => {
        if (player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
                type: 'OPPONENT_LEFT',
                intentional: intentional
            }));
            
            // Put the remaining player back in queue with current session pieces
            player.ws.sessionId = null;
            matchPlayer(player.ws, session.pieces);
        }
    });
    
    // Clean up session
    gameSessions.delete(ws.sessionId);
    console.log(`Game session closed: ${ws.sessionId}`);
}

function generatePlacement(pieces) {
    // Find the strongest non-royal piece (most moves)
    // pieces[0] = royal, pieces[1-5] = random non-royal, pieces[6] = pawn
    let strongestIndex = 1;
    let maxMoves = pieces[1].moves.length;
    for (let i = 2; i <= 5; i++) {
        if (pieces[i].moves.length > maxMoves) {
            maxMoves = pieces[i].moves.length;
            strongestIndex = i;
        }
    }
    
    // Get remaining pieces for symmetric placement
    const remainingPieces = [];
    for (let i = 1; i <= 5; i++) {
        if (i !== strongestIndex) {
            remainingPieces.push(i);
        }
    }
    
    // Shuffle for random but consistent placement
    for (let i = remainingPieces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingPieces[i], remainingPieces[j]] = [remainingPieces[j], remainingPieces[i]];
    }
    
    return {
        remainingPieces: remainingPieces,
        strongestIndex: strongestIndex
    };
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('RandoChess multiplayer server initialized');
});
