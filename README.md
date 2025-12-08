# RandoChess - Automatic Matchmaking

A randomized chess variant with automatic multiplayer matchmaking.

## Installation

1. Install Node.js dependencies:
```bash
npm install
```

## Running the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

## How to Play

1. Open `http://localhost:3000` in your browser
2. You'll automatically be matched with another player (or wait if no one is available)
3. Game starts! Play your assigned color
4. When the game ends, you can:
   - **Rematch** - Play another game with the same opponent and same pieces
   - **Find New Opponent** - Leave and get matched with someone else

## Features

- **Automatic Matchmaking**: Just load the page and you're matched with an opponent
- **Session Persistence**: Pieces stay the same for rematches with the same opponent
- **Rematch System**: Keep playing with same pieces to learn and strategize
- **Opponent Reconnection**: If someone disconnects, you're automatically re-queued
- **Click-to-Learn UI**: Click pieces to see their moves (dots = possible moves, green = valid moves)

## Game Rules

- Capture the opponent's Royal piece (glowing gold) to win
- Pieces are randomly generated each session with unique movement patterns
- Pawns (second rank) move forward and capture diagonally
- All other pieces use the same pattern for moving and capturing

## Testing Locally

Open `http://localhost:3000` in two different browser windows to test the matchmaking!
