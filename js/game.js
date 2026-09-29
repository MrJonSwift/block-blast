export const GRID = 8;
export const TRAY_SIZE = 3;

/**
 * Bumped to 2 when the shape catalogue was replaced. Shape ids are indexes into
 * the flattened shape table, so every id in a v1 save means a different shape
 * now — a v1 save is discarded and a new run starts rather than restoring a
 * board built out of pieces the game no longer deals.
 */
export const SAVE_VERSION = 2;

/**
 * How many times a stuck tray can be re-dealt before the run is over for good.
 * This is the only thing standing between the player and an unlimited reroll of
 * a bad hand, which is why it is capped rather than unlimited. It costs nothing
 * in score: the run carries on, and the best is still the best.
 */
export const MAX_RESCUES = 3;

/**
 * Shapes are authored as ASCII art, one entry per *family*, and expanded into
 * every distinct rotation and reflection of it. Each variant is then dealt as
 * its own fixed shape: the app never rotates a piece at runtime, so the tray
 * always shows the orientation the player is about to place.
 *
 * The catalogue is deliberately small and nothing is longer than 5 cells. The
 * earlier set was 72 variants, and what made it feel bad was not the variety —
 * it was that awkward shapes (a 3x3, 6-cell rectangles, a 6-cell L, F, Y, the
 * plus and a diagonal Z-staircase) arrived in the same pool as the friendly ones
 * and a tray could hold three of them. There is no size-based difficulty here;
 * the board getting full is the difficulty, and the pool is chosen so that a
 * shape you have not seen before is never worse than the ones you know.
 *
 * Tier 0 is the whole opening experience: all seven tetrominoes (I, O, T, L and
 * J, S and Z), the shorter bars, the 2x2 and the L-tromino, which is 28 variants
 * of nothing harder than four cells. The 5-cell pieces arrive much later. A
 * shape is only as hard as the pocket it goes in, so a piece that has a legal
 * placement is always a piece the player can at least see the place for.
 *
 * `u5` is here rather than in tier 0 because the smallest U is five cells —
 * there is no 4-cell U, and the art that looks like one is the L-tetromino, so
 * naming it `u4` would have claimed a family name for a shape already in the
 * set. Tier boundaries are `0 / 45 / 150` pieces placed.
 */
const SHAPE_DEFS = [
  ['dot', ['#']],

  ['h2', ['##']],

  ['h3', ['###']],

  ['h4', ['####']],

  ['h5', ['#####']],

  ['o2', ['##', '##']],

  ['l3', ['##', '#.']],
  ['l4', ['#..', '###']],
  ['l5', ['#...', '####']],

  ['s4', ['.##', '##.']],

  ['t4', ['###', '.#.']],
  ['t5', ['###', '.#.', '.#.']],

  ['u5', ['#.#', '###']],
];

/** Block colours, indexed 0-based. 0 doubles as "empty" in the board array. */
export const COLORS = [
  '#ff5f6d', // coral
  '#ffa64d', // amber
  '#ffd93d', // lemon
  '#6ee36e', // mint
  '#4ecdc4', // teal
  '#5aa9ff', // azure
  '#9b7bff', // violet
  '#ff7bc6', // pink
];

function variantsOf(rows) {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '#') cells.push([x, y]);
    }
  }
  return { cells, width, height };
}

function keyOf(cells) {
  return cells
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(' ');
}

/** The seeds of a family's full orbit: four rotations, each also mirrored. */
function orbitSeeds(seed) {
  const mirrored = mirror(seed);
  const seeds = [];
  for (const base of [seed, mirrored]) {
    let cells = base;
    for (let turn = 0; turn < 4; turn++) {
      seeds.push(normalise(cells));
      cells = rotate90(cells);
    }
  }
  return seeds;
}

