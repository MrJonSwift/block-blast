import assert from 'node:assert/strict';
import { LIFT_CELLS, ghostOffset } from '../js/input.js';
import {
  COLORS,
  GRID,
  MAX_RESCUES,
  SAVE_VERSION,
  SHAPES,
  SHAPE_COUNT,
  SHAPE_FAMILIES,
  STAGE_COUNT,
  STAGE_SHAPES,
  TRAY_SIZE,
  anyTrayPlacement,
  boardPressure,
  canRescue,
  clearedLines,
  createPlayableGame,
  dealTray,
  deserialize,
  fitsAt,
  hasAnyPlacement,
  isGameOver,
  placePiece,
  previewPlacement,
  rescueTray,
  scoreForPlacement,
  serialize,
  stageFor,
  stageNameFor,
} from '../js/game.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
  }
}

function emptyBoard() {
  const game = createPlayableGame(1);
  game.board.fill(0);
  return game;
}

/**
 * Builds a board that is full everywhere except `gaps`. A board can never have
 * a completed line at rest (they would already have been cleared), so tests
 * assert that precondition before placing anything.
 */
function boardWithGaps(gaps) {
  const game = emptyBoard();
  const blank = new Set(gaps.map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      game.board[y * GRID + x] = blank.has(`${x},${y}`) ? 0 : 1;
    }
  }
  const { rows, cols } = clearedLines(game.board);
  assert.equal(rows.length, 0, 'fixture has a pre-complete row');
  assert.equal(cols.length, 0, 'fixture has a pre-complete column');
  return game;
}

function singleCellGame(gaps) {
  const game = boardWithGaps(gaps);
  const single = SHAPES.find((s) => s.cells.length === 1);
  game.tray = [{ shapeId: single.id, colorIndex: 0 }];
  return game;
}

function diagonalGaps() {
  return Array.from({ length: GRID }, (_, i) => [i, i]);
}

/**
 * A board with `gapCount` empty cells and no completed line, at any density from
 * 87.5% full down to 12.5%. The diagonal goes in first: it puts one gap in every
 * row and every column, so no line can ever be complete and the extra gaps can
 * then go anywhere at all. A board with a completed line is not a state the game
 * can be in, so a fixture that has one proves nothing about the deal.
 */
function staggeredBoard(gapCount, salt) {
  assert.ok(gapCount >= GRID && gapCount <= GRID * GRID, `bad gap count ${gapCount}`);
  const gaps = new Set(diagonalGaps().map(([x, y]) => `${x},${y}`));
  const rest = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!gaps.has(`${x},${y}`)) rest.push([x, y]);
    }
  }
  // A fixed, spread walk rather than a shuffle, so the density is the only thing
  // varying between two boards that are being compared.
  for (let i = 0; i < gapCount - GRID; i++) {
    gaps.add(`${rest[(i * 5 + salt * 3) % rest.length][0]},${rest[(i * 5 + salt * 3) % rest.length][1]}`);
  }
  const game = emptyBoard();
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      game.board[y * GRID + x] = gaps.has(`${x},${y}`) ? 0 : 1;
    }
  }
  const { rows, cols } = clearedLines(game.board);
  assert.equal(rows.length, 0, 'fixture has a pre-complete row');
  assert.equal(cols.length, 0, 'fixture has a pre-complete column');
  return game;
}

function shapeOfSize(size) {
  const shape = SHAPES.find((s) => s.cells.length === size);
  assert.ok(shape, `expected a shape with ${size} cells`);
  return shape;
}

test('shape table is valid and de-duplicated', () => {
  const seen = new Set();
  for (const shape of SHAPES) {
    const key = shape.cells
      .map(([x, y]) => `${x},${y}`)
      .sort()
      .join(' ');
    assert.ok(!seen.has(key), `duplicate shape variant: ${key}`);
    seen.add(key);
    for (const [x, y] of shape.cells) {
      assert.ok(x >= 0 && x < shape.width, 'cell x inside bounding box');
      assert.ok(y >= 0 && y < shape.height, 'cell y inside bounding box');
    }
    assert.equal(shape.cells.length, new Set(shape.cells.map(String)).size, 'no repeated cells');
    assert.ok(shape.cells.length <= 5, `shape ${shape.id} is ${shape.cells.length} cells`);
    assert.ok(Math.max(shape.width, shape.height) <= 5, `shape ${shape.id} is too long`);
  }
  assert.equal(SHAPE_COUNT, SHAPES.length);
  assert.equal(SHAPE_COUNT, 46, `the catalogue is 46 variants, got ${SHAPE_COUNT}`);
});

/**
 * Every family must expand to its whole orbit, all four rotations of it and of
 * its mirror. The expansion used to try only four transforms, which quietly lost
 * orientations: the L-tromino and L-tetromino came out as 4 of their 8, so the
 * game contained no J shapes at all, and the U and T lost one each. Recomputing
 * the orbit here means a future change to the expansion cannot lose one again.
 */
test('every family expands to its full orbit of orientations', () => {
  const keyOf = (cells) =>
    cells
      .map(([x, y]) => `${x},${y}`)
      .sort()
      .join(' ');
  const rotate = (cells) => cells.map(([x, y]) => [-y, x]);
  const mirror = (cells) => cells.map(([x, y]) => [-x, y]);
  const normalise = (cells) => {
    const minX = Math.min(...cells.map((c) => c[0]));
    const minY = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => [x - minX, y - minY]);
  };

  for (const family of SHAPE_FAMILIES) {
    const seed = normalise(family.variants[0].cells);
    const orbit = new Set();
    for (const base of [seed, mirror(seed)]) {
      let cells = base;
      for (let turn = 0; turn < 4; turn += 1) {
        orbit.add(keyOf(normalise(cells)));
        cells = rotate(cells);
      }
    }
    assert.equal(
      family.variants.length,
      orbit.size,
      `${family.name} has ${family.variants.length} of its ${orbit.size} orientations`
    );
  }
  // The chiral families are the ones the old four-transform expansion lost, so
  // they are the ones worth naming: the L gives L and J, the S gives S and Z.
  const l4 = SHAPE_FAMILIES.find((f) => f.name === 'l4');
  assert.equal(l4.variants.length, 8, 'the L-tetromino needs all four Ls and all four Js');
  const s4 = SHAPE_FAMILIES.find((f) => f.name === 's4');
  assert.equal(s4.variants.length, 4, 'the S-tetromino needs S and Z, both ways up');
});

