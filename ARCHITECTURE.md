# RandoChess - Refactored Architecture

## Overview
This refactor transformed RandoChess from a monolithic 791-line game.js file into a clean, modular architecture with clear separation of concerns.

## File Structure

### Core Modules

**pieces.js** - Piece definitions and generation
- `Move` class: Defines piece movement rules
- `Piece` class: Piece data structure
- `PieceGenerator`: Generates random piece sets
- `PieceSerializer`: Handles network serialization/deserialization

**engine.js** - Pure game logic
- `ChessEngine`: Board state, move validation, game rules
- No UI dependencies, no network code
- Fully testable in isolation
- Cloneable for AI lookahead

**renderer.js** - UI rendering
- `BoardRenderer`: Renders board state to DOM
- `UIManager`: Handles messages, turn display, buttons
- No game logic - pure presentation layer

**ai.js** - AI player
- `ChessAI`: Minimax with alpha-beta pruning
- Uses `ChessEngine` for all game logic (no duplication)
- Configurable difficulty levels

**controllers.js** - Game mode coordination
- `GameController`: Base controller class
- `AIGameController`: Manages AI vs player games
- `MultiplayerGameController`: Manages networked games
- Clean separation between AI and multiplayer modes

**multiplayer.js** - Network client
- `MultiplayerClient`: WebSocket communication
- Callback-based API for loose coupling
- No direct DOM manipulation

**game.js** - Application coordinator
- `RandoChessApp`: Orchestrates all modules
- Manages game mode transitions
- Entry point and initialization

**server.js** - Multiplayer server (unchanged structure)
- WebSocket server
- Game session management
- Matchmaking queue

## Architecture Benefits

### 1. Separation of Concerns
- **Game Logic** (engine.js): Pure, testable, no side effects
- **UI** (renderer.js): Presentation only, no game rules
- **AI** (ai.js): Strategy only, delegates to engine
- **Network** (multiplayer.js): Communication only
- **Coordination** (controllers.js, game.js): Orchestration

### 2. No Code Duplication
- Move validation logic exists in ONE place (engine.js)
- AI uses the same engine as the game
- Serialization handled centrally in PieceSerializer

### 3. Testability
- Each module can be tested independently
- Engine is pure and deterministic
- No global state pollution

### 4. Clear Dependencies
```
game.js
├── pieces.js (standalone)
├── engine.js (depends on: pieces.js)
├── renderer.js (standalone)
├── ai.js (depends on: engine.js)
├── controllers.js (depends on: engine.js, renderer.js, ai.js, multiplayer.js)
└── multiplayer.js (depends on: pieces.js)
```

### 5. Easier to Extend
Want to add a new feature? Clear where it belongs:
- New piece type → `pieces.js`
- New game rule → `engine.js`
- New UI element → `renderer.js`
- Better AI → `ai.js`
- New game mode → `controllers.js`

## Key Improvements

### Before: Tangled Responsibilities
```javascript
class GameBoard {
    // Mixed: game logic, rendering, AI, multiplayer, piece generation
    render() { /* DOM manipulation */ }
    makeMove() { /* game logic + network calls */ }
    makeAIMove() { /* AI logic inline */ }
    getValidMoves() { /* duplicated in ai.js */ }
}
```

### After: Clean Separation
```javascript
// Pure game logic
class ChessEngine {
    makeMove(from, to) { /* just the rules */ }
}

// Pure rendering
class BoardRenderer {
    render(boardState) { /* just DOM */ }
}

// Coordination
class AIGameController {
    constructor(engine, renderer, ai) { /* compose modules */ }
}
```

### Before: Global State Mess
```javascript
window.sessionPieces = /* ... */
window.sessionPlacement = /* ... */
window.game = /* ... */
window.multiplayerClient = /* ... */
```

### After: Encapsulated State
```javascript
class RandoChessApp {
    constructor() {
        this.pieces = null;
        this.renderer = null;
        this.currentController = null;
        // All state in one place
    }
}
```

### Before: Duplicate Move Logic
- `GameBoard.getValidMoves()` - for UI
- `ChessAI.getMovesForPiece()` - for AI (slightly different!)

### After: Single Source of Truth
- `ChessEngine.getValidMoves()` - used by everyone
- `ChessEngine.getAllMoves()` - used by AI
- Same logic, guaranteed consistency

## Migration Notes

### Removed Global Variables
- `window.sessionPieces` → `app.pieces`
- `window.sessionPlacement` → managed by engine
- `window.game` → `app.currentController`
- `window.multiplayerClient` → `app.multiplayerClient`

### API Changes
- Old: `new GameBoard(pieces)` then check `isAIGame` flag
- New: `new AIGameController(...)` or `new MultiplayerGameController(...)`

### Serialization Fix
- Old: `deserializePieces()` left promotion references broken
- New: `PieceSerializer.deserialize()` properly reconstructs all references

## Future Developer Tips

### Adding a New Piece Type
1. Update `PieceGenerator.generateRandomPieces()` in `pieces.js`
2. No other changes needed - engine handles all piece types generically

### Adding a New Game Rule
1. Update `ChessEngine.makeMove()` or `getValidMoves()` in `engine.js`
2. AI and UI automatically use new rules

### Adding a New UI Feature
1. Update `BoardRenderer` or `UIManager` in `renderer.js`
2. No need to touch game logic

### Adding a New Game Mode
1. Create new controller extending `GameController` in `controllers.js`
2. Add mode selection in `game.js`

### Testing
Each module can be tested independently:
```javascript
// Test engine
const engine = new ChessEngine(testPieces);
engine.initializeBoard();
assert(engine.makeMove(6, 4, 4, 4) === true);

// Test AI
const ai = new ChessAI('hard');
const move = ai.getBestMove(engine);
assert(move !== null);

// Test renderer (with mock DOM)
const renderer = new BoardRenderer(mockElement);
renderer.render(testBoard);
```

## Performance
- No performance regression
- AI still evaluates same number of positions
- Rendering is identical
- Network protocol unchanged

## Backward Compatibility
- Server works with refactored client
- Save/load would need updating (if added)
- Deployment is drop-in replacement

---

This refactor makes RandoChess maintainable, testable, and ready for future enhancements. Each module does one thing well, and the whole system is easier to understand and modify.
