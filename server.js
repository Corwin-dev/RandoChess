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
                case 'REMATCH_REQUEST':
                    handleRematchRequest(ws, data.mode);
                    break;
                case 'LEAVE_AND_QUEUE':
                    handleLeaveAndQueue(ws);
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
        // Add to queue with their pieces (already serialized from client)
        console.log('Adding to queue with pieces:', pieces ? `array of ${pieces.length}` : 'null/undefined');
        waitingQueue.push({ ws: ws, pieces: pieces });
        ws.send(JSON.stringify({
            type: 'WAITING',
            message: '⏳'
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
            message: '⛔'
        }));
        return;
    }
    
    // Update game state
    session.currentTurn = session.currentTurn === 'white' ? 'black' : 'white';
    
    // Broadcast move to both players (including the sender)
    session.players.forEach(p => {
        p.ws.send(JSON.stringify({
            type: 'MOVE',
            move: data.move,
            currentTurn: session.currentTurn,
            gameOver: data.gameOver || false,
            winner: data.winner || null
        }));
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

function handleRematchRequest(ws, mode) {
    if (!ws.sessionId) return;
    const session = gameSessions.get(ws.sessionId);
    if (!session) return;

    // store rematch request on player object
    const player = session.players.find(p => p.ws === ws);
    if (!player) return;
    player.rematch = { mode: mode };

    // Build status to send to both players
    const p0 = session.players[0];
    const p1 = session.players[1];

    // Send REMATCH_STATUS to each player with fields: mySelection, opponentSelection
    [p0, p1].forEach((recipient, idx) => {
        const theirs = recipient === p0 ? p1 : p0;
        if (recipient.ws.readyState === WebSocket.OPEN) {
            recipient.ws.send(JSON.stringify({
                type: 'REMATCH_STATUS',
                mySelection: recipient.rematch ? recipient.rematch.mode : null,
                opponentSelection: theirs.rematch ? theirs.rematch.mode : null
            }));
        }
    });

    // If both players have requested rematch, start a rematch
    if (p0.rematch && p1.rematch) {
        // Decide whether to keep placement: only if both chose 'keep'
        const keepPlacement = (p0.rematch.mode === 'keep' && p1.rematch.mode === 'keep');

        // Create new session preserving ws objects
        const colors = Math.random() < 0.5 ? ['white', 'black'] : ['black', 'white'];

        const newPlacement = keepPlacement ? session.placement : generatePlacement(session.pieces);

        const newSessionId = generateSessionId();
        const newSession = {
            sessionId: newSessionId,
            pieces: session.pieces,
            placement: newPlacement,
            players: [ { ws: p0.ws, color: colors[0], ready: false }, { ws: p1.ws, color: colors[1], ready: false } ],
            currentTurn: 'white',
            gameActive: true
        };

        // Update session mapping and sessionId on sockets
        gameSessions.set(newSessionId, newSession);
        p0.ws.sessionId = newSessionId;
        p1.ws.sessionId = newSessionId;

        // Notify both players similar to MATCHED
        const msg0 = { type: 'REMATCH_START', color: colors[0], sessionId: newSessionId, pieces: newSession.pieces, placement: newSession.placement };
        const msg1 = { type: 'REMATCH_START', color: colors[1], sessionId: newSessionId, pieces: newSession.pieces, placement: newSession.placement };

        if (p0.ws.readyState === WebSocket.OPEN) p0.ws.send(JSON.stringify(msg0));
        if (p1.ws.readyState === WebSocket.OPEN) p1.ws.send(JSON.stringify(msg1));

        // Remove old session
        if (session.sessionId) gameSessions.delete(session.sessionId);
    }
}

function handleLeaveAndQueue(ws) {
    // If player is in waiting queue, ignore
    const qIndex = waitingQueue.findIndex(item => item.ws === ws);
    if (qIndex !== -1) return;

    if (!ws.sessionId) {
        // Not in a session — just matchPlayer directly
        matchPlayer(ws, null);
        return;
    }

    const session = gameSessions.get(ws.sessionId);
    if (!session) return;

    // Find leaving player and other
    const leavingIndex = session.players.findIndex(p => p.ws === ws);
    if (leavingIndex === -1) return;
    const other = session.players[1 - leavingIndex];

    // Notify other that opponent left and requeue them
    if (other.ws.readyState === WebSocket.OPEN) {
        other.ws.send(JSON.stringify({ type: 'OPPONENT_LEFT', intentional: true }));
        other.ws.sessionId = null;
        matchPlayer(other.ws, session.pieces);
    }

    // Put leaving player into queue with their session pieces
    ws.sessionId = null;
    matchPlayer(ws, session.pieces);

    // Remove the old session
    if (session.sessionId) gameSessions.delete(session.sessionId);
}

function generatePlacement(pieces) {
    // Find the strongest non-royal, non-pawn piece (most moves)
    // pieces[0] = royal, other indices include non-royal pieces and a pawn
    // Detect pawn index (pawn has promotionType === 'choice' or enPassant special)
    let pawnIndex = pieces.findIndex(p => (p && (p.promotionType === 'choice' || (p.specials && p.specials.some(s => s.type === 'enPassant')))));
    if (pawnIndex === -1) {
        // Fallback: assume last piece is pawn
        pawnIndex = pieces.length - 1;
    }

    // Build list of candidate indices for strongest piece (exclude royal at 0 and pawn)
    const candidates = [];
    for (let i = 1; i < pieces.length; i++) {
        if (i === pawnIndex) continue;
        candidates.push(i);
    }

    // Default to first candidate
    let strongestIndex = candidates[0] || 1;
    let maxMoves = (pieces[strongestIndex] && pieces[strongestIndex].moves) ? pieces[strongestIndex].moves.length : 0;
    for (const i of candidates) {
        const movesLen = (pieces[i] && pieces[i].moves) ? pieces[i].moves.length : 0;
        if (movesLen > maxMoves) {
            maxMoves = movesLen;
            strongestIndex = i;
        }
    }

    // Get remaining pieces for symmetric placement (exclude strongest and pawn)
    const remainingPieces = candidates.filter(i => i !== strongestIndex);
    
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