/**
 * A family that expands to nothing is a family name in the tier table that points
 * at a shape an earlier one already claimed. That is how the previous catalogue
 * came to have a "y5" that was byte-identical to its "u3", so the shape table is
 * checked for it directly.
 */
test('no family is a duplicate of another, and none expands to nothing', () => {
  const artOf = (shape) => {
    const rows = [];
    for (let y = 0; y < shape.height; y += 1) {
      let row = '';
      for (let x = 0; x < shape.width; x += 1) {
        row += shape.cells.some(([cx, cy]) => cx === x && cy === y) ? '#' : '.';
      }
      rows.push(row);
    }
    return rows.join('/');
  };
  const art = new Map();
  for (const family of SHAPE_FAMILIES) {
    assert.ok(family.variants.length > 0, `${family.name} expands to no shape at all`);
    const key = artOf(family.variants[0]);
    assert.ok(!art.has(key), `${family.name} is the same shape as ${art.get(key)}`);
    art.set(key, family.name);
  }
  assert.equal(SHAPE_FAMILIES.length, 13, `13 families, got ${SHAPE_FAMILIES.length}`);
});

test('shape ids index the flattened shape table', () => {
  SHAPES.forEach((shape, index) => {
    assert.equal(shape.id, index, `shape at ${index} has id ${shape.id}`);
  });
  // A shape looked up by id must be the shape that was stored.
  for (const shape of SHAPES) {
    assert.equal(SHAPES[shape.id], shape);
  }
});

test('every shape fits in an empty board', () => {
  const game = emptyBoard();
  for (const shape of SHAPES) {
    assert.ok(hasAnyPlacement(game, shape.id), `shape ${shape.id} never fits an empty board`);
  }
});

test('placement respects board bounds', () => {
  const game = emptyBoard();
  const shape = shapeOfSize(3);
  assert.equal(fitsAt(game, shape.id, GRID - shape.width, 0), true);
  assert.equal(fitsAt(game, shape.id, GRID - shape.width + 1, 0), false);
  assert.equal(fitsAt(game, shape.id, 0, GRID - shape.height), true);
  assert.equal(fitsAt(game, shape.id, 0, GRID - shape.height + 1), false);
  assert.equal(fitsAt(game, shape.id, -1, 0), false);
  assert.equal(fitsAt(game, shape.id, 0, -1), false);
});

test('placement refuses occupied cells', () => {
  const game = emptyBoard();
  const piece = game.tray[0];
  assert.equal(fitsAt(game, piece.shapeId, 0, 0), true);
  const [dx, dy] = SHAPES[piece.shapeId].cells[0];
  game.board[dy * GRID + dx] = 1;
  assert.equal(fitsAt(game, piece.shapeId, 0, 0), false);
});

test('preview does not mutate the game', () => {
  const game = emptyBoard();
  const before = serialize(game);
  const result = previewPlacement(game, 0, 0, 0);
  assert.ok(result);
  assert.deepEqual(serialize(game), before);
});

test('placing a piece writes blocks and consumes the slot', () => {
  const game = emptyBoard();
  const piece = game.tray[0];
  const result = placePiece(game, 0, 0, 0);
  assert.ok(result);
  assert.equal(game.tray[0], null);
  for (const [dx, dy] of SHAPES[piece.shapeId].cells) {
    assert.equal(game.board[dy * GRID + dx], piece.colorIndex + 1);
  }
  assert.equal(result.gained, scoreForPlacement(SHAPES[piece.shapeId].cells.length, 0));
});

test('a full row clears and scores 10 plus the blocks placed', () => {
  // Row 0's only gap is (7,0); column 7 has plenty of other gaps, so filling
  // (7,0) completes the row without completing a column.
  const gaps = [
    ...diagonalGaps().filter(([x, y]) => y !== 0),
    [7, 0],
    [7, 1],
    [7, 2],
    [7, 3],
    [7, 4],
    [7, 5],
    [7, 6],
    [0, 1],
  ];
  const game = singleCellGame(gaps);
  const result = placePiece(game, 0, 7, 0);
  assert.ok(result);
  assert.deepEqual(result.rows, [0]);
  assert.deepEqual(result.cols, []);
  assert.equal(result.lines, 1);
  assert.equal(result.gained, 1 + 10);
  for (let x = 0; x < GRID; x++) assert.equal(game.board[x], 0, 'cleared row is empty');
});

test('a full column clears too', () => {
  const game = singleCellGame([[0, 7], [1, 0], ...diagonalGaps().filter(([x]) => x !== 0)]);
  const result = placePiece(game, 0, 0, 7);
  assert.ok(result);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.cols, [0]);
  assert.equal(result.gained, 11);
  for (let y = 0; y < GRID; y++) assert.equal(game.board[y * GRID], 0);
});

test('crossing a row and a column clears both and overlaps once', () => {
  // Every row and column has exactly one gap, on the diagonal, so filling
  // (0,0) completes both row 0 and column 0.
  const game = singleCellGame(diagonalGaps());
  const result = placePiece(game, 0, 0, 0);
  assert.deepEqual(result.rows, [0]);
  assert.deepEqual(result.cols, [0]);
  assert.equal(result.lines, 2);
  assert.equal(result.gained, 1 + 20 + 18);
  assert.equal(game.board[0], 0);
  assert.equal(game.board[GRID - 1], 0, 'the shared cell is not double counted');
});

