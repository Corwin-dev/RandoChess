// ===== RandoChess - Randomized Abstract Chess =====
// A chess variant where pieces are randomly generated each game
// Straight moves (orthogonal/diagonal) slide, non-straight moves jump

// ===== Data Structures =====

class Move {
    constructor(step, symmetry, distance, jump, requiresUnmoved, capture = 'allowed') {
        this.step = step; // [dx, dy] - movement vector
        this.symmetry = symmetry; // None|Horizontal|Vertical|4way|8way
        this.distance = distance; // max distance, -1 for unlimited
        this.jump = jump; // prohibited (slide) | required (jump) - automatic based on step
        this.requiresUnmoved = requiresUnmoved; // always false (feature disabled)
        this.capture = capture; // allowed (default) | prohibited (pawn forward) | required (pawn diagonal)
    }

    // Generate all possible steps based on symmetry
    getSteps() {
        const [dx, dy] = this.step;
        const steps = [[dx, dy]];

        switch (this.symmetry) {
            case 'Horizontal':
                steps.push([-dx, dy]);
                break;
            case 'Vertical':
                steps.push([dx, -dy]);
                break;
            case '4way':
                steps.push([-dx, dy], [dx, -dy], [-dx, -dy]);
                break;
            case '8way':
                steps.push([-dx, dy], [dx, -dy], [-dx, -dy]);
                steps.push([dy, dx], [-dy, dx], [dy, -dx], [-dy, -dx]);
                break;
        }

        return steps;
    }
}

class Piece {
    constructor(name, moves, royal, specials, promotionPieces, promotionRank) {
        this.name = name;
        this.moves = moves; // [Move]
        this.royal = royal; // bool
        this.specials = specials; // [Special] - for future expansion
        this.promotionPieces = promotionPieces; // [Piece]
        this.promotionRank = promotionRank; // int (0-7)
    }
}

// Helper functions to serialize/deserialize pieces for network transfer
function deserializePieces(piecesData) {
    // piecesData is already parsed JSON (array of plain objects)
    if (!piecesData) {
        console.error('piecesData is undefined');
        return null;
    }
    
    console.log('Deserializing pieces:', piecesData.map(p => p.name));
    
    return piecesData.map(pieceData => {
        // Reconstruct Move objects
        const moves = pieceData.moves.map(moveData => 
            new Move(
                moveData.step,
                moveData.symmetry,
                moveData.distance,
                moveData.jump,
                moveData.requiresUnmoved,
                moveData.capture
            )
        );
        
        // Reconstruct Piece object
        return new Piece(
            pieceData.name,
            moves,
            pieceData.royal,
            pieceData.specials,
            pieceData.promotionPieces, // Note: promotionPieces reference will be fixed later
            pieceData.promotionRank
        );
    });
}

// ===== Piece Generator =====

class PieceGenerator {
    static symmetries = ['Horizontal', '4way', '8way'];
    
    static generateRandomPieces() {
        const pieces = [];
        const usedSymbols = new Set(); // Track used symbols

        // Generate Royal piece (must have one)
        // 50% chance: 1 move, 50% chance: 2 moves
        const royalMoveCount = Math.random() < 0.5 ? 1 : 2;
        
        const royalMoves = this.generateRandomMoves(royalMoveCount);
        const royalSymbol = this.selectSymbolForPiece(royalMoves, true, false, usedSymbols);
        usedSymbols.add(royalSymbol);
        const royal = new Piece(
            royalSymbol,
            royalMoves,
            true,
            [],
            [],
            -1
        );
        pieces.push(royal);

        // Generate 5 random non-royal pieces
        for (let i = 0; i < 5; i++) {
            const numMoves = 1 + Math.floor(Math.random() + Math.random() + Math.random()); // 1-3 moves
            const moves = this.generateRandomMoves(numMoves);
            const symbol = this.selectSymbolForPiece(moves, false, false, usedSymbols);
            usedSymbols.add(symbol);
            const piece = new Piece(
                symbol,
                moves,
                false,
                [],
                [],
                -1
            );
            pieces.push(piece);
        }

        // Generate pawn-like piece (can promote)
        // Forward move (prohibited capture) and diagonal capture (required capture)
        const pawnMoves = [
            new Move([0, 1], 'None', 1, 'prohibited', false, 'prohibited'),      // Forward move only
            new Move([1, 1], 'Horizontal', 1, 'prohibited', false, 'required')   // Diagonal capture only
        ];
        
        const promotionPieces = [];
        const numPromotions = 1 + Math.floor(Math.random() * Math.min(3, pieces.length));
        for (let i = 0; i < numPromotions; i++) {
            promotionPieces.push(pieces[Math.floor(Math.random() * pieces.length)]);
        }
        
        const pawnSymbol = this.selectSymbolForPiece(pawnMoves, false, true, usedSymbols);
        usedSymbols.add(pawnSymbol);
        const pawn = new Piece(
            pawnSymbol,
            pawnMoves,
            false,
            [],
            promotionPieces,
            6 + Math.floor(Math.random() * 2) // promotes on rank 6 or 7
        );
        pieces.push(pawn);

        return pieces;
    }

