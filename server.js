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

// Track rematch votes per session: Map sessionId -> { [playerId]: 'roll'|'keep' }
const rematchVotes = new Map();

// Use lightweight placement generator module to avoid duplication.
const { PieceGenerator } = require('./placementGenerator.js');

function generateSessionId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function matchPlayer(ws, pieces, seed = null) {
    if (waitingQueue.length > 0) {
        const waiting = waitingQueue.shift();
        const selectedPieces = waiting.pieces || pieces;
        const selectedSeed =
            typeof waiting.seed !== 'undefined' && waiting.seed !== null
                ? waiting.seed
                : seed || null;
        if (!selectedPieces) {
            try {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(
                        JSON.stringify({
                            type: 'ERROR',
                            message: 'Invalid pieces',
                        })
                    );
            } catch (e) {
                console.warn('Failed to send ERROR to client', e);
            }
            return;
        }

        const sessionId = generateSessionId();
        const placement = PieceGenerator.generatePlacement(
            selectedPieces,
            selectedSeed
        );
        const colors =
            Math.random() < 0.5 ? ['white', 'black'] : ['black', 'white'];

        const session = {
            sessionId,
            pieces: selectedPieces,
            placement,
            players: [waiting.ws, ws],
        };
        gameSessions.set(sessionId, session);
        waiting.ws.sessionId = sessionId;
        ws.sessionId = sessionId;

        const msg0 = {
            type: 'MATCHED',
            color: colors[0],
            sessionId,
            pieces: selectedPieces,
            placement,
            seed: selectedSeed,
        };
        const msg1 = {
            type: 'MATCHED',
            color: colors[1],
            sessionId,
            pieces: selectedPieces,
            placement,
            seed: selectedSeed,
        };

        try {
            if (waiting.ws.readyState === WebSocket.OPEN)
                waiting.ws.send(JSON.stringify(msg0));
        } catch (e) {
            console.warn('Failed to send MATCHED to waiting client', e);
        }
        try {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg1));
        } catch (e) {
            console.warn('Failed to send MATCHED to joining client', e);
        }
    } else {
        waitingQueue.push({ ws, pieces, seed });
        try {
            if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'WAITING', message: '⏳' }));
        } catch (e) {
            console.warn('Failed to send WAITING to client', e);
        }
    }
}

