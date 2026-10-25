// ─── LIVE-GAME ENGINE WORKER ───────────────────────────────────────────────────
// Runs the AI search for game.html off the main thread so the board, clocks and
// animations stay responsive while the engine thinks. The worker mirrors the
// game from its SAN move list: when a request extends the moves it already
// knows, only the new moves are played; anything else (new game, takeback)
// triggers a full replay. Its transposition table survives between moves.
importScripts('engine.js?v=22', 'ai.js?v=22', 'notation.js?v=22');

let knownSAN = [];

function syncTo(sanMoves) {
    const extends_ = sanMoves.length >= knownSAN.length && knownSAN.every((s, i) => s === sanMoves[i]);
    if (!extends_) {
        replaySANFromStart(sanMoves);
    } else {
        for (let i = knownSAN.length; i < sanMoves.length; i++) {
            const r = resolveSAN(currentTurn, sanMoves[i]);
            if (!r) { replaySANFromStart(sanMoves); break; }
            applyMoveWithPromotion(r.move, r.promo);
            recordPosition();
        }
    }
    knownSAN = sanMoves.slice();
}

resetGame();
recordPosition();

self.onmessage = (e) => {
    const d = e.data;
    try {
        if (d.type === 'newGame') {
            clearSearchMemory();
            resetGame();
            recordPosition();
            knownSAN = [];
        } else if (d.type === 'think') {
            syncTo(d.sanMoves);
            const r = findBestMove(currentTurn, d.level, d.sanMoves);
            const m = r.move;
            self.postMessage({
                type: 'move', id: d.id,
                move: m ? { fromX: m.fromX, fromY: m.fromY, toX: m.toX, toY: m.toY, details: m.details } : null,
                promo: r.promo,
            });
        }
    } catch (err) {
        self.postMessage({ type: 'error', id: d.id, message: err.message });
    }
};