    static selectSymbolForPiece(moves, isRoyal, isPawn = false, usedSymbols = new Set()) {
        // Analyze piece characteristics
        let hasLongRange = false;
        let hasDiagonal = false;
        let hasStraight = false;
        let hasJump = false;
        let isShortRange = true;
        let hasComplexMove = false;
        
        for (const move of moves) {
            const [dx, dy] = move.step;
            
            // Check range
            if (move.distance === -1 || move.distance > 3) {
                hasLongRange = true;
                isShortRange = false;
            }
            
            // Check direction type
            if (dx === dy && dx !== 0) hasDiagonal = true;
            if ((dx === 0 && dy !== 0) || (dy === 0 && dx !== 0)) hasStraight = true;
            
            // Check for knight-like jumps
            if (move.jump === 'required' || (dx > 1 && dy > 0) || (dy > 1 && dx > 0)) {
                hasJump = true;
            }
            
            // Complex moves (L-shapes, unusual steps)
            if ((dx === 2 && dy === 1) || (dx === 1 && dy === 2) || (dx === 3 || dy === 3)) {
                hasComplexMove = true;
            }
        }
        
        // Symbol selection based on characteristics
        if (isRoyal) {
            // Royal pieces get crown-like symbols
            const royalSymbols = ['⚜', '♔', '⚑'];
            return this.getUniqueSymbol(royalSymbols, usedSymbols);
        }
        
        if (isPawn) {
            // Pawn-like pieces get simple upward symbols
            const pawnSymbols = ['▴', '▵'];
            return this.getUniqueSymbol(pawnSymbols, usedSymbols);
        }
        
        if (hasJump || hasComplexMove) {
            // Jumping/complex pieces get dynamic symbols
            const jumpSymbols = ['✪', '◬', '⬟'];
            return this.getUniqueSymbol(jumpSymbols, usedSymbols);
        }
        
        if (hasLongRange && hasDiagonal && hasStraight) {
            // Queen-like pieces (powerful, all directions)
            const queenSymbols = ['✶', '❖', '✸'];
            return this.getUniqueSymbol(queenSymbols, usedSymbols);
        }
        
        if (hasLongRange && hasStraight) {
            // Rook-like pieces (straight lines)
            const rookSymbols = ['⊞', '🞧'];
            return this.getUniqueSymbol(rookSymbols, usedSymbols);
        }
        
        if (hasLongRange && hasDiagonal) {
            // Bishop-like pieces (diagonals)
            const bishopSymbols = ['⨯', '⟐', '⬖', '⬗'];
            return this.getUniqueSymbol(bishopSymbols, usedSymbols);
        }
        
        if (isShortRange) {
            // Short range pieces get smaller symbols
            const shortSymbols = ['○', '◉', '◓'];
            return this.getUniqueSymbol(shortSymbols, usedSymbols);
        }
        
        // Default: generic piece symbols
        const genericSymbols = ['★', '☆', '⬢', '⬣', '⬡', '◈', '✦', '✫', '✬', '✭', '✮', '✯'];
        return this.getUniqueSymbol(genericSymbols, usedSymbols);
    }