test('a multi-cell piece can complete two lines at once', () => {
  const game = singleCellGame([
    ...diagonalGaps().filter(([, y]) => y > 1),
    [0, 0],
    [1, 0],
    [1, 1],
    [5, 1],
  ]);
  const h2 = SHAPES.find((s) => s.cells.length === 2 && s.width === 2 && s.height === 1);
  game.tray = [{ shapeId: h2.id, colorIndex: 0 }];
  const result = placePiece(game, 0, 0, 0);
  assert.ok(result, 'a horizontal domino fits');
  assert.deepEqual(result.rows, [0]);
  assert.deepEqual(result.cols, [0]);
  assert.equal(result.lines, 2);
  assert.equal(result.gained, 2 + 20 + 18);
});

test('combo scoring follows the 18/36/54/72 ladder', () => {
  assert.equal(scoreForPlacement(5, 0), 5);
  assert.equal(scoreForPlacement(5, 1), 15);
  assert.equal(scoreForPlacement(5, 2), 5 + 20 + 18);
  assert.equal(scoreForPlacement(5, 3), 5 + 30 + 36);
  assert.equal(scoreForPlacement(5, 4), 5 + 40 + 54);
  assert.equal(scoreForPlacement(5, 5), 5 + 50 + 72);
  assert.equal(scoreForPlacement(5, 9), 5 + 90 + 72, 'combo bonus caps at 72');
});

test('an illegal placement is rejected without side effects', () => {
  const game = emptyBoard();
  const before = serialize(game);
  const result = placePiece(game, 0, GRID, GRID);
  assert.equal(result, null);
  assert.deepEqual(serialize(game), before);
});

test('an empty slot cannot be played', () => {
  const game = emptyBoard();
  game.tray[0] = null;
  assert.equal(placePiece(game, 0, 0, 0), null);
  assert.equal(previewPlacement(game, 0, 0, 0), null);
});

test('game over when no tray piece fits', () => {
  const game = emptyBoard();
  const single = SHAPES.find((s) => s.cells.length === 1);
  for (let i = 0; i < TRAY_SIZE; i++) {
    game.tray[i] = { shapeId: single.id, colorIndex: 0 };
  }
  for (let i = 0; i < GRID * GRID; i++) game.board[i] = 1;
  game.board[63] = 0;
  assert.equal(hasAnyPlacement(game, single.id), true);
  game.board[63] = 1;
  assert.equal(hasAnyPlacement(game, single.id), false);
  assert.equal(anyTrayPlacement(game), false);
  assert.equal(isGameOver(game), true);
});

test('a board with a free cell in every line is not game over, and clearing keeps it alive', () => {
  const game = singleCellGame(diagonalGaps());
  assert.equal(isGameOver(game), false);
  const result = placePiece(game, 0, 0, 0);
  assert.ok(result);
  assert.equal(result.lines, 2);
  assert.equal(result.gameOver, isGameOver(game), 'gameOver mirrors the board state');
  game.tray = [{ shapeId: SHAPES.find((s) => s.cells.length === 1).id, colorIndex: 0 }];
  assert.equal(isGameOver(game), false, 'the cleared lines left room to play on');
});

test('the tray is refilled once the last piece is used', () => {
  const game = emptyBoard();
  assert.equal(game.tray.every((p) => p !== null), true);
  const single = SHAPES.find((s) => s.cells.length === 1);
  game.tray = [
    { shapeId: single.id, colorIndex: 0 },
    { shapeId: single.id, colorIndex: 1 },
    { shapeId: single.id, colorIndex: 2 },
  ];
  const drawsBefore = game.draws;
  for (const slot of [0, 1, 2]) {
    assert.ok(placePiece(game, slot, 0, slot), `slot ${slot} should be playable`);
  }
  assert.equal(game.tray.every((p) => p !== null), true, 'a fresh deal of three');
  assert.equal(game.tray.length, TRAY_SIZE);
  assert.ok(game.draws > drawsBefore, 'the refill dealt new pieces');
});

test('dealing is deterministic for a given seed', () => {
  const a = createPlayableGame(123456);
  const b = createPlayableGame(123456);
  assert.deepEqual(a.tray, b.tray);
  assert.equal(a.draws, b.draws);
  const c = createPlayableGame(123457);
  assert.notDeepEqual(a.tray, c.tray);
});

test('the piece is held 2 cells clear of the finger when there is room', () => {
  const geom = { axis: 'y', pitch: 45, block: 40, cell0Left: 20, cell0Top: 80, viewWidth: 390, viewHeight: 844 };
  const { dx, dy } = ghostOffset(geom);
  assert.equal(dx, 0, 'not moved sideways');
  assert.equal(dy, -2 * geom.pitch, 'held 2 cells up, away from the tray below');
  const sideways = ghostOffset({ ...geom, axis: 'x', viewWidth: 1024 });
  assert.equal(sideways.dy, 0, 'not moved up');
  assert.equal(sideways.dx, -2 * geom.pitch, 'held 2 cells left, away from the tray beside');
});

test('the hold shrinks when the board leaves no room below it', () => {
  // The board's bottom edge is cell0Top + GRID*pitch, and the deepest finger is
  // aimed half a cell above it, so a view that has less than half a cell of
  // slack after that leaves no room for a hold at all.
  const base = { axis: 'y', pitch: 45, block: 40, cell0Left: 20, cell0Top: 80, viewWidth: 390 };
  const boardEdge = base.cell0Top + GRID * base.pitch;
  const noRoom = { ...base, viewHeight: boardEdge - base.pitch + base.block / 2 };
  const none = ghostOffset(noRoom);
  assert.deepEqual([none.dx, none.dy], [0, 0], 'no room means no hold');
  const aLittle = { ...base, viewHeight: noRoom.viewHeight + 30 };
  const shrunk = ghostOffset(aLittle);
  assert.ok(Math.abs(shrunk.dy) < 2 * aLittle.pitch, `expected less than 2 cells, got ${shrunk.dy}`);
  assert.ok(Math.abs(shrunk.dy) > 0, 'the room that is there gets used');
  const plenty = { ...base, viewHeight: 844 };
  assert.equal(ghostOffset(plenty).dy, -2 * plenty.pitch, 'a roomy view gets the full 2 cells');
});

