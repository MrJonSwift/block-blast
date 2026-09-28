export const GRID = 8;
export const TRAY_SIZE = 3;
export const SAVE_VERSION = 1;

/** Shapes are authored as ASCII art, then normalised into unique variants. */
const SHAPE_DEFS = [
  ['dot', ['#']],

  ['h2', ['##']],
  ['v2', ['#', '#']],

  ['h3', ['###']],
  ['v3', ['#', '#', '#']],

  ['h4', ['####']],
  ['v4', ['#', '#', '#', '#']],

  ['h5', ['#####']],
  ['v5', ['#', '#', '#', '#', '#']],

  ['o2', ['##', '##']],
  ['o3', ['###', '###', '###']],

  ['r2x3', ['##.', '###']],
  ['r3x2', ['###', '#..']],
  ['r3x2b', ['###', '..#']],
  ['r2x3b', ['###', '.##']],

  ['l3', ['#..', '###']],
  ['l3b', ['..#', '###']],
  ['l3c', ['###', '#..']],
  ['l3d', ['###', '..#']],
  ['l4', ['#...', '####']],
  ['l4b', ['...#', '####']],
  ['l4c', ['####', '#...']],
  ['l4d', ['####', '...#']],
  ['l5', ['#....', '#####']],
  ['l5b', ['....#', '#####']],
  ['l5c', ['#####', '#....']],
  ['l5d', ['#####', '....#']],

  ['s3', ['.##', '##.']],
  ['s3v', ['#.', '##', '.#']],

  ['t3', ['###', '.#.']],
  ['t3v', ['.#.', '##', '.#.']],

  ['u3', ['#.#', '###']],
  ['u3v', ['###', '#.#']],

  ['z4', ['##..', '.##.']],
  ['z4v', ['.#..', '##..', '..##']],

  ['f4', ['.##', '##.', '#..']],
  ['f4b', ['..#', '.##', '##.']],
  ['f5', ['.##', '##.', '#...']],
  ['f5b', ['...#', '.##', '##.']],

  ['y5', ['#.#', '###']],
  ['y5v', ['.#.', '##', '.#', '.#']],
  ['plus5', ['.#.', '###', '.#.']],
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

function buildShapes() {
  const seen = new Set();
  const families = [];
  SHAPE_DEFS.forEach(([name, rows], defIndex) => {
    const seed = normalise(variantsOf(rows).cells);
    const family = [seed, rotate90(seed), mirror(seed), mirror(rotate90(seed))];
    const variants = [];
    for (const candidate of family) {
      const cells = normalise(candidate);
      const key = keyOf(cells);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({
        defIndex,
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
 * Difficulty is a property of the stage, not of the individual shape: every
 * shape in a stage is about equally easy, and each stage's pool contains the
 * previous one's, so a shape you have never seen before is never *worse* than
 * the ones you know. The awkward shapes are the long ones — 5-bars, 4-arm and
 * 6-cell L's, F and Y pieces — and they are all in the last stage.
 *
 * The stage advances on pieces placed rather than score. Score is dominated by
 * line clears, so gating on it would make playing well raise the stakes, and one
 * lucky double-clear would jump a stage mid-run. Pieces placed advance evenly,
 * and `moves` is already part of the save, so a restored game resumes at the
 * right stage with no change to the save format.
 */
const STAGES = [
  {
    at: 0,
    name: 'Warming up',
    add: ['dot', 'h2', 'h3', 'o2', 'l3'],
  },
  {
    at: 9,
    name: 'Steady',
    add: ['h4', 'r3x2', 'r3x2b', 's3', 't3', 't3v'],
  },
  {
    at: 24,
    name: 'Stretching',
    add: ['r2x3', 'r2x3b', 'u3', 'u3v', 'z4v', 'l4', 'l4b', 'l4c', 'plus5'],
  },
  {
    at: 45,
    name: 'All of it',
    add: ['h5', 'l5', 'l5b', 'l5c', 'f4', 'f4b', 'f5b', 'y5v', 'o3'],
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

/** The stage index for a run that has placed `moves` pieces. */
export function stageFor(moves) {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (moves >= STAGES[i].at) index = i;
  }
  return index;
}

export function stageNameFor(moves) {
  return STAGES[stageFor(moves)].name;
}

export function createRng(seed) {
  let state = seed >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => state;
  rng.setState = (next) => {
    state = next >>> 0;
  };
  return rng;
}

function rngSeedFromDraws(seed, draws) {
  const rng = createRng(seed);
  for (let i = 0; i < draws; i++) rng();
  return rng.getState();
}

export function createGame(seed = (Math.random() * 0xffffffff) >>> 0) {
  return {
    version: SAVE_VERSION,
    board: new Uint8Array(GRID * GRID),
    tray: new Array(TRAY_SIZE).fill(null),
    score: 0,
    moves: 0,
    best: 0,
    seed: seed >>> 0,
    draws: 0,
  };
}

export function createPlayableGame(seed) {
  const game = createGame(seed);
  dealTray(game);
  return game;
}

function dealPiece(game) {
  game.draws += 1;
  const rng = createRng(rngSeedFromDraws(game.seed, game.draws - 1));
  const pool = STAGE_POOLS[stageFor(game.moves)];
  const shape = SHAPES[pool[Math.floor(rng() * pool.length)]];
  return { shapeId: shape.id, colorIndex: Math.floor(rng() * COLORS.length) };
}

export function dealTray(game) {
  for (let i = 0; i < TRAY_SIZE; i++) game.tray[i] = dealPiece(game);
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
    best: game.best,
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

  return {
    version: SAVE_VERSION,
    board,
    tray,
    score: Number.isInteger(data.score) && data.score >= 0 ? data.score : 0,
    moves: Number.isInteger(data.moves) && data.moves >= 0 ? data.moves : 0,
    best: Number.isInteger(data.best) && data.best >= 0 ? data.best : 0,
    seed: data.seed >>> 0,
    draws: data.draws,
  };
}