function normalise(cells) {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

function rotate90(cells) {
  return cells.map(([x, y]) => [-y, x]);
}

function mirror(cells) {
  return cells.map(([x, y]) => [-x, y]);
}

/**
 * Expands every family into its full orbit of distinct orientations.
 *
 * This used to try only four transforms (the seed, one rotation, and the two
 * mirrorings of those), which silently lost orientations: the L-tromino and
 * L-tetromino came out as 4 of their 8, so the game contained no J shapes at
 * all, and the U and T lost one each. The mirror of a piece is only a *new*
 * piece if the piece is chiral, so a family has to be rotated all the way round
 * to be sure of what it expands to. `tests/run.js` pins the result.
 */
function buildShapes() {
  const seen = new Set();
  const families = [];
  SHAPE_DEFS.forEach(([name, rows]) => {
    const variants = [];
    for (const cells of orbitSeeds(normalise(variantsOf(rows).cells))) {
      const key = keyOf(cells);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({
        // The family is what the tray caps work on, so two L's of different
        // orientations still count as two of the same family.
        family: name,
        cells,
        width: Math.max(...cells.map((c) => c[0])) + 1,
        height: Math.max(...cells.map((c) => c[1])) + 1,
      });
    }
    families.push({ name, variants });
  });

  // Ids must be positions in the flattened list, since that is how a shape is
  // looked up from a save file.
  families.flatMap((family) => family.variants).forEach((shape, index) => {
    shape.id = index;
  });
  return families;
}

export const SHAPE_FAMILIES = buildShapes();
export const SHAPES = SHAPE_FAMILIES.flatMap((family) => family.variants);
export const SHAPE_COUNT = SHAPES.length;

/**
 * Which shapes exist yet, and how big they are allowed to be.
 *
 * **The stage advances on success, not on time.** The trigger is total lines
 * cleared, so a player who is struggling stays in the friendly tier instead of
 * being handed harder pieces at the exact moment they are struggling, and a
 * player who is clearing regularly unlocks everything early. This is the
 * reverse of the usual argument, which is that gating on score is bad because
 * playing well would raise the stakes. That argument is right for a game about a
 * high score. Here playing well is meant to open things up, not tighten them.
 *
 * It is lines cleared rather than score, because `scoreForPlacement` pays a
 * point per block: a player grinding out 1x1s racks up a score without ever
 * clearing anything, which is the opposite signal.
 *
 * **The board getting full is the other half of the curve.** `sizeCap` below
 * reads how full the board is, and that is the felt difficulty. Because both
 * terms are a function of saved state, a restored game resumes at the right
 * stage and deals the same trays again.
 */
const STAGES = [
  {
    at: 0,
    name: 'Warming up',
    add: ['dot', 'h2', 'h3', 'h4', 'o2', 'l3', 'l4', 's4', 't4'],
  },
  {
    at: 20,
    name: 'Full deck',
    add: ['h5', 'u5'],
  },
  {
    at: 60,
    name: 'Deep deck',
    add: ['t5', 'l5'],
  },
];

/** The stage's shape ids, accumulated in stage order. Frozen; never mutated. */
const STAGE_POOLS = (() => {
  const byName = new Map(SHAPE_FAMILIES.map((family) => [family.name, family.variants]));
  const pools = [];
  const pool = [];
  const seen = new Set();
  for (const stage of STAGES) {
    for (const name of stage.add) {
      for (const variant of byName.get(name) || []) {
        if (seen.has(variant.id)) continue;
        seen.add(variant.id);
        pool.push(variant.id);
      }
    }
    pools.push(Object.freeze([...pool]));
  }
  return Object.freeze(pools);
})();

/** Shape ids available at each stage. Exported so tests can check the ramp. */
export const STAGE_SHAPES = STAGE_POOLS;
export const STAGE_COUNT = STAGES.length;

/**
 * The stage a run is in, from the number of lines cleared so far. Each stage's
 * pool is a superset of the last, so a shape you have never seen is never worse
 * than the ones you know.
 */
export function stageFor(lines) {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (lines >= STAGES[i].at) index = i;
  }
  return index;
}

export function stageNameFor(lines) {
  return STAGES[stageFor(lines)].name;
}

