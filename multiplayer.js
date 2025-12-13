// Multiplayer client removed — stub kept to avoid accidental imports.
class MultiplayerClient {
    constructor() {
        console.warn('MultiplayerClient is disabled in this build.');
    }
    connect() { /* no-op */ }
    disconnect() { /* no-op */ }
    sendMove() { /* no-op */ }
    sendRematchRequest() { /* no-op */ }
    leaveAndQueue() { /* no-op */ }
}

try { if (typeof window !== 'undefined') window.MultiplayerClient = null; } catch (e) {}
export { MultiplayerClient };

