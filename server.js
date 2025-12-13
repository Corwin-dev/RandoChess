const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.resolve(__dirname)));

// Minimal matchmaking server: pair two clients that send JOIN_QUEUE
const waitingQueue = [];
const gameSessions = new Map();

function generateSessionId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePlacement(pieces) {
    // Basic placement generator: choose strongest index and shuffle remaining
    let pawnIndex = pieces.findIndex(p => (p && (p.promotionType === 'choice' || (p.specials && p.specials.some(s => s.type === 'enPassant')))));
    if (pawnIndex === -1) pawnIndex = pieces.length - 1;

    const candidates = [];
    for (let i = 1; i < pieces.length; i++) if (i !== pawnIndex) candidates.push(i);

    let strongestIndex = candidates[0] || 1;
    let maxMoves = (pieces[strongestIndex] && pieces[strongestIndex].moves) ? pieces[strongestIndex].moves.length : 0;
    for (const i of candidates) {
        const movesLen = (pieces[i] && pieces[i].moves) ? pieces[i].moves.length : 0;
        if (movesLen > maxMoves) { maxMoves = movesLen; strongestIndex = i; }
    }

    const remainingPieces = candidates.filter(i => i !== strongestIndex);
    for (let i = remainingPieces.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingPieces[i], remainingPieces[j]] = [remainingPieces[j], remainingPieces[i]];
    }

    const pickVariant = () => { const r = Math.random(); if (r < 0.12) return 'orthogonal'; if (r < 0.24) return 'diagonal'; return 'normal'; };

    return { remainingPieces, strongestIndex, kingVariants: { white: pickVariant(), black: pickVariant() } };
}

function matchPlayer(ws, pieces) {
    if (waitingQueue.length > 0) {
        const waiting = waitingQueue.shift();
        const selectedPieces = waiting.pieces || pieces;
        if (!selectedPieces) {
            try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid pieces' })); } catch (e) {}
            return;
        }

        const sessionId = generateSessionId();
        const placement = generatePlacement(selectedPieces);
        const colors = Math.random() < 0.5 ? ['white', 'black'] : ['black', 'white'];

        const session = { sessionId, pieces: selectedPieces, placement, players: [waiting.ws, ws] };
        gameSessions.set(sessionId, session);
        waiting.ws.sessionId = sessionId; ws.sessionId = sessionId;

        const msg0 = { type: 'MATCHED', color: colors[0], sessionId, pieces: selectedPieces, placement };
        const msg1 = { type: 'MATCHED', color: colors[1], sessionId, pieces: selectedPieces, placement };

        try { if (waiting.ws.readyState === WebSocket.OPEN) waiting.ws.send(JSON.stringify(msg0)); } catch (e) {}
        try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg1)); } catch (e) {}
    } else {
        waitingQueue.push({ ws, pieces });
        try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'WAITING', message: '⏳' })); } catch (e) {}
    }
}

wss.on('connection', (ws) => {
    ws.playerId = Math.random().toString(36).substring(2, 12).toUpperCase();
    try { ws.send(JSON.stringify({ type: 'ASSIGN_ID', playerId: ws.playerId })); } catch (e) {}

    ws.on('message', (msg) => {
        let data = null;
        try { data = JSON.parse(msg); } catch (e) { return; }
        if (!data || !data.type) return;

        if (data.type === 'JOIN_QUEUE') {
            matchPlayer(ws, data.pieces || null);
        } else if (data.type === 'LEAVE_QUEUE') {
            const idx = waitingQueue.findIndex(item => item.ws === ws);
            if (idx !== -1) waitingQueue.splice(idx, 1);
            try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'LEFT_QUEUE' })); } catch (e) {}
        } else if (data.type === 'MOVE') {
            const session = gameSessions.get(ws.sessionId);
            if (!session) return;
            // broadcast to both players
            for (const p of session.players) {
                try { if (p.readyState === WebSocket.OPEN) p.send(JSON.stringify(Object.assign({ type: 'MOVE' }, { move: data.move, gameOver: data.gameOver || false, winner: data.winner || null }))); } catch (e) {}
            }
        }
    });

    ws.on('close', () => {
        // Remove from waitingQueue
        const idx = waitingQueue.findIndex(item => item.ws === ws);
        if (idx !== -1) waitingQueue.splice(idx, 1);
        // Notify opponent if in session
        if (ws.sessionId && gameSessions.has(ws.sessionId)) {
            const session = gameSessions.get(ws.sessionId);
            session.players.forEach(p => { if (p !== ws && p.readyState === WebSocket.OPEN) { try { p.send(JSON.stringify({ type: 'OPPONENT_LEFT' })); } catch (e) {} } });
            gameSessions.delete(ws.sessionId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('RandoChess multiplayer server initialized');
});
