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
            case 'easy': return 2;
            case 'medium': return 3;
            case 'hard': return 4;
            case 'expert': return 5;
            default: return 3;
        }
    }

    // Main AI move selection - takes a ChessEngine instance
    getBestMove(engine) {
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

        for (const move of allMoves) {
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
    }

    // Minimax algorithm with alpha-beta pruning - takes ChessEngine instance
    minimax(engine, depth, alpha, beta, isMaximizing) {
        this.positionEvaluations++;

        // Check for game over
        if (engine.isGameOver()) {
            return isMaximizing ? -100000 : 100000; // Lost the game
        }

        // Reached depth limit
        if (depth === 0) {
            return this.evaluatePosition(engine);
        }

        const moves = engine.getAllMoves(engine.currentTurn);

        // No legal moves (stalemate or checkmate)
        if (moves.length === 0) {
            return 0; // Draw
        }

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

    // Evaluate the current board position - takes ChessEngine instance
    evaluatePosition(engine) {
        const currentPlayer = engine.currentTurn;
        let score = 0;

        // Material count and positional evaluation
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = engine.board[row][col];
                if (square) {
                    const pieceValue = this.getPieceValue(square.piece, row, col);
                    score += square.color === currentPlayer ? pieceValue : -pieceValue;
                }
            }
        }

        // Mobility bonus (number of legal moves)
        const ourMoves = engine.getAllMoves(currentPlayer).length;
        const opponentColor = currentPlayer === 'white' ? 'black' : 'white';
        const theirMoves = engine.getAllMoves(opponentColor).length;
        score += (ourMoves - theirMoves) * 0.1;

        return score;
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
