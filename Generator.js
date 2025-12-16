import { Move, Piece, Special } from './pieces.js';

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

class PieceGenerator {
    static symmetries = ['Horizontal', '4way', '8way'];
    
    // Analyze if a piece has only forward or only vertical movement
    static isDirectionallyRestricted(moves) {
        const baseSteps = [];
        for (const move of moves) {
            if (move.capture === 'required') continue;
            baseSteps.push(move.step);
        }

        if (baseSteps.length === 0) return false;

        const hasBackward = baseSteps.some(([dx, dy]) => dy < 0);
        const hasForward = baseSteps.some(([dx, dy]) => dy > 0);
        const onlyVertical = baseSteps.every(([dx, dy]) => dx === 0);

        const expandedSteps = [];
        for (const m of moves) {
            if (m.capture === 'required') continue;
            expandedSteps.push(...m.getSteps());
        }
        const expandedHasBackward = expandedSteps.some(([dx, dy]) => dy < 0);

        return (!hasBackward && !expandedHasBackward && (hasForward || onlyVertical));
    }
    
    static getFarthestReachableRank(moves, startRank = 1) {
        const allSteps = [];
        for (const move of moves) {
            if (move.capture === 'required') continue;
            allSteps.push(...move.getSteps());
        }
        
        if (allSteps.length === 0) return startRank;
        
        const maxY = Math.max(...allSteps.map(([dx, dy]) => dy));
        const minY = Math.min(...allSteps.map(([dx, dy]) => dy));
        
        if (maxY > 0 && minY >= 0) return 7;
        if (maxY <= 0 && minY < 0) return 0;
        
        return 7;
    }
    
    static getUpgradeBonusRange(moves) {
        const baseInfo = [];
        for (const m of moves) {
            if (m.capture === 'required') continue;
            const [dx, dy] = m.step;
            baseInfo.push({dx, dy, move: m});
        }

        const hasAnyForward = baseInfo.some(({dy}) => dy > 0);
        const hasAnyBackward = baseInfo.some(({dy}) => dy < 0);

        const expanded = [];
        for (const m of moves) {
            if (m.capture === 'required') continue;
            expanded.push(...m.getSteps());
        }
        const expandedHasBackward = expanded.some(([dx, dy]) => dy < 0);

        if (!hasAnyForward || hasAnyBackward || expandedHasBackward) return null;

        const hasInfiniteForward = baseInfo.some(({dy, move}) => dy > 0 && move.distance === -1 && move.jump !== 'required');

        const hasDoubleForward = baseInfo.some(({dy, move}) => dy > 0 && move.distance === 2);

        let baseRange;
        if (hasInfiniteForward) baseRange = [0, 1];
        else if (hasDoubleForward) baseRange = [1, 2];
        else baseRange = [2, 3];

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

        while (this.isDirectionallyRestricted(newMoves) && attemptsLeft > 0) {
            attemptsLeft--;

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
                dx = [1, 1, 2][Math.floor(rng.next() * 3)];
                dy = [0, 1, 1][Math.floor(rng.next() * 3)];
            } else if (allForward) {
                dx = [0, 1, 1][Math.floor(rng.next() * 3)];
                dy = -([1, 1, 2][Math.floor(rng.next() * 3)]);
            } else if (allBackward) {
                dx = [0, 1, 1][Math.floor(rng.next() * 3)];
                dy = [1, 1, 2][Math.floor(rng.next() * 3)];
            }

            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            const orthogonalJump = isOrthogonal && (dx >= 2 || dy >= 2);
            const diagonalJump = (dx === dy) && dx >= 2;

            if (orthogonalJump || diagonalJump) {
                attemptsLeft++;
                continue;
            }

            const symmetry = this.symmetries[Math.floor(rng.next() * this.symmetries.length)];
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            const distance = jump === 'required' ? 1 : (rng.next() < 0.5 ? -1 : 1);

            newMoves.push(new Move([dx, dy], symmetry, distance, jump, false));
        }

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

