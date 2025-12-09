// ===== Core Chess Engine =====
// Pure game logic with no UI or network dependencies

class ChessEngine {
    constructor(pieces, seed = null) {
        this.pieces = pieces;
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.currentTurn = 'white';
        this.gameOver = false;
        this.placement = null; // Store placement for deterministic board setup
        this.pendingPromotion = null; // {row, col, color, promotionPieces} for choice promotions
        this.seed = seed; // Store seed for move-upgrade generation
    }

    // Initialize the board with pieces
    initializeBoard(placement = null) {
        // Clear the board
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.currentTurn = 'white';
        this.gameOver = false;
        
        // Generate or use provided placement
        if (placement) {
            this.placement = placement;
        } else {
            this.placement = this.generatePlacement();
        }
        
        const { remainingPieces, strongestIndex } = this.placement;
        
        // Build back rank layout: symmetric pairs around royal and strongest piece
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
        
        // Place back rank pieces
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

        // Second rank - all pawns
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

    // Generate placement configuration
    generatePlacement() {
        // Create RNG for placement (use seed if available)
        const rng = this.seed !== null ? new SeededRandom(this.seed + 1000000) : null;
        const random = rng ? () => rng.next() : Math.random;
        
        // Find the strongest non-royal piece (most moves)
        // pieces[0] = royal, pieces[1-5] = random non-royal, pieces[6] = pawn
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
        
        // Shuffle for random placement using seeded RNG
        for (let i = remainingPieces.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [remainingPieces[i], remainingPieces[j]] = [remainingPieces[j], remainingPieces[i]];
        }
        
        return {
            remainingPieces: [...remainingPieces],
            strongestIndex: strongestIndex
        };
    }

    // Find the king position for a given color
    findKing(color) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = this.board[row][col];
                if (square && square.color === color && square.piece.royal) {
                    return { row, col };
                }
            }
        }
        return null; // King was captured
    }

    // Check if a square is under attack by the opponent
    isSquareUnderAttack(row, col, byColor) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const square = this.board[r][c];
                if (square && square.color === byColor) {
                    const moves = this.getPseudoLegalMoves(r, c);
                    if (moves.some(m => m.row === row && m.col === col)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Check if a color is in check
    isInCheck(color) {
        const king = this.findKing(color);
        if (!king) return false; // No king = already lost
        
        const opponent = color === 'white' ? 'black' : 'white';
        return this.isSquareUnderAttack(king.row, king.col, opponent);
    }

    // Get pseudo-legal moves (doesn't check if move leaves king in check)
    getPseudoLegalMoves(row, col) {
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
                        // Determine move type based on current state and capture rules
                        let moveType;
                        if (move.capture === 'allowed') {
                            moveType = isCapture ? 'both' : 'both'; // Can move or capture
                        } else if (move.capture === 'prohibited') {
                            moveType = 'move-only';
                        } else if (move.capture === 'required') {
                            moveType = 'capture-only';
                        }
                        validMoves.push({ row: newRow, col: newCol, type: moveType });
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

    // Get all valid moves for a piece at a position (filters out moves that leave king in check)
    getValidMoves(row, col) {
        const pseudoLegalMoves = this.getPseudoLegalMoves(row, col);
        const cellData = this.board[row][col];
        if (!cellData) return [];

        // Filter out moves that would leave own king in check
        const legalMoves = [];
        for (const move of pseudoLegalMoves) {
            // Simulate the move
            const originalTarget = this.board[move.row][move.col];
            this.board[move.row][move.col] = {
                piece: cellData.piece,
                color: cellData.color,
                hasMoved: true
            };
            this.board[row][col] = null;

            // Check if this leaves our king in check
            const inCheck = this.isInCheck(cellData.color);

            // Undo the move
            this.board[row][col] = cellData;
            this.board[move.row][move.col] = originalTarget;

            // Only add move if it doesn't leave king in check
            if (!inCheck) {
                legalMoves.push(move);
            }
        }

        return legalMoves;
    }

    // Get theoretical moves (ignoring turn) - useful for UI hints
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

    // Get unrestricted movement pattern (ignoring board boundaries) - for visualization
    getUnrestrictedPattern(row, col) {
        const cellData = this.board[row][col];
        if (!cellData) return new Map();

        const piece = cellData.piece;
        const direction = cellData.color === 'white' ? -1 : 1;
        const moveSquares = new Map(); // position -> {canMove, canCapture}
        
        // Extend the grid by 8 squares in each direction (16x16 total)
        const gridExtension = 8;

        for (const move of piece.moves) {
            const steps = move.getSteps();

            for (const [dx, dy] of steps) {
                const adjustedDy = dy * direction;
                const maxDist = move.distance === -1 ? gridExtension : move.distance;

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    // No boundary checking - allow extended grid
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

    // Get all possible moves for a color
    getAllMoves(color) {
        const moves = [];
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = this.board[row][col];
                if (square && square.color === color) {
                    const pieceMoves = this.getValidMoves(row, col);
                    for (const move of pieceMoves) {
                        moves.push({
                            fromRow: row,
                            fromCol: col,
                            toRow: move.row,
                            toCol: move.col
                        });
                    }
                }
            }
        }
        
        return moves;
    }

    // Make a move (returns true if successful, false if invalid)
    makeMove(fromRow, fromCol, toRow, toCol) {
        const cellData = this.board[fromRow][fromCol];
        if (!cellData) {
            console.error('No piece at', fromRow, fromCol);
            return false;
        }
        
        // Verify it's the right color's turn
        if (cellData.color !== this.currentTurn) {
            console.error('Not your turn');
            return false;
        }
        
        // Verify the move is valid
        const validMoves = this.getValidMoves(fromRow, fromCol);
        const isValid = validMoves.some(m => m.row === toRow && m.col === toCol);
        if (!isValid) {
            console.error('Invalid move');
            return false;
        }
        
        const captured = this.board[toRow][toCol];

        // Move the piece
        this.board[toRow][toCol] = {
            piece: cellData.piece,
            color: cellData.color,
            hasMoved: true
        };
        this.board[fromRow][fromCol] = null;

        // Check for promotion
        if (cellData.piece.promotionRank !== -1 && toRow === cellData.piece.promotionRank) {
            if (cellData.piece.promotionType === 'choice') {
                // Pawn promotion - player must choose
                this.pendingPromotion = {
                    row: toRow,
                    col: toCol,
                    color: cellData.color,
                    promotionPieces: cellData.piece.promotionPieces
                };
                // Don't switch turns yet - wait for promotion choice
                return true;
            } else if (cellData.piece.promotionType === 'move-upgrade') {
                // Automatic move upgrade promotion
                const rng = this.seed !== null ? new SeededRandom(this.seed + toRow * 8 + toCol) : null;
                const upgradedMoves = PieceGenerator.generateUpgradeMoves(cellData.piece.moves, rng || {next: Math.random});
                
                // Create new upgraded piece
                const upgradedPiece = new Piece(
                    cellData.piece.name,
                    upgradedMoves,
                    cellData.piece.royal,
                    cellData.piece.specials,
                    [],
                    -1,
                    null
                );
                
                this.board[toRow][toCol].piece = upgradedPiece;
            }
        }

        // Switch turns
        this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';

        // Check for checkmate or stalemate
        if (this.getAllMoves(this.currentTurn).length === 0) {
            this.gameOver = true;
            // If in check and no moves, it's checkmate
            // If not in check and no moves, it's stalemate (draw)
        }
        
        return true;
    }
    
    // Complete a pending promotion choice
    completePromotion(pieceIndex) {
        if (!this.pendingPromotion) {
            console.error('No pending promotion');
            return false;
        }
        
        const { row, col, promotionPieces } = this.pendingPromotion;
        
        if (pieceIndex < 0 || pieceIndex >= promotionPieces.length) {
            console.error('Invalid promotion piece index');
            return false;
        }
        
        // Promote to chosen piece
        this.board[row][col].piece = promotionPieces[pieceIndex];
        this.pendingPromotion = null;
        
        // Switch turns
        this.currentTurn = this.currentTurn === 'white' ? 'black' : 'white';
        
        // Check for checkmate or stalemate
        if (this.getAllMoves(this.currentTurn).length === 0) {
            this.gameOver = true;
        }
        
        return true;
    }

    // Check if the game is over
    isGameOver() {
        return this.gameOver;
    }

    // Get the winner (null if game not over)
    getWinner() {
        if (!this.gameOver) return null;
        
        // Check if current player (who has no moves) is in check
        const inCheck = this.isInCheck(this.currentTurn);
        
        if (inCheck) {
            // Checkmate - the other player wins
            return this.currentTurn === 'white' ? 'black' : 'white';
        } else {
            // Stalemate - it's a draw
            return 'draw';
        }
    }

    // Check if current player is in checkmate
    isCheckmate() {
        return this.gameOver && this.isInCheck(this.currentTurn);
    }

    // Check if game is a stalemate (draw)
    isStalemate() {
        return this.gameOver && !this.isInCheck(this.currentTurn);
    }

    // Clone the engine state (useful for AI lookahead)
    clone() {
        const clone = new ChessEngine(this.pieces, this.seed);
        clone.currentTurn = this.currentTurn;
        clone.gameOver = this.gameOver;
        clone.placement = this.placement;
        clone.pendingPromotion = this.pendingPromotion ? {...this.pendingPromotion} : null;
        
        // Deep copy board
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (this.board[row][col]) {
                    clone.board[row][col] = { ...this.board[row][col] };
                }
            }
        }
        
        return clone;
    }
}