test('the deepest placement always needs a finger that is on screen', () => {
  // Whatever the view, the finger needed to aim a one cell deep piece at the
  // last legal origin must land inside it. This is the invariant the hold is
  // clamped to preserve; without the clamp the bottom row would need a finger
  // below the screen on a short viewport.
  for (const viewWidth of [320, 390, 430, 768, 1024, 1180]) {
    for (const viewHeight of [390, 568, 844, 932, 1024]) {
      for (const axis of ['x', 'y']) {
        const pitch = Math.min(viewWidth, viewHeight) / 8 - 2;
        const cell0Left = 20;
        const cell0Top = 20;
        const { dx, dy } = ghostOffset({ axis, pitch, block: pitch - 4, cell0Left, cell0Top, viewWidth, viewHeight });
        const half = (pitch - 4) / 2;
        const fingerX = cell0Left + (GRID - 1) * pitch + half + dx;
        const fingerY = cell0Top + (GRID - 1) * pitch + half + dy;
        // On the held axis the limit is the screen; on the other the piece is
        // centred on the finger, so the board's own far edge is the limit.
        const limitX = axis === 'x' ? viewWidth : cell0Left + GRID * pitch;
        const limitY = axis === 'y' ? viewHeight : cell0Top + GRID * pitch;
        const where = `${viewWidth}x${viewHeight} ${axis}`;
        assert.ok(fingerX <= limitX, `x ${fingerX.toFixed(1)} past ${limitX} at ${where}`);
        assert.ok(fingerY <= limitY, `y ${fingerY.toFixed(1)} past ${limitY} at ${where}`);
        assert.ok(fingerX > 0 && fingerY > 0, `finger off the top/left at ${where}`);
      }
    }
  }
});

test('save round-trips exactly', () => {
  const game = createPlayableGame(99);
  placePiece(game, 0, 2, 3);
  placePiece(game, 1, 5, 1);
  const restored = deserialize(serialize(game));
  assert.ok(restored);
  assert.deepEqual(serialize(restored), serialize(game));
  assert.equal(restored.score, game.score);
  assert.equal(restored.moves, game.moves);
  assert.ok(restored.board instanceof Uint8Array);
});

test('replaying a restored game deals identical future pieces', () => {
  const game = createPlayableGame(4242);
  placePiece(game, 0, 0, 0);
  const snapshot = JSON.stringify(serialize(deserialize(serialize(game))));
  const copy = deserialize(JSON.parse(snapshot));
  placePiece(game, 0, 0, 0);
  placePiece(copy, 0, 0, 0);
  placePiece(game, 0, 0, 0);
  placePiece(copy, 0, 0, 0);
  assert.deepEqual(copy.tray, game.tray);
  assert.equal(copy.draws, game.draws);
});

test('best score tracks the running maximum', () => {
  const game = emptyBoard();
  assert.equal(game.best, 0);
  placePiece(game, 0, 0, 0);
  assert.equal(game.best, game.score);
  const peak = game.score;
  game.score = 0;
  placePiece(game, 0, 4, 4);
  assert.equal(game.best, peak);
});

test('corrupt saves are rejected rather than crashing', () => {
  assert.equal(deserialize(null), null);
  assert.equal(deserialize(undefined), null);
  assert.equal(deserialize({}), null);
  assert.equal(deserialize({ version: 999 }), null);
  // A v1 save names shape ids from the old catalogue, so every one of them
  // means something else now. It is dropped whole rather than half-read.
  assert.equal(deserialize({ version: 1, board: new Array(64).fill(0) }), null);
  assert.equal(deserialize({ version: 1, board: [1], tray: [] }), null);
  assert.equal(deserialize({ version: SAVE_VERSION, board: [1], tray: [] }), null);
  const extraFields = {
    version: SAVE_VERSION,
    board: new Array(64).fill(0),
    tray: new Array(3).fill(null),
    seed: 1,
    draws: 0,
    staleJunk: true,
  };
  assert.ok(deserialize(extraFields), 'unknown fields are ignored, not rejected');
  const badTray = {
    version: SAVE_VERSION,
    board: new Array(64).fill(0),
    tray: [{ shapeId: 9999, colorIndex: 0 }, null, null],
    seed: 1,
    draws: 0,
  };
  assert.equal(deserialize(badTray), null);
  const badColor = {
    version: SAVE_VERSION,
    board: new Array(64).fill(0),
    tray: [{ shapeId: 0, colorIndex: COLORS.length + 5 }, null, null],
    seed: 1,
    draws: 0,
  };
  assert.equal(deserialize(badColor), null);
  const badCell = {
    version: SAVE_VERSION,
    board: new Array(64).fill(COLORS.length + 9),
    tray: [null, null, null],
    seed: 1,
    draws: 0,
  };
  assert.equal(deserialize(badCell), null);
});

/**
 * The opening has to be varied enough to be interesting and gentle enough not to
 * decide a run. These are the two halves of that, and they are the whole reason
 * the pool is built the way it is: 28 shapes available from the first tray, none
 * of them more than four cells, and the 5-cell pieces held back until the player
 * has earned them by clearing.
 */
test('the opening is varied, small, and the 5-cell pieces need clears first', () => {
  const opening = new Set();
  const later = new Set();
  for (const seed of [1, 7, 42, 2026, 987654321, 13, 99, 12345, 555, 8]) {
    for (const [lines, bucket] of [
      [0, opening],
      [100, later],
    ]) {
      const game = createPlayableGame(seed);
      game.lines = lines;
      for (let tray = 0; tray < 60; tray++) {
        for (const piece of dealTray(game)) bucket.add(piece.shapeId);
      }
    }
  }
  assert.ok(opening.size > 20, `the opening pool is only ${opening.size} shapes`);
  for (const id of opening) {
    const shape = SHAPES[id];
    assert.ok(shape.cells.length <= 4, `stage 0 shape ${id} has ${shape.cells.length} cells`);
  }
  assert.equal(opening.size, 28, 'every friendly shape turns up in the opening stage');
  assert.ok(later.size > opening.size, `later stages must unlock more shapes: ${opening.size} -> ${later.size}`);

  const five = [...later].filter((id) => SHAPES[id].cells.length === 5);
  assert.ok(five.length > 0, 'the 5-cell pieces do turn up later');
  for (const id of five) {
    assert.ok(!opening.has(id), `5-cell shape ${id} is dealt in the opening stage`);
  }
  assert.equal(SHAPES.filter((s) => s.cells.length === 5).length, 18, '18 of the 46 are 5-cell');
  assert.equal(STAGE_SHAPES[0].filter((id) => SHAPES[id].cells.length === 5).length, 0);
});