export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How full the board is, 0..1. This is the game's difficulty curve. A crowded
 * board is the hard part, so the deal reacts to it: a roomy board gets the big
 * friendly pieces, a tight one gets small slot-fillers. Measured after a clear,
 * so a good clear buys bigger pieces straight back.
 */
export function boardPressure(board) {
  let filled = 0;
  for (let i = 0; i < board.length; i++) if (board[i]) filled += 1;
  return filled / (GRID * GRID);
}

/**
 * How big a piece is allowed to be right now.
 *
 * Two inputs, and the second is the one that matters. `pressure` is how full the
 * board is, which is the difficulty everyone feels. `sinceClear` is how many
 * pieces have been placed since the last line cleared, which is how the run is
 * *going* — and a board can be roomy while the player is stuck, or tight while
 * they are in a rhythm, so the two are not the same signal.
 *
 * The `sinceClear` term is what makes the ramp breathe in both directions: two
 * notches smaller after six placements with nothing cleared, a notch larger when
 * the player has just cleared on a roomy board. It replaces a `sin(moves/12)`
 * term that could not do this — a clock does not know how anyone is doing — and
 * which, being consulted only in stage 0, was dead code for most of a run.
 */
function sizeCap(stage, pressure, sinceClear) {
  let cap;
  if (stage === 0) {
    if (pressure < 0.3) cap = 4;
    else if (pressure < 0.5) cap = 3;
    else cap = 2;
  } else if (pressure < 0.35) {
    cap = 5;
  } else if (pressure < 0.6) {
    cap = 4;
  } else if (pressure < 0.75) {
    cap = 3;
  } else {
    cap = 2;
  }
  if (sinceClear >= 6) cap -= 2;
  else if (sinceClear >= 3) cap -= 1;
  else if (sinceClear === 0 && pressure < 0.4) cap += 1;
  return Math.max(1, Math.min(5, cap));
}