    static getUniqueSymbol(symbolArray, usedSymbols) {
        // Try to find an unused symbol from the preferred array
        const availableSymbols = symbolArray.filter(s => !usedSymbols.has(s));
        
        if (availableSymbols.length > 0) {
            return availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
        }
        
        // Fallback: use generic symbols
        const genericSymbols = ['★', '☆', '⬢', '⬣', '⬡', '◈', '✦', '✫', '✬', '✭', '✮', '✯',
                               '◆', '◇', '●', '◐', '◑', '◒', '▲', '△', '▼', '▽', '◀', '▶',
                               '⬤', '◘', '◙', '♦', '♥', '♠', '♣', '♨', '⚡', '⚐'];
        const availableGeneric = genericSymbols.filter(s => !usedSymbols.has(s));
        
        if (availableGeneric.length > 0) {
            return availableGeneric[Math.floor(Math.random() * availableGeneric.length)];
        }
        
        // Final fallback: shouldn't happen with 40+ symbols for 7 pieces
        return symbolArray[Math.floor(Math.random() * symbolArray.length)];
    }

    static generateRandomMoves(count) {
        const moves = [];
        
        for (let i = 0; i < count; i++) {
            // Random step (0-3 in each direction, but not both 0)
            // Custom ratio: more weight on smaller values
            const stepOptions = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];
            let dx, dy;
            do {
                dx = stepOptions[Math.floor(Math.random() * stepOptions.length)];
                dy = stepOptions[Math.floor(Math.random() * stepOptions.length)];
            } while (dx === 0 && dy === 0);

            const symmetry = this.symmetries[Math.floor(Math.random() * this.symmetries.length)];
            
            const requiresUnmoved = false; // Disabled - no one-time-use moves

            // Determine if this is a straight move (slide) or non-straight move (jump)
            // Straight moves: orthogonal (dx=0 or dy=0) or diagonal (dx=dy)
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const jump = isStraightMove ? 'prohibited' : 'required';
            
            // Jump moves always distance 1, slide moves can be unlimited or limited
            let distance;
            if (jump === 'required') {
                distance = 1;
            } else {
                // Slide moves: 50% unlimited, 50% limited
                distance = Math.random() < 0.5 ? -1 : 1;
            }

            moves.push(new Move([dx, dy], symmetry, distance, jump, requiresUnmoved));
        }
        
        // Ensure at least one move has non-zero y value (can move forward/backward)
        const hasYMovement = moves.some(m => m.step[1] !== 0);
        if (!hasYMovement && moves.length > 0) {
            // Replace first move with one that has y movement
            const stepOptions = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];
            const dx = stepOptions[Math.floor(Math.random() * stepOptions.length)];
            const dy = stepOptions.filter(v => v !== 0)[Math.floor(Math.random() * stepOptions.filter(v => v !== 0).length)];
            
            const symmetry = this.symmetries[Math.floor(Math.random() * this.symmetries.length)];
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const jump = isStraightMove ? 'prohibited' : 'required';
            const distance = jump === 'required' ? 1 : (Math.random() < 0.5 ? -1 : 1);
            
            moves[0] = new Move([dx, dy], symmetry, distance, jump, false);
        }
        
        return moves;
    }
}

// ===== Game Board =====

class GameBoard {
    constructor(pieces = null) {
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.currentTurn = 'white';
        this.selectedSquare = null;
        this.validMoves = [];
        this.pieces = pieces || PieceGenerator.generateRandomPieces();
        this.gameOver = false;
        this.moveHistory = [];
        this.playerColor = null; // Set by multiplayer client or AI game
        this.isAIGame = false; // Whether this is an AI game
        this.aiPlayer = null; // ChessAI instance
        this.aiColor = null; // Which color the AI plays
        
        // Chess clock properties
        this.clockEnabled = false;
        this.whiteTime = 300000; // 5 minutes in milliseconds
        this.blackTime = 300000;
        this.clockInterval = null;
        this.lastTickTime = null;
        
        this.initializeBoard();
        this.render();
        this.attachEventListeners();
    }