test('every shape is reachable eventually', () => {
  const seen = new Set();
  for (const seed of [1, 7, 42, 2026, 987654321, 13, 99, 12345, 555, 8, 31, 64]) {
    const game = createPlayableGame(seed);
    game.lines = 1000; // deep into the last stage
    for (let tray = 0; tray < 20; tray++) {
      for (const piece of dealTray(game)) seen.add(piece.shapeId);
    }
  }
  assert.equal(seen.size, SHAPE_COUNT, `only ${seen.size} of ${SHAPE_COUNT} shapes ever turn up`);
});

test('each stage offers everything the last one did, and more', () => {
  assert.ok(STAGE_SHAPES.length === STAGE_COUNT, 'one pool per stage');
  for (let i = 1; i < STAGE_SHAPES.length; i++) {
    const previous = new Set(STAGE_SHAPES[i - 1]);
    const current = new Set(STAGE_SHAPES[i]);
    for (const id of previous) {
      assert.ok(current.has(id), `stage ${i} dropped shape ${id} that stage ${i - 1} had`);
    }
    assert.ok(current.size > previous.size, `stage ${i} is not bigger than stage ${i - 1}`);
  }
  assert.equal(STAGE_SHAPES[STAGE_SHAPES.length - 1].length, SHAPE_COUNT, 'the last stage holds every shape');
  for (const id of STAGE_SHAPES[STAGE_SHAPES.length - 1]) {
    assert.ok(id >= 0 && id < SHAPE_COUNT, `stage holds a bad shape id ${id}`);
  }
});

test('the stage advances on lines cleared, and never goes back', () => {
  // Keyed on success, not on elapsed placements, so a player who is struggling
  // stays in the friendly tier rather than being handed harder pieces at the
  // exact moment they are struggling. `moves` is deliberately not consulted.
  assert.equal(stageFor(0), 0);
  assert.equal(stageFor(19), 0);
  assert.equal(stageFor(20), 1);
  assert.equal(stageFor(59), 1);
  assert.equal(stageFor(60), 2);
  assert.equal(stageFor(100000), STAGE_COUNT - 1);
  let previous = 0;
  for (let lines = 0; lines < 400; lines++) {
    const stage = stageFor(lines);
    assert.ok(stage >= previous, `stage went backwards at ${lines} lines`);
    previous = stage;
  }
  assert.ok(stageNameFor(0).length > 0, 'stages are named for the player');
  assert.equal(stageNameFor(60), 'Deep deck', 'the late stage is named for the mood, not strain');
});

test('a stage boundary survives a save and restore', () => {
  // The stage comes from `lines`, which is saved, so a game restored right on a
  // boundary has to deal the same pieces the uninterrupted game would.
  for (const lines of [0, 19, 20, 59, 60]) {
    const game = createPlayableGame(20260928);
    game.lines = lines;
    const copy = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    assert.deepEqual(dealTray(copy), dealTray(game), `mismatch at ${lines} lines`);
    assert.deepEqual(serialize(copy), serialize(game));
  }
});

test('a struggling player stays friendly and a flowing one unlocks everything', () => {
  // The point of keying the ramp on clears. A player who has placed 400 pieces
  // and cleared nothing is still in stage 0; a player who has cleared 60 lines
  // is in the last stage, however few pieces they placed to do it.
  const stalled = createPlayableGame(5);
  for (let i = 0; i < 400; i++) stalled.moves += 1;
  assert.equal(stalled.lines, 0, 'no clears');
  assert.equal(stageFor(stalled.lines), 0, 'a player who never clears never leaves stage 0');
  assert.ok(STAGE_SHAPES[0].every((id) => SHAPES[id].cells.length <= 4), 'and never sees a 5-cell piece');

  const flowing = createPlayableGame(6);
  flowing.lines = 60;
  flowing.moves = 30;
  assert.equal(stageFor(flowing.lines), STAGE_COUNT - 1, 'clearing unlocks quickly, by design');
  assert.equal(STAGE_SHAPES[STAGE_COUNT - 1].length, SHAPE_COUNT, 'and the whole catalogue is open');
});

/** A 5-bar: the biggest thing in the catalogue, and the piece a rescue test needs. */
function barId() {
  const bar = SHAPES.find((s) => s.cells.length === 5 && s.width === 5);
  assert.ok(bar, 'expected a 5-cell bar in the catalogue');
  return bar.id;
}

/**
 * A board full but for the diagonal, with a tray nothing can be placed on. The
 * deal guarantees a piece that fits, so a stuck position has to be staged by
 * hand whenever a test wants to get there.
 */
function stuckGame() {
  const game = boardWithGaps(diagonalGaps());
  const bar = barId();
  game.tray = [0, 1, 2].map(() => ({ shapeId: bar, colorIndex: 0 }));
  assert.equal(isGameOver(game), true, 'fixture is a dead end');
  return game;
}

test('a dead tray can be re-dealt three times, and no more', () => {
  const game = stuckGame();
  assert.equal(canRescue(game), true);

  const board = Array.from(game.board);
  const score = game.score;
  for (let attempt = 1; attempt <= MAX_RESCUES; attempt++) {
    assert.equal(rescueTray(game), true, `rescue ${attempt} refused`);
    assert.equal(game.rescues, attempt, 'rescues counted');
    assert.deepEqual(Array.from(game.board), board, 'the board is untouched');
    assert.equal(game.score, score, 'the score is untouched');
    assert.equal(game.tray.length, TRAY_SIZE);
    for (const piece of game.tray) assert.ok(piece !== null, 'the tray is full again');
    // The deal filters for pieces that fit, so a rescue is never another dead
    // tray. On this board that means a 1x1, which is all the diagonal allows.
    assert.ok(
      game.tray.some((piece) => hasAnyPlacement(game, piece.shapeId)),
      `rescue ${attempt} dealt another tray that cannot be played`
    );
    // Get stuck again, the way a player would, to spend the next rescue.
    if (attempt < MAX_RESCUES) {      game.tray = [0, 1, 2].map(() => ({ shapeId: barId(), colorIndex: 0 }));
      assert.equal(isGameOver(game), true);
    }
  }
  assert.equal(game.rescues, MAX_RESCUES, 'no more than the limit');
  assert.equal(canRescue(game), false, 'the offer is withdrawn');
  assert.equal(rescueTray(game), false, 'a fourth rescue is refused');
  assert.equal(game.rescues, MAX_RESCUES, 'and it does not count');
});

