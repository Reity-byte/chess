// ─── ENDGAME LESSONS ───────────────────────────────────────────────────────────
// The endgame trainer's positions (endgames.html). You play the side to move
// against the engine at full strength.
//   goal: 'mate'    — checkmate (a draw of any kind fails)
//         'promote' — promote the pawn safely (the new piece can't be taken at once)
//         'draw'    — hold the draw: a drawn result, or `hold` of your moves without losing
//   par:  fewest moves to mate with best defence (K+Q / K+R: exact, from
//         tools/endgame-tables.js; others: the engine's forced mate) — 3 stars
//         need par plus a little slack. tests/endgames.js checks every number.
//   line: the textbook main line (both sides' moves). While the game follows
//         it, the opponent plays it and hints show it.
//   engineHints: false where the engine doesn't know the technique (it can't
//         see that deep) — off the line, the hint explains the plan instead.
// K+P vs K positions are judged move by move with the exact bitbase
// (endgame-tables.js): a move that throws away the result fails at once.
// Lesson ids are stored in progress — never rename them.
const ENDGAME_CHAPTERS = [
    { id: 'mates', name: 'Basic checkmates', blurb: 'Every winning endgame ends here. Learn to mate the lone king quickly and without stalemating it.' },
    { id: 'pawns', name: 'King and pawn', blurb: 'Opposition, key squares and the square of the pawn — the ideas every other endgame is built on.' },
    { id: 'rooks', name: 'Rook endgames', blurb: 'The most common endgames of all. The two positions every player must know: Lucena and Philidor.' },
];