/** Mixes the run seed with a tray index into a well-spread seed. */
function traySeed(seed, trayIndex) {
  let h = (seed ^ Math.imul(trayIndex + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function createGame(seed = (Math.random() * 0xffffffff) >>> 0) {
  return {
    version: SAVE_VERSION,
    board: new Uint8Array(GRID * GRID),
    tray: new Array(TRAY_SIZE).fill(null),
    score: 0,
    moves: 0,
    // Total lines cleared: what the difficulty ramp is keyed on, because it
    // measures success rather than survival.
    lines: 0,
    // Placements since the last line cleared. Zero means the player is in a
    // rhythm, which is the signal that buys them bigger pieces back.
    sinceClear: 0,
    best: 0,
    rescues: 0,
    seed: seed >>> 0,
    draws: 0,
  };
}

export function createPlayableGame(seed) {
  const game = createGame(seed);
  dealTray(game);
  return game;
}

/**
 * Which shapes in `pool` have a placement that completes a row or a column on
 * `board`, as a Set of shape ids.
 *
 * This is the fix for the one thing that made the game feel like work: only 30%
 * of trays used to contain a piece that cleared a line *right now*, so seven
 * trays in ten handed over nothing to do but set up. A tray that always carries a
 * clear is a tray that always carries a small win.
 *
 * The row and column fill counts are built once and the piece's own cells are
 * tallied per origin, so this is one pass over the pool rather than a full board
 * copy per candidate. Measured at 109–254 microseconds per deal, against 7–23
 * before this scan existed — about ten times the rest of a deal, and still
 * nothing: a deal happens once every three placements, so it is well under a
 * millisecond against a move the player takes a second over.
 */
function clearingShapes(board, pool) {
  const rowFill = new Int8Array(GRID);
  const colFill = new Int8Array(GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (board[y * GRID + x]) {
        rowFill[y] += 1;
        colFill[x] += 1;
      }
    }
  }

  const result = new Set();
  const inRow = new Int8Array(GRID);
  const inCol = new Int8Array(GRID);
  for (const id of pool) {
    const shape = SHAPES[id];
    for (let oy = 0; oy + shape.height <= GRID; oy++) {
      for (let ox = 0; ox + shape.width <= GRID; ox++) {
        inRow.fill(0);
        inCol.fill(0);
        let fits = true;
        for (const [dx, dy] of shape.cells) {
          const x = ox + dx;
          const y = oy + dy;
          if (board[y * GRID + x]) {
            fits = false;
            break;
          }
          inRow[y] += 1;
          inCol[x] += 1;
        }
        if (!fits) continue;
        for (let i = 0; i < GRID; i++) {
          if (inRow[i] && rowFill[i] + inRow[i] === GRID) {
            result.add(id);
            break;
          }
          if (inCol[i] && colFill[i] + inCol[i] === GRID) {
            result.add(id);
            break;
          }
        }
      }
    }
  }
  return result;
}

/**
 * Whether a shape may join the tray being dealt, at how far the rules have been
 * relaxed to get a tray at all. The order matters. The clear guarantee goes
 * first, because a tray with nothing to clear is the dry spell this game exists
 * to avoid. Fitting on the board is the last thing given up, because a piece you
 * cannot place is a piece the player cannot act on, while two L's in one tray is
 * only a matter of taste.
 */
function pieceAllowed(shape, level, rules) {
  if (level < 4 && rules.wantsClear && rules.slot === rules.clearSlot && !rules.clearing.has(shape.id)) {
    return false;
  }
  if (level < 1 && rules.families.has(shape.family)) return false;
  if (level < 2) {
    if (rules.fives >= 1 && shape.cells.length >= 5) return false;
    if (rules.bigs >= rules.bigLimit && shape.cells.length >= 4) return false;
  }
  if (level < 3 && shape.cells.length > rules.cap) return false;
  if (level < 4 && !rules.fits(shape.id)) return false;
  return true;
}

/** The levels at which a tray will settle, tightest first. */
const RELAXATIONS = 5;

/**
 * Deals a whole tray at once, rather than three independent draws.
 *
 * The three pieces used to be rolled separately and uniformly from the stage
 * pool, which left nothing in charge of what a tray contained: 73% of late trays
 * held two or more pieces of five cells or more and a quarter held three. A tray
 * is the unit the player is actually given, so it is the unit that is composed.
 *
 * Two guarantees hold, in this order of importance. Wherever the board allows a
 * line to be completed, at least one slot is required to take a piece that
 * completes one. And every piece dealt has a legal placement on the board as it
 * stands. The second is not a proof that all three can be played in some order —
 * that needs a search far too deep to run on a phone — but it does mean a tray is
 * never dealt that cannot be placed at all.
 *
 * The whole thing is a function of the seed, the tray index, `lines`,
 * `sinceClear` and the board, all of which are saved, so a reloaded app deals
 * the same trays again and a refresh re-deals identically.
 */
export function dealTray(game) {
  const trayIndex = Math.floor(game.draws / TRAY_SIZE);
  const rng = createRng(traySeed(game.seed, trayIndex));
  const stage = stageFor(game.lines);
  const pool = STAGE_POOLS[stage];
  const clearing = clearingShapes(game.board, pool);
  const rules = {
    cap: sizeCap(stage, boardPressure(game.board), game.sinceClear),
    clearing,
    // The guarantee is relief, not the default. Offering a clear on every tray
    // pushed the median run from 49 trays to 184 and the 90th percentile to 481,
    // which is not a calm game, it is an endless sandbox with no natural point to
    // stop at. It fires only once the player is actually in a dry spell, which is
    // the whole point of it: the tray is easy *because* they have just had a hard
    // moment, and the rest of the time the deck stays varied.
    //
    // An empty board has nothing to complete and an early run is mostly empty
    // boards, so `clearing` being empty skips the constraint rather than forcing
    // five empty filter passes on every slot of every early tray.
    wantsClear: clearing.size > 0 && game.sinceClear >= 2,
    clearSlot: 0,
    slot: 0,
    families: new Set(),
    fives: 0,
    bigs: 0,
    // Two four-cell pieces in a tray is a real decision; three is a wall.
    bigLimit: stage === 0 ? 1 : 2,
    fits: (id) => hasAnyPlacement(game, id),
  };
  // Rolled before the pieces so the clear is not always the first one shown.
  rules.clearSlot = Math.floor(rng() * TRAY_SIZE);

  for (let slot = 0; slot < TRAY_SIZE; slot++) {
    rules.slot = slot;
    let candidates = null;
    for (let level = 0; level < RELAXATIONS; level++) {
      candidates = pool.filter((id) => pieceAllowed(SHAPES[id], level, rules));
      if (candidates.length) break;
    }
    if (!candidates.length) candidates = pool;
    const shape = SHAPES[candidates[Math.floor(rng() * candidates.length)]];
    rules.families.add(shape.family);
    if (shape.cells.length >= 5) rules.fives += 1;
    if (shape.cells.length >= 4) rules.bigs += 1;
    game.tray[slot] = { shapeId: shape.id, colorIndex: Math.floor(rng() * COLORS.length) };
  }
  game.draws += TRAY_SIZE;
  return game.tray;
}

function shapeById(id) {
  return SHAPES[id];
}

export function fitsAt(game, shapeId, originX, originY) {
  const shape = shapeById(shapeId);
  if (!shape) return false;
  if (originX < 0 || originY < 0) return false;
  if (originX + shape.width > GRID || originY + shape.height > GRID) return false;
  for (const [dx, dy] of shape.cells) {
    if (game.board[(originY + dy) * GRID + originX + dx] !== 0) return false;
  }
  return true;
}

export function hasAnyPlacement(game, shapeId) {
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (fitsAt(game, shapeId, x, y)) return true;
    }
  }
  return false;
}