test('a rescue is only offered on a tray that cannot be played', () => {
  const game = createPlayableGame(7);
  assert.equal(isGameOver(game), false, 'a fresh tray can be played');
  assert.equal(canRescue(game), false, 'so no rescue is offered');
  assert.equal(rescueTray(game), false, 'and it cannot be taken');
  assert.equal(game.rescues, 0);

  // Nor may it be used to pick a better hand off a live board, which is the
  // whole reason the offer is tied to being stuck.
  const oneSlot = boardWithGaps(diagonalGaps());
  const single = SHAPES.find((s) => s.cells.length === 1);
  oneSlot.tray = [{ shapeId: single.id, colorIndex: 0 }, null, null];
  assert.equal(isGameOver(oneSlot), false, 'one playable piece is enough');
  assert.equal(canRescue(oneSlot), false);
  assert.equal(rescueTray(oneSlot), false);
  assert.equal(oneSlot.tray[0].shapeId, single.id, 'the tray is left alone');
});

test('a rescued tray is as deterministic as any other deal', () => {
  const a = stuckGame();
  const b = stuckGame();
  a.seed = 4242;
  b.seed = 4242;
  assert.equal(rescueTray(a), true);
  assert.equal(rescueTray(b), true);
  assert.deepEqual(a.tray, b.tray);

  // And it survives a restore mid-way, so a reloaded app deals the same again.
  // Both are restored from the same save and then stuck in the same way, so the
  // rescue has to come out identical on both sides of a reload.
  const stuckAgain = () => [0, 1, 2].map(() => ({ shapeId: barId(), colorIndex: 0 }));
  const c = deserialize(JSON.parse(JSON.stringify(serialize(a))));
  const d = deserialize(JSON.parse(JSON.stringify(serialize(a))));
  const before = serialize(c);
  c.tray = stuckAgain();
  d.tray = stuckAgain();
  assert.equal(rescueTray(c), true);
  assert.equal(rescueTray(d), true);
  assert.deepEqual(serialize(c), serialize(d));
  assert.notDeepEqual(serialize(c), before, 'the rescue really changed the tray');
});

test('rescues round-trip through the save, and old saves read as none', () => {
  const game = createPlayableGame(11);
  game.rescues = 2;
  assert.equal(deserialize(serialize(game)).rescues, 2);
  // A save written before rescues existed has no such field.
  const legacy = JSON.parse(JSON.stringify(serialize(game)));
  delete legacy.rescues;
  assert.equal(deserialize(legacy).rescues, 0);
  for (const bad of [-1, 1.5, '2', null, 99]) {
    const save = JSON.parse(JSON.stringify(serialize(game)));
    save.rescues = bad;
    const restored = deserialize(save);
    assert.ok(restored, 'a bad rescue count must not lose the save');
    assert.ok(restored.rescues >= 0 && restored.rescues <= MAX_RESCUES, `rescues=${restored.rescues}`);
  }
});

test('a new game starts with its rescues back', () => {
  const game = createPlayableGame(3);
  game.rescues = MAX_RESCUES;
  const fresh = createPlayableGame(3);
  assert.equal(fresh.rescues, 0);
  assert.equal(serialize(fresh).rescues, 0);
});

/**
 * The fairness guarantee. Every piece in a dealt tray is one that fits the board
 * as it stands, which means a tray is never dealt that the player cannot place
 * anything from — the case the keep-going card exists to rescue, and the reason
 * the old uniform deal felt unfair. It is a guarantee about each piece, not a
 * proof that all three can be played in some order, which would need a search
 * far too deep to run on a phone.
 */
test('no dealt piece is unplayable on the board it was dealt on', () => {
  let checked = 0;
  for (let gaps = GRID; gaps <= GRID * GRID; gaps += 2) {
    for (let salt = 0; salt < 4; salt++) {
      const game = staggeredBoard(gaps, salt);
      game.lines = 200; // every shape unlocked
      for (const piece of dealTray(game)) {
        checked += 1;
        assert.ok(
          hasAnyPlacement(game, piece.shapeId),
          `shape ${piece.shapeId} cannot be placed with ${gaps} gaps on the board`
        );
      }
    }
  }
  assert.ok(checked > 300, `only ${checked} pieces checked`);
});

test('a tray is composed, not rolled three times independently', () => {
  // These are the tray-level rules that make a tray playable as a unit. The old
  // uniform deal broke all of them: 73% of late trays held two or more pieces of
  // five cells or more, and a quarter held three.
  let trays = 0;
  for (const seed of [1, 7, 42, 2026, 987654321, 13, 99, 12345, 555, 8, 31, 64, 77, 88, 101]) {
    const game = createPlayableGame(seed);
    for (let step = 0; step < 120; step++) {
      game.lines = step * 3;
      const dealt = dealTray(game);
      trays += 1;
      const cells = dealt.map((piece) => SHAPES[piece.shapeId].cells.length);
      const families = dealt.map((piece) => SHAPES[piece.shapeId].family);
      assert.ok(cells.filter((c) => c >= 5).length <= 1, `tray has two 5-cell pieces: ${cells}`);
      const bigLimit = stageFor(game.lines) === 0 ? 1 : 2;
      assert.ok(
        cells.filter((c) => c >= 4).length <= bigLimit,
        `tray has too many 4-cell pieces for stage ${stageFor(game.lines)}: ${cells}`
      );
      assert.equal(new Set(families).size, families.length, `tray repeats a family: ${families}`);
      assert.equal(new Set(dealt.map((p) => p.shapeId)).size, TRAY_SIZE, 'tray repeats a shape');
    }
  }
  assert.ok(trays > 1000, `only ${trays} trays checked`);
});