wss.on('connection', (ws) => {
    ws.playerId = Math.random().toString(36).substring(2, 12).toUpperCase();
    try {
        ws.send(JSON.stringify({ type: 'ASSIGN_ID', playerId: ws.playerId }));
    } catch (e) {
        console.warn('Failed to assign id to client', e);
    }

    ws.on('message', (msg) => {
        let data = null;
        try {
            data = JSON.parse(msg);
        } catch (e) {
            return;
        }
        if (!data || !data.type) return;

        if (data.type === 'JOIN_QUEUE') {
            matchPlayer(
                ws,
                data.pieces || null,
                typeof data.seed !== 'undefined' ? data.seed : null
            );
        } else if (data.type === 'LEAVE_QUEUE') {
            const idx = waitingQueue.findIndex((item) => item.ws === ws);
            if (idx !== -1) waitingQueue.splice(idx, 1);
            try {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(JSON.stringify({ type: 'LEFT_QUEUE' }));
            } catch (e) {
                console.warn('Failed to notify client LEFT_QUEUE', e);
            }
        } else if (data.type === 'MOVE') {
            const session = gameSessions.get(ws.sessionId);
            if (!session) return;
            // broadcast to both players
            for (const p of session.players) {
                try {
                    if (p.readyState === WebSocket.OPEN)
                        p.send(
                            JSON.stringify(
                                Object.assign(
                                    { type: 'MOVE' },
                                    {
                                        move: data.move,
                                        gameOver: data.gameOver || false,
                                        winner: data.winner || null,
                                    }
                                )
                            )
                        );
                } catch (e) {
                    console.warn('Failed to forward MOVE to session player', e);
                }
            }
        } else if (
            data.type === 'DRAW_REQUEST' ||
            data.type === 'DRAW_PERFORM' ||
            data.type === 'RESIGN' ||
            data.type === 'TAKEBACK_REQUEST' ||
            data.type === 'TAKEBACK_PERFORM'
        ) {
            const session = gameSessions.get(ws.sessionId);
            if (!session) return;
            // Relay these control messages to the *other* player only (avoid echoing back to origin)
            for (const p of session.players) {
                if (p === ws) continue;
                try {
                    if (p.readyState === WebSocket.OPEN)
                        p.send(JSON.stringify(data));
                } catch (e) {
                    console.warn(
                        'Failed to forward control message to opponent',
                        e
                    );
                }
            }
        } else if (data.type === 'REMATCH_VOTE') {
            const session = gameSessions.get(ws.sessionId);
            if (!session) return;
            const sid = ws.sessionId;
            if (!rematchVotes.has(sid)) rematchVotes.set(sid, {});
            const votes = rematchVotes.get(sid);
            // Expect data.choice === 'roll' or 'keep'
            if (data && (data.choice === 'roll' || data.choice === 'keep')) {
                votes[ws.playerId] = data.choice;
            }

            // Broadcast current rematch status to both players (tailored: mySelection/opponentSelection)
            for (const p of session.players) {
                try {
                    if (p.readyState !== WebSocket.OPEN) continue;
                    const other = session.players.find((x) => x !== p);
                    const payload = {
                        type: 'REMATCH_STATUS',
                        mySelection: votes[p.playerId] || null,
                        opponentSelection: other
                            ? votes[other.playerId] || null
                            : null,
                    };
                    p.send(JSON.stringify(payload));
                } catch (e) {
                    console.warn(
                        'Error while handling REMATCH_VOTE resolution',
                        e
                    );
                }
            }

            // If both players have voted, resolve rematch
            const playerIds = session.players.map((p) => p.playerId);
            if (playerIds.every((id) => votes[id])) {
                // Both voted
                const bothKeep = playerIds.every((id) => votes[id] === 'keep');
                // Decide action: both keep => reset, otherwise reroll
                const action = bothKeep ? 'reset' : 'reroll';

                // For reroll, instruct clients to generate a new seeded set (and placement)
                // by sending a fresh seed. For reset, reuse existing placement.
                //
                // NOTE: We intentionally do not generate new `pieces` server-side here.
                // The authoritative piece-generation algorithm lives in the client
                // (`Generator.js`) and is deterministic when given a seed. By
                // sending a seed to both clients they will independently produce
                // the same new piece set and placement. Keeping generation on
                // the client keeps server logic minimal and avoids duplicating
                // the full generator implementation on the server.
                let newPlacement = session.placement;
                let payloadExtra = {};
                if (action === 'reroll') {
                    const newSeed = Math.floor(Math.random() * 1000000);
                    // Do NOT attempt to re-generate pieces server-side here; instead
                    // tell clients to use the provided seed so they independently
                    // generate the same new pieces and placement.
                    payloadExtra.seed = newSeed;
                    // clear placement so clients will compute placement from seed
                    newPlacement = null;
                    // update session seed so future joins (if any) can be aware
                    session.seed = newSeed;
                } else {
                    // keep/reset: reuse current placement
                    payloadExtra.seed =
                        typeof session.seed !== 'undefined'
                            ? session.seed
                            : null;
                }

                // Notify both players of rematch result
                for (const p of session.players) {
                    try {
                        if (p.readyState === WebSocket.OPEN)
                            p.send(
                                JSON.stringify(
                                    Object.assign(
                                        {
                                            type: 'REMATCH_RESULT',
                                            action,
                                            placement: newPlacement,
                                        },
                                        payloadExtra
                                    )
                                )
                            );
                    } catch (e) {
                        console.warn(
                            'Failed to notify player of rematch result',
                            e
                        );
                    }
                }

                // Clear stored votes for the session
                rematchVotes.delete(sid);
            }
        }
    });

    ws.on('close', () => {
        // Remove from waitingQueue
        const idx = waitingQueue.findIndex((item) => item.ws === ws);
        if (idx !== -1) waitingQueue.splice(idx, 1);
        // Notify opponent if in session
        if (ws.sessionId && gameSessions.has(ws.sessionId)) {
            const session = gameSessions.get(ws.sessionId);
            session.players.forEach((p) => {
                if (p !== ws && p.readyState === WebSocket.OPEN) {
                    try {
                        p.send(JSON.stringify({ type: 'OPPONENT_LEFT' }));
                    } catch (e) {
                        console.warn(
                            'Failed to notify opponent that player left',
                            e
                        );
                    }
                }
            });
            gameSessions.delete(ws.sessionId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('RandoChess multiplayer server initialized');
});
