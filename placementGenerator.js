// Lightweight placement generator extracted from Generator.js
// Exposes only `PieceGenerator.generatePlacement` so servers can avoid
// loading the entire Generator.js runtime/UI helpers.

class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }

    next() {
        let t = (this.seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

const PieceGenerator = {
    generatePlacement(pieces, rng = null) {
        if (typeof rng === 'number') rng = new SeededRandom(rng);
        const random =
            rng && typeof rng.next === 'function'
                ? () => rng.next()
                : Math.random;

        let pawnIndex = pieces.findIndex(
            (p) =>
                p &&
                (p.promotionType === 'choice' ||
                    (p.specials &&
                        p.specials.some((s) => s.type === 'enPassant')))
        );
        if (pawnIndex === -1) pawnIndex = pieces.length - 1;

        const candidates = [];
        for (let i = 1; i < pieces.length; i++)
            if (i !== pawnIndex) candidates.push(i);

        let strongestIndex = candidates[0] || 1;
        let maxMoves =
            pieces[strongestIndex] && pieces[strongestIndex].moves
                ? pieces[strongestIndex].moves.length
                : 0;
        for (const i of candidates) {
            const movesLen =
                pieces[i] && pieces[i].moves ? pieces[i].moves.length : 0;
            if (movesLen > maxMoves) {
                maxMoves = movesLen;
                strongestIndex = i;
            }
        }

        const remainingPieces = candidates.filter((i) => i !== strongestIndex);
        for (let i = remainingPieces.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [remainingPieces[i], remainingPieces[j]] = [
                remainingPieces[j],
                remainingPieces[i],
            ];
        }

        const pickVariant = () => {
            const r = random();
            if (r < 0.12) return 'orthogonal';
            if (r < 0.24) return 'diagonal';
            return 'normal';
        };

        const chosenKingVariant = pickVariant();
        return {
            remainingPieces,
            strongestIndex,
            kingVariants: {
                white: chosenKingVariant,
                black: chosenKingVariant,
            },
        };
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports.PieceGenerator = PieceGenerator;
}
