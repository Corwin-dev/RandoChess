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

class Special {
    constructor(type, data = {}) {
        this.type = type; // 'enPassant' | 'castling'
        this.data = data; // Additional data for the special move
    }
}

class Move {
    constructor(step, symmetry, distance, jump, requiresUnmoved, capture = 'allowed') {
        this.step = step; // [dx, dy] - movement vector
        this.symmetry = symmetry; // None|Horizontal|Vertical|4way|8way
        this.distance = distance; // max distance, -1 for unlimited
        this.jump = jump; // prohibited (slide) | required (jump) - automatic based on step
        this.requiresUnmoved = requiresUnmoved; // for castling and pawn double-move
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
    constructor(name, moves, royal, specials, promotionPieces, promotionRank, promotionType = null, upgradeMoves = []) {
        this.name = name;
        this.moves = moves; // [Move]
        this.royal = royal; // bool
        this.specials = specials; // [Special] - for future expansion
        this.promotionPieces = promotionPieces; // [Piece]
        this.promotionRank = promotionRank; // int (0-7)
        this.promotionType = promotionType; // 'choice' (pawns), 'move-upgrade' (directionally restricted), or null
        this.upgradeMoves = upgradeMoves; // [Move] - pre-generated moves for move-upgrade promotions
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
        
        // Seed is used internally for deterministic generation but not exposed
        
        // Create seeded random number generator
        const rng = new SeededRandom(seed);
        
        const pieces = [];
        const usedSymbols = new Set(); // Track used symbols
        const usedSignatures = new Set(); // Track piece signatures to enforce uniqueness

        // Predefine standard pawn moves/signature so we can reserve it
        const pawnMovesPreset = [
            new Move([0, 1], 'Horizontal', 1, 'prohibited', false, 'prohibited'),
            new Move([1, 1], 'Horizontal', 1, 'prohibited', false, 'required'),
            new Move([0, 1], 'Horizontal', 2, 'prohibited', true, 'prohibited')
        ];

        // Helper to compute a structural signature for a piece (moves, specials, royal, promotionType, upgradeMoves)
        const pieceSignature = (p) => {
            const mv = (m) => `${m.step[0]},${m.step[1]}|${m.symmetry}|${m.distance}|${m.jump}|${m.requiresUnmoved}|${m.capture}`;
            const ups = (p.upgradeMoves || []).map(mv).sort().join(';');
            const moves = (p.moves || []).map(mv).sort().join(';');
            const specs = (p.specials || []).map(s => s.type).sort().join(',');
            return `${p.royal ? 'R' : 'N'}|${p.promotionType||''}|${specs}|MOVES:${moves}|UP:${ups}`;
        };

        // Reserve pawn signature so no generated piece matches the pawn exactly
        const pawnSignatureReserved = pieceSignature({
            moves: pawnMovesPreset,
            specials: [],
            royal: false,
            promotionType: 'choice',
            upgradeMoves: []
        });
        usedSignatures.add(pawnSignatureReserved);

        // Generate Royal piece (must have one)
        // Royal is fixed to behave like a King: one square in any direction
        const royalMoves = [];
        const kingSteps = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        for (const step of kingSteps) {
            // Each king-like move is distance 1, no jump
            royalMoves.push(new Move(step, null, 1, 'prohibited', false));
        }
        const royalSymbol = this.selectSymbolForPiece(royalMoves, true, false, usedSymbols);
        usedSymbols.add(royalSymbol);
        
        // Add castling special move to king
        const castlingSpecial = new Special('castling', {});
        
        const royal = new Piece(
            royalSymbol,
            royalMoves,
            true,
            [castlingSpecial],
            [],
            -1,
            null
        );
        pieces.push(royal);
        // Reserve royal signature so no other piece matches king
        usedSignatures.add(pieceSignature(royal));

        // Generate 4 non-royal pieces with deterministic roles:
        // Index mapping after push: [0]=royal, [1]=powerhouse, [2]=slider, [3]=trickster, [4]=flower, [5]=pawn
        // n is random between 2 and 4 inclusive
        const n = 1 + Math.floor(rng.next() * 2); // 1..2   

        // Helper to create a piece and handle promotions
        const createNonRoyal = (moves) => {
            const symbol = this.selectSymbolForPiece(moves, false, false, usedSymbols, rng);
            usedSymbols.add(symbol);

            let promotionRank = -1;
            let promotionType = null;
            let upgradeMoves = [];

            if (this.isDirectionallyRestricted(moves)) {
                promotionRank = this.getFarthestReachableRank(moves);
                promotionType = 'move-upgrade';
                upgradeMoves = this.generateUpgradeMoves(moves, rng);
            }

            return new Piece(symbol, moves, false, [], [], promotionRank, promotionType, upgradeMoves);
        };

        // Powerhouse (queen position) - n+2 moves
        // Ensure uniqueness: reroll if signature matches existing piece
        let powerhouse;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n + 2, false, rng);
                const candidate = createNonRoyal(moves);
                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    powerhouse = candidate;
                    usedSignatures.add(sig);
                    pieces.push(powerhouse);
                    break;
                }
                attempts++;
            } while (attempts < 30);
            if (!powerhouse) {
                // fallback: accept last candidate
                const moves = this.generateRandomMoves(n + 2, false, rng);
                powerhouse = createNonRoyal(moves);
                pieces.push(powerhouse);
                usedSignatures.add(pieceSignature(powerhouse));
            }
        }

        // Slider (both rook positions) - n+1 moves
        // Generate one slider move-set (single generated piece; placement duplicates it)
        // Slider (generate once; placement duplicates on board)
        let slider;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n + 1, false, rng);
                const candidate = createNonRoyal(moves);
                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    slider = candidate;
                    // Enforce Slider constraints: at least one sliding unlimited move (distance -1)
                    // and ensure Slider is not purely horizontal-symmetry.
                    let hasUnlimited = slider.moves.some(m => m.distance === -1 && m.jump !== 'required');
                    if (!hasUnlimited) {
                        // Try to convert an existing sliding move to unlimited
                        const slideIdx = slider.moves.findIndex(m => m.jump !== 'required');
                        if (slideIdx >= 0) {
                            slider.moves[slideIdx].distance = -1;
                        } else {
                            // No slide moves exist (unlikely) - add a standard orthogonal slide
                            slider.moves.push(new Move([1, 0], '4way', -1, 'prohibited', false));
                        }
                    }

                    // Ensure at least one move has symmetry other than 'Horizontal'
                    const hasNonHorizontal = slider.moves.some(m => m.symmetry && m.symmetry !== 'Horizontal');
                    if (!hasNonHorizontal) {
                        // Prefer to change a slide move's symmetry to 4way
                        const idx = slider.moves.findIndex(m => m.jump !== 'required');
                        if (idx >= 0) {
                            slider.moves[idx].symmetry = '4way';
                        } else {
                            slider.moves[0].symmetry = '4way';
                        }
                    }

                    usedSignatures.add(sig);
                    pieces.push(slider);
                    break;
                }
                attempts++;
            } while (attempts < 30);
            if (!slider) {
                const moves = this.generateRandomMoves(n + 1, false, rng);
                slider = createNonRoyal(moves);
                // same enforcement for fallback
                if (!slider.moves.some(m => m.distance === -1 && m.jump !== 'required')) {
                    const slideIdx = slider.moves.findIndex(m => m.jump !== 'required');
                    if (slideIdx >= 0) slider.moves[slideIdx].distance = -1;
                    else slider.moves.push(new Move([1, 0], '4way', -1, 'prohibited', false));
                }
                if (!slider.moves.some(m => m.symmetry && m.symmetry !== 'Horizontal')) {
                    const idx = slider.moves.findIndex(m => m.jump !== 'required');
                    if (idx >= 0) slider.moves[idx].symmetry = '4way';
                    else slider.moves[0].symmetry = '4way';
                }
                pieces.push(slider);
                usedSignatures.add(pieceSignature(slider));
            }
        }

        // Minor 1 (bishop/knight position) - n moves
        let minor1;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n, false, rng);
                const candidate = createNonRoyal(moves);
                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    minor1 = candidate;
                    usedSignatures.add(sig);
                    pieces.push(minor1);
                    break;
                }
                attempts++;
            } while (attempts < 30);
            if (!minor1) {
                const moves = this.generateRandomMoves(n, false, rng);
                minor1 = createNonRoyal(moves);
                pieces.push(minor1);
                usedSignatures.add(pieceSignature(minor1));
            }
        }

        // Minor 2 (bishop/knight position) - n moves
        let minor2;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n, false, rng);
                const candidate = createNonRoyal(moves);
                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    minor2 = candidate;
                    usedSignatures.add(sig);
                    pieces.push(minor2);
                    break;
                }
                attempts++;
            } while (attempts < 30);
            if (!minor2) {
                const moves = this.generateRandomMoves(n, false, rng);
                minor2 = createNonRoyal(moves);
                pieces.push(minor2);
                usedSignatures.add(pieceSignature(minor2));
            }
        }

        // Note: Do NOT generate a separate rook clone here. The board placement logic
        // will duplicate the rook on the back rank. We only want one generated rook type.

        // Generate standard chess pawn
        const pawnMoves = [
            // Forward move (1 square always, up to 2 squares on first move)
            new Move([0, 1], 'Horizontal', 1, 'prohibited', false, 'prohibited'),
            // Diagonal capture
            new Move([1, 1], 'Horizontal', 1, 'prohibited', false, 'required'),
            // Double Move handled by requiresUnmoved in first move
            new Move([0, 1], 'Horizontal', 2, 'prohibited', true, 'prohibited')
        ];
        
        // Promotion pieces: all non-pawn, non-royal pieces
        // Pawns use 'choice' promotionType, so exclude any piece that is a pawn by filtering out
        // pieces with promotionType === 'choice'. This prevents the pawn itself from appearing
        // as a promotion target.
        const promotionPieces = pieces.filter(p => !p.royal && p.promotionType !== 'choice');
        
        const pawnSymbol = this.selectSymbolForPiece(pawnMoves, false, true, usedSymbols, rng);
        usedSymbols.add(pawnSymbol);
        
        // Add en passant special move to pawn
        const enPassantSpecial = new Special('enPassant', {});
        
        const pawn = new Piece(
            pawnSymbol,
            pawnMoves,
            false, // Royal is always false
            [enPassantSpecial],
            promotionPieces,
            7, // promotes on rank 7 (opponent's back rank for white, rank 0 for black)
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
            let dx = stepOptions[Math.floor(random() * stepOptions.length)];
            let dy = stepOptions.filter(v => v !== 0)[Math.floor(random() * stepOptions.filter(v => v !== 0).length)];
            
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

        // Create a set of all reachable positions for upgrade moves
        const upgradeReachable = new Set();

        // Simulate all possible moves from the center position for upgrade moves (if present)
        if (piece.upgradeMoves && piece.upgradeMoves.length > 0) {
            for (const move of piece.upgradeMoves) {
                if (move.requiresUnmoved) continue;
                const stepsU = move.getSteps();
                for (const [dx, dy] of stepsU) {
                    const maxDistU = move.distance === -1 ? gridSize : move.distance;
                    for (let dist = 1; dist <= maxDistU; dist++) {
                        const shouldFlip = (playerPerspective === 'black' && color === 'black') ||
                                          (playerPerspective === 'white' && color === 'white');
                        const flipDy = shouldFlip ? -dy : dy;
                        const newX = centerPos + (dx * dist);
                        const newY = centerPos + (flipDy * dist);

                        if (newX >= 0 && newX < gridSize && newY >= 0 && newY < gridSize) {
                            upgradeReachable.add(`${newX},${newY}`);
                            if (move.jump === 'required') break;
                        } else {
                            break;
                        }
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
                const isUpgradeReachable = upgradeReachable.has(`${x},${y}`);

                if (isReachable) {
                    // Fill with piece color
                    ctx.fillStyle = color === 'white' ? '#ffffff' : '#000000';
                    ctx.fillRect(px, py, width, height);
                } else if (isUpgradeReachable) {
                    // Fill upgrade squares with neutral gray
                    ctx.fillStyle = '#808080ff';
                    ctx.fillRect(px, py, width, height);
                }

                // Add golden gem in center for royal pieces (override any fills)
                if (isCenter) {
                    if (piece.royal) {
                        // Diagonal shimmering gold gradient across the center cell
                        const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                        grad.addColorStop(0, '#e7e774ff'); // pale highlight
                        grad.addColorStop(0.25, '#FFFF33'); // very bright yellow
                        grad.addColorStop(0.6, '#FFD700'); // gold
                        grad.addColorStop(1, '#B8860B'); // dark goldenrod (shadow)
                        ctx.fillStyle = grad;
                        ctx.fillRect(px, py, width, height);
                    } else {
                        // Non-royal center cell: fill with neutral gray
                        ctx.fillStyle = '#808080ff';
                        ctx.fillRect(px, py, width, height);
                    }
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
            specials: piece.specials.map(special => ({
                type: special.type,
                data: special.data
            })),
            // Store indices into the top-level pieces array for promotion references
            promotionPieces: piece.promotionPieces.map(promo => pieces.indexOf(promo)),
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
            
            const specials = pieceData.specials.map(specialData =>
                new Special(specialData.type, specialData.data)
            );
            
            return new Piece(
                pieceData.name,
                moves,
                pieceData.royal,
                specials,
                [], // Temporary empty array
                pieceData.promotionRank,
                pieceData.promotionType
            );
        });
        
        // Second pass: fix promotion piece references (ignore invalid indices)
        piecesData.forEach((pieceData, idx) => {
            pieces[idx].promotionPieces = (pieceData.promotionPieces || [])
                .map(promoIdx => pieces[promoIdx])
                .filter(p => !!p);
        });
        
        return pieces;
    }
}

// Verify the function exists
console.log('PieceGenerator.createMovementPatternIcon exists?', typeof PieceGenerator.createMovementPatternIcon === 'function');

// Export for Node testing/runtime if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports.PieceGenerator = PieceGenerator;
    module.exports.Piece = Piece;
    module.exports.Move = Move;
    module.exports.Special = Special;
    module.exports.PieceSerializer = PieceSerializer;
}
