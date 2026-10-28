// ─── OPENING REPERTOIRES ───────────────────────────────────────────────────────
// Lines the Opening Trainer (openings.html) drills. Each repertoire is played
// from one side; its lines share prefixes and form a tree in which every
// position where it's your move has exactly ONE repertoire move (the opponent
// may branch). Moves are SAN; a {comment} after one of YOUR moves is shown when
// it is taught or missed. tests/openings.js checks every line is legal, the
// one-move rule holds and no move of yours is an engine-judged blunder.
// Line ids are stored with your progress — never renumber them.
const OPENING_REPERTOIRES = [
    {
        id: 'italian', name: 'Italian Game', color: 'white', first: 'e4',
        blurb: '1.e4 e5 2.Nf3 Nc6 3.Bc4 — quick development, aim at f7, castle early. Includes answers to the Philidor, Petrov and a classic trap.',
        lines: [
            { id: 'it1', name: 'Giuoco Pianissimo',
              moves: 'e4 {Takes the centre and opens lines for the queen and bishop.} e5 Nf3 {Develops and attacks the e5 pawn.} Nc6 Bc4 {The Italian bishop aims at f7, the weakest square near Black\'s king.} Bc5 c3 {Prepares d4 and gives the bishop a retreat on c2 later.} Nf6 d3 {Quiet and solid: protects e4 without committing.} d6 O-O {King to safety first.} O-O Re1 {Backs up the e4 pawn and the e-file.} a6 Bb3 {Steps away from ...b5 and ...Na5 before they come with tempo.} Ba7 Nbd2 {The knight heads for f1 and g3 — the standard Italian manoeuvre.}' },
            { id: 'it2', name: 'Two Knights: 4.d3',
              moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 {Defends e4 calmly — no need to enter the sharp 4.Ng5 lines.} Be7 O-O O-O Re1 {Supports e4; the rook belongs on the e-file.} d6 c3 {Prepares d4 and a bishop retreat to c2.}' },
            { id: 'it3', name: 'Two Knights: 4...Bc5',
              moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 {Same plan as the Giuoco Piano: c3, castle, then d4 when ready.} d6 O-O O-O Bb3 {Pre-empts ...Na5 hitting the bishop.}' },
            { id: 'it4', name: 'Blackburne Shilling trap',
              moves: 'e4 e5 Nf3 Nc6 Bc4 Nd4 Nxd4 {The simple answer. (4.Nxe5 is fine too, but after 4...Qg5 the greedy 5.Nxf7?? Qxg2 is the famous trap.)} exd4 O-O {Castle; the d4 pawn is weak and you are ahead in development.} Bc5 c3 {Opens the c-file and challenges the d4 pawn.}' },
            { id: 'it5', name: 'Philidor Defense',
              moves: 'e4 e5 Nf3 d6 d4 {Strike the centre at once while Black is passive.} exd4 Nxd4 {Recapture with the knight — it dominates the centre.} Nf6 Nc3 {Develop and protect e4.} Be7 Be2 O-O O-O {A free, comfortable position with more space.}' },
            { id: 'it6', name: 'Petrov Defense',
              moves: 'e4 e5 Nf3 Nf6 Nxe5 {Take the pawn — Black must not copy you.} d6 Nf3 {Retreat; the knight was attacked.} Nxe4 d4 {Grab the centre; the e4 knight will have to retreat or be supported.} d5 Bd3 {Develops with pressure on the e4 knight.} Nc6 O-O Be7 c4 {Hits d5 to undermine the e4 knight\'s support.}' },
            { id: 'it7', name: 'Petrov: 3...Nxe4? trap',
              moves: 'e4 e5 Nf3 Nf6 Nxe5 Nxe4 Qe2 {Pins along the e-file — if 4...Nf6?? 5.Nc6+ wins the queen with a discovered check.} Qe7 Qxe4 {Win back the pawn — the knight on e5 is defended tactically.} d6 d4 {Defend the knight; after the trades you stay a pawn up.} dxe5 dxe5 {White is a clean pawn up.}' },
        ],
    },
    {
        id: 'london', name: 'London System', color: 'white', first: 'd4',
        blurb: '1.d4 and 2.Bf4 — the same solid setup (e3, c3, Nf3, Bd3, Nbd2) against almost everything. Few lines to learn.',
        lines: [
            { id: 'lo1', name: 'Main line vs ...d5',
              moves: 'd4 {Takes the centre with a pawn the queen protects.} d5 Bf4 {The London bishop comes out BEFORE e3 shuts it in.} Nf6 e3 {Builds the pawn triangle d4–e3–c3.} e6 Nf3 c5 c3 {Keeps the d4 pawn strong when it is challenged.} Nc6 Nbd2 {Supports e4 and keeps c3 free for the pawn.} Bd6 Bg3 {Avoid ...Bxf4 exf4; keep the bishop and the structure.} O-O Bd3 {Bishop to its best diagonal, aiming at h7.}' },
            { id: 'lo2', name: 'vs ...c5 and ...Qb6',
              moves: 'd4 d5 Bf4 c5 e3 {Stay calm and keep the setup.} Nc6 c3 {Solid support for d4.} Qb6 Qb3 {Meet the queen with the queen — b2 is defended.} c4 Qxb6 {Trade queens; Black\'s a-file pawns are doubled.} axb6 Na3 {The knight eyes b5 and the weakened queenside.}' },
            { id: 'lo3', name: 'vs symmetrical ...Bf5',
              moves: 'd4 d5 Bf4 Nf6 e3 Bf5 Nf3 e6 Bd3 {Offer the trade of light-squared bishops.} Bxd3 Qxd3 {The queen recaptures and is well placed.} Bd6 Bxd6 {Trade the opponent\'s good bishop.} Qxd6 Nbd2 {Prepare e4 to open the centre.}' },
            { id: 'lo4', name: 'vs 1...Nf6 and ...g6',
              moves: 'd4 Nf6 Bf4 {Same setup against a King\'s Indian set-up.} g6 e3 Bg7 Nf3 O-O Be2 {Modest but solid; the bishop protects the kingside.} d6 h3 {Gives the f4 bishop a home on h2 and stops ...Nh5 / ...Bg4 ideas.}' },
            { id: 'lo5', name: 'vs 1...Nf6 and ...e6',
              moves: 'd4 Nf6 Bf4 e6 e3 c5 c3 {The same pawn triangle.} Nc6 Nd2 {Knight to d2 first keeps f3 open for the other knight.} d5 Ngf3 Bd6 Bg3 {Keep the bishop when Black offers the trade.} O-O Bd3' },
        ],
    },
    {
        id: 'caro', name: 'Caro-Kann Defense', color: 'black', first: 'e4',
        blurb: '1.e4 c6 — solid and sound: ...d5 next, the light-squared bishop gets out before ...e6. Answers to every main White try.',
        lines: [
            { id: 'ck1', name: 'Advance: Short System',
              moves: 'e4 c6 {Prepares ...d5 with pawn support.} d4 d5 {Challenge the centre at once.} e5 Bf5 {The bishop gets out BEFORE ...e6 locks it in.} Nf3 e6 {Now the pawn chain is solid.} Be2 c5 {Hit the base of White\'s chain.} O-O Nc6 {Pile up on d4.}' },
            { id: 'ck2', name: 'Advance: 4.Nc3 and g4',
              moves: 'e4 c6 d4 d5 e5 Bf5 Nc3 e6 g4 Bg6 {The bishop stays on its diagonal.} Nge2 c5 {Counter-attack the centre while White pushes on the kingside.}' },
            { id: 'ck3', name: 'Classical: 3.Nc3',
              moves: 'e4 c6 d4 d5 Nc3 dxe4 {Give up the centre to free your pieces.} Nxe4 Bf5 {Develop with tempo on the e4 knight.} Ng3 Bg6 h4 h6 {Make room so h5 doesn\'t trap the bishop.} Nf3 Nd7 {Stops Ne5 and prepares ...Ngf6.} h5 Bh7 Bd3 Bxd3 {Trade the bishop that White chased.} Qxd3 e6' },
            { id: 'ck4', name: 'Classical: 3.Nd2',
              moves: 'e4 c6 d4 d5 Nd2 dxe4 Nxe4 Bf5 Ng3 Bg6 Nf3 Nd7 {Same set-up: ...Nd7, ...Ngf6, ...e6.}' },
            { id: 'ck5', name: 'Exchange Variation',
              moves: 'e4 c6 d4 d5 exd5 cxd5 {Recapture with the c-pawn — symmetrical and solid.} Bd3 Nc6 {Pressure on d4.} c3 Nf6 Bf4 Bg4 {Develop the bishop actively before ...e6.} Qb3 Qd7 {Defend b7 and connect.} Nd2 e6' },
            { id: 'ck6', name: 'Panov Attack',
              moves: 'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 {Develop and hit d5 back.} Nc3 e6 {Solid: support d5, open the bishop.} Nf3 Be7 cxd5 Nxd5 {Recapture with the knight; aim for an IQP middlegame.}' },
            { id: 'ck7', name: 'Two Knights Attack',
              moves: 'e4 c6 Nc3 d5 Nf3 Bg4 {Pin the knight that guards e5 and d4.} h3 Bxf3 {Give the bishop for the knight — easy development.} Qxf3 e6 {Solid centre; ...Nf6 and ...Be7 follow.}' },
        ],
    },
    {
        id: 'qgd', name: 'Queen\'s Gambit Declined', color: 'black', first: 'd4',
        blurb: '1.d4 d5 and ...e6 — the classic solid defence: hold the centre, develop, castle. Lines against the Queen\'s Gambit, the Catalan and the London.',
        lines: [
            { id: 'qg1', name: 'Tartakower: 7.Bh4',
              moves: 'd4 d5 {Claim the centre too.} c4 e6 {Decline: d5 stays firmly supported.} Nc3 Nf6 Bg5 Be7 {Unpin first.} e3 O-O Nf3 h6 {Ask the bishop a question.} Bh4 b6 {The Tartakower: the c8 bishop goes to b7.}' },
            { id: 'qg2', name: '7.Bxf6',
              moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bxf6 Bxf6 {Recapture with the bishop — you have the bishop pair.}' },
            { id: 'qg3', name: 'Exchange Variation',
              moves: 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 {Recapture with the e-pawn: your c8 bishop is free now.} Bg5 c6 {Support d5; the queen can go to b6 or a5.} e3 Be7 Bd3 Nbd7 {Unpins with ...Nf8 ideas later.}' },
            { id: 'qg4', name: '3.Nf3 move order',
              moves: 'd4 d5 c4 e6 Nf3 Nf6 Nc3 Be7 {Same set-up as against 3.Nc3.} Bg5 O-O e3 h6 Bh4 b6' },
            { id: 'qg5', name: 'Open Catalan',
              moves: 'd4 d5 c4 e6 Nf3 Nf6 g3 Be7 Bg2 O-O O-O dxc4 {Take the pawn — White must spend time to win it back.} Qc2 a6 {Prepare ...b5 to hold the pawn for a while.}' },
            { id: 'qg6', name: 'vs the London',
              moves: 'd4 d5 Bf4 Nf6 e3 c5 {Strike at d4 before White plays c3 comfortably.} c3 Nc6 Nd2 e6 Ngf3 Bd6 {Challenge the London bishop.} Bg3 O-O' },
        ],
    },
];

// 'e4 {note} e5 Nf3' -> [{ san: 'e4', note: 'note' }, { san: 'e5', note: null }, ...]
function parseOpeningLine(text) {
    const out = [];
    for (const token of text.match(/\{[^}]*\}|[^\s{}]+/g) || []) {
        if (token.startsWith('{')) { if (out.length) out[out.length - 1].note = token.slice(1, -1).trim(); }
        else out.push({ san: token, note: null });
    }
    return out;
}

// How a game's opening compares with your repertoires for `color` (the review
// page's repertoire note). Picks the repertoire whose lines follow the game the
// longest and says where the game left it:
//   kind 'you'      — you played something else at `ply`; `expected` = the repertoire move
//   kind 'opponent' — the opponent's move at `ply` isn't covered; `expected` = the replies it covers
//   kind 'end'      — you played a whole line (`line`) to its end
//   kind 'inside'   — the game ended while still in the repertoire
// `rep` is null (and `expected` lists every repertoire's first move) when the
// game left all of them on move 1. Returns null for an empty game.
function repertoireCheck(sanMoves, color) {
    const bare = (s) => String(s).replace(/[+#!?]/g, '');
    const game = sanMoves.map(bare);
    if (!game.length) return null;
    const userParity = color === 'white' ? 0 : 1;
    let best = null;
    for (const rep of OPENING_REPERTOIRES) {
        if (rep.color !== color) continue;
        const lines = rep.lines.map(line => ({ line, moves: parseOpeningLine(line.moves).map(m => bare(m.san)) }));
        let n = 0;
        for (const l of lines) {
            let k = 0;
            while (k < l.moves.length && k < game.length && l.moves[k] === game[k]) k++;
            n = Math.max(n, k);
        }
        if (!best || n > best.n) best = { rep, lines, n };
    }
    if (!best) return null;
    const { n } = best;
    const kindAt = (ply) => (ply % 2 === userParity ? 'you' : 'opponent');
    if (n === 0) {
        const firsts = OPENING_REPERTOIRES.filter(r => r.color === color).map(r => parseOpeningLine(r.lines[0].moves)[0].san);
        return { rep: null, ply: 0, kind: kindAt(0), played: sanMoves[0], expected: [...new Set(firsts)], line: null };
    }
    const matching = best.lines.filter(l => l.moves.slice(0, n).every((m, i) => m === game[i]));
    const finished = matching.find(l => l.moves.length === n);
    if (finished) return { rep: best.rep, ply: n - 1, kind: 'end', played: null, expected: [], line: finished.line };
    if (n >= game.length) return { rep: best.rep, ply: n - 1, kind: 'inside', played: null, expected: [], line: matching[0].line };
    const expected = [...new Set(matching.map(l => l.moves[n]))];
    const line = matching.find(l => l.moves[n] === expected[0]).line;
    return { rep: best.rep, ply: n, kind: kindAt(n), played: sanMoves[n], expected, line };
}
