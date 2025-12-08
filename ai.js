// ===== Chess AI Engine =====

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

    // Main AI move selection
    getBestMove(gameBoard) {
        this.positionEvaluations = 0;
        const startTime = Date.now();
        
        const allMoves = this.getAllPossibleMoves(gameBoard, gameBoard.currentTurn);
        
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
            // Make move on a copy of the board
            const boardCopy = this.copyBoard(gameBoard);
            this.applyMove(boardCopy, move);
            
            // Evaluate position (opponent's turn, so we minimize)
            const score = -this.minimax(boardCopy, this.searchDepth - 1, -beta, -alpha, false);
            
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

    // Minimax algorithm with alpha-beta pruning
    minimax(gameBoard, depth, alpha, beta, isMaximizing) {
        this.positionEvaluations++;

        // Check for game over
        if (this.isGameOver(gameBoard)) {
            return isMaximizing ? -100000 : 100000; // Lost the game
        }

        // Reached depth limit
        if (depth === 0) {
            return this.evaluatePosition(gameBoard);
        }

        const currentPlayer = gameBoard.currentTurn;
        const moves = this.getAllPossibleMoves(gameBoard, currentPlayer);

        // No legal moves (stalemate or checkmate)
        if (moves.length === 0) {
            return 0; // Draw
        }

        if (isMaximizing) {
            let maxScore = -Infinity;
            for (const move of moves) {
                const boardCopy = this.copyBoard(gameBoard);
                this.applyMove(boardCopy, move);
                const score = this.minimax(boardCopy, depth - 1, alpha, beta, false);
                maxScore = Math.max(maxScore, score);
                alpha = Math.max(alpha, score);
                if (beta <= alpha) break; // Beta cutoff
            }
            return maxScore;
        } else {
            let minScore = Infinity;
            for (const move of moves) {
                const boardCopy = this.copyBoard(gameBoard);
                this.applyMove(boardCopy, move);
                const score = this.minimax(boardCopy, depth - 1, alpha, beta, true);
                minScore = Math.min(minScore, score);
                beta = Math.min(beta, score);
                if (beta <= alpha) break; // Alpha cutoff
            }
            return minScore;
        }
    }

    // Evaluate the current board position
    evaluatePosition(gameBoard) {
        const currentPlayer = gameBoard.currentTurn;
        let score = 0;

        // Material count and positional evaluation
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = gameBoard.board[row][col];
                if (square) {
                    const pieceValue = this.getPieceValue(square.piece, row, col);
                    score += square.color === currentPlayer ? pieceValue : -pieceValue;
                }
            }
        }

        // Mobility bonus (number of legal moves)
        const ourMoves = this.getAllPossibleMoves(gameBoard, currentPlayer).length;
        const opponentColor = currentPlayer === 'white' ? 'black' : 'white';
        const theirMoves = this.getAllPossibleMoves(gameBoard, opponentColor).length;
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

    // Get all possible moves for a player
    getAllPossibleMoves(gameBoard, color) {
        const moves = [];
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = gameBoard.board[row][col];
                if (square && square.color === color) {
                    const pieceMoves = this.getMovesForPiece(gameBoard, row, col);
                    moves.push(...pieceMoves);
                }
            }
        }
        
        return moves;
    }

    // Get moves for a specific piece (similar to game.js getValidMoves but returns move objects)
    getMovesForPiece(gameBoard, row, col) {
        const moves = [];
        const square = gameBoard.board[row][col];
        if (!square) return moves;

        const piece = square.piece;
        const color = square.color;
        const direction = color === 'white' ? -1 : 1;

        for (const move of piece.moves) {
            if (move.requiresUnmoved && square.hasMoved) continue;

            const steps = move.getSteps();
            for (const [dx, dy] of steps) {
                // Adjust dy for piece color (pawns move forward relative to their side)
                const adjustedDy = dy * direction;

                const maxDist = move.distance === -1 ? 8 : move.distance;

                for (let dist = 1; dist <= maxDist; dist++) {
                    const newRow = row + adjustedDy * dist;
                    const newCol = col + dx * dist;

                    if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;

                    const targetSquare = gameBoard.board[newRow][newCol];
                    const isEmpty = !targetSquare;
                    const isEnemy = targetSquare && targetSquare.color !== color;

                    // Handle jump logic
                    if (dist > 1 && move.jump === 'prohibited') {
                        if (!isEmpty) break; // Can't jump, stop here
                    }
                    if (dist > 1 && move.jump === 'required') {
                        if (!isEmpty) break; // Must jump, but something is in the way
                        continue; // Keep going, can't land on intermediate squares
                    }

                    // Capture logic
                    const canCapture = move.capture === 'allowed' || move.capture === 'required';
                    const mustCapture = move.capture === 'required';
                    const cannotCapture = move.capture === 'prohibited';

                    if (isEnemy && canCapture) {
                        moves.push({ fromRow: row, fromCol: col, toRow: newRow, toCol: newCol });
                        break; // Can't move further after capture
                    }

                    if (isEmpty && !mustCapture) {
                        moves.push({ fromRow: row, fromCol: col, toRow: newRow, toCol: newCol });
                    }

                    if (!isEmpty) break; // Stop if we hit any piece (friend or foe)
                }
            }
        }

        return moves;
    }

    // Apply a move to the board (modifies the board)
    applyMove(gameBoard, move) {
        const { fromRow, fromCol, toRow, toCol } = move;
        const piece = gameBoard.board[fromRow][fromCol];
        
        // Handle promotion
        if (piece.piece.promotionRank !== -1 && toRow === piece.piece.promotionRank) {
            if (piece.piece.promotionPieces.length > 0) {
                const promotionPiece = piece.piece.promotionPieces[0]; // AI picks first option
                gameBoard.board[toRow][toCol] = {
                    piece: promotionPiece,
                    color: piece.color,
                    hasMoved: true
                };
            } else {
                gameBoard.board[toRow][toCol] = { ...piece, hasMoved: true };
            }
        } else {
            gameBoard.board[toRow][toCol] = { ...piece, hasMoved: true };
        }
        
        gameBoard.board[fromRow][fromCol] = null;
        gameBoard.currentTurn = gameBoard.currentTurn === 'white' ? 'black' : 'white';
    }

    // Check if the game is over (royal piece captured)
    isGameOver(gameBoard) {
        let whiteRoyal = false;
        let blackRoyal = false;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = gameBoard.board[row][col];
                if (square && square.piece.royal) {
                    if (square.color === 'white') whiteRoyal = true;
                    if (square.color === 'black') blackRoyal = true;
                }
            }
        }

        return !whiteRoyal || !blackRoyal;
    }

    // Deep copy the board
    copyBoard(gameBoard) {
        const newBoard = {
            board: Array(8).fill(null).map(() => Array(8).fill(null)),
            currentTurn: gameBoard.currentTurn,
            pieces: gameBoard.pieces
        };

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (gameBoard.board[row][col]) {
                    newBoard.board[row][col] = { ...gameBoard.board[row][col] };
                }
            }
        }

        return newBoard;
    }

    // Utility: Shuffle array in place
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}
