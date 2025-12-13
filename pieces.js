// ===== Piece Definitions and Generation =====
// Pure piece logic with no game state dependencies

// Piece generation (SeededRandom and PieceGenerator) moved to Generator.js

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

// PieceGenerator moved to Generator.js. It uses `Move`, `Piece`, `Special` and is exported
// from Generator.js to keep generation logic separate from piece data structures.

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
    // PieceGenerator is exported from Generator.js
    module.exports.Piece = Piece;
    module.exports.Move = Move;
    module.exports.Special = Special;
    module.exports.PieceSerializer = PieceSerializer;
}

// Expose as ES module exports and attach to window for backwards compatibility
try {
    // Attach to window when running in browser so legacy scripts continue to work
    if (typeof window !== 'undefined') {
        // PieceGenerator attached by Generator.js for compatibility
        window.Piece = Piece;
        window.Move = Move;
        window.Special = Special;
        window.PieceSerializer = PieceSerializer;
    }
} catch (e) { /* ignore in non-browser environments */ }

// ES module exports
export { Piece, Move, Special, PieceSerializer };
