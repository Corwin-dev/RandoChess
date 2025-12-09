// ===== Chess AI Engine =====
// Uses ChessEngine for game logic

class ChessAI {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty;
        this.searchDepth = this.getSearchDepth(difficulty);
        this.positionEvaluations = 0; // For debugging
    }

    getSearchDepth(difficulty) {
        switch(difficulty) {
            case 'easy': return 1;
            case 'medium': return 2;
            case 'hard': return 3;
            case 'expert': return 4;
            default: return 2;
        }
    }

    // Main AI move selection - takes a ChessEngine instance
    async getBestMove(engine) {
        // ============================================================
        // DEBUG: RANDOM MOVES - REMOVE THIS BEFORE PRODUCTION
        // ============================================================
        const allMoves = engine.getAllMoves(engine.currentTurn);
        if (allMoves.length === 0) return null;
        return allMoves[Math.floor(Math.random() * allMoves.length)];
        // ============================================================
        // END DEBUG - RESTORE ORIGINAL AI LOGIC BELOW
        // ============================================================
        
        /* ORIGINAL AI LOGIC - COMMENTED OUT FOR DEBUG
        this.positionEvaluations = 0;
        const startTime = Date.now();
        
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
        let alpha = -Infinity;
        let beta = Infinity;

        // Shuffle moves for variety at same evaluation
        this.shuffleArray(allMoves);

        for (let i = 0; i < allMoves.length; i++) {
            const move = allMoves[i];
            
            // Yield to browser every few moves to prevent freezing
            if (i > 0 && i % 3 === 0) {
                await this.yield();
            }
            
            // Make move on a copy of the engine
            const engineCopy = engine.clone();
            engineCopy.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
            
            // Evaluate position (opponent's turn, so we minimize)
            const score = -this.minimax(engineCopy, this.searchDepth - 1, -beta, -alpha, false);
            
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
            
            alpha = Math.max(alpha, score);
        }

        const elapsed = Date.now() - startTime;
        console.log(`AI evaluated ${this.positionEvaluations} positions in ${elapsed}ms`);
        console.log(`Best move score: ${bestScore}`);
        
        return bestMove;
        */
    }

    // Helper to yield control back to browser
    yield() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    // Minimax algorithm with alpha-beta pruning - takes ChessEngine instance
    minimax(engine, depth, alpha, beta, isMaximizing) {
        this.positionEvaluations++;

        // Reached depth limit
        if (depth === 0) {
            return this.evaluatePosition(engine);
        }

        const moves = engine.getAllMoves(engine.currentTurn);

        // No legal moves - checkmate or stalemate
        if (moves.length === 0) {
            if (engine.isInCheck(engine.currentTurn)) {
                // Checkmate - losing position
                return isMaximizing ? -100000 : 100000;
            }
            // Stalemate - draw
            return 0;
        }

        // Order moves for better pruning - captures and center moves first
        this.orderMoves(moves, engine);

        if (isMaximizing) {
            let maxScore = -Infinity;
            for (const move of moves) {
                const engineCopy = engine.clone();
                engineCopy.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
                const score = this.minimax(engineCopy, depth - 1, alpha, beta, false);
                maxScore = Math.max(maxScore, score);
                alpha = Math.max(alpha, score);
                if (beta <= alpha) break; // Beta cutoff
            }
            return maxScore;
        } else {
            let minScore = Infinity;
            for (const move of moves) {
                const engineCopy = engine.clone();
                engineCopy.makeMove(move.fromRow, move.fromCol, move.toRow, move.toCol);
                const score = this.minimax(engineCopy, depth - 1, alpha, beta, true);
                minScore = Math.min(minScore, score);
                beta = Math.min(beta, score);
                if (beta <= alpha) break; // Alpha cutoff
            }
            return minScore;
        }
    }

    // Order moves to improve alpha-beta pruning effectiveness
    orderMoves(moves, engine) {
        moves.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            // Prioritize captures
            const targetA = engine.board[a.toRow][a.toCol];
            const targetB = engine.board[b.toRow][b.toCol];
            if (targetA) scoreA += 10;
            if (targetB) scoreB += 10;

            // Prioritize center moves
            const centerDistA = Math.abs(3.5 - a.toRow) + Math.abs(3.5 - a.toCol);
            const centerDistB = Math.abs(3.5 - b.toRow) + Math.abs(3.5 - b.toCol);
            scoreA += (7 - centerDistA);
            scoreB += (7 - centerDistB);

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
                    const pieceValue = this.getPieceValue(square.piece, row, col);
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
    getPieceValue(piece, row, col) {
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

        // Promotion potential
        if (piece.promotionPieces && piece.promotionPieces.length > 0) {
            const distanceToPromotion = Math.abs(row - piece.promotionRank);
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
}
