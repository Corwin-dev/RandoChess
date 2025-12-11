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
        // Use base move steps (ignore symmetry expansions) so promotion decisions
        // depend on the intended step directions rather than symmetric derivatives.
        const baseSteps = [];
        for (const move of moves) {
            // Skip capture-only moves for this analysis
            if (move.capture === 'required') continue;
            // Use the move's declared step only (do not expand symmetry)
            baseSteps.push(move.step);
        }

        if (baseSteps.length === 0) return false;

        const hasBackward = baseSteps.some(([dx, dy]) => dy < 0);
        const hasForward = baseSteps.some(([dx, dy]) => dy > 0);
        const onlyVertical = baseSteps.every(([dx, dy]) => dx === 0);

        // Also ensure the symmetry-expanded steps do not introduce backward movement.
        const expandedSteps = [];
        for (const m of moves) {
            if (m.capture === 'required') continue;
            expandedSteps.push(...m.getSteps());
        }
        const expandedHasBackward = expandedSteps.some(([dx, dy]) => dy < 0);

        // Directionally restricted if it has no backward movement in base steps AND
        // no backward movement when symmetry is applied, and either can move forward
        // or is vertical-only.
        return (!hasBackward && !expandedHasBackward && (hasForward || onlyVertical));
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
    static getUpgradeBonusRange(moves) {
        // Determine bonus move range based on forward-movement difficulty.
        // Use base move steps (ignore symmetry) to determine forward/backward/horizontal.
        const baseInfo = [];
        for (const m of moves) {
            if (m.capture === 'required') continue;
            const [dx, dy] = m.step;
            baseInfo.push({dx, dy, move: m});
        }

        const hasAnyForward = baseInfo.some(({dy}) => dy > 0);
        const hasAnyBackward = baseInfo.some(({dy}) => dy < 0);

        // Also ensure symmetry-expanded moves do not have backward movement
        const expanded = [];
        for (const m of moves) {
            if (m.capture === 'required') continue;
            expanded.push(...m.getSteps());
        }
        const expandedHasBackward = expanded.some(([dx, dy]) => dy < 0);

        // Only apply scaling when piece has no backward movement (base) and no expanded backward
        // and has some forward movement
        if (!hasAnyForward || hasAnyBackward || expandedHasBackward) return null;

        // Infinite forward movement if any forward move has unlimited distance and isn't a jump
        const hasInfiniteForward = baseInfo.some(({dy, move}) => dy > 0 && move.distance === -1 && move.jump !== 'required');

        // Double-step forward if any forward move has distance === 2
        const hasDoubleForward = baseInfo.some(({dy, move}) => dy > 0 && move.distance === 2);

        // Determine base range
        let baseRange;
        if (hasInfiniteForward) baseRange = [0, 1];
        else if (hasDoubleForward) baseRange = [1, 2];
        else baseRange = [2, 3];

        // If piece has horizontal movement (and no backward movement — already ensured above),
        // subtract one bonus move from the range (minimum 0).
        const hasHorizontal = baseInfo.some(({dx, dy}) => dx !== 0 && dy === 0);
        if (hasHorizontal) {
            const adjMin = Math.max(0, baseRange[0] - 1);
            const adjMax = Math.max(0, baseRange[1] - 1);
            return [adjMin, adjMax];
        }

        return baseRange;
    }

    static generateUpgradeMoves(originalMoves, rng, bonusRange = null) {
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

        // Determine bonus moves count
        let bonusMin = 1, bonusMax = 1;
        if (Array.isArray(bonusRange) && bonusRange.length === 2) {
            bonusMin = bonusRange[0];
            bonusMax = bonusRange[1];
        }

        const bonusCount = Math.floor(rng.next() * (bonusMax - bonusMin + 1)) + bonusMin;

        const stepOptions = [0, 0, 0, 1, 1];
        for (let b = 0; b < bonusCount; b++) {
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
        }

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
        // Royal is king-like most of the time, but occasionally restricted
        // to only orthogonal or only diagonal moves for variety.
        const royalMoves = [];
        const kingStepsAll = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        // Small random chance to restrict the king's movement set
        // Use the seeded RNG so generation stays deterministic for a seed
        const kingRnd = rng.next();
        let chosenKingSteps = kingStepsAll;
        if (kingRnd < 0.10) {
            // 10%: orthogonal-only king (rook-like single-step)
            chosenKingSteps = [ [1,0], [-1,0], [0,1], [0,-1] ];
        } else if (kingRnd < 0.20) {
            // 10%: diagonal-only king (bishop-like single-step)
            chosenKingSteps = [ [1,1], [1,-1], [-1,1], [-1,-1] ];
        }

        for (const step of chosenKingSteps) {
            // Each king-like move is distance 1, no jump
            royalMoves.push(new Move(step, null, 1, 'prohibited', false));
        }
        // Rarely, give the king extra flair: a knight-like jump or a two-square
        // orthogonal/double move. These are uncommon special abilities.
        // Use the seeded RNG so behavior is deterministic per-seed.
        const extraRnd = rng.next();
        // ~6% chance for a knight jump
        if (extraRnd < 0.06) {
            royalMoves.push(new Move([2, 1], '4way', 1, 'required', false));
        }
        // ~6% (next) chance for an orthogonal double-step (distance 2 slide)
        if (extraRnd >= 0.06 && extraRnd < 0.12) {
            // Add an orthogonal distance-2 slide; symmetry 4way to include both axes
            royalMoves.push(new Move([2, 0], '4way', 2, 'prohibited', false));
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
                const bonusRange = this.getUpgradeBonusRange(moves);
                upgradeMoves = this.generateUpgradeMoves(moves, rng, bonusRange);
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

                    // Recompute promotion/upgrade status in case our enforced changes affected directionality
                    if (this.isDirectionallyRestricted(slider.moves)) {
                        slider.promotionRank = this.getFarthestReachableRank(slider.moves);
                        slider.promotionType = 'move-upgrade';
                        const bonusRange = this.getUpgradeBonusRange(slider.moves);
                        slider.upgradeMoves = this.generateUpgradeMoves(slider.moves, rng, bonusRange);
                    } else {
                        slider.promotionRank = -1;
                        slider.promotionType = null;
                        slider.upgradeMoves = [];
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
                // Recompute promotion/upgrade status for fallback slider
                if (this.isDirectionallyRestricted(slider.moves)) {
                    slider.promotionRank = this.getFarthestReachableRank(slider.moves);
                    slider.promotionType = 'move-upgrade';
                    const bonusRange = this.getUpgradeBonusRange(slider.moves);
                    slider.upgradeMoves = this.generateUpgradeMoves(slider.moves, rng, bonusRange);
                } else {
                    slider.promotionRank = -1;
                    slider.promotionType = null;
                    slider.upgradeMoves = [];
                }

                pieces.push(slider);
                usedSignatures.add(pieceSignature(slider));
            }
        }

        // Trickster (formerly Minor 1) - n moves
        // Requirements: must have at least one jumping move and must NOT have all four cardinal directions
        let trickster;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n, false, rng);
                const candidate = createNonRoyal(moves);

                // Enforce Trickster constraints BEFORE computing signature
                // Ensure at least one jumping move
                const hasJump = candidate.moves.some(m => m.jump === 'required');
                if (!hasJump) {
                    // Add a knight-like jump move to guarantee a jumping ability
                    candidate.moves.push(new Move([2, 1], '4way', 1, 'required', false));
                }

                // Ensure the piece does NOT have all four cardinal directions
                const allSteps = [];
                for (const m of candidate.moves) {
                    if (m.capture === 'required') continue;
                    allSteps.push(...m.getSteps());
                }
                const hasE = allSteps.some(([dx, dy]) => dx === 1 && dy === 0);
                const hasW = allSteps.some(([dx, dy]) => dx === -1 && dy === 0);
                const hasN = allSteps.some(([dx, dy]) => dx === 0 && dy === 1);
                const hasS = allSteps.some(([dx, dy]) => dx === 0 && dy === -1);

                if (hasE && hasW && hasN && hasS) {
                    // Break the full-cardinal set by converting one cardinal move into a diagonal
                    // Find first move that yields a cardinal direction and modify it
                    for (const m of candidate.moves) {
                        const steps = m.getSteps();
                        const producesCardinal = steps.some(([dx, dy]) => (dx === 1 && dy === 0) || (dx === -1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 0 && dy === -1));
                        if (producesCardinal) {
                            // Change this move to a diagonal slide to remove one cardinal
                            m.step = [1, 1];
                            m.jump = 'prohibited';
                            m.distance = m.distance === -1 ? -1 : 1;
                            m.symmetry = 'Horizontal';
                            break;
                        }
                    }
                }

                // Recompute promotion/upgrade status in case our enforced changes affected directionality
                if (this.isDirectionallyRestricted(candidate.moves)) {
                    candidate.promotionRank = this.getFarthestReachableRank(candidate.moves);
                    candidate.promotionType = 'move-upgrade';
                    const bonusRange = this.getUpgradeBonusRange(candidate.moves);
                    candidate.upgradeMoves = this.generateUpgradeMoves(candidate.moves, rng, bonusRange);
                } else {
                    candidate.promotionRank = -1;
                    candidate.promotionType = null;
                    candidate.upgradeMoves = [];
                }

                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    trickster = candidate;
                    usedSignatures.add(sig);
                    pieces.push(trickster);
                    break;
                }
                attempts++;
            } while (attempts < 30);
            if (!trickster) {
                const moves = this.generateRandomMoves(n, false, rng);
                trickster = createNonRoyal(moves);
                // Ensure trickster constraints on fallback as well
                if (!trickster.moves.some(m => m.jump === 'required')) {
                    trickster.moves.push(new Move([2, 1], '4way', 1, 'required', false));
                }
                // Remove full-cardinal if present
                const allSteps = [];
                for (const m of trickster.moves) {
                    if (m.capture === 'required') continue;
                    allSteps.push(...m.getSteps());
                }
                const hasE = allSteps.some(([dx, dy]) => dx === 1 && dy === 0);
                const hasW = allSteps.some(([dx, dy]) => dx === -1 && dy === 0);
                const hasN = allSteps.some(([dx, dy]) => dx === 0 && dy === 1);
                const hasS = allSteps.some(([dx, dy]) => dx === 0 && dy === -1);
                if (hasE && hasW && hasN && hasS) {
                    for (const m of trickster.moves) {
                        const steps = m.getSteps();
                        const producesCardinal = steps.some(([dx, dy]) => (dx === 1 && dy === 0) || (dx === -1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 0 && dy === -1));
                        if (producesCardinal) {
                            m.step = [1, 1];
                            m.jump = 'prohibited';
                            m.distance = m.distance === -1 ? -1 : 1;
                            m.symmetry = 'Horizontal';
                            break;
                        }
                    }
                }
                // Recompute promotion/upgrade for fallback trickster
                if (this.isDirectionallyRestricted(trickster.moves)) {
                    trickster.promotionRank = this.getFarthestReachableRank(trickster.moves);
                    trickster.promotionType = 'move-upgrade';
                    const bonusRange = this.getUpgradeBonusRange(trickster.moves);
                    trickster.upgradeMoves = this.generateUpgradeMoves(trickster.moves, rng, bonusRange);
                } else {
                    trickster.promotionRank = -1;
                    trickster.promotionType = null;
                    trickster.upgradeMoves = [];
                }

                pieces.push(trickster);
                usedSignatures.add(pieceSignature(trickster));
            }
        }

        // Flower (formerly Minor 2) - n + 2 moves
        // Requirements: has 2 extra moves compared to minor baseline, and ALL moves use Horizontal symmetry
        let flower;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n + 2, false, rng);
                const candidate = createNonRoyal(moves);

                // Force Horizontal symmetry on all moves for Flower
                for (const m of candidate.moves) {
                    m.symmetry = 'Horizontal';
                }

                // Recompute promotion/upgrade status in case forcing Horizontal symmetry changed directionality
                if (this.isDirectionallyRestricted(candidate.moves)) {
                    candidate.promotionRank = this.getFarthestReachableRank(candidate.moves);
                    candidate.promotionType = 'move-upgrade';
                    const bonusRange = this.getUpgradeBonusRange(candidate.moves);
                    candidate.upgradeMoves = this.generateUpgradeMoves(candidate.moves, rng, bonusRange);
                } else {
                    candidate.promotionRank = -1;
                    candidate.promotionType = null;
                    candidate.upgradeMoves = [];
                }

                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    flower = candidate;
                    usedSignatures.add(sig);
                    pieces.push(flower);
                    break;
                }
                attempts++;
            } while (attempts < 30);
            if (!flower) {
                const moves = this.generateRandomMoves(n + 2, false, rng);
                flower = createNonRoyal(moves);
                for (const m of flower.moves) {
                    m.symmetry = 'Horizontal';
                }
                // Recompute promotion/upgrade for fallback flower
                if (this.isDirectionallyRestricted(flower.moves)) {
                    flower.promotionRank = this.getFarthestReachableRank(flower.moves);
                    flower.promotionType = 'move-upgrade';
                    const bonusRange = this.getUpgradeBonusRange(flower.moves);
                    flower.upgradeMoves = this.generateUpgradeMoves(flower.moves, rng, bonusRange);
                } else {
                    flower.promotionRank = -1;
                    flower.promotionType = null;
                    flower.upgradeMoves = [];
                }
                pieces.push(flower);
                usedSignatures.add(pieceSignature(flower));
            }
        }

        // Note: Do NOT generate a separate rook clone here. The board placement logic
        // will duplicate the rook on the back rank. We only want one generated rook type.
        // Ensure at least one knight-like jumping move exists among the
        // non-royal pieces (indices 1..4). If none found, add a classic
        // knight jump to the trickster (or fallback to the first non-royal).
        let hasKnight = false;
        for (let i = 1; i <= 4; i++) {
            const p = pieces[i];
            if (!p) continue;
            for (const m of p.moves) {
                if (m.jump === 'required') {
                    const dx = Math.abs(m.step[0]);
                    const dy = Math.abs(m.step[1]);
                    if ((dx === 2 && dy === 1) || (dx === 1 && dy === 2)) {
                        hasKnight = true;
                        break;
                    }
                }
            }
            if (hasKnight) break;
        }

        if (!hasKnight) {
            const target = typeof trickster !== 'undefined' && trickster ? trickster : pieces[1];
            if (target) {
                target.moves.push(new Move([2, 1], '4way', 1, 'required', false));
            }
        }

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
            // Orthogonal moves must slide, only diagonal/knight moves can normally jump
            let jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';

            // Determine distance with a few rare variants:
            // - Knights (jump required) usually have distance 1, but rarely
            //   we allow a non-jumping distance-2 variant (turning a knight-like
            //   step into a short sliding move).
            // - Slide moves normally are either unlimited (-1) or distance 1;
            //   very rarely allow distance 2 as an extra uncommon case.
            let distance;
            if (isRoyal) {
                distance = 1;
            } else if (jump === 'required') {
                if (random() < 0.05) {
                    // 5% chance: convert a jumping knight-like move into a short slide
                    // of distance 2 (and mark as sliding)
                    jump = 'prohibited';
                    distance = 2;
                } else {
                    distance = 1;
                }
            } else {
                const r = random();
                if (r < 0.50) distance = -1;            // 50% unlimited slide
                else if (r < 0.95) distance = 1;        // 45% short slide
                else distance = 2;                     // 5% rare distance-2 slide
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
            const distance = jump === 'required' ? 1 : (random() < 0.5 ? -1 : Math.floor(Math.pow(random(), 2) *3) +1);
            
            moves[0] = new Move([dx, dy], symmetry, distance, jump, false);
        }
        
        return moves;
    }

    // Generate a canvas icon showing the movement pattern of a piece on a 7x7 grid
    static createMovementPatternIcon(piece, size = 80, color = 'white', playerPerspective = 'white', isPromotionSquare = false, defeated = false) {
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
                        if (defeated) {
                            // Ruby-red defeated center (deep ruby with subtle facet)
                            const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                            grad.addColorStop(0, '#FF6B6B'); // light ruby
                            grad.addColorStop(0.35, '#E63946'); // ruby
                            grad.addColorStop(0.75, '#990012'); // deep ruby shadow
                            grad.addColorStop(1, '#4B0000'); // near-black edge
                            ctx.fillStyle = grad;
                            ctx.fillRect(px, py, width, height);
                            // Add subtle highlight facet
                            ctx.fillStyle = 'rgba(255,255,255,0.12)';
                            ctx.fillRect(px + Math.floor(width * 0.18), py + Math.floor(height * 0.12), Math.floor(width * 0.28), Math.floor(height * 0.18));
                        } else {
                            // Diagonal shimmering gold gradient across the center cell
                            const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                            grad.addColorStop(0, '#e7e774ff'); // pale highlight
                            grad.addColorStop(0.25, '#FFFF33'); // very bright yellow
                            grad.addColorStop(0.6, '#FFD700'); // gold
                            grad.addColorStop(1, '#B8860B'); // dark goldenrod (shadow)
                            ctx.fillStyle = grad;
                            ctx.fillRect(px, py, width, height);
                        }
                    } else if (isPromotionSquare) {
                        // Silver gradient for promotion/upgrade-ready pieces
                        const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                        grad.addColorStop(0, '#f0f0f4'); // pale silver highlight
                        grad.addColorStop(0.25, '#dcdde1');
                        grad.addColorStop(0.6, '#c0c0c8');
                        grad.addColorStop(1, '#808090'); // darker silver shadow
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

    // Build a move table for the current engine state.
    // Returns an object with per-color totals and per-symbol aggregations:
    // { white: { total, bySymbol: { symbol: { countPieces, totalMoves } } }, black: { ... } }
    static buildMoveTable(engine) {
        const table = {
            white: { total: 0, bySymbol: {} },
            black: { total: 0, bySymbol: {} }
        };

        if (!engine || !engine.board) return table;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = engine.board[r][c];
                if (!cell) continue;
                const color = cell.color;
                const symbol = cell.piece && cell.piece.name ? cell.piece.name : 'unknown';

                // Use engine.getValidMoves to get legal move count for the piece
                let moves = [];
                try {
                    moves = typeof engine.getValidMoves === 'function' ? engine.getValidMoves(r, c) : [];
                } catch (e) {
                    moves = [];
                }

                const count = Array.isArray(moves) ? moves.length : 0;

                table[color].total += count;

                if (!table[color].bySymbol[symbol]) {
                    table[color].bySymbol[symbol] = { countPieces: 0, totalMoves: 0 };
                }
                table[color].bySymbol[symbol].countPieces += 1;
                table[color].bySymbol[symbol].totalMoves += count;
            }
        }

        return table;
    }

    // Compute a material score for each side and the advantage (white - black).
    // Uses heuristics similar to the AI evaluator: long-range moves, number of directions,
    // capture ability, promotion potential, and slight positional center bias.
    static computeMaterialAdvantage(engine) {
        let white = 0;
        let black = 0;

        if (!engine || !engine.board) return { white, black, advantage: white - black };

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = engine.board[r][c];
                if (!cell) continue;
                const val = this.getStaticPieceValue(cell.piece, r, c, cell.color, engine);
                if (cell.color === 'white') white += val;
                else black += val;
            }
        }

        return { white, black, advantage: white - black };
    }

    // Helper used by computeMaterialAdvantage to estimate a piece's static value.
    static getStaticPieceValue(piece, row, col, color, engine = null) {
        if (!piece) return 0;

        // Royal piece is effectively invaluable (large sentinel)
        if (piece.royal) return 10000;

        let value = 0;

        for (const move of piece.moves) {
            if (move.distance === -1) value += 3;
            else value += (move.distance || 0) * 0.5;

            const steps = move.getSteps();
            value += (steps.length || 0) * 0.3;

            if (move.capture === 'allowed' || move.capture === 'required') value += 0.5;
        }

        // Promotion potential
        if (piece.promotionPieces && piece.promotionPieces.length > 0) {
            const promotionTargetRank = color === 'white' ? 0 : 7;
            const distanceToPromotion = Math.abs(row - promotionTargetRank);
            value += 1; // base pawn/promotion potential
            if (distanceToPromotion < 3) value += (3 - distanceToPromotion) * 0.5;
        }

        // Small positional center bonus (encourage center control)
        const centerDistance = Math.abs(3.5 - row) + Math.abs(3.5 - col);
        value += (7 - centerDistance) * 0.1;

        return value;
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
        
        // Deserialization in production shouldn't log by default
        
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

// Development-only checks removed to reduce console noise in production

// Export for Node testing/runtime if available
if (typeof module !== 'undefined' && module.exports) {
    module.exports.PieceGenerator = PieceGenerator;
    module.exports.Piece = Piece;
    module.exports.Move = Move;
    module.exports.Special = Special;
    module.exports.PieceSerializer = PieceSerializer;
}

// Expose as ES module exports and attach to window for backwards compatibility
try {
    // Attach to window when running in browser so legacy scripts continue to work
    if (typeof window !== 'undefined') {
        window.PieceGenerator = PieceGenerator;
        window.Piece = Piece;
        window.Move = Move;
        window.Special = Special;
        window.PieceSerializer = PieceSerializer;
    }
} catch (e) { /* ignore in non-browser environments */ }

// ES module exports
export { PieceGenerator, Piece, Move, Special, PieceSerializer };