    initializeBoard() {
        // Clear the entire board first
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        
        // Back rank setup: symmetric pairs + king and strong piece in middle
        // pieces[0] = royal, pieces[1-5] = random non-royal, pieces[6] = pawn
        
        // Find the strongest non-royal piece (most moves)
        let strongestIndex = 1;
        let maxMoves = this.pieces[1].moves.length;
        for (let i = 2; i <= 5; i++) {
            if (this.pieces[i].moves.length > maxMoves) {
                maxMoves = this.pieces[i].moves.length;
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
        
        // Use placement from server (multiplayer) or generate locally (single player)
        // In multiplayer, sessionPlacement comes from server to ensure both players match
        if (!window.sessionPlacement) {
            // Generate placement locally (for single player or first initialization)
            for (let i = remainingPieces.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [remainingPieces[i], remainingPieces[j]] = [remainingPieces[j], remainingPieces[i]];
            }
            
            window.sessionPlacement = {
                remainingPieces: [...remainingPieces],
                strongestIndex: strongestIndex
            };
        } else {
            // Use placement from session (comes from server in multiplayer)
            remainingPieces.length = 0;
            remainingPieces.push(...window.sessionPlacement.remainingPieces);
            strongestIndex = window.sessionPlacement.strongestIndex;
        }
        
        // Classic chess layout: Rook-Knight-Bishop-Queen-King-Bishop-Knight-Rook
        // Our layout: A-B-C-Strong-Royal-C-B-A (symmetric pairs)
        const backRankPieces = [
            remainingPieces[0], // A
            remainingPieces[1], // B
            remainingPieces[2], // C
            strongestIndex,     // Strong piece
            0,                  // Royal (king)
            remainingPieces[2], // C (mirror)
            remainingPieces[1], // B (mirror)
            remainingPieces[0]  // A (mirror)
        ];
        
        for (let col = 0; col < 8; col++) {
            const pieceType = backRankPieces[col];
            this.board[0][col] = {
                piece: this.pieces[pieceType],
                color: 'black',
                hasMoved: false
            };
            this.board[7][col] = {
                piece: this.pieces[pieceType],
                color: 'white',
                hasMoved: false
            };
        }

        // Second rank - all pawn-like pieces
        const pawnIndex = 6; // Last piece is always the pawn
        for (let col = 0; col < 8; col++) {
            this.board[1][col] = {
                piece: this.pieces[pawnIndex],
                color: 'black',
                hasMoved: false
            };
            this.board[6][col] = {
                piece: this.pieces[pawnIndex],
                color: 'white',
                hasMoved: false
            };
        }
    }

    render() {
        const boardElement = document.getElementById('board');
        boardElement.innerHTML = '';

        // Calculate theoretical moves if a piece is selected
        let theoreticalMoves = new Map(); // position -> {canMove, canCapture}
        if (this.selectedSquare) {
            const selectedCell = this.board[this.selectedSquare.row][this.selectedSquare.col];
            if (selectedCell) {
                theoreticalMoves = this.getTheoreticalMoves(this.selectedSquare.row, this.selectedSquare.col);
            }
        }

        // Render board from black's perspective if playerColor is black
        const startRow = this.playerColor === 'black' ? 7 : 0;
        const endRow = this.playerColor === 'black' ? -1 : 8;
        const rowStep = this.playerColor === 'black' ? -1 : 1;
        const startCol = this.playerColor === 'black' ? 7 : 0;
        const endCol = this.playerColor === 'black' ? -1 : 8;
        const colStep = this.playerColor === 'black' ? -1 : 1;

        for (let row = startRow; row !== endRow; row += rowStep) {
            for (let col = startCol; col !== endCol; col += colStep) {
                const square = document.createElement('div');
                square.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
                square.dataset.row = row;
                square.dataset.col = col;

                const cellData = this.board[row][col];
                if (cellData) {
                    const piece = document.createElement('span');
                    piece.className = `piece ${cellData.color}`;
                    if (cellData.piece.royal) {
                        piece.classList.add('royal');
                    }
                    piece.textContent = cellData.piece.name;
                    square.appendChild(piece);
                }

                if (this.selectedSquare && this.selectedSquare.row === row && this.selectedSquare.col === col) {
                    square.classList.add('selected');
                }

                // Check if this is a valid move
                const isValidMove = this.validMoves.some(m => m.row === row && m.col === col);
                
                // Check if this is a theoretical move
                const key = `${row},${col}`;
                const theoreticalMove = theoreticalMoves.get(key);
                
                if (theoreticalMove) {
                    // Add dot indicator for theoretical move
                    const dot = document.createElement('div');
                    dot.className = 'move-dot';
                    square.appendChild(dot);
                }
                
                if (isValidMove) {
                    // Highlight square for valid move
                    square.classList.add('valid-move');
                }

                boardElement.appendChild(square);
            }
        }
    }

    getTheoreticalMoves(row, col) {
        const cellData = this.board[row][col];
        if (!cellData) return new Map();

        const piece = cellData.piece;
        const direction = cellData.color === 'white' ? -1 : 1;
        const moveSquares = new Map(); // position -> {canMove, canCapture}

        for (const move of piece.moves) {
            if (move.requiresUnmoved && cellData.hasMoved) continue;

            const steps = move.getSteps();

            for (const [dx, dy] of steps) {
                const adjustedDy = dy * direction;
                const maxDist = move.distance === -1 ? 8 : move.distance;

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    if (newRow < 0 || newRow > 7 || newCol < 0 || newCol > 7) break;

                    const key = `${newRow},${newCol}`;
                    if (!moveSquares.has(key)) {
                        moveSquares.set(key, { canMove: false, canCapture: false });
                    }

                    const square = moveSquares.get(key);
                    if (move.capture === 'allowed') {
                        square.canMove = true;
                        square.canCapture = true;
                    } else if (move.capture === 'prohibited') {
                        square.canMove = true;
                    } else if (move.capture === 'required') {
                        square.canCapture = true;
                    }

                    // Jump moves only go one distance
                    if (move.jump === 'required') break;
                }
            }
        }

        return moveSquares;
    }

    attachEventListeners() {
        document.getElementById('board').addEventListener('click', (e) => {
            if (this.gameOver) return;
            
            const square = e.target.closest('.square');
            if (!square) return;

            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);

            this.handleSquareClick(row, col);
        });
    }

