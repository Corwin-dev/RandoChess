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
        this.lastMove = null; // {fromRow, fromCol, toRow, toCol, piece} for en passant tracking
    }

    // Create a shallow-cloned Piece instance and optionally apply a king movement
    // variant. This ensures each placed royal can be an independent instance
    // (so white and black kings can have different movement sets).
    _clonePieceWithVariant(piece, variant = 'normal') {
        // Clone moves deeply
        const clonedMoves = piece.moves.map(m => new Move([...m.step], m.symmetry, m.distance, m.jump, m.requiresUnmoved, m.capture));
        const clonedSpecials = piece.specials.map(s => new Special(s.type, Object.assign({}, s.data)));

        // Apply king-specific variant overrides while preserving any special
        // extra moves (like knight jumps or distance-2 slides). We restrict
        // only the base single-step moves according to the variant.
        if (piece.royal && variant && variant !== 'normal') {
            const preserved = [];
            const base = [];

            for (const m of clonedMoves) {
                const dx = Math.abs(m.step[0]);
                const dy = Math.abs(m.step[1]);

                const isSingleStep = (dx === 1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 1 && dy === 1);
                const isJump = m.jump === 'required';
                const isLong = m.distance && m.distance > 1;

                if (isJump || isLong) {
                    // preserve any knight/jump or multi-square moves
                    preserved.push(new Move([...m.step], m.symmetry, m.distance, m.jump, m.requiresUnmoved, m.capture));
                } else if (isSingleStep) {
                    // candidate for base moves; will be filtered by variant
                    base.push(m);
                } else {
                    // keep other moves conservative
                    preserved.push(new Move([...m.step], m.symmetry, m.distance, m.jump, m.requiresUnmoved, m.capture));
                }
            }

            const filteredBase = [];
            if (variant === 'orthogonal') {
                for (const m of base) {
                    const [dx, dy] = m.step;
                    if (Math.abs(dx) === 1 && dy === 0) filteredBase.push(new Move([...m.step], m.symmetry, m.distance, m.jump, m.requiresUnmoved, m.capture));
                    if (Math.abs(dy) === 1 && dx === 0) filteredBase.push(new Move([...m.step], m.symmetry, m.distance, m.jump, m.requiresUnmoved, m.capture));
                }
            } else if (variant === 'diagonal') {
                for (const m of base) {
                    const [dx, dy] = m.step;
                    if (Math.abs(dx) === 1 && Math.abs(dy) === 1) filteredBase.push(new Move([...m.step], m.symmetry, m.distance, m.jump, m.requiresUnmoved, m.capture));
                }
            }

            const finalMoves = [...filteredBase, ...preserved];
            return new Piece(piece.name, finalMoves, piece.royal, clonedSpecials, piece.promotionPieces, piece.promotionRank, piece.promotionType, piece.upgradeMoves);
        }

        return new Piece(piece.name, clonedMoves, piece.royal, clonedSpecials, piece.promotionPieces, piece.promotionRank, piece.promotionType, piece.upgradeMoves);
    }

    // Initialize the board with pieces
    initializeBoard(placement = null) {
        // Clear the board
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.currentTurn = 'white';
        this.gameOver = false;
        this.lastMove = null;
        
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
            // Use per-square clones for royal pieces so each king can have
            // an independent movement variant when the placement includes
            // `kingVariants` (sent by the server). For non-royal pieces we
            // continue to reference the shared piece type object.
            const isRoyalType = (this.pieces[pieceType] && this.pieces[pieceType].royal);

            if (isRoyalType) {
                const variantBlack = this.placement && this.placement.kingVariants ? this.placement.kingVariants.black : 'normal';
                const variantWhite = this.placement && this.placement.kingVariants ? this.placement.kingVariants.white : 'normal';

                this.board[0][col] = {
                    piece: this._clonePieceWithVariant(this.pieces[pieceType], variantBlack),
                    color: 'black',
                    hasMoved: false
                };

                this.board[7][col] = {
                    piece: this._clonePieceWithVariant(this.pieces[pieceType], variantWhite),
                    color: 'white',
                    hasMoved: false
                };
            } else {
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
        }

        // Second rank - all pawns
        const pawnIndex = 5; // Last piece is always the pawn (index 5)
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
        // pieces[0] = royal, pieces[1-4] = random non-royal, pieces[5] = pawn
        let strongestIndex = 1;
        let maxMoves = this.pieces[1].moves.length;
        for (let i = 2; i <= 4; i++) {
            if (this.pieces[i].moves.length > maxMoves) {
                maxMoves = this.pieces[i].moves.length;
                strongestIndex = i;
            }
        }

        // Get remaining pieces for symmetric placement (exclude strongest)
        const remainingPieces = [];
        for (let i = 1; i <= 4; i++) {
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
                    if (this.canPieceAttackSquare(r, c, row, col)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // Determine whether a piece at (fromRow,fromCol) can attack the square (toRow,toCol)
    // This routine mirrors movement rules but intentionally avoids calling
    // `isSquareUnderAttack` or `getPseudoLegalMoves` to prevent recursion.
    canPieceAttackSquare(fromRow, fromCol, toRow, toCol) {
        const cellData = this.board[fromRow][fromCol];
        if (!cellData) return false;

        const piece = cellData.piece;
        const direction = cellData.color === 'white' ? -1 : 1;

        for (const move of piece.moves) {
            if (move.requiresUnmoved && cellData.hasMoved) continue;

            const steps = move.getSteps();

            for (const [dx, dy] of steps) {
                const adjustedDy = dy * direction;
                const maxDist = move.distance === -1 ? 8 : move.distance;

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = fromRow + adjustedDy * dist;
                    const newCol = fromCol + dx * dist;

                    // Guard against invalid numeric steps (NaN/Infinity) which can
                    // occur if a move's step values are malformed. If encountered,
                    // stop scanning this direction to avoid indexing this.board[NaN].
                    if (!Number.isFinite(newRow) || !Number.isFinite(newCol)) break;

                    if (newRow < 0 || newRow > 7 || newCol < 0 || newCol > 7) break;

                    // If this is the target square, determine if the move can attack it
                    if (newRow === toRow && newCol === toCol) {
                        const targetCell = this.board[newRow][newCol];
                        const hasObstacle = targetCell !== null;
                        const isCapture = hasObstacle && targetCell.color !== cellData.color;

                        // move.capture === 'prohibited' cannot capture (e.g., pawn forward)
                        if (move.capture === 'prohibited' && hasObstacle) {
                            return false;
                        }

                        // capture-only moves must capture
                        if (move.capture === 'required' && !isCapture) {
                            return false;
                        }

                        // If path is blocked before reaching target, it's not an attack
                        if (move.jump !== 'required') {
                            // Check intervening squares
                            let pathClear = true;
                            for (let d = 1; d < dist; d++) {
                                const midRow = fromRow + adjustedDy * d;
                                const midCol = fromCol + dx * d;
                                if (this.board[midRow][midCol] !== null) {
                                    pathClear = false;
                                    break;
                                }
                            }
                            if (!pathClear) return false;
                        }

                        // If we reached here, the piece can attack the target square
                        // For jumping moves, captures are allowed if target occupied by enemy
                        if (move.jump === 'required') {
                            // jumping moves only reach when dist==1
                            return move.distance === 1 || dist === 1 ? (move.capture !== 'required' || isCapture) : false;
                        }

                        return true;
                    }

                    // If there's an obstacle before the target, sliding stops
                    if (this.board[newRow][newCol] !== null && move.jump !== 'required') break;

                    // Jump moves only go one distance
                    if (move.jump === 'required') break;
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
                
                // For pawns: limit distance to 1 if already moved (applies to forward moves with distance > 1)
                let maxDist = move.distance === -1 ? 8 : move.distance;
                if (cellData.hasMoved && move.capture === 'prohibited' && dx === 0 && move.distance > 1) {
                    maxDist = 1; // Pawn can only move 1 square forward after first move
                }

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    if (!Number.isFinite(newRow) || !Number.isFinite(newCol)) break;

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

        // Check for special moves
        for (const special of piece.specials) {
            if (special.type === 'enPassant') {
                // Check for en passant
                if (this.lastMove && 
                    this.lastMove.piece.specials.some(s => s.type === 'enPassant') &&
                    Math.abs(this.lastMove.toRow - this.lastMove.fromRow) === 2) {
                    // Enemy pawn just moved two squares
                    const enemyRow = this.lastMove.toRow;
                    const enemyCol = this.lastMove.toCol;
                    
                    // Check if we're adjacent to the enemy pawn
                    if (row === enemyRow && Math.abs(col - enemyCol) === 1) {
                        // En passant is possible
                        const captureRow = enemyRow + direction;
                        if (captureRow >= 0 && captureRow <= 7) {
                            validMoves.push({ 
                                row: captureRow, 
                                col: enemyCol, 
                                type: 'en-passant',
                                captureRow: enemyRow,
                                captureCol: enemyCol
                            });
                        }
                    }
                }
            } else if (special.type === 'castling' && !cellData.hasMoved) {
                // Check for castling (kingside and queenside)
                const kingRow = row;
                const kingCol = col;
                
                // Kingside castling (columns 5, 6, 7)
                const kingsideRookCol = 7;
                const kingsideRook = this.board[kingRow][kingsideRookCol];
                if (kingsideRook && 
                    kingsideRook.color === cellData.color && 
                    !kingsideRook.hasMoved &&
                    !this.board[kingRow][kingCol + 1] &&
                    !this.board[kingRow][kingCol + 2]) {
                    // Check that king doesn't move through check
                    const opponent = cellData.color === 'white' ? 'black' : 'white';
                    if (!this.isSquareUnderAttack(kingRow, kingCol, opponent) &&
                        !this.isSquareUnderAttack(kingRow, kingCol + 1, opponent) &&
                        !this.isSquareUnderAttack(kingRow, kingCol + 2, opponent)) {
                        validMoves.push({ 
                            row: kingRow, 
                            col: kingCol + 2, 
                            type: 'castling-kingside',
                            rookFromCol: kingsideRookCol,
                            rookToCol: kingCol + 1
                        });
                    }
                }
                
                // Queenside castling (columns 0, 1, 2, 3, 4)
                const queensideRookCol = 0;
                const queensideRook = this.board[kingRow][queensideRookCol];
                if (queensideRook && 
                    queensideRook.color === cellData.color && 
                    !queensideRook.hasMoved &&
                    !this.board[kingRow][kingCol - 1] &&
                    !this.board[kingRow][kingCol - 2] &&
                    !this.board[kingRow][kingCol - 3]) {
                    // Check that king doesn't move through check
                    const opponent = cellData.color === 'white' ? 'black' : 'white';
                    if (!this.isSquareUnderAttack(kingRow, kingCol, opponent) &&
                        !this.isSquareUnderAttack(kingRow, kingCol - 1, opponent) &&
                        !this.isSquareUnderAttack(kingRow, kingCol - 2, opponent)) {
                        validMoves.push({ 
                            row: kingRow, 
                            col: kingCol - 2, 
                            type: 'castling-queenside',
                            rookFromCol: queensideRookCol,
                            rookToCol: kingCol - 1
                        });
                    }
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
            const originalRook = null;
            let rookFromCol = null;
            
            // Handle castling - move the rook during simulation
            if (move.type === 'castling-kingside' || move.type === 'castling-queenside') {
                rookFromCol = move.rookFromCol;
                const originalRookCell = this.board[row][rookFromCol];
                this.board[row][move.rookToCol] = originalRookCell;
                this.board[row][rookFromCol] = null;
            }
            
            // Handle en passant - remove captured pawn during simulation
            if (move.type === 'en-passant') {
                const capturedPawn = this.board[move.captureRow][move.captureCol];
                this.board[move.captureRow][move.captureCol] = null;
            }
            
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
            
            // Undo castling
            if (move.type === 'castling-kingside' || move.type === 'castling-queenside') {
                const originalRookCell = this.board[row][move.rookToCol];
                this.board[row][rookFromCol] = originalRookCell;
                this.board[row][move.rookToCol] = null;
            }
            
            // Undo en passant
            if (move.type === 'en-passant') {
                const capturedPawnColor = cellData.color === 'white' ? 'black' : 'white';
                const pawnPiece = this.pieces.find(p => p.specials.some(s => s.type === 'enPassant'));
                this.board[move.captureRow][move.captureCol] = {
                    piece: pawnPiece,
                    color: capturedPawnColor,
                    hasMoved: true
                };
            }

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
                
                // For pawns: limit distance to 1 if already moved
                let maxDist = move.distance === -1 ? 8 : move.distance;
                if (cellData.hasMoved && move.capture === 'prohibited' && dx === 0 && move.distance > 1) {
                    maxDist = 1;
                }

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    if (!Number.isFinite(newRow) || !Number.isFinite(newCol)) break;

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
            if (move.requiresUnmoved && cellData.hasMoved) continue;

            const steps = move.getSteps();

            for (const [dx, dy] of steps) {
                const adjustedDy = dy * direction;
                
                // For pawns: limit distance to 1 if already moved
                let maxDist = move.distance === -1 ? gridExtension : move.distance;
                if (cellData.hasMoved && move.capture === 'prohibited' && dx === 0 && move.distance > 1) {
                    maxDist = 1;
                }

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    // Guard against invalid numeric steps when generating unrestricted
                    // patterns. If encountered, stop this direction.
                    if (!Number.isFinite(newRow) || !Number.isFinite(newCol)) break;

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
            console.warn('No piece at', fromRow, fromCol);
            return false;
        }
        
        // Verify it's the right color's turn
        if (cellData.color !== this.currentTurn) {
            console.warn('Not your turn');
            return false;
        }
        
        // Verify the move is valid
        const validMoves = this.getValidMoves(fromRow, fromCol);
        const moveData = validMoves.find(m => m.row === toRow && m.col === toCol);
        if (!moveData) {
            console.warn('Invalid move');
            return false;
        }
        
        const captured = this.board[toRow][toCol];

        // Handle special moves
        if (moveData.type === 'en-passant') {
            // Remove the captured pawn
            this.board[moveData.captureRow][moveData.captureCol] = null;
        } else if (moveData.type === 'castling-kingside' || moveData.type === 'castling-queenside') {
            // Move the rook
            const rook = this.board[fromRow][moveData.rookFromCol];
            this.board[fromRow][moveData.rookToCol] = {
                piece: rook.piece,
                color: rook.color,
                hasMoved: true
            };
            this.board[fromRow][moveData.rookFromCol] = null;
        }

        // Move the piece
        this.board[toRow][toCol] = {
            piece: cellData.piece,
            color: cellData.color,
            hasMoved: true
        };
        this.board[fromRow][fromCol] = null;
        
        // Track last move for en passant
        this.lastMove = {
            fromRow,
            fromCol,
            toRow,
            toCol,
            piece: cellData.piece
        };

        // Check for promotion (white promotes on rank 0, black on rank 7)
        const promotionRank = cellData.color === 'white' ? 0 : 7;
        if (cellData.piece.promotionRank !== -1 && toRow === promotionRank) {
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
                // Prefer pre-generated upgradeMoves on the piece (populated at piece generation).
                let upgradedMoves = [];
                if (cellData.piece.upgradeMoves && cellData.piece.upgradeMoves.length > 0) {
                    upgradedMoves = cellData.piece.upgradeMoves;
                } else {
                    // Fallback: generate now using seeded RNG
                    const rng = this.seed !== null ? new SeededRandom(this.seed + toRow * 8 + toCol) : null;
                    const realRng = rng || {next: Math.random};
                    const bonusRange = PieceGenerator.getUpgradeBonusRange(cellData.piece.moves);
                    upgradedMoves = PieceGenerator.generateUpgradeMoves(cellData.piece.moves, realRng, bonusRange);
                }

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
            console.warn('No pending promotion');
            return false;
        }
        
        const { row, col, promotionPieces } = this.pendingPromotion;
        
        if (pieceIndex < 0 || pieceIndex >= promotionPieces.length) {
            console.warn('Invalid promotion piece index');
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
        clone.lastMove = this.lastMove ? {...this.lastMove} : null;
        
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

// Export for Node testing/runtime if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports.ChessEngine = ChessEngine;
}

// Attach to window for backwards compatibility and export as ES module
try {
    if (typeof window !== 'undefined') {
        window.ChessEngine = ChessEngine;
    }
} catch (e) { /* ignore in non-browser env */ }

export { ChessEngine };