/**
 * The board getting full is the difficulty, so the deal reacts to it. A tight
 * board gets small slot-fillers; a roomy one gets the bigger friendly pieces.
 * Both sides are dealt from the same seed and tray index, so the only difference
 * between them is the board.
 */
test('a tighter board is dealt smaller pieces', () => {
  const mean = (game) => {
    let total = 0;
    for (const piece of dealTray(game)) total += SHAPES[piece.shapeId].cells.length;
    return total / TRAY_SIZE;
  };
  let roomy = 0;
  let tight = 0;
  const samples = 40;
  for (let salt = 0; salt < samples; salt++) {
    const open = emptyBoard();
    open.lines = 200;
    const crowded = staggeredBoard(24, salt); // 62.5% full
    crowded.lines = 200;
    roomy += mean(open);
    tight += mean(crowded);
  }
  roomy /= samples;
  tight /= samples;
  assert.ok(roomy > tight, `a roomy board gave ${roomy.toFixed(2)} cells, a tight one ${tight.toFixed(2)}`);
  // The gap is the real assertion. An absolute number is only meaningful against
  // the catalogue's average, which is about 4.1 cells for the full pool and lower
  // once the one-five-cell and two-four-cell caps are applied.
  assert.ok(roomy - tight >= 0.8, `the gap is only ${(roomy - tight).toFixed(2)} cells`);
  assert.ok(roomy >= 3.2, `a roomy board should get the big pieces, got ${roomy.toFixed(2)}`);
  assert.ok(tight < 2.6, `a crowded board should get slot-fillers, got ${tight.toFixed(2)}`);
  assert.ok(boardPressure(new Uint8Array(GRID * GRID)) === 0, 'an empty board is no pressure');
  assert.ok(boardPressure(new Uint8Array(GRID * GRID).fill(1)) === 1, 'a full board is all pressure');
});

/**
 * The guarantee: a tray is nearly always carrying a small win.
 *
 * Only 30% of trays used to contain a piece that completed a line *at the moment
 * it was dealt*, which is what makes a long stretch of placements feel like
 * nothing is happening. Measured over real runs, a clear is completable at all
 * on 58% of trays, and the deal now reaches that ceiling — so this test asserts
 * the weaker, structural version: whenever a clear is available, one is dealt.
 */
