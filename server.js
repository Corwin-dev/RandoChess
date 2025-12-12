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
// Map of playerId -> { ws, sessionId, lastSeen }
const playersById = new Map();

// Rejoin expiry (ms)
const REJOIN_EXPIRY = 1000 * 60 * 10; // 10 minutes

wss.on('connection', (ws) => {
    console.log('New client connected');
    // Assign a temporary player id for this connection; client may later
    // request rejoin with an existing id which will override this entry.
    const tempId = generatePlayerId();
    ws.tempPlayerId = tempId;
    ws.playerId = tempId;
    playersById.set(tempId, { ws: ws, sessionId: null, lastSeen: Date.now() });
    // Inform client of assigned id (client may persist it)
    try {
        ws.send(JSON.stringify({ type: 'ASSIGN_ID', playerId: tempId }));
    } catch (e) { /* ignore */ }
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'REJOIN': {
                    // Client is asking to reattach using a previously issued playerId
                    const pid = data.playerId;
                    if (!pid) {
                        ws.send(JSON.stringify({ type: 'REJOIN_FAILED', reason: 'missing_playerId' }));
                        break;
                    }

                    const record = playersById.get(pid);
                    if (!record) {
                        ws.send(JSON.stringify({ type: 'REJOIN_FAILED', reason: 'not_found' }));
                        break;
                    }

                    // Remove any temporary id we set earlier for this socket
                    if (ws.tempPlayerId && ws.tempPlayerId !== pid) {
                        playersById.delete(ws.tempPlayerId);
                    }

                    // Attach ws to the existing player record
                    record.ws = ws;
                    record.lastSeen = Date.now();
                    ws.playerId = pid;
                    ws.sessionId = record.sessionId || null;

                    // If player belonged to an active session, reattach them
                    if (record.sessionId && gameSessions.has(record.sessionId)) {
                        const session = gameSessions.get(record.sessionId);
                        // find player slot
                        const slot = session.players.find(p => p.playerId === pid);
                        if (slot) {
                            slot.ws = ws;
                            // Send acceptance and current session state
                            const color = slot.color;
                            try {
                                ws.send(JSON.stringify({
                                    type: 'REJOIN_ACCEPT',
                                    sessionId: session.sessionId,
                                    pieces: session.pieces,
                                    placement: session.placement,
                                    color: color,
                                    currentTurn: session.currentTurn,
                                    moveHistory: session.moveHistory || []
                                }));
                            } catch (e) { /* ignore */ }

                            // Notify opponent that this player rejoined
                            session.players.forEach(p => {
                                if (p.playerId !== pid && p.ws && p.ws.readyState === WebSocket.OPEN) {
                                    p.ws.send(JSON.stringify({ type: 'OPPONENT_REJOINED' }));
                                }
                            });
                        }
                    } else {
                        // No session to rejoin
                        ws.send(JSON.stringify({ type: 'REJOIN_FAILED', reason: 'no_active_session' }));
                    }

                    break;
                }
                case 'JOIN_QUEUE':
                    console.log('JOIN_QUEUE received, pieces:', data.pieces ? 'present' : 'missing');
                    // Ensure playerId is recorded for this ws
                    if (ws.playerId) {
                        const rec = playersById.get(ws.playerId) || { ws, sessionId: null, lastSeen: Date.now() };
                        rec.ws = ws;
                        rec.lastSeen = Date.now();
                        playersById.set(ws.playerId, rec);
                    }
                    matchPlayer(ws, data.pieces);
                    break;
                case 'LEAVE_QUEUE':
                    // Remove this socket from the waiting queue if present
                    const qIndex = waitingQueue.findIndex(item => item.ws === ws);
                    if (qIndex !== -1) {
                        waitingQueue.splice(qIndex, 1);
                        console.log('Client requested LEAVE_QUEUE; removed from waiting queue');
                        ws.send(JSON.stringify({ type: 'LEFT_QUEUE' }));
                    }
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
        handleDisconnect(ws, false);
    });
});

