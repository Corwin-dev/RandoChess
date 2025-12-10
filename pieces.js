// ===== Piece Definitions and Generation =====
// Pure piece logic with no game state dependencies

// Seeded Random Number Generator (using mulberry32)
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }

    // Generate next random number [0, 1)
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

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
                // For orthogonal moves, also add rotations
                if (dx === 0 || dy === 0) {
                    steps.push([dy, dx], [-dy, dx], [dy, -dx], [-dy, -dx]);
                }
                break;
            case '8way':
                steps.push([-dx, dy], [dx, -dy], [-dx, -dy]);
                steps.push([dy, dx], [-dy, dx], [dy, -dx], [-dy, -dx]);
                break;
        }

        // Remove duplicates
        const uniqueSteps = [];
        const seen = new Set();
        for (const step of steps) {
            const key = `${step[0]},${step[1]}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueSteps.push(step);
            }
        }

        return uniqueSteps;
    }
}

class Piece {
    constructor(name, moves, royal, specials, promotionPieces, promotionRank, promotionType = null) {
        this.name = name;
        this.moves = moves; // [Move]
        this.royal = royal; // bool
        this.specials = specials; // [Special] - for future expansion
        this.promotionPieces = promotionPieces; // [Piece]
        this.promotionRank = promotionRank; // int (0-7)
        this.promotionType = promotionType; // 'choice' (pawns), 'move-upgrade' (directionally restricted), or null
    }
}

class PieceGenerator {
    static symmetries = ['Horizontal', '4way', '8way'];
    
    // Analyze if a piece has only forward or only vertical movement
    static isDirectionallyRestricted(moves) {
        // Get all possible steps from all moves
        const allSteps = [];
        for (const move of moves) {
            // Skip capture-only moves for this analysis
            if (move.capture === 'required') continue;
            allSteps.push(...move.getSteps());
        }
        
        if (allSteps.length === 0) return false;
        
        // Check if all steps are forward-only (dy > 0 for all, or dy < 0 for all)
        const allForward = allSteps.every(([dx, dy]) => dy > 0);
        const allBackward = allSteps.every(([dx, dy]) => dy < 0);
        const onlyForwardMovement = allForward || allBackward;
        
        // Check if all steps are vertical-only (dx === 0)
        const onlyVertical = allSteps.every(([dx, dy]) => dx === 0);
        
        return onlyForwardMovement || onlyVertical;
    }
    
    // Determine the farthest rank a piece can reach
    static getFarthestReachableRank(moves, startRank = 1) {
        // Get all possible steps
        const allSteps = [];
        for (const move of moves) {
            if (move.capture === 'required') continue;
            allSteps.push(...move.getSteps());
        }
        
        if (allSteps.length === 0) return startRank;
        
        // Find maximum y movement
        const maxY = Math.max(...allSteps.map(([dx, dy]) => dy));
        const minY = Math.min(...allSteps.map(([dx, dy]) => dy));
        
        // If can only move forward, farthest is rank 7; if only backward, rank 0
        if (maxY > 0 && minY >= 0) return 7; // Can move forward
        if (maxY <= 0 && minY < 0) return 0; // Can only move backward
        
        return 7; // Can move both ways
    }
    
    // Generate additional moves for move-upgrade promotion
    static generateUpgradeMoves(originalMoves, rng) {
        const newMoves = [...originalMoves];
        let attemptsLeft = 10;
        
        // Keep adding moves until piece is no longer directionally restricted
        while (this.isDirectionallyRestricted(newMoves) && attemptsLeft > 0) {
            attemptsLeft--;
            
            // Generate a move that breaks the restriction
            const allSteps = [];
            for (const move of newMoves) {
                if (move.capture === 'required') continue;
                allSteps.push(...move.getSteps());
            }
            
            const onlyVertical = allSteps.every(([dx, dy]) => dx === 0);
            const allForward = allSteps.every(([dx, dy]) => dy > 0);
            const allBackward = allSteps.every(([dx, dy]) => dy < 0);
            
            let dx, dy;
            
            if (onlyVertical) {
                // Add horizontal or diagonal movement
                dx = [1, 1, 2][Math.floor(rng.next() * 3)];
                dy = [0, 1, 1][Math.floor(rng.next() * 3)];
            } else if (allForward) {
                // Add backward movement
                dx = [0, 1, 1][Math.floor(rng.next() * 3)];
                dy = -([1, 1, 2][Math.floor(rng.next() * 3)]);
            } else if (allBackward) {
                // Add forward movement
                dx = [0, 1, 1][Math.floor(rng.next() * 3)];
                dy = [1, 1, 2][Math.floor(rng.next() * 3)];
            }
            
            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            const orthogonalJump = isOrthogonal && (dx >= 2 || dy >= 2);
            const diagonalJump = (dx === dy) && dx >= 2;
            
            // Skip orthogonal jumps (e.g., [0,2], [2,0]) and diagonal jumps (e.g., [2,2])
            if (orthogonalJump || diagonalJump) {
                attemptsLeft++; // Don't count this as a failed attempt
                continue;
            }
            
            const symmetry = this.symmetries[Math.floor(rng.next() * this.symmetries.length)];
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            // Orthogonal moves must slide, only diagonal/knight moves can jump
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            const distance = jump === 'required' ? 1 : (rng.next() < 0.5 ? -1 : 1);
            
            newMoves.push(new Move([dx, dy], symmetry, distance, jump, false));
        }
        
        // Add one bonus move for the upgrade
        const stepOptions = [0, 0, 0, 1, 1];
        let dx, dy;
        do {
            dx = stepOptions[Math.floor(rng.next() * stepOptions.length)];
            dy = stepOptions[Math.floor(rng.next() * stepOptions.length)];
        } while (dx === 0 && dy === 0);
        
        const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
        const orthogonalJump = isOrthogonal && (dx >= 2 || dy >= 2);
        const diagonalJump = (dx === dy) && dx >= 2;
        
        // If this would be an orthogonal or diagonal jump, change to distance 1
        if (orthogonalJump || diagonalJump) {
            if (dx >= 2) dx = 1;
            if (dy >= 2) dy = 1;
        }
        
        const symmetry = this.symmetries[Math.floor(rng.next() * this.symmetries.length)];
        const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
        // Orthogonal moves must slide, only diagonal/knight moves can jump
        const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
        const distance = jump === 'required' ? 1 : (rng.next() < 0.5 ? -1 : 1);
        
        newMoves.push(new Move([dx, dy], symmetry, distance, jump, false));
        
        return newMoves;
    }
    
    static generateRandomPieces(seed = null) {
        // If no seed provided, generate one from current timestamp
        if (seed === null) {
            seed = Date.now() % 1000000;
        }
        
        // Store seed for retrieval
        this.lastUsedSeed = seed;
        
        // Create seeded random number generator
        const rng = new SeededRandom(seed);
        
        const pieces = [];
        const usedSymbols = new Set(); // Track used symbols

        // Generate Royal piece (must have one)
        // 50% chance: 2 moves, 50% chance: 3 moves
        const royalMoveCount = rng.next()^2 < 0.75 ? 3 : 2;
        const royalMoves = this.generateRandomMoves(royalMoveCount, true, rng);
        const royalSymbol = this.selectSymbolForPiece(royalMoves, true, false, usedSymbols);
        usedSymbols.add(royalSymbol);
        const royal = new Piece(
            royalSymbol,
            royalMoves,
            true,
            [],
            [],
            -1,
            null
        );
        pieces.push(royal);

        // Generate 5 random non-royal pieces
        for (let i = 0; i < 5; i++) {
            const numMoves = 1 + Math.floor(rng.next() + rng.next() + rng.next()); // 1-3 moves
            const moves = this.generateRandomMoves(numMoves, false, rng);
            const symbol = this.selectSymbolForPiece(moves, false, false, usedSymbols, rng);
            usedSymbols.add(symbol);
            
            // Check if piece needs move-upgrade promotion
            let promotionRank = -1;
            let promotionType = null;
            
            if (this.isDirectionallyRestricted(moves)) {
                promotionRank = this.getFarthestReachableRank(moves);
                promotionType = 'move-upgrade';
            }
            
            const piece = new Piece(
                symbol,
                moves,
                false,
                [],
                [],
                promotionRank,
                promotionType
            );
            pieces.push(piece);
        }

        // Generate pawn-like piece (can promote)
        // Determine number of moves: 50% get 2, 25% get 1, 25% get 3
        const rand = rng.next();
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
            // Random step with small values preferred (no 2+ for orthogonal moves)
            const stepOptions = [0, 1, 1];
            let dx, dy;
            
            // First move must have forward component (dy > 0)
            if (i === 0) {
                dx = stepOptions[Math.floor(rng.next() * stepOptions.length)];
                dy = stepOptions.filter(v => v > 0)[Math.floor(rng.next() * stepOptions.filter(v => v > 0).length)];
                hasForwardMove = true;
            } else {
                do {
                    dx = stepOptions[Math.floor(rng.next() * stepOptions.length)];
                    dy = stepOptions[Math.floor(rng.next() * stepOptions.length)];
                } while (dx === 0 && dy === 0);
            }
            
            // Always horizontal symmetry for pawns
            const symmetry = 'Horizontal';
            
            // Determine if this is a straight move (slide) or non-straight move (jump)
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            // Orthogonal moves must slide, only diagonal/knight moves can jump
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            
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
                    const captureRand = rng.next();
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
                const distRand = rng.next();
                if (distRand < 0.1) {
                    distance = 3; // 10% chance of distance 3
                    requiresUnmoved = true; // Only distance 3 requires unmoved
                } else if (distRand < 0.55) {
                    distance = 2; // 45% chance of distance 2
                    requiresUnmoved = true; // Only distance 2 requires unmoved
                } else {
                    distance = 1; // 45% chance of distance 1 (always available)
                }
                
                // If pawn only has one move and it's forward, it can't require unmoved
                if (pawnMoveCount === 1 && requiresUnmoved) {
                    requiresUnmoved = false;
                    distance = 1; // Make it distance 1 so it's always available
                }
            } else {
                // Capture moves or both always distance 1
                distance = 1;
            }
            
            pawnMoves.push(new Move([dx, dy], symmetry, distance, jump, requiresUnmoved, capture));
        }
        
        // Promotion pieces: all non-pawn, non-royal pieces
        const promotionPieces = pieces.filter(p => !p.royal);
        
        const pawnSymbol = this.selectSymbolForPiece(pawnMoves, false, true, usedSymbols, rng);
        usedSymbols.add(pawnSymbol);
        const pawn = new Piece(
            pawnSymbol,
            pawnMoves,
            false, // Royal is always false
            [],
            promotionPieces,
            6 + Math.floor(rng.next() * 2), // promotes on rank 6 or 7
            'choice' // Pawns get player choice promotion
        );
        pieces.push(pawn);

        return pieces;
    }

    static selectSymbolForPiece(moves, isRoyal, isPawn = false, usedSymbols = new Set(), rng = null) {
        // Fallback to Math.random if no rng provided
        const random = rng ? () => rng.next() : Math.random;
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
            return this.getUniqueSymbol(royalSymbols, usedSymbols, random);
        }
        
        if (isPawn) {
            const pawnSymbols = ['▴', '▵', '▲', '△', '⯅', '⯆'];
            return this.getUniqueSymbol(pawnSymbols, usedSymbols, random);
        }
        
        if (hasJump || hasComplexMove) {
            const jumpSymbols = ['✪', '◬', '⬟', '⬠', '⯃', '⯄', '⬢', '⬣', '⬡', '⭒', '⭓'];
            return this.getUniqueSymbol(jumpSymbols, usedSymbols, random);
        }
        
        if (hasLongRange && hasDiagonal && hasStraight) {
            const queenSymbols = ['✶', '❖', '✸', '✺', '✹', '✷', '✶'];
            return this.getUniqueSymbol(queenSymbols, usedSymbols, random);
        }
        
        if (hasLongRange && hasStraight) {
            const rookSymbols = ['⊞', '🞧', '🞦', '⯌', '⯎'];
            return this.getUniqueSymbol(rookSymbols, usedSymbols, random);
        }
        
        if (hasLongRange && hasDiagonal) {
            const bishopSymbols = ['⨯', '🞨', '🞩', '⯍', '⯏', '⟐', '⬖', '⬗'];
            return this.getUniqueSymbol(bishopSymbols, usedSymbols, random);
        }
        
        if (isShortRange) {
            const shortSymbols = ['◉', '◓', '⯊', '⯋'];
            return this.getUniqueSymbol(shortSymbols, usedSymbols, random);
        }
        
        // Default: generic piece symbols
        const genericSymbols = ['★', '☆', '✫', '✬', '✭', '✮', '✯'];
        return this.getUniqueSymbol(genericSymbols, usedSymbols, random);
    }

    static getUniqueSymbol(symbolArray, usedSymbols, random = Math.random) {
        // Try to find an unused symbol from the preferred array
        const availableSymbols = symbolArray.filter(s => !usedSymbols.has(s));
        
        if (availableSymbols.length > 0) {
            return availableSymbols[Math.floor(random() * availableSymbols.length)];
        }
        
        // Fallback: use generic symbols
        const genericSymbols = ['★', '☆', '✫', '✬', '✭', '✮', '✯'];
        const availableGeneric = genericSymbols.filter(s => !usedSymbols.has(s));
        
        if (availableGeneric.length > 0) {
            return availableGeneric[Math.floor(random() * availableGeneric.length)];
        }
        
        // Final fallback
        return symbolArray[Math.floor(random() * symbolArray.length)];
    }

    static generateRandomMoves(count, isRoyal = false, rng = null) {
        const random = rng ? () => rng.next() : Math.random;
        const moves = [];
        
        for (let i = 0; i < count; i++) {
            // Random step (0-3 in each direction, but not both 0)
            // Custom ratio: more weight on smaller values
            const stepOptions = isRoyal ? [0, 1] : [0, 0, 0, 0, 0, 1, 1, 1, 2];
            let dx, dy;
            do {
                dx = stepOptions[Math.floor(random() * stepOptions.length)];
                dy = stepOptions[Math.floor(random() * stepOptions.length)];
            } while (dx === 0 && dy === 0 ||        // Not both zero
                     (dx === 0 && dy >= 2) ||       // No [0, 2+]
                     (dy === 0 && dx >= 2) ||       // No [2+, 0]
                     (dx === dy && dx >= 2));       // No [2+, 2+]

            // Royal pieces get 4way symmetry, others random
            const symmetry = isRoyal ? '4way' : this.symmetries[Math.floor(random() * this.symmetries.length)];
            
            const requiresUnmoved = false; // Disabled - no one-time-use moves

            // Determine if this is a straight move (slide) or non-straight move (jump)
            // Straight moves: orthogonal (dx=0 or dy=0) or diagonal (dx=dy)
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            // Orthogonal moves must slide, only diagonal/knight moves can jump
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            
            // Jump moves always distance 1, slide moves can be unlimited or limited
            // Royal pieces always get distance 1
            let distance;
            if (isRoyal) {
                distance = 1;
            } else if (jump === 'required') {
                distance = 1;
            } else {
                // Slide moves: 50% unlimited, 50% limited
                distance = random() < 0.5 ? -1 : 1;
            }

            moves.push(new Move([dx, dy], symmetry, distance, jump, requiresUnmoved));
        }
        
        // Ensure at least one move has non-zero y value (can move forward/backward)
        const hasYMovement = moves.some(m => m.step[1] !== 0);
        if (!hasYMovement && moves.length > 0) {
            // Replace first move with one that has y movement
            const stepOptions = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];
            const dx = stepOptions[Math.floor(random() * stepOptions.length)];
            const dy = stepOptions.filter(v => v !== 0)[Math.floor(random() * stepOptions.filter(v => v !== 0).length)];
            
            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            const orthogonalJump = isOrthogonal && (dx >= 2 || dy >= 2);
            const diagonalJump = (dx === dy) && dx >= 2;
            
            // If this would be an orthogonal or diagonal jump, change to distance 1
            if (orthogonalJump || diagonalJump) {
                if (dx >= 2) dx = 1;
                if (dy >= 2) dy = 1;
            }
            
            const symmetry = this.symmetries[Math.floor(random() * this.symmetries.length)];
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            // Orthogonal moves must slide, only diagonal/knight moves can jump
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            const distance = jump === 'required' ? 1 : (random() < 0.5 ? -1 : 1);
            
            moves[0] = new Move([dx, dy], symmetry, distance, jump, false);
        }
        
        return moves;
    }

    // Generate a canvas icon showing the movement pattern of a piece on a 7x7 grid
    static createMovementPatternIcon(piece, size = 80, color = 'white', playerPerspective = 'white') {
        const gridSize = 7;
        const borderCells = 0.5; // Half-cell transparent border on each side
        const totalGridSize = gridSize + (borderCells * 2); // 8x8 total with border
        
        // Ensure size is a perfect multiple for pixel-perfect rendering
        const adjustedSize = Math.floor(size / totalGridSize) * totalGridSize;
        const cellSize = adjustedSize / totalGridSize;
        
        const canvas = document.createElement('canvas');
        canvas.width = adjustedSize;
        canvas.height = adjustedSize;
        const ctx = canvas.getContext('2d');
        
        // Disable anti-aliasing for crisp pixels
        ctx.imageSmoothingEnabled = false;
        
        const centerPos = Math.floor(gridSize / 2); // Center at position 3 in 7x7 grid
        
        // Create a set of all reachable positions
        const reachable = new Set();
        
        // Simulate all possible moves from the center position
        for (const move of piece.moves) {
            // Skip moves that require the piece to be unmoved (like castling)
            if (move.requiresUnmoved) continue;
            
            const steps = move.getSteps();
            
            for (const [dx, dy] of steps) {
                // For each step, calculate all positions within distance
                const maxDist = move.distance === -1 ? gridSize : move.distance;
                
                for (let dist = 1; dist <= maxDist; dist++) {
                    // Only flip your own pieces when viewing as black
                    // (flip when player is black AND piece is black, or when player is white AND piece is white)
                    const shouldFlip = (playerPerspective === 'black' && color === 'black') || 
                                      (playerPerspective === 'white' && color === 'white');
                    const flipDy = shouldFlip ? -dy : dy;
                    const newX = centerPos + (dx * dist);
                    const newY = centerPos + (flipDy * dist);
                    
                    // Check if within grid bounds
                    if (newX >= 0 && newX < gridSize && newY >= 0 && newY < gridSize) {
                        reachable.add(`${newX},${newY}`);
                        
                        // If this is a sliding move (prohibited jump), continue
                        // If this is a jumping move (required jump), stop after first
                        if (move.jump === 'required') {
                            break;
                        }
                    } else {
                        // Out of bounds, stop sliding in this direction
                        break;
                    }
                }
            }
        }
        
        // Canvas is transparent by default, only draw the reachable squares
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                // Offset by border when drawing
                const gridX = x + borderCells;
                const gridY = y + borderCells;
                const px = Math.floor(gridX * cellSize);
                const py = Math.floor(gridY * cellSize);
                const width = Math.floor((gridX + 1) * cellSize) - px;
                const height = Math.floor((gridY + 1) * cellSize) - py;
                
                // Check if this is a reachable position or the center (for royal gem)
                const isCenter = (x === centerPos && y === centerPos);
                const isReachable = reachable.has(`${x},${y}`);
                
                if (isReachable) {
                    // Fill with piece color
                    ctx.fillStyle = color === 'white' ? '#ffffff' : '#000000';
                    ctx.fillRect(px, py, width, height);
                }
                
                // Add golden gem in center for royal pieces
                if (isCenter && piece.royal) {
                    // Create a faceted gem appearance with gradients
                    const gemSize = Math.floor(cellSize * 0.85);
                    const gemOffset = Math.floor((cellSize - gemSize) / 2);
                    const gemX = px + gemOffset;
                    const gemY = py + gemOffset;
                    
                    // Create radial gradient for shimmer effect
                    const gradient = ctx.createRadialGradient(
                        gemX + gemSize * 0.35, gemY + gemSize * 0.35, 0,
                        gemX + gemSize * 0.5, gemY + gemSize * 0.5, gemSize * 0.7
                    );
                    gradient.addColorStop(0, '#FFFACD');    // Light yellow (highlight)
                    gradient.addColorStop(0.4, '#FFD700');  // Gold
                    gradient.addColorStop(0.7, '#DAA520');  // Darker gold
                    gradient.addColorStop(1, '#B8860B');    // Dark goldenrod (shadow)
                    
                    ctx.fillStyle = gradient;
                    ctx.fillRect(gemX, gemY, gemSize, gemSize);
                    
                    // Add facet lines for gem appearance
                    ctx.strokeStyle = '#B8860B';
                    ctx.lineWidth = 1;
                    const centerX = gemX + gemSize / 2;
                    const centerY = gemY + gemSize / 2;
                    
                    // Draw diagonal facets
                    ctx.beginPath();
                    ctx.moveTo(gemX, gemY);
                    ctx.lineTo(centerX, centerY);
                    ctx.lineTo(gemX + gemSize, gemY);
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.moveTo(gemX + gemSize, gemY);
                    ctx.lineTo(centerX, centerY);
                    ctx.lineTo(gemX + gemSize, gemY + gemSize);
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.moveTo(gemX + gemSize, gemY + gemSize);
                    ctx.lineTo(centerX, centerY);
                    ctx.lineTo(gemX, gemY + gemSize);
                    ctx.stroke();
                    
                    ctx.beginPath();
                    ctx.moveTo(gemX, gemY + gemSize);
                    ctx.lineTo(centerX, centerY);
                    ctx.lineTo(gemX, gemY);
                    ctx.stroke();
                }
            }
        }
        
        return canvas;
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
            promotionRank: piece.promotionRank,
            promotionType: piece.promotionType
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
                pieceData.promotionRank,
                pieceData.promotionType
            );
        });
        
        // Second pass: fix promotion piece references
        piecesData.forEach((pieceData, idx) => {
            pieces[idx].promotionPieces = pieceData.promotionPieces.map(promoIdx => pieces[promoIdx]);
        });
        
        return pieces;
    }
}

// Verify the function exists
console.log('PieceGenerator.createMovementPatternIcon exists?', typeof PieceGenerator.createMovementPatternIcon === 'function');
