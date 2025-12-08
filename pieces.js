// ===== Piece Definitions and Generation =====
// Pure piece logic with no game state dependencies

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

class PieceGenerator {
    static symmetries = ['Horizontal', '4way', '8way'];
    
    static generateRandomPieces() {
        const pieces = [];
        const usedSymbols = new Set(); // Track used symbols

        // Generate Royal piece (must have one)
        // 50% chance: 1 move, 50% chance: 2 moves
        const royalMoveCount = Math.random() < 0.5 ? 1 : 2;
        const royalMoves = this.generateRandomMoves(royalMoveCount, true);
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
        // Determine number of moves: 50% get 2, 25% get 1, 25% get 3
        const rand = Math.random();
        let pawnMoveCount;
        if (rand < 0.25) {
            pawnMoveCount = 1;
        } else if (rand < 0.75) {
            pawnMoveCount = 2;
        } else {
            pawnMoveCount = 3;
        }
        
        const pawnMoves = [];
        let hasMove = false;
        let hasCapture = false;
        let hasForwardMove = false;
        
        for (let i = 0; i < pawnMoveCount; i++) {
            // Random step with small values preferred (no 2 for pawns)
            const stepOptions = [0, 1, 1];
            let dx, dy;
            
            // First move must have forward component (dy > 0)
            if (i === 0) {
                dx = stepOptions[Math.floor(Math.random() * stepOptions.length)];
                dy = stepOptions.filter(v => v > 0)[Math.floor(Math.random() * stepOptions.filter(v => v > 0).length)];
                hasForwardMove = true;
            } else {
                do {
                    dx = stepOptions[Math.floor(Math.random() * stepOptions.length)];
                    dy = stepOptions[Math.floor(Math.random() * stepOptions.length)];
                } while (dx === 0 && dy === 0);
            }
            
            // Always horizontal symmetry for pawns
            const symmetry = 'Horizontal';
            
            // Determine if this is a straight move (slide) or non-straight move (jump)
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const jump = isStraightMove ? 'prohibited' : 'required';
            
            // Determine capture type
            let capture;
            if (pawnMoveCount === 1) {
                // Single move must do both
                capture = 'allowed';
                hasMove = true;
                hasCapture = true;
            } else {
                // Multiple moves: ensure we have at least one of each type
                if (i === 0 && !hasMove) {
                    capture = 'prohibited'; // move-only
                    hasMove = true;
                } else if (i === 1 && !hasCapture) {
                    capture = 'required'; // capture-only
                    hasCapture = true;
                } else {
                    // Random for additional moves
                    const captureRand = Math.random();
                    if (captureRand < 0.33) {
                        capture = 'prohibited';
                        hasMove = true;
                    } else if (captureRand < 0.66) {
                        capture = 'required';
                        hasCapture = true;
                    } else {
                        capture = 'allowed';
                        hasMove = true;
                        hasCapture = true;
                    }
                }
            }
            
            // Determine distance and requiresUnmoved
            let distance;
            let requiresUnmoved = false;
            if (capture === 'prohibited') {
                // Move-only can have distance 2-3 (with 3 being rare)
                const distRand = Math.random();
                if (distRand < 0.1) {
                    distance = 3; // 10% chance of distance 3
                } else {
                    distance = 2; // 90% chance of distance 2
                }
                // Long-distance move-only moves require unmoved piece
                requiresUnmoved = true;
            } else {
                // Capture moves or both always distance 1
                distance = 1;
            }
            
            pawnMoves.push(new Move([dx, dy], symmetry, distance, jump, requiresUnmoved, capture));
        }
        
        // Promotion pieces: all non-pawn, non-royal pieces
        const promotionPieces = pieces.filter(p => !p.royal);
        
        const pawnSymbol = this.selectSymbolForPiece(pawnMoves, false, true, usedSymbols);
        usedSymbols.add(pawnSymbol);
        const pawn = new Piece(
            pawnSymbol,
            pawnMoves,
            false, // Royal is always false
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
            const royalSymbols = ['⚜'];
            return this.getUniqueSymbol(royalSymbols, usedSymbols);
        }
        
        if (isPawn) {
            const pawnSymbols = ['▴', '▵', '▲', '△', '⯅', '⯆'];
            return this.getUniqueSymbol(pawnSymbols, usedSymbols);
        }
        
        if (hasJump || hasComplexMove) {
            const jumpSymbols = ['✪', '◬', '⬟', '⬠', '⯃', '⯄', '⬢', '⬣', '⬡', '⭒', '⭓'];
            return this.getUniqueSymbol(jumpSymbols, usedSymbols);
        }
        
        if (hasLongRange && hasDiagonal && hasStraight) {
            const queenSymbols = ['✶', '❖', '✸', '✺', '✹', '✷', '✶'];
            return this.getUniqueSymbol(queenSymbols, usedSymbols);
        }
        
        if (hasLongRange && hasStraight) {
            const rookSymbols = ['⊞', '🞧', '🞦', '⯌', '⯎'];
            return this.getUniqueSymbol(rookSymbols, usedSymbols);
        }
        
        if (hasLongRange && hasDiagonal) {
            const bishopSymbols = ['⨯', '🞨', '🞩', '⯍', '⯏', '⟐', '⬖', '⬗'];
            return this.getUniqueSymbol(bishopSymbols, usedSymbols);
        }
        
        if (isShortRange) {
            const shortSymbols = ['◉', '◓', '⯊', '⯋'];
            return this.getUniqueSymbol(shortSymbols, usedSymbols);
        }
        
        // Default: generic piece symbols
        const genericSymbols = ['★', '☆', '✫', '✬', '✭', '✮', '✯'];
        return this.getUniqueSymbol(genericSymbols, usedSymbols);
    }