function matchPlayer(ws, pieces = null) {
    console.log('matchPlayer called with pieces:', pieces ? `array of ${pieces.length}` : 'null/undefined');
    
    if (waitingQueue.length > 0) {
        // Match with waiting player
        const waitingPlayer = waitingQueue.shift();
        console.log('Matching with waiting player. Waiting player pieces:', waitingPlayer.pieces ? `array of ${waitingPlayer.pieces.length}` : 'null/undefined');
        // Prefer a non-null pieces payload: waiting player's pieces or the newcomer
        const selectedPieces = waitingPlayer.pieces || pieces;
        if (!selectedPieces || !Array.isArray(selectedPieces) || selectedPieces.length < 6) {
            console.error('Cannot create session - invalid pieces payload from either player');
            // Notify both sockets about the error and requeue the waiting player
            try {
                if (waitingPlayer.ws && waitingPlayer.ws.readyState === WebSocket.OPEN) {
                    waitingPlayer.ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid pieces payload. Please resend.' }));
                }
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid pieces payload. Please resend.' }));
                }
            } catch (e) {
                console.warn('Failed to notify players of invalid pieces', e);
            }
            // Requeue the waiting player to give them another chance (preserve their pieces)
            waitingQueue.unshift(waitingPlayer);
            return;
        }

        createGameSession(waitingPlayer.ws, ws, selectedPieces);
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
    // Validate pieces before proceeding
    if (!pieces || !Array.isArray(pieces) || pieces.length < 6) {
        console.error('ERROR: Invalid pieces provided to createGameSession!');
        try {
            if (player1 && player1.readyState === WebSocket.OPEN) player1.send(JSON.stringify({ type: 'ERROR', message: 'Invalid pieces payload' }));
            if (player2 && player2.readyState === WebSocket.OPEN) player2.send(JSON.stringify({ type: 'ERROR', message: 'Invalid pieces payload' }));
        } catch (e) { /* ignore */ }
        return;
    }
    
    // Randomly assign colors
    const colors = Math.random() < 0.5 ? ['white', 'black'] : ['black', 'white'];
    
    // Generate placement once on server to ensure both players have identical boards
    const placement = generatePlacement(pieces);
    
    const session = {
        sessionId: sessionId,
        pieces: pieces, // Use pieces from first player
        placement: placement, // Shared placement for both players
        moveHistory: [],
        players: [
            { ws: player1, color: colors[0], ready: false, playerId: player1.playerId || null },
            { ws: player2, color: colors[1], ready: false, playerId: player2.playerId || null }
        ],
        currentTurn: 'white',
        gameActive: true
    };
    
    gameSessions.set(sessionId, session);
    player1.sessionId = sessionId;
    player2.sessionId = sessionId;

    // Update playersById records with sessionId
    if (player1.playerId) {
        const r1 = playersById.get(player1.playerId) || { ws: player1, sessionId: sessionId, lastSeen: Date.now() };
        r1.sessionId = sessionId;
        r1.ws = player1;
        playersById.set(player1.playerId, r1);
    }
    if (player2.playerId) {
        const r2 = playersById.get(player2.playerId) || { ws: player2, sessionId: sessionId, lastSeen: Date.now() };
        r2.sessionId = sessionId;
        r2.ws = player2;
        playersById.set(player2.playerId, r2);
    }
    
    // Send distinct messages to each player to avoid in-place mutation bugs
    const msgToP1 = {
        type: 'MATCHED',
        color: colors[0],
        sessionId: sessionId,
        pieces: pieces,
        placement: placement
    };
    const msgToP2 = {
        type: 'MATCHED',
        color: colors[1],
        sessionId: sessionId,
        pieces: pieces,
        placement: placement
    };

    try {
        console.log('Sending to player1, pieces:', Array.isArray(msgToP1.pieces) ? `array of ${msgToP1.pieces.length}` : 'missing');
        if (player1 && player1.readyState === WebSocket.OPEN) player1.send(JSON.stringify(msgToP1));
    } catch (e) { console.warn('Failed sending MATCHED to player1', e); }
    try {
        console.log('Sending to player2, pieces:', Array.isArray(msgToP2.pieces) ? `array of ${msgToP2.pieces.length}` : 'missing');
        if (player2 && player2.readyState === WebSocket.OPEN) player2.send(JSON.stringify(msgToP2));
    } catch (e) { console.warn('Failed sending MATCHED to player2', e); }
    
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
    // Store move in session history for reconnect/resume
    try {
        session.moveHistory = session.moveHistory || [];
        session.moveHistory.push({ move: data.move, currentTurn: session.currentTurn, gameOver: data.gameOver || false, winner: data.winner || null });
    } catch (e) { console.warn('Failed to record move history', e); }
    
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
    // Find the disconnected player's slot
    const slot = session.players.find(p => p.ws === ws || p.playerId === ws.playerId);

    // Update player record in playersById
    if (ws.playerId && playersById.has(ws.playerId)) {
        const rec = playersById.get(ws.playerId);
        rec.ws = null;
        rec.lastSeen = Date.now();
        playersById.set(ws.playerId, rec);
    }

    if (intentional) {
        // Intentional leave: behave as before (notify opponent and requeue them)
        session.players.forEach(player => {
            if (player.ws && player.ws !== ws && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify({ type: 'OPPONENT_LEFT', intentional: true }));
                player.ws.sessionId = null;
                matchPlayer(player.ws, session.pieces);
            }
        });
        // Remove session immediately
        gameSessions.delete(ws.sessionId);
        console.log(`Game session closed (intentional): ${ws.sessionId}`);
        return;
    }

    // Unintentional disconnect: allow a grace period for reconnect
    if (slot) slot.ws = null;

    // Notify other player that opponent left but can rejoin
    session.players.forEach(player => {
        if ((!slot || player !== slot) && player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({ type: 'OPPONENT_LEFT', intentional: false, reconnectAllowed: true }));
        }
    });

    // Do not delete session here; periodic cleanup will remove expired sessions
}