export function anyTrayPlacement(game) {
  return game.tray.some((piece) => piece && hasAnyPlacement(game, piece.shapeId));
}

export function isGameOver(game) {
  return !anyTrayPlacement(game);
}

/**
 * Whether the player may re-deal a tray that cannot be played. Only offered
 * when the game is actually over, so it can never be used to pick a better
 * hand off a live board.
 */
export function canRescue(game) {
  return game.rescues < MAX_RESCUES && isGameOver(game);
}

/**
 * Re-deals the tray after a dead end, spending one rescue. Returns false if the
 * game is not over or there are none left, so the caller can trust the result.
 * The new pieces come from the seeded RNG like any other deal, which is what
 * keeps a restored app replaying identically.
 *
 * The player-facing name is "use a refresh". The three chances are the natural
 * end of a run, which is why they are capped: a game that could go on for ever
 * has no point to stop at, and that is its own kind of pressure.
 */
export function rescueTray(game) {
  if (!canRescue(game)) return false;
  game.rescues += 1;
  dealTray(game);
  return true;
}

/** Rows/cols that are completely filled on `board`. Exported for tests. */
export function clearedLines(board) {
  const rows = [];
  const cols = [];
  for (let y = 0; y < GRID; y++) {
    let full = true;
    for (let x = 0; x < GRID; x++) {
      if (board[y * GRID + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  for (let x = 0; x < GRID; x++) {
    let full = true;
    for (let y = 0; y < GRID; y++) {
      if (board[y * GRID + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(x);
  }
  return { rows, cols };
}

/**
 * Returns a description of the placement instead of mutating, so the UI can
 * preview a move (ghost blocks + lines that would clear) before committing.
 */
export function previewPlacement(game, slot, originX, originY) {
  const piece = game.tray[slot];
  if (!piece) return null;
  const shape = shapeById(piece.shapeId);
  if (!shape || !fitsAt(game, piece.shapeId, originX, originY)) return null;

  const probe = new Uint8Array(game.board);
  for (const [dx, dy] of shape.cells) {
    probe[(originY + dy) * GRID + originX + dx] = piece.colorIndex + 1;
  }
  const { rows, cols } = clearedLines(probe);
  const lines = rows.length + cols.length;
  const filled = shape.cells.length;

  return {
    cells: shape.cells.map(([dx, dy]) => ({
      x: originX + dx,
      y: originY + dy,
      colorIndex: piece.colorIndex,
    })),
    rows,
    cols,
    lines,
    gained: scoreForPlacement(filled, lines),
  };
}

export function scoreForPlacement(filled, lines) {
  const combo = lines >= 2 ? 18 * Math.min(lines - 1, 4) : 0;
  return filled + lines * 10 + combo;
}

/** Applies a placement. Mutates `game` and returns a result, or null if illegal. */
export function placePiece(game, slot, originX, originY) {
  const result = previewPlacement(game, slot, originX, originY);
  if (!result) return null;

  const piece = game.tray[slot];
  for (const [dx, dy] of shapeById(piece.shapeId).cells) {
    game.board[(originY + dy) * GRID + originX + dx] = piece.colorIndex + 1;
  }
  game.tray[slot] = null;

  for (const y of result.rows) {
    for (let x = 0; x < GRID; x++) game.board[y * GRID + x] = 0;
  }
  for (const x of result.cols) {
    for (let y = 0; y < GRID; y++) game.board[y * GRID + x] = 0;
  }

  game.score += result.gained;
  game.moves += 1;
  game.lines += result.lines;
  game.sinceClear = result.lines > 0 ? 0 : game.sinceClear + 1;
  if (game.score > game.best) game.best = game.score;

  if (game.tray.every((piece) => piece === null)) dealTray(game);

  return { ...result, gameOver: isGameOver(game) };
}

export function serialize(game) {
  return {
    version: SAVE_VERSION,
    board: Array.from(game.board),
    tray: game.tray.map((piece) => (piece ? { ...piece } : null)),
    score: game.score,
    moves: game.moves,
    lines: game.lines,
    sinceClear: game.sinceClear,
    best: game.best,
    rescues: game.rescues,
    seed: game.seed,
    draws: game.draws,
  };
}

export function deserialize(data) {
  if (!data || data.version !== SAVE_VERSION) return null;
  if (!Array.isArray(data.board) || data.board.length !== GRID * GRID) return null;
  if (!Array.isArray(data.tray) || data.tray.length !== TRAY_SIZE) return null;
  if (!Number.isInteger(data.seed) || !Number.isInteger(data.draws)) return null;
  if (data.draws < 0) return null;

  const tray = data.tray.map((piece) => {
    if (piece === null) return null;
    if (!Number.isInteger(piece.shapeId) || piece.shapeId < 0 || piece.shapeId >= SHAPE_COUNT) {
      return null;
    }
    if (!Number.isInteger(piece.colorIndex) || piece.colorIndex < 0 || piece.colorIndex >= COLORS.length) {
      return null;
    }
    return { shapeId: piece.shapeId, colorIndex: piece.colorIndex };
  });
  if (data.tray.some((piece, i) => piece !== null && tray[i] === null)) return null;

  // Validate before converting: Uint8Array coerces out-of-range values (e.g.
  // -1 becomes 255), which would let corrupt cells through as valid blocks.
  for (const value of data.board) {
    if (!Number.isInteger(value) || value < 0 || value > COLORS.length) return null;
  }
  const board = Uint8Array.from(data.board);

  const safeCount = (value) =>
    Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_RESCUES) : 0;
  // Absent in saves written before these two existed. Both default to 0, which
  // is the generous reading: no lines cleared means still in the friendly tier,
  // and no dry spell means the player is treated as being in a rhythm.
  const safeCountUpTo = (value, max) =>
    Number.isInteger(value) && value >= 0 ? Math.min(value, max) : 0;

  return {
    version: SAVE_VERSION,
    board,
    tray,
    score: Number.isInteger(data.score) && data.score >= 0 ? data.score : 0,
    moves: safeCountUpTo(data.moves, 1e6),
    lines: safeCountUpTo(data.lines, 1e6),
    sinceClear: safeCountUpTo(data.sinceClear, 1000),
    best: Number.isInteger(data.best) && data.best >= 0 ? data.best : 0,
    // Absent in saves written before rescues existed, which read as none used.
    rescues: safeCount(data.rescues),
    seed: data.seed >>> 0,
    draws: data.draws,
  };
}