    handleSquareClick(row, col) {
        // In multiplayer mode, only allow moves if it's your turn
        // In AI mode, only allow moves if it's the player's turn (not AI's turn)
        if (this.playerColor) {
            if (this.currentTurn !== this.playerColor) return;
        }
        
        // If a valid move is clicked
        const validMove = this.validMoves.find(m => m.row === row && m.col === col);
        if (validMove) {
            this.makeMove(this.selectedSquare.row, this.selectedSquare.col, row, col);
            
            // Send move to server only if in multiplayer mode (not AI mode)
            if (!this.isAIGame && window.multiplayerClient && window.multiplayerClient.isConnected) {
                window.multiplayerClient.sendMove({
                    fromRow: this.selectedSquare.row,
                    fromCol: this.selectedSquare.col,
                    toRow: row,
                    toCol: col
                }, this.gameOver, this.gameOver ? this.currentTurn : null);
            }
            
            this.selectedSquare = null;
            this.validMoves = [];
            this.render();
            return;
        }

        // Select a piece
        const cellData = this.board[row][col];
        if (cellData && cellData.color === this.currentTurn) {
            this.selectedSquare = { row, col };
            this.validMoves = this.getValidMoves(row, col);
            this.render();
        } else {
            this.selectedSquare = null;
            this.validMoves = [];
            this.render();
        }
    }