const ENDGAME_LESSONS = [
    // ── Basic checkmates ──────────────────────────────────────────────────────
    { id: 'm-rr', chapter: 'mates', name: 'Two rooks — the ladder', fen: '8/8/8/3k4/8/8/8/R3K2R w - - 0 1', goal: 'mate', par: 5,
      intro: 'One rook fences the king off along a rank or file; the other gives check one line further in. Take turns and walk the king to the edge. Your own king can stay at home.',
      tip: 'If the king attacks a rook, move that rook far away along the same line — to the other side of the board.' },
    { id: 'm-q', chapter: 'mates', name: 'Queen mate', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', goal: 'mate', par: 7,
      intro: 'Put the queen a knight\'s move away from the enemy king and follow it as it moves — the box gets smaller every time. Once the king is on the edge, bring your own king next to it and mate.',
      tip: 'Before every queen move near the edge, check the king still has a square to go to. No moves and no check is stalemate — a draw.' },
    { id: 'm-r', chapter: 'mates', name: 'Rook mate', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', par: 14,
      intro: 'The rook cuts the king off; your king walks up to it. When the two kings stand face to face, check with the rook to push the king back one line. When they don\'t, make a waiting rook move along its line.',
      tip: 'Keep the rook far from the enemy king so it can\'t be attacked, and shrink the box one line at a time.' },
    { id: 'm-bb', chapter: 'mates', name: 'Two bishops', fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1', goal: 'mate',
      intro: 'Bishops side by side form a wall the king can\'t cross. Push it to the edge with king and bishops together, then into a corner — that\'s where the mate is. You have 50 moves.',
      tip: 'Your king is the third attacker: bring it close, a knight\'s move from the enemy king. Watch out for stalemate in the corner.' },
    { id: 'm-bn', chapter: 'mates', name: 'Bishop and knight', fen: '8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1', goal: 'mate', expert: true, engineHints: false,
      intro: 'The hardest basic mate. It only works in a corner of your bishop\'s colour — a light corner here (a8 or h1). Drive the king to the edge, then along it to a light corner. You have 50 moves.',
      tip: 'If the king hides in a dark corner, keep your king close and let knight and bishop take squares away in turn, pushing it along the edge.' },

    // ── King and pawn ─────────────────────────────────────────────────────────
    { id: 'p-front', chapter: 'pawns', name: 'King in front of the pawn', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', goal: 'promote',
      intro: 'Your king is on the 6th rank in front of its pawn — this always wins. Keep your king ahead of the pawn and shoulder the black king away; push the pawn only when it can\'t be stopped.',
      tip: 'Don\'t rush the pawn: with the king in front, it promotes by itself once the king has cleared the way.' },
    { id: 'p-opp', chapter: 'pawns', name: 'Take the opposition', fen: '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1', goal: 'promote',
      intro: 'Kings facing each other with one square between them: whoever has to move must give way — the other side has the opposition. Walk your king up in front of the pawn, take the opposition, and keep pawn moves in reserve to win a tempo.',
      tip: 'Your king belongs in front of the pawn. Aim for the key squares two ranks ahead of it (d4, e4, f4 for a pawn on e2… and further as it moves).' },
    { id: 'p-square', chapter: 'pawns', name: 'The square of the pawn', fen: '7k/8/8/8/1p6/8/8/5K2 w - - 0 1', goal: 'draw', hold: 10,
      intro: 'Can your king catch the pawn? Draw a square from the pawn to its promotion rank — here b4, e4, e1, b1. If your king can step inside it, the pawn is caught.',
      tip: 'Head straight for the pawn\'s path. Diagonal king moves cover as much ground as straight ones.' },
    { id: 'p-defend', chapter: 'pawns', name: 'Defend with the opposition', fen: '8/4k3/8/3K4/3P4/8/8/8 b - - 0 1', goal: 'draw', hold: 15,
      intro: 'Only a king against king and pawn — but it\'s a draw if you keep the opposition. Stay in front of the pawn, and every time the white king steps forward, face it with one square between you.',
      tip: 'When you have to retreat, go straight back in front of the pawn, not to the side.' },
    { id: 'p-sixth', chapter: 'pawns', name: 'Keep the king off the 6th', fen: '4k3/8/8/4PK2/8/8/8/8 b - - 0 1', goal: 'draw', hold: 15,
      intro: 'If the white king reaches the 6th rank in front of its pawn, the game is lost. Block its way: take the opposition, so the white king can\'t come forward.',
      tip: 'Watch the white king: put yours directly opposite it, two squares away, whenever you can.' },

    // ── Rook endgames ─────────────────────────────────────────────────────────
    { id: 'r-lucena', chapter: 'rooks', name: 'Lucena — build a bridge', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', goal: 'promote',
      line: 'Rd1+ Ke7 Rd4 Ra1 Kc7 Rc1+ Kb6 Rb1+ Kc6 Rc1+ Kb5 Rb1+ Rb4', engineHints: false,
      intro: 'Your pawn is on the 7th but your king stands in front of it, and the rooks keep checking. The winning plan: check the black king one file further away, put your rook on the 4th rank, then walk your king out — when the checks come, block with the rook (the bridge).',
      tip: 'Check the black king one file further away (Rd1+), lift the rook to the 4th rank (Rd4), walk the king out towards the black rook, and block the last check with Rb4.' },
    { id: 'r-philidor', chapter: 'rooks', name: 'Philidor — hold the draw', fen: '4k3/R7/1r6/4PK2/8/8/8/8 b - - 0 1', goal: 'draw', hold: 15,
      line: 'Rc6 e6 Rc1 Kf6 Rf1+ Ke5 Re1+ Kd6 Rd1+ Ke5 Re1+', engineHints: false,
      intro: 'A pawn down, but this is a draw. Keep your king on the promotion square and your rook on the 6th rank, so the white king can\'t come forward. Once the pawn steps to the 6th, the white king has no shelter: drop your rook to the 1st rank and check it from behind.',
      tip: 'Before the pawn moves: wait with the rook along the 6th rank (not where the pawn can take it). After e6: rook to the 1st rank at once, then check the king from behind until it gives up.' },
];