    static getUniqueSymbol(symbolArray, usedSymbols) {
        // Try to find an unused symbol from the preferred array
        const availableSymbols = symbolArray.filter(s => !usedSymbols.has(s));
        
        if (availableSymbols.length > 0) {
            return availableSymbols[Math.floor(Math.random() * availableSymbols.length)];
        }
        
        // Fallback: use generic symbols
        const genericSymbols = ['★', '☆', '✫', '✬', '✭', '✮', '✯'];
        const availableGeneric = genericSymbols.filter(s => !usedSymbols.has(s));
        
        if (availableGeneric.length > 0) {
            return availableGeneric[Math.floor(Math.random() * availableGeneric.length)];
        }
        
        // Final fallback
        return symbolArray[Math.floor(Math.random() * symbolArray.length)];
    }

    static generateRandomMoves(count, isRoyal = false) {
        const moves = [];
        
        for (let i = 0; i < count; i++) {
            // Random step (0-3 in each direction, but not both 0)
            // Custom ratio: more weight on smaller values
            const stepOptions = [0, 0, 1, 1, 1, 1, 2];
            let dx, dy;
            do {
                dx = stepOptions[Math.floor(Math.random() * stepOptions.length)];
                dy = stepOptions[Math.floor(Math.random() * stepOptions.length)];
            } while (dx === 0 && dy === 0);

            // Royal pieces always get 8way symmetry
            const symmetry = isRoyal ? '8way' : this.symmetries[Math.floor(Math.random() * this.symmetries.length)];
            
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

// Serialization helpers for network transfer
class PieceSerializer {
    static serialize(pieces) {
        // Convert pieces to plain objects for JSON
        return pieces.map(piece => ({
            name: piece.name,
            moves: piece.moves.map(move => ({
                step: move.step,
                symmetry: move.symmetry,
                distance: move.distance,
                jump: move.jump,
                requiresUnmoved: move.requiresUnmoved,
                capture: move.capture
            })),
            royal: piece.royal,
            specials: piece.specials,
            promotionPieces: piece.promotionPieces.map((_, idx) => idx), // Store indices instead of references
            promotionRank: piece.promotionRank
        }));
    }

    static deserialize(piecesData) {
        if (!piecesData) {
            console.error('piecesData is undefined');
            return null;
        }
        
        console.log('Deserializing pieces:', piecesData.map(p => p.name));
        
        // First pass: create all pieces without promotion references
        const pieces = piecesData.map(pieceData => {
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
            
            return new Piece(
                pieceData.name,
                moves,
                pieceData.royal,
                pieceData.specials,
                [], // Temporary empty array
                pieceData.promotionRank
            );
        });
        
        // Second pass: fix promotion piece references
        piecesData.forEach((pieceData, idx) => {
            pieces[idx].promotionPieces = pieceData.promotionPieces.map(promoIdx => pieces[promoIdx]);
        });
        
        return pieces;
    }
}