    getValidMoves(row, col) {
        const cellData = this.board[row][col];
        if (!cellData) return [];

        const piece = cellData.piece;
        const validMoves = [];
        const direction = cellData.color === 'white' ? -1 : 1;

        for (const move of piece.moves) {
            if (move.requiresUnmoved && cellData.hasMoved) continue;

            const steps = move.getSteps();

            for (const [dx, dy] of steps) {
                // Adjust dy for piece color (pawns move forward relative to their side)
                const adjustedDy = dy * direction;
                const maxDist = move.distance === -1 ? 8 : move.distance;

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    if (newRow < 0 || newRow > 7 || newCol < 0 || newCol > 7) break;

                    const targetCell = this.board[newRow][newCol];
                    const hasObstacle = targetCell !== null;
                    const isCapture = hasObstacle && targetCell.color !== cellData.color;
                    const isBlocked = hasObstacle && targetCell.color === cellData.color;

                    // Check jump requirement
                    if (move.jump === 'prohibited' && dist > 1) {
                        // Check if path is clear
                        let pathClear = true;
                        for (let d = 1; d < dist; d++) {
                            if (this.board[row + adjustedDy * d][col + dx * d] !== null) {
                                pathClear = false;
                                break;
                            }
                        }
                        if (!pathClear) break;
                    }

                    // Check capture rules
                    if (move.capture === 'required' && !isCapture) {
                        if (hasObstacle) break;
                        continue;
                    }
                    if (move.capture === 'prohibited' && hasObstacle) {
                        break;
                    }

                    if (isBlocked) break;

                    if (!hasObstacle || isCapture) {
                        validMoves.push({ row: newRow, col: newCol });
                    }

                    // Stop if we hit a piece (and jumping is not required)
                    if (hasObstacle && move.jump !== 'required') break;
                    
                    // If jump is required, only check the exact distance
                    if (move.jump === 'required') break;
                }
            }
        }