test('a dry spell brings a line-clearing piece with the next tray', () => {
  const offersClear = (game, tray) =>
    tray.some((piece) => {
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          if (!fitsAt(game, piece.shapeId, x, y)) continue;
          const probe = Uint8Array.from(game.board);
          for (const [dx, dy] of SHAPES[piece.shapeId].cells) probe[(y + dy) * GRID + x + dx] = 1;
          const { rows, cols } = clearedLines(probe);
          if (rows.length + cols.length > 0) return true;
        }
      }
      return false;
    });

  let checked = 0;
  let satisfied = 0;
  for (let gaps = 12; gaps <= 40; gaps += 2) {
    for (let salt = 0; salt < 4; salt++) {
      for (const sinceClear of [0, 1, 2, 4, 9]) {
        const game = staggeredBoard(gaps, salt);
        game.lines = 100;
        game.sinceClear = sinceClear;
        const tray = dealTray(game);
        if (!offersClear(game, tray)) continue; // nothing was completable at all
        checked += 1;
        if (sinceClear >= 2) {
          assert.ok(
            offersClear(game, tray),
            `after ${sinceClear} dry placements a clear was available and none was dealt`
          );
          satisfied += 1;
        }
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} boards had a clear available, ${satisfied} asserted`);
});

/**
 * The ramp breathes. A player part-way through a dry spell is dealt smaller
 * pieces, and a player who has just cleared on a roomy board gets bigger ones.
 * Same seed and same tray index on both sides, so the only difference is
 * `sinceClear`.
 */
test('the cap eases down on a dry spell and up in flow', () => {
  const mean = (game) => {
    let total = 0;
    for (const piece of dealTray(game)) total += SHAPES[piece.shapeId].cells.length;
    return total / TRAY_SIZE;
  };
  let flowing = 0;
  let stuck = 0;
  const samples = 40;
  for (let salt = 0; salt < samples; salt++) {
    const inFlow = emptyBoard();
    inFlow.lines = 100;
    inFlow.sinceClear = 0;
    const dried = emptyBoard();
    dried.lines = 100;
    dried.sinceClear = 8;
    flowing += mean(inFlow);
    stuck += mean(dried);
  }
  flowing /= samples;
  stuck /= samples;
  assert.ok(flowing > stuck, `in flow got ${flowing.toFixed(2)} cells, stuck got ${stuck.toFixed(2)}`);
  assert.ok(flowing - stuck >= 0.8, `the breath is only ${(flowing - stuck).toFixed(2)} cells wide`);
  assert.ok(flowing >= 3.2, `a flowing player on a roomy board gets the big pieces, got ${flowing.toFixed(2)}`);
  assert.ok(stuck < 2.6, `a stuck player gets slot-fillers, got ${stuck.toFixed(2)}`);
});

test('the clear counter and the dry spell round-trip, and default generously', () => {
  const game = createPlayableGame(17);
  game.lines = 34;
  game.sinceClear = 2;
  const restored = deserialize(serialize(game));
  assert.equal(restored.lines, 34);
  assert.equal(restored.sinceClear, 2);
  // A save written before these fields existed reads as "nothing cleared yet and
  // no dry spell", which puts the player at the start of the ramp and in flow.
  const legacy = JSON.parse(JSON.stringify(serialize(game)));
  delete legacy.lines;
  delete legacy.sinceClear;
  const old = deserialize(legacy);
  assert.ok(old);
  assert.equal(old.lines, 0);
  assert.equal(old.sinceClear, 0);
  for (const bad of [-1, 1.5, '2', null, 1e9]) {
    for (const field of ['lines', 'sinceClear']) {
      const save = JSON.parse(JSON.stringify(serialize(game)));
      save[field] = bad;
      const back = deserialize(save);
      assert.ok(back, `a bad ${field} must not lose the save`);
      assert.ok(back.lines >= 0 && back.sinceClear >= 0, `${field}=${bad} read back badly`);
    }
  }
});

test('the dry spell resets on a clear and grows without one', () => {
  const game = singleCellGame(diagonalGaps());
  assert.equal(game.sinceClear, 0);
  const first = placePiece(game, 0, 0, 0);
  assert.equal(first.lines, 2, 'the fixture clears a row and a column');
  assert.equal(game.lines, 2, 'lines are counted');
  assert.equal(game.sinceClear, 0, 'and the dry spell stays at zero');

  // The other half needs a board loose enough that a one-cell piece has somewhere
  // to go that does not finish a line, which the diagonal fixture cannot offer —
  // on it every gap is the only gap in its row and its column.
  const single = SHAPES.find((s) => s.cells.length === 1);
  let placed = false;
  for (let gaps = 20; gaps <= 48 && !placed; gaps += 2) {
    for (let salt = 0; salt < 4 && !placed; salt += 1) {
      const loose = staggeredBoard(gaps, salt);
      loose.tray = [{ shapeId: single.id, colorIndex: 0 }];
      for (let y = 0; y < GRID && !placed; y += 1) {
        for (let x = 0; x < GRID; x += 1) {
          if (!fitsAt(loose, single.id, x, y)) continue;
          const probe = Uint8Array.from(loose.board);
          probe[y * GRID + x] = 1;
          const { rows, cols } = clearedLines(probe);
          if (rows.length + cols.length > 0) continue;
          const result = placePiece(loose, 0, x, y);
          assert.equal(result.lines, 0, 'this placement clears nothing');
          assert.equal(loose.lines, 0, 'so no lines are counted');
          assert.equal(loose.sinceClear, 1, 'and the dry spell starts');
          placed = true;
          break;
        }
      }
    }
  }
  assert.ok(placed, 'no board was found where a one-cell piece clears nothing');
});

/**
 * The complaint this whole change answers: a run was dying about eight trays in,
 * right as the awkward shapes arrived. A greedy bot is a stable stand-in for a
 * competent player, so the floor it reports is a floor on how long a run can be.
 *
 * The upper bound matters just as much and was added after getting it wrong.
 * Offering a line-clearing piece on *every* tray pushed the median to 184 trays
 * and the 90th percentile to 481, which is not a calm game — it is an endless
 * sandbox with no natural point to stop at, and the three refreshes exist
 * precisely so there is one. A run is a thing that finishes.
 */
test('runs last, but still finish', () => {
  const movesOf = (game) => {
    let guard = 0;
    while (!isGameOver(game) && guard < 6000) {
      guard += 1;
      let best = null;
      let bestScore = -1;
      for (let slot = 0; slot < TRAY_SIZE; slot++) {
        const piece = game.tray[slot];
        if (!piece) continue;
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            if (!fitsAt(game, piece.shapeId, x, y)) continue;
            const probe = Uint8Array.from(game.board);
            for (const [dx, dy] of SHAPES[piece.shapeId].cells) probe[(y + dy) * GRID + x + dx] = 1;
            const { rows, cols } = clearedLines(probe);
            const value = (rows.length + cols.length) * 1000 + SHAPES[piece.shapeId].cells.length;
            if (value > bestScore) {
              bestScore = value;
              best = [slot, x, y];
            }
          }
        }
      }
      if (!best) break;
      placePiece(game, ...best);
    }
    return Math.floor(game.moves / TRAY_SIZE);
  };

  const runs = [];
  for (let seed = 1; seed <= 150; seed++) runs.push(movesOf(createPlayableGame(seed)));
  runs.sort((a, b) => a - b);
  const at = (p) => runs[Math.floor((runs.length - 1) * p)];
  const short = runs.filter((r) => r < 10).length;
  assert.ok(at(0.5) >= 25, `median run is ${at(0.5)} trays, want at least 25`);
  assert.ok(at(0.1) >= 15, `10th percentile is ${at(0.1)} trays, want at least 15`);
  assert.ok(short / runs.length < 0.1, `${short} of ${runs.length} runs ended before tray ten`);
  assert.ok(at(0.9) > at(0.5), 'a better run should last longer than a median one');
  // Before any of this work a greedy run died at a median of 10 trays.
  assert.ok(at(0.5) <= 200, `median run is ${at(0.5)} trays, the game has stopped being a game`);
  assert.ok(at(0.9) <= 400, `90th percentile is ${at(0.9)} trays, runs need an ending`);
});

test('a full random game never produces an impossible state', () => {
  for (const seed of [1, 7, 42, 2026, 987654321]) {
    const game = createPlayableGame(seed);
    let guard = 0;
    while (!isGameOver(game) && guard < 5000) {
      guard += 1;
      const options = [];
      for (let slot = 0; slot < TRAY_SIZE; slot++) {
        const piece = game.tray[slot];
        if (!piece) continue;
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            if (fitsAt(game, piece.shapeId, x, y)) options.push([slot, x, y]);
          }
        }
      }
      assert.ok(options.length > 0, 'a playable game must offer a legal move');
      const [slot, x, y] = options[Math.floor(options.length / 2)];
      const result = placePiece(game, slot, x, y);
      assert.ok(result);
      assert.ok(game.score >= 0);
    }
    assert.ok(guard < 5000, 'games terminate');
    assert.ok(game.best > 0, `seed ${seed} scored nothing`);
  }
});

for (const { name, error } of failures) {
  const frame = (error.stack || '')
    .split('\n')
    .find((line) => line.includes('tests/run.js'))
    .trim();
  const detail = String(error.message).split('\n').slice(0, 6).join('\n      ');
  process.stdout.write(`FAIL  ${name}\n      ${detail}\n      ${frame}\n\n`);
}
process.stdout.write(`${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