// Periodic cleanup to remove sessions where players didn't rejoin within expiry
setInterval(() => {
    const now = Date.now();
    // Clean up playersById entries that are stale
    for (const [pid, rec] of playersById.entries()) {
        if (!rec.ws && rec.lastSeen && (now - rec.lastSeen) > REJOIN_EXPIRY) {
            // Remove player record
            playersById.delete(pid);
        }
    }

    // Clean up sessions where both players are disconnected and expired
    for (const [sid, session] of gameSessions.entries()) {
        const allDisconnected = session.players.every(p => !p.ws || p.ws.readyState !== WebSocket.OPEN);
        if (allDisconnected) {
            // Check players' lastSeen
            let latestSeen = 0;
            for (const p of session.players) {
                if (p.playerId && playersById.has(p.playerId)) {
                    latestSeen = Math.max(latestSeen, playersById.get(p.playerId).lastSeen || 0);
                }

            }

            if (latestSeen === 0 || (now - latestSeen) > REJOIN_EXPIRY) {
                console.log(`Cleaning up expired session ${sid}`);
                gameSessions.delete(sid);
            }
        }
    }
}, 60 * 1000);
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
            players: [
                { ws: p0.ws, color: colors[0], ready: false, playerId: p0.playerId || (p0.ws && p0.ws.playerId) || null },
                { ws: p1.ws, color: colors[1], ready: false, playerId: p1.playerId || (p1.ws && p1.ws.playerId) || null }
            ],
            moveHistory: [],
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

    // Allow independent king movement variants per side so each king can
    // independently be normal, orthogonal-only, or diagonal-only. These
    // flags get sent to clients as part of the placement so both players
    // see the same behavior.
    const pickVariant = () => {
        const r = Math.random();
        if (r < 0.12) return 'orthogonal';
        if (r < 0.24) return 'diagonal';
        return 'normal';
    };

    return {
        remainingPieces: remainingPieces,
        strongestIndex: strongestIndex,
        kingVariants: {
            white: pickVariant(),
            black: pickVariant()
        }
    };
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePlayerId() {
    return Math.random().toString(36).substring(2, 12).toUpperCase();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('RandoChess multiplayer server initialized');
});
