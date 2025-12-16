// Multiplayer client intentionally disabled in this build.
// If you want multiplayer locally, run `node server.js` from the project root
// and use a full client build that communicates with the server socket.
// This stub keeps imports safe while clearly signaling the feature is disabled.
class MultiplayerClient {
    constructor() {
        console.warn(
            'MultiplayerClient is disabled in this build. Use the standalone server for matchmaking.'
        );
    }
    connect() {
        /* no-op */
    }
    disconnect() {
        /* no-op */
    }
    sendMove() {
        /* no-op */
    }
    sendRematchRequest() {
        /* no-op */
    }
    leaveAndQueue() {
        /* no-op */
    }
}

try {
    if (typeof window !== 'undefined') window.MultiplayerClient = null;
} catch (e) {
    console.warn('No window to attach MultiplayerClient');
}
export { MultiplayerClient };