            if (orthogonalJump || diagonalJump) {
                if (dx >= 2) dx = 1;
                if (dy >= 2) dy = 1;
            }

            const symmetry = this.symmetries[Math.floor(rng.next() * this.symmetries.length)];
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            const distance = jump === 'required' ? 1 : (rng.next() < 0.5 ? -1 : 1);

            newMoves.push(new Move([dx, dy], symmetry, distance, jump, false));
        }

        return newMoves;
    }
    
    static generateRandomPieces(seed = null) {
        if (seed === null) {
            seed = Date.now() % 1000000;
        }
        
        const rng = new SeededRandom(seed);
        
        const pieces = [];
        const usedSymbols = new Set();
        const usedSignatures = new Set();

        const pawnMovesPreset = [
            new Move([0, 1], 'Horizontal', 1, 'prohibited', false, 'prohibited'),
            new Move([1, 1], 'Horizontal', 1, 'prohibited', false, 'required'),
            new Move([0, 1], 'Horizontal', 2, 'prohibited', true, 'prohibited')
        ];

        const pieceSignature = (p) => {
            const mv = (m) => `${m.step[0]},${m.step[1]}|${m.symmetry}|${m.distance}|${m.jump}|${m.requiresUnmoved}|${m.capture}`;
            const ups = (p.upgradeMoves || []).map(mv).sort().join(';');
            const moves = (p.moves || []).map(mv).sort().join(';');
            const specs = (p.specials || []).map(s => s.type).sort().join(',');
            return `${p.royal ? 'R' : 'N'}|${p.promotionType||''}|${specs}|MOVES:${moves}|UP:${ups}`;
        };

        const pawnSignatureReserved = pieceSignature({
            moves: pawnMovesPreset,
            specials: [],
            royal: false,
            promotionType: 'choice',
            upgradeMoves: []
        });
        usedSignatures.add(pawnSignatureReserved);

        const royalMoves = [];
        const kingStepsAll = [
            [1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]
        ];
        const kingRnd = rng.next();
        let chosenKingSteps = kingStepsAll;
        if (kingRnd < 0.10) {
            chosenKingSteps = [ [1,0], [-1,0], [0,1], [0,-1] ];
        } else if (kingRnd < 0.20) {
            chosenKingSteps = [ [1,1], [1,-1], [-1,1], [-1,-1] ];
        }

        for (const step of chosenKingSteps) {
            royalMoves.push(new Move(step, null, 1, 'prohibited', false));
        }

        // Allow king to have the special length-2 jumps ([2,0], [0,2], [2,2])
        // but do NOT give the king any double-distance (distance=2) sliding moves.
        try {
            const allSteps = [];
            for (const m of royalMoves) {
                if (m.capture === 'required') continue;
                allSteps.push(...m.getSteps());
            }

            const absHas = (ax, ay) => allSteps.some(([sx, sy]) => Math.abs(sx) === ax && Math.abs(sy) === ay);
            const jumpCandidates = [[2, 0], [0, 2], [2, 2]];

            for (const [jx, jy] of jumpCandidates) {
                const interAx = Math.abs(jx / 2);
                const interAy = Math.abs(jy / 2);

                const interPresent = absHas(interAx, interAy);
                const jumpPresent = absHas(Math.abs(jx), Math.abs(jy));

                if (!interPresent && !jumpPresent) {
                    let symR = (Math.abs(jx) === Math.abs(jy)) ? '8way' : '4way';
                    royalMoves.push(new Move([jx, jy], symR, 1, 'required', false));
                }

                // if a jump exists, remove intermediary single-step moves
                const tmpSteps = [];
                for (const m of royalMoves) {
                    if (m.capture === 'required') continue;
                    tmpSteps.push(...m.getSteps());
                }
                const nowJumpPresent = tmpSteps.some(([sx, sy]) => Math.abs(sx) === Math.abs(jx) && Math.abs(sy) === Math.abs(jy));
                if (nowJumpPresent) {
                    for (let i = royalMoves.length - 1; i >= 0; i--) {
                        const m = royalMoves[i];
                        const steps = m.getSteps();
                        if (steps.some(([sx, sy]) => Math.abs(sx) === interAx && Math.abs(sy) === interAy)) {
                            royalMoves.splice(i, 1);
                        }
                    }
                }
            }
        } catch (e) {}

        const royalSymbol = this.selectSymbolForPiece(royalMoves, true, false, usedSymbols);
        usedSymbols.add(royalSymbol);
        
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
        usedSignatures.add(pieceSignature(royal));

        const n = 2 + Math.floor(rng.next() * 2);

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
                const moves = this.generateRandomMoves(n + 2, false, rng);
                powerhouse = createNonRoyal(moves);
                pieces.push(powerhouse);
                usedSignatures.add(pieceSignature(powerhouse));
            }
        }

        let slider;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n + 1, false, rng);
                const candidate = createNonRoyal(moves);
                const sig = pieceSignature(candidate);
                if (!usedSignatures.has(sig)) {
                    slider = candidate;
                    let hasUnlimited = slider.moves.some(m => m.distance === -1 && m.jump !== 'required');
                    if (!hasUnlimited) {
                        const slideIdx = slider.moves.findIndex(m => m.jump !== 'required');
                        if (slideIdx >= 0) {
                            slider.moves[slideIdx].distance = -1;
                        } else {
                            slider.moves.push(new Move([1, 0], '4way', -1, 'prohibited', false));
                        }
                    }

                    const hasNonHorizontal = slider.moves.some(m => m.symmetry && m.symmetry !== 'Horizontal');
                    if (!hasNonHorizontal) {
                        const idx = slider.moves.findIndex(m => m.jump !== 'required');
                        if (idx >= 0) {
                            slider.moves[idx].symmetry = '4way';
                        } else {
                            slider.moves[0].symmetry = '4way';
                        }
                    }

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

        let trickster;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n, false, rng);
                const candidate = createNonRoyal(moves);

                const hasJump = candidate.moves.some(m => m.jump === 'required');
                if (!hasJump) {
                    candidate.moves.push(new Move([2, 1], '4way', 1, 'required', false));
                }

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
                    for (const m of candidate.moves) {
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
                if (!trickster.moves.some(m => m.jump === 'required')) {
                    trickster.moves.push(new Move([2, 1], '4way', 1, 'required', false));
                }
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

        let flower;
        {
            let attempts = 0;
            do {
                const moves = this.generateRandomMoves(n + 2, false, rng);
                const candidate = createNonRoyal(moves);

                for (const m of candidate.moves) {
                    m.symmetry = 'Horizontal';
                }

                // Flower special: allow orthogonal/diagonal length-2 jumps
                // ([2,0], [0,2], [2,2]) only when the intermediate square
                // ([1,0], [0,1], [1,1]) is NOT present in the moveset.
                // If a jump is present, remove any intermediary step to keep
                // the moveset consistent (no both-step-and-jump).
                try {
                    const allSteps = [];
                    for (const m of candidate.moves) {
                        if (m.capture === 'required') continue;
                        allSteps.push(...m.getSteps());
                    }

                    const absHas = (ax, ay) => allSteps.some(([sx, sy]) => Math.abs(sx) === ax && Math.abs(sy) === ay);

                    const jumpCandidates = [[2, 0], [0, 2], [2, 2]];
                    // Prefer existing symmetry on the candidate, else choose by vector
                    const existingSymmetry = candidate.moves.find(m => m.symmetry === '8way') ? '8way' : (candidate.moves.find(m => m.symmetry === '4way') ? '4way' : null);
                    for (const [jx, jy] of jumpCandidates) {
                        const interAx = Math.abs(jx / 2);
                        const interAy = Math.abs(jy / 2);

                        const interPresent = absHas(interAx, interAy);
                        const jumpPresent = absHas(Math.abs(jx), Math.abs(jy));

                        if (!interPresent && !jumpPresent) {
                            let sym = existingSymmetry;
                            if (!sym) sym = (Math.abs(jx) === Math.abs(jy)) ? '8way' : '4way';
                            candidate.moves.push(new Move([jx, jy], sym, 1, 'required', false));
                        }

                        // if jump now present, ensure intermediary is removed
                        if (!jumpPresent) {
                            // recompute presence after potential addition
                            const tmpSteps = [];
                            for (const m of candidate.moves) {
                                if (m.capture === 'required') continue;
                                tmpSteps.push(...m.getSteps());
                            }
                            if (tmpSteps.some(([sx, sy]) => Math.abs(sx) === Math.abs(jx) && Math.abs(sy) === Math.abs(jy))) {
                                // remove any moves that produce the intermediary step
                                candidate.moves = candidate.moves.filter(m => {
                                    const steps = m.getSteps();
                                    return !steps.some(([sx, sy]) => Math.abs(sx) === interAx && Math.abs(sy) === interAy);
                                });
                            }
                        } else {
                            // if jump already existed, remove intermediary moves
                            candidate.moves = candidate.moves.filter(m => {
                                const steps = m.getSteps();
                                return !steps.some(([sx, sy]) => Math.abs(sx) === interAx && Math.abs(sy) === interAy);
                            });
                        }
                    }
                } catch (e) {
                    // harmless if something unexpected happens; keep original candidate
                }

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
                // Flower special (fallback): allow length-2 orth/diag jumps and
                // remove intermediary steps if the jump is present.
                try {
                    const allSteps = [];
                    for (const m of flower.moves) {
                        if (m.capture === 'required') continue;
                        allSteps.push(...m.getSteps());
                    }

                    const absHas = (ax, ay) => allSteps.some(([sx, sy]) => Math.abs(sx) === ax && Math.abs(sy) === ay);
                    const jumpCandidates = [[2, 0], [0, 2], [2, 2]];

                    for (const [jx, jy] of jumpCandidates) {
                        const interAx = Math.abs(jx / 2);
                        const interAy = Math.abs(jy / 2);

                        const interPresent = absHas(interAx, interAy);
                        const jumpPresent = absHas(Math.abs(jx), Math.abs(jy));

                        if (!interPresent && !jumpPresent) {
                            const existingSymmetryF = flower.moves.find(m => m.symmetry === '8way') ? '8way' : (flower.moves.find(m => m.symmetry === '4way') ? '4way' : null);
                            let symF = existingSymmetryF;
                            if (!symF) symF = (Math.abs(jx) === Math.abs(jy)) ? '8way' : '4way';
                            flower.moves.push(new Move([jx, jy], symF, 1, 'required', false));
                        }

                        // if jump exists (now), remove intermediary moves
                        const tmpSteps = [];
                        for (const m of flower.moves) {
                            if (m.capture === 'required') continue;
                            tmpSteps.push(...m.getSteps());
                        }
                        const nowJumpPresent = tmpSteps.some(([sx, sy]) => Math.abs(sx) === Math.abs(jx) && Math.abs(sy) === Math.abs(jy));
                        if (nowJumpPresent) {
                            flower.moves = flower.moves.filter(m => {
                                const steps = m.getSteps();
                                return !steps.some(([sx, sy]) => Math.abs(sx) === interAx && Math.abs(sy) === interAy);
                            });
                        }
                    }
                } catch (e) {}
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

        const pawnMoves = [
            new Move([0, 1], 'Horizontal', 1, 'prohibited', false, 'prohibited'),
            new Move([1, 1], 'Horizontal', 1, 'prohibited', false, 'required'),
            new Move([0, 1], 'Horizontal', 2, 'prohibited', true, 'prohibited')
        ];
        
        const promotionPieces = pieces.filter(p => !p.royal && p.promotionType !== 'choice');
        
        const pawnSymbol = this.selectSymbolForPiece(pawnMoves, false, true, usedSymbols, rng);
        usedSymbols.add(pawnSymbol);
        
        const enPassantSpecial = new Special('enPassant', {});
        
        const pawn = new Piece(
            pawnSymbol,
            pawnMoves,
            false,
            [enPassantSpecial],
            promotionPieces,
            7,
            'choice'
        );
        pieces.push(pawn);

        // Expose the actual seed used for generation so callers (UI, server)
        // can display/share it even when `seed` was not provided.
        try { pieces.__seed = seed; } catch (e) {}

        return pieces;
    }

    static selectSymbolForPiece(moves, isRoyal, isPawn = false, usedSymbols = new Set(), rng = null) {
        const random = rng ? () => rng.next() : Math.random;
        let hasLongRange = false;
        let hasDiagonal = false;
        let hasStraight = false;
        let hasJump = false;
        let isShortRange = true;
        let hasComplexMove = false;
        
        for (const move of moves) {
            const [dx, dy] = move.step;
            
            if (move.distance === -1 || move.distance > 3) {
                hasLongRange = true;
                isShortRange = false;
            }
            
            if (dx === dy && dx !== 0) hasDiagonal = true;
            if ((dx === 0 && dy !== 0) || (dy === 0 && dx !== 0)) hasStraight = true;
            
            if (move.jump === 'required' || (dx > 1 && dy > 0) || (dy > 1 && dx > 0)) {
                hasJump = true;
            }
            
            if ((dx === 2 && dy === 1) || (dx === 1 && dy === 2) || (dx === 3 || dy === 3)) {
                hasComplexMove = true;
            }
        }
        
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
        
        const genericSymbols = ['★', '☆', '✫', '✬', '✭', '✮', '✯'];
        return this.getUniqueSymbol(genericSymbols, usedSymbols, random);
    }

    static getUniqueSymbol(symbolArray, usedSymbols, random = Math.random) {
        const availableSymbols = symbolArray.filter(s => !usedSymbols.has(s));
        
        if (availableSymbols.length > 0) {
            return availableSymbols[Math.floor(random() * availableSymbols.length)];
        }
        
        const genericSymbols = ['★', '☆', '✫', '✬', '✭', '✮', '✯'];
        const availableGeneric = genericSymbols.filter(s => !usedSymbols.has(s));
        
        if (availableGeneric.length > 0) {
            return availableGeneric[Math.floor(random() * availableGeneric.length)];
        }
        
        return symbolArray[Math.floor(random() * symbolArray.length)];
    }

    static generateRandomMoves(count, isRoyal = false, rng = null) {
        const random = rng ? () => rng.next() : Math.random;
        const moves = [];
        
        for (let i = 0; i < count; i++) {
            const stepOptions = isRoyal ? [0, 1] : [0, 0, 0, 0, 0, 1, 1, 1, 2];
            let dx, dy;
            do {
                dx = stepOptions[Math.floor(random() * stepOptions.length)];
                dy = stepOptions[Math.floor(random() * stepOptions.length)];
            } while (dx === 0 && dy === 0 ||        
                     (dx === 0 && dy >= 2) ||       
                     (dy === 0 && dx >= 2) ||       
                     (dx === dy && dx >= 2));       

            const symmetry = isRoyal ? '4way' : this.symmetries[Math.floor(random() * this.symmetries.length)];
            
            const requiresUnmoved = false;

            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            let jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';

            let distance;
            if (isRoyal) {
                distance = 1;
            } else if (jump === 'required') {
                if (random() < 0.05) {
                    jump = 'prohibited';
                    distance = 2;
                } else {
                    distance = 1;
                }
            } else {
                const r = random();
                if (r < 0.50) distance = -1;            
                else if (r < 0.95) distance = 1;        
                else distance = 2;                     
            }

            moves.push(new Move([dx, dy], symmetry, distance, jump, requiresUnmoved));
        }
        
        const hasYMovement = moves.some(m => m.step[1] !== 0);
        if (!hasYMovement && moves.length > 0) {
            const stepOptions = [0, 0, 0, 0, 1, 1, 1, 2];
            let dx = stepOptions[Math.floor(random() * stepOptions.length)];
            let dy = stepOptions.filter(v => v !== 0)[Math.floor(random() * stepOptions.filter(v => v !== 0).length)];
            
            const isOrthogonal = (dx === 0 || dy === 0) && !(dx === 0 && dy === 0);
            const orthogonalJump = isOrthogonal && (dx >= 2 || dy >= 2);
            const diagonalJump = (dx === dy) && dx >= 2;
            
            if (orthogonalJump || diagonalJump) {
                if (dx >= 2) dx = 1;
                if (dy >= 2) dy = 1;
            }
            
            const symmetry = this.symmetries[Math.floor(random() * this.symmetries.length)];
            const isStraightMove = (dx === 0 || dy === 0 || dx === dy);
            const jump = (isStraightMove || isOrthogonal) ? 'prohibited' : 'required';
            const distance = jump === 'required' ? 1 : (random() < 0.5 ? -1 : Math.floor(Math.pow(random(), 2) *3) +1);
            
            moves[0] = new Move([dx, dy], symmetry, distance, jump, false);
        }
        
        return moves;
    }

    static generatePlacement(pieces, rng = null) {
        // Support passing either a SeededRandom-like object or a numeric seed.
        if (typeof rng === 'number') rng = new SeededRandom(rng);
        const random = (rng && typeof rng.next === 'function') ? () => rng.next() : Math.random;
        // Basic placement generator: choose strongest index and shuffle remaining
        let pawnIndex = pieces.findIndex(p => (p && (p.promotionType === 'choice' || (p.specials && p.specials.some(s => s.type === 'enPassant')))));
        if (pawnIndex === -1) pawnIndex = pieces.length - 1;

        const candidates = [];
        for (let i = 1; i < pieces.length; i++) if (i !== pawnIndex) candidates.push(i);

        let strongestIndex = candidates[0] || 1;
        let maxMoves = (pieces[strongestIndex] && pieces[strongestIndex].moves) ? pieces[strongestIndex].moves.length : 0;
        for (const i of candidates) {
            const movesLen = (pieces[i] && pieces[i].moves) ? pieces[i].moves.length : 0;
            if (movesLen > maxMoves) { maxMoves = movesLen; strongestIndex = i; }
        }

        const remainingPieces = candidates.filter(i => i !== strongestIndex);
        for (let i = remainingPieces.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [remainingPieces[i], remainingPieces[j]] = [remainingPieces[j], remainingPieces[i]];
        }

        const pickVariant = () => { const r = random(); if (r < 0.12) return 'orthogonal'; if (r < 0.24) return 'diagonal'; return 'normal'; };

        // Ensure both kings receive the same variant so opposing royals
        // always have identical base movesets.
        const chosenKingVariant = pickVariant();
        return { remainingPieces, strongestIndex, kingVariants: { white: chosenKingVariant, black: chosenKingVariant } };
    }

    static createMovementPatternIcon(piece, size = 80, color = 'white', playerPerspective = 'white', isPromotionSquare = false, defeated = false) {
        const gridSize = 7;
        const borderCells = 0.5;
        const totalGridSize = gridSize + (borderCells * 2);
        const adjustedSize = Math.floor(size / totalGridSize) * totalGridSize;
        const cellSize = adjustedSize / totalGridSize;
        
        const canvas = document.createElement('canvas');
        canvas.width = adjustedSize;
        canvas.height = adjustedSize;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        const centerPos = Math.floor(gridSize / 2);
        const reachable = new Set();
        
        for (const move of piece.moves) {
            if (move.requiresUnmoved) continue;
            const steps = move.getSteps();
            for (const [dx, dy] of steps) {
                const maxDist = move.distance === -1 ? gridSize : move.distance;
                for (let dist = 1; dist <= maxDist; dist++) {
                    const shouldFlip = (playerPerspective === 'black' && color === 'black') || 
                                      (playerPerspective === 'white' && color === 'white');
                    const flipDy = shouldFlip ? -dy : dy;
                    const newX = centerPos + (dx * dist);
                    const newY = centerPos + (flipDy * dist);
                    if (newX >= 0 && newX < gridSize && newY >= 0 && newY < gridSize) {
                        reachable.add(`${newX},${newY}`);
                        if (move.jump === 'required') {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
        }

        const upgradeReachable = new Set();
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

        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const gridX = x + borderCells;
                const gridY = y + borderCells;
                const px = Math.floor(gridX * cellSize);
                const py = Math.floor(gridY * cellSize);
                const width = Math.floor((gridX + 1) * cellSize) - px;
                const height = Math.floor((gridY + 1) * cellSize) - py;

                const isCenter = (x === centerPos && y === centerPos);
                const isReachable = reachable.has(`${x},${y}`);
                const isUpgradeReachable = upgradeReachable.has(`${x},${y}`);

                if (isReachable) {
                    ctx.fillStyle = color === 'white' ? '#ffffff' : '#000000';
                    ctx.fillRect(px, py, width, height);
                } else if (isUpgradeReachable) {
                    ctx.fillStyle = '#808080ff';
                    ctx.fillRect(px, py, width, height);
                }

                if (isCenter) {
                    if (piece.royal) {
                        if (false) {
                            const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                            grad.addColorStop(0, '#FF6B6B');
                            grad.addColorStop(0.35, '#E63946');
                            grad.addColorStop(0.75, '#990012');
                            grad.addColorStop(1, '#4B0000');
                            ctx.fillStyle = grad;
                            ctx.fillRect(px, py, width, height);
                            ctx.fillStyle = 'rgba(255,255,255,0.12)';
                            ctx.fillRect(px + Math.floor(width * 0.18), py + Math.floor(height * 0.12), Math.floor(width * 0.28), Math.floor(height * 0.18));
                        } else {
                            const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                            grad.addColorStop(0, '#e7e774ff');
                            grad.addColorStop(0.25, '#FFFF33');
                            grad.addColorStop(0.6, '#FFD700');
                            grad.addColorStop(1, '#B8860B');
                            ctx.fillStyle = grad;
                            ctx.fillRect(px, py, width, height);
                        }
                    } else if (isPromotionSquare) {
                        const grad = ctx.createLinearGradient(px, py, px + width, py + height);
                        grad.addColorStop(0, '#f0f0f4');
                        grad.addColorStop(0.25, '#dcdde1');
                        grad.addColorStop(0.6, '#c0c0c8');
                        grad.addColorStop(1, '#808090');
                        ctx.fillStyle = grad;
                        ctx.fillRect(px, py, width, height);
                    } else {
                        ctx.fillStyle = '#808080ff';
                        ctx.fillRect(px, py, width, height);
                    }
                }
            }
        }

        return canvas;
    }

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

    static getStaticPieceValue(piece, row, col, color, engine = null) {
        if (!piece) return 0;

        if (piece.royal) return 10000;

        let value = 0;

        for (const move of piece.moves) {
            if (move.distance === -1) value += 3;
            else value += (move.distance || 0) * 0.5;

            const steps = move.getSteps();
            value += (steps.length || 0) * 0.3;

            if (move.capture === 'allowed' || move.capture === 'required') value += 0.5;
        }

        if (piece.promotionPieces && piece.promotionPieces.length > 0) {
            const promotionTargetRank = color === 'white' ? 0 : 7;
            const distanceToPromotion = Math.abs(row - promotionTargetRank);
            value += 1;
            if (distanceToPromotion < 3) value += (3 - distanceToPromotion) * 0.5;
        }

        const centerDistance = Math.abs(3.5 - row) + Math.abs(3.5 - col);
        value += (7 - centerDistance) * 0.1;

        return value;
    }
}

// Expose `PieceGenerator` on `window` for non-module consumers
try {
    if (typeof window !== 'undefined') window.PieceGenerator = PieceGenerator;
} catch (e) {}

// Named export for ES module consumers (browser `import { PieceGenerator } from './Generator.js'`)
export { PieceGenerator };

try {
    if (typeof window !== 'undefined') {
        window.PieceGenerator = PieceGenerator;
    }
} catch (e) {}