        return validMoves;
    }

    makeMove(fromRow, fromCol, toRow, toCol, switchTurn = true) {
        const cellData = this.board[fromRow][fromCol];
        if (!cellData) {
            console.error('No piece at', fromRow, fromCol);
            return;
        }
        
        const captured = this.board[toRow][toCol];

        // Check if capturing a royal piece
        if (captured && captured.piece.royal) {
            this.gameOver = true;
            this.showMessage(`${this.currentTurn.charAt(0).toUpperCase() + this.currentTurn.slice(1)} wins!`);
        }

        // Move the piece
        this.board[toRow][toCol] = {
            piece: cellData.piece,
            color: cellData.color,
            hasMoved: true
        };
        this.board[fromRow][fromCol] = null;

        // Check for promotion
        if (cellData.piece.promotionRank !== -1 && toRow === cellData.piece.promotionRank) {
            if (cellData.piece.promotionPieces.length > 0) {
                // Promote to first available piece (in a full version, let player choose)
                this.board[toRow][toCol].piece = cellData.piece.promotionPieces[0];
                this.showMessage('Piece promoted!');
            }
        }

        // Switch turns only if requested (not for remote moves)
        if (switchTurn) {
            this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';
            document.getElementById('current-turn').textContent = 
                this.currentTurn.charAt(0).toUpperCase() + this.currentTurn.slice(1);
            
            // Update clock display when turn switches
            if (this.clockEnabled) {
                this.lastTickTime = Date.now(); // Reset tick time for new turn
                this.updateClockDisplay();
            }
            
            // If it's now AI's turn in an AI game, make AI move
            if (this.isAIGame && this.currentTurn === this.aiColor && !this.gameOver) {
                this.makeAIMove();
            }
        }
    }

    showMessage(msg) {
        const messageEl = document.getElementById('message');
        messageEl.textContent = msg;
        setTimeout(() => {
            if (!this.gameOver) messageEl.textContent = '';
        }, 3000);
    }
    
    applyRemoteMove(move) {
        this.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol, false);
        // Update turn indicator
        document.getElementById('current-turn').textContent = 
            this.currentTurn.charAt(0).toUpperCase() + this.currentTurn.slice(1);
        
        // Update clock display when opponent moves
        if (this.clockEnabled) {
            this.lastTickTime = Date.now();
            this.updateClockDisplay();
        }
        
        this.render();
    }
    
    // Enable AI mode for this game
    enableAI(playerColor = null, difficulty = 'medium') {
        this.isAIGame = true;
        // If no player color specified, randomly assign
        this.playerColor = playerColor || (Math.random() < 0.5 ? 'white' : 'black');
        this.aiColor = this.playerColor === 'white' ? 'black' : 'white';
        this.aiPlayer = new ChessAI(difficulty);
        
        console.log(`AI game started. Player: ${this.playerColor}, AI: ${this.aiColor}`);
        
        // Clear the initial message
        const messageEl = document.getElementById('message');
        if (messageEl) {
            messageEl.textContent = '';
        }
        
        // If AI plays first (player is black), make AI move
        if (this.currentTurn === this.aiColor) {
            this.makeAIMove();
        }
    }
    
    // Make AI move after a delay
    makeAIMove() {
        if (this.gameOver || !this.isAIGame) return;
        
        setTimeout(() => {
            const bestMove = this.aiPlayer.getBestMove(this);
            if (bestMove) {
                this.makeMove(bestMove.fromRow, bestMove.fromCol, bestMove.toRow, bestMove.toCol, true);
                this.render(); // Redraw board after AI move
            }
        }, 500); // Small delay to make it feel natural
    }
    
    // Enable chess clock for multiplayer
    startClock() {
        this.clockEnabled = true;
        this.lastTickTime = Date.now();
        
        // Show clock displays
        document.getElementById('white-clock').style.display = 'flex';
        document.getElementById('black-clock').style.display = 'flex';
        
        this.updateClockDisplay();
        
        // Start the interval
        this.clockInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = now - this.lastTickTime;
            this.lastTickTime = now;
            
            // Subtract time from current player's clock
            if (this.currentTurn === 'white') {
                this.whiteTime = Math.max(0, this.whiteTime - elapsed);
                if (this.whiteTime === 0) {
                    this.handleTimeout('white');
                }
            } else {
                this.blackTime = Math.max(0, this.blackTime - elapsed);
                if (this.blackTime === 0) {
                    this.handleTimeout('black');
                }
            }
            
            this.updateClockDisplay();
        }, 100); // Update every 100ms for smooth countdown
    }
    
    stopClock() {
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }
    }
    
    updateClockDisplay() {
        const whiteClock = document.getElementById('white-clock');
        const blackClock = document.getElementById('black-clock');
        
        if (!whiteClock || !blackClock) return;
        
        // Format time as M:SS
        const formatTime = (ms) => {
            const totalSeconds = Math.ceil(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        };
        
        whiteClock.querySelector('.clock-time').textContent = formatTime(this.whiteTime);
        blackClock.querySelector('.clock-time').textContent = formatTime(this.blackTime);
        
        // Highlight active player's clock
        whiteClock.classList.toggle('active', this.currentTurn === 'white' && !this.gameOver);
        blackClock.classList.toggle('active', this.currentTurn === 'black' && !this.gameOver);
        
        // Warning when under 30 seconds
        whiteClock.classList.toggle('warning', this.whiteTime < 30000 && this.whiteTime > 0);
        blackClock.classList.toggle('warning', this.blackTime < 30000 && this.blackTime > 0);
    }
    
    handleTimeout(color) {
        this.stopClock();
        this.gameOver = true;
        const winner = color === 'white' ? 'Black' : 'White';
        this.showMessage(`${winner} wins on time!`);
        
        // Notify server if in multiplayer
        if (!this.isAIGame && window.multiplayerClient && window.multiplayerClient.isConnected) {
            window.multiplayerClient.sendMove({
                fromRow: -1,
                fromCol: -1,
                toRow: -1,
                toCol: -1
            }, true, winner);
        }
    }

}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
    // Generate pieces for initial AI game
    window.sessionPieces = PieceGenerator.generateRandomPieces();
    console.log('Initial pieces generated:', window.sessionPieces.map(p => p.name));
    window.sessionPlacement = null;
    
    // Start AI game immediately
    window.game = new GameBoard(window.sessionPieces);
    window.game.enableAI(null, 'hard'); // Randomly assign player color and start AI
    
    // Set up Search for Opponent button
    const searchBtn = document.getElementById('search-opponent-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            searchBtn.disabled = true;
            searchBtn.textContent = 'Searching...';
            
            // Show waiting message
            const messageEl = document.getElementById('message');
            if (messageEl) {
                messageEl.textContent = 'Waiting for opponent...';
            }
            
            // Connect to multiplayer and join queue
            if (!window.multiplayerClient) {
                window.multiplayerClient = new MultiplayerClient();
            }
            window.multiplayerClient.connect();
        });
    }
});
