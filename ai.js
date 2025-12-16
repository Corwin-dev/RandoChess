// ===== Chess AI Engine =====
// Uses ChessEngine for game logic

class ChessAI {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty;
        this.searchDepth = this.getSearchDepth(difficulty);
        this.positionEvaluations = 0; // For debugging
        this.transpositionTable = new Map();
        this.timeLimits = this.getTimeLimits();

        // Time-scaling parameters (tunable)
        // Maximum thinking time in ms (0.5 minutes)
        this.maxThinkMs = 30 * 1000;
        // Only start boosting when the evaluation deficit (pawns) exceeds this
        this.deficitThreshold = 3.0;
        // Controls how quickly the boost grows once past the threshold
        this.scaleFactor = 3.0;
    }

    getSearchDepth(difficulty) {
        switch (difficulty) {
            case 'easy':
                return 1;
            case 'medium':
                return 2;
            case 'hard':
                return 3;
            case 'expert':
                return 4;
            default:
                return 2;
        }
    }

    // Time limits per difficulty (ms) used by iterative deepening
    getTimeLimits() {
        return {
            easy: 150,
            medium: 500,
            hard: 1200,
            expert: 3000,
        };
    }

    // Main AI move selection - takes a ChessEngine instance
    async getBestMove(engine) {
        this.positionEvaluations = 0;
        const startTime = Date.now();
        this.transpositionTable.clear(); // clear cache between top-level searches

        // Base time for this difficulty
        const baseTimeLimit = this.timeLimits[this.difficulty] || 500;

        // Compute a slow, bounded boost if the engine is significantly behind.
        // Use the evaluation (positive = good for engine). Only boost when
        // deficit > deficitThreshold. Growth is smoothed with a sigmoid.
        let timeLimit = baseTimeLimit;
        try {
            const evalScore = this.evaluatePosition(engine);
            const deficit = Math.max(0, -evalScore);
            if (deficit > this.deficitThreshold) {
                const x = (deficit - this.deficitThreshold) / this.scaleFactor;
                const sigmoid = 1 / (1 + Math.exp(-x));
                const maxScale = Math.max(1, this.maxThinkMs / baseTimeLimit);
                const scale = 1 + sigmoid * (maxScale - 1);
                timeLimit = Math.min(
                    this.maxThinkMs,
                    Math.round(baseTimeLimit * scale)
                );
            }
        } catch (e) {
            // If evaluation fails for any reason, fall back to base timeLimit
            timeLimit = baseTimeLimit;
        }

        const allMoves = engine.getAllMoves(engine.currentTurn);

        if (allMoves.length === 0) {
            return null; // No legal moves
        }

        // Single move - just return it
        if (allMoves.length === 1) {
            return allMoves[0];
        }

        let bestMove = null;
        let bestScore = -Infinity;

        // Iterative deepening from depth 1..searchDepth so earlier iterations
        // help populate the transposition table and improve move ordering.
        for (let depth = 1; depth <= this.searchDepth; depth++) {
            // Order top-level moves for better pruning (don't shuffle here)
            this.orderMoves(allMoves, engine);

            let alpha = -Infinity;
            let beta = Infinity;
            let localBest = null;
            let localBestScore = -Infinity;

            for (let i = 0; i < allMoves.length; i++) {
                const move = allMoves[i];

                // Yield to browser occasionally to avoid freezing
                if (i > 0 && i % 4 === 0) await this.yield();

                // Time cutoff: if exceeded, return best from last completed depth
                if (Date.now() - startTime > timeLimit) {
                    return bestMove || localBest;
                }

                const snapshot = engine.makeMoveUnsafe(
                    move.fromRow,
                    move.fromCol,
                    move.toRow,
                    move.toCol
                );
                const score = -this.minimax(
                    engine,
                    depth - 1,
                    -beta,
                    -alpha,
                    false
                );
                engine.undoMove(snapshot);

                if (score > localBestScore) {
                    localBestScore = score;
                    localBest = move;
                }

                alpha = Math.max(alpha, score);
            }

            // If we completed this depth, accept the local best as current best
            if (localBest) {
                bestMove = localBest;
                bestScore = localBestScore;
            }
        }

        const elapsed = Date.now() - startTime;
        // Development logging removed: keep production quiet

        return bestMove;
    }

    // Helper to yield control back to browser
    yield() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Negamax algorithm with alpha-beta pruning (returns score for side to move)
    minimax(engine, depth, alpha, beta) {
        this.positionEvaluations++;

        // Simple transposition-table lookup keyed by position + depth
        const key = this.engineKey(engine) + '|' + depth;
        const cached = this.transpositionTable.get(key);
        if (cached !== undefined) return cached;

        // Reached depth limit
        if (depth === 0) {
            const evalScore = this.evaluatePosition(engine);
            this.transpositionTable.set(key, evalScore);
            return evalScore;
        }

        const moves = engine.getAllMoves(engine.currentTurn);

        // No legal moves - checkmate or stalemate
        if (moves.length === 0) {
            if (engine.isInCheck(engine.currentTurn)) {
                // Current side to move is checkmated => very negative
                return -100000;
            }
            // Stalemate - draw
            return 0;
        }

        // Order moves for better pruning - captures and center moves first
        this.orderMoves(moves, engine);

        let bestScore = -Infinity;
        for (const move of moves) {
            const snapshot = engine.makeMoveUnsafe(
                move.fromRow,
                move.fromCol,
                move.toRow,
                move.toCol
            );
            const score = -this.minimax(engine, depth - 1, -beta, -alpha);
            engine.undoMove(snapshot);

            if (score > bestScore) bestScore = score;
            alpha = Math.max(alpha, score);
            if (alpha >= beta) break; // cutoff
        }

        this.transpositionTable.set(key, bestScore);
        return bestScore;
    }

    // Order moves to improve alpha-beta pruning effectiveness
    orderMoves(moves, engine) {
        // MVV-LVA + promotion + center heuristic
        moves.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            const fromA =
                engine.board[a.fromRow] && engine.board[a.fromRow][a.fromCol];
            const fromB =
                engine.board[b.fromRow] && engine.board[b.fromRow][b.fromCol];

            const targetA =
                engine.board[a.toRow] && engine.board[a.toRow][a.toCol];
            const targetB =
                engine.board[b.toRow] && engine.board[b.toRow][b.toCol];

            // Capture priority using victim value minus attacker value (MVV-LVA)
            if (targetA && fromA) {
                const victimVal = this.getPieceValue(
                    targetA.piece,
                    a.toRow,
                    a.toCol,
                    targetA.color
                );
                const attackerVal = this.getPieceValue(
                    fromA.piece,
                    a.fromRow,
                    a.fromCol,
                    fromA.color
                );
                scoreA += 100 + (victimVal - attackerVal);
            }
            if (targetB && fromB) {
                const victimVal = this.getPieceValue(
                    targetB.piece,
                    b.toRow,
                    b.toCol,
                    targetB.color
                );
                const attackerVal = this.getPieceValue(
                    fromB.piece,
                    b.fromRow,
                    b.fromCol,
                    fromB.color
                );
                scoreB += 100 + (victimVal - attackerVal);
            }

            // Promotion priority (if attacker is promotable pawn moving to promotion rank)
            if (fromA && fromA.piece && fromA.piece.promotionRank !== -1) {
                const promoRank = fromA.color === 'white' ? 0 : 7;
                if (a.toRow === promoRank) scoreA += 80;
            }
            if (fromB && fromB.piece && fromB.piece.promotionRank !== -1) {
                const promoRank = fromB.color === 'white' ? 0 : 7;
                if (b.toRow === promoRank) scoreB += 80;
            }

            // Center control heuristic
            const centerDistA =
                Math.abs(3.5 - a.toRow) + Math.abs(3.5 - a.toCol);
            const centerDistB =
                Math.abs(3.5 - b.toRow) + Math.abs(3.5 - b.toCol);
            scoreA += (7 - centerDistA) * 0.5;
            scoreB += (7 - centerDistB) * 0.5;

            return scoreB - scoreA;
        });
    }

    // Evaluate the current board position - takes ChessEngine instance
    evaluatePosition(engine) {
        const currentPlayer = engine.currentTurn;
        let score = 0;
        let ourMoveCount = 0;
        let theirMoveCount = 0;

        // Material count and positional evaluation
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = engine.board[row][col];
                if (square) {
                    const pieceValue = this.getPieceValue(
                        square.piece,
                        row,
                        col,
                        square.color
                    );
                    if (square.color === currentPlayer) {
                        score += pieceValue;
                        // Approximate move count instead of calling getAllMoves
                        ourMoveCount += this.estimateMobility(square.piece);
                    } else {
                        score -= pieceValue;
                        theirMoveCount += this.estimateMobility(square.piece);
                    }
                }
            }
        }

        // Mobility bonus (estimated instead of exact)
        score += (ourMoveCount - theirMoveCount) * 0.05;

        return score;
    }

    // Estimate piece mobility without generating all moves
    estimateMobility(piece) {
        let mobility = 0;
        for (const move of piece.moves) {
            if (move.distance === -1) {
                mobility += 7; // Long range pieces
            } else {
                mobility += move.distance;
            }
        }
        return mobility * 0.1;
    }

    // Get piece value based on its characteristics
    getPieceValue(piece, row, col, color) {
        let value = 0;

        // Royal piece is invaluable
        if (piece.royal) {
            return 10000;
        }

        // Base value on move capabilities
        for (const move of piece.moves) {
            // Long range moves are valuable
            if (move.distance === -1) {
                value += 3;
            } else {
                value += move.distance * 0.5;
            }

            // Multiple directions increase value
            const steps = move.getSteps();
            value += steps.length * 0.3;

            // Capture ability
            if (move.capture === 'allowed' || move.capture === 'required') {
                value += 0.5;
            }
        }

        // Promotion potential (account for piece color so pawns are valued correctly)
        if (piece.promotionPieces && piece.promotionPieces.length > 0) {
            // For choice promotions (pawns), promotion rank depends on the pawn's color:
            // white promotes on rank 0, black on rank 7. Use color to compute distance.
            const promotionTargetRank = color === 'white' ? 0 : 7;
            const distanceToPromotion = Math.abs(row - promotionTargetRank);
            value += 1; // Base pawn value
            if (distanceToPromotion < 3) {
                value += (3 - distanceToPromotion) * 0.5; // Closer to promotion = more valuable
            }
        }

        // Positional bonus - favor center control
        const centerDistance = Math.abs(3.5 - row) + Math.abs(3.5 - col);
        value += (7 - centerDistance) * 0.1;

        return value;
    }

    // Utility: Shuffle array in place
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    // Lightweight engine position key for transposition table
    engineKey(engine) {
        let s = engine.currentTurn[0];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = engine.board[r][c];
                if (!cell) {
                    s += '.';
                } else {
                    // piece name, color initial and moved flag
                    s += `|${cell.piece.name}:${cell.color[0]}:${
                        cell.hasMoved ? '1' : '0'
                    }`;
                }
            }
        }
        // include lastMove to disambiguate en-passant states
        if (engine.lastMove)
            s += `:lm:${engine.lastMove.fromRow},${engine.lastMove.fromCol},${engine.lastMove.toRow},${engine.lastMove.toCol}`;
        return s;
    }
}

// Attach to window for backwards compatibility and export as ES module
try {
    if (typeof window !== 'undefined') {
        window.ChessAI = ChessAI;
    }
} catch (e) {
    /* ignore in non-browser env */
}

export { ChessAI };
