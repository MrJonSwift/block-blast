import assert from 'node:assert/strict';
import { LIFT_CELLS, ghostOffset } from '../js/input.js';
import {
  COLORS,
  GRID,
  SHAPES,
  SHAPE_COUNT,
  STAGE_COUNT,
  STAGE_SHAPES,
  TRAY_SIZE,
  anyTrayPlacement,
  clearedLines,
  createPlayableGame,
  dealTray,
  deserialize,
  fitsAt,
  hasAnyPlacement,
  isGameOver,
  placePiece,
  previewPlacement,
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
    assert.ok(shape.cells.length <= 25, 'shape fits the 5x5 design limit');
  }
  assert.equal(SHAPE_COUNT, SHAPES.length);
  assert.ok(SHAPE_COUNT > 60, `expected a rich shape set, got ${SHAPE_COUNT}`);
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
  assert.equal(deserialize({ version: 1, board: [1], tray: [] }), null);
  const extraFields = {
    version: 1,
    board: new Array(64).fill(0),
    tray: new Array(3).fill(null),
    seed: 1,
    draws: 0,
    staleJunk: true,
  };
  assert.ok(deserialize(extraFields), 'unknown fields are ignored, not rejected');
  const badTray = {
    version: 1,
    board: new Array(64).fill(0),
    tray: [{ shapeId: 9999, colorIndex: 0 }, null, null],
    seed: 1,
    draws: 0,
  };
  assert.equal(deserialize(badTray), null);
  const badColor = {
    version: 1,
    board: new Array(64).fill(0),
    tray: [{ shapeId: 0, colorIndex: COLORS.length + 5 }, null, null],
    seed: 1,
    draws: 0,
  };
  assert.equal(deserialize(badColor), null);
  const badCell = {
    version: 1,
    board: new Array(64).fill(COLORS.length + 9),
    tray: [null, null, null],
    seed: 1,
    draws: 0,
  };
  assert.equal(deserialize(badCell), null);
});

test('the first pieces of a run are small, and the awkward ones come later', () => {
  const opening = new Set();
  const later = new Set();
  // Sample every deal a game makes, bucketed by the stage that was live when it
  // was drawn. A handful of seeds is enough to see every shape in a pool.
  for (const seed of [1, 7, 42, 2026, 987654321, 13, 99, 12345, 555, 8]) {
    const game = createPlayableGame(seed);
    for (let moves = 0; moves < 200; moves++) {
      const bucket = stageFor(moves) === 0 ? opening : later;
      for (const piece of dealTray(game)) bucket.add(piece.shapeId);
      game.moves += 1;
    }
  }
  assert.ok(opening.size > 4, `the opening pool is ${opening.size} shapes`);
  for (const id of opening) {
    const shape = SHAPES[id];
    assert.ok(shape.cells.length <= 4, `stage 0 shape ${id} has ${shape.cells.length} cells`);
    assert.ok(shape.width <= 3 && shape.height <= 3, `stage 0 shape ${id} is ${shape.width}x${shape.height}`);
  }
  assert.ok(later.size > opening.size, `later stages must unlock more shapes: ${opening.size} -> ${later.size}`);
  const awkward = [...later].filter((id) => SHAPES[id].cells.length >= 6);
  assert.ok(awkward.length > 0, 'the 6-cell pieces only turn up later');
  assert.ok(!opening.has(awkward[0]), 'no 6-cell piece is dealt in the opening stage');
});

test('every shape is reachable eventually', () => {
  const seen = new Set();
  for (const seed of [1, 7, 42, 2026, 987654321, 13, 99, 12345, 555, 8, 31, 64]) {
    const game = createPlayableGame(seed);
    game.moves = 1000; // deep into the last stage
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

test('the stage advances on pieces placed, and never goes back', () => {
  assert.equal(stageFor(0), 0);
  assert.equal(stageFor(8), 0);
  assert.equal(stageFor(9), 1);
  assert.equal(stageFor(23), 1);
  assert.equal(stageFor(24), 2);
  assert.equal(stageFor(44), 2);
  assert.equal(stageFor(45), 3);
  assert.equal(stageFor(100000), STAGE_COUNT - 1);
  let previous = 0;
  for (let moves = 0; moves < 200; moves++) {
    const stage = stageFor(moves);
    assert.ok(stage >= previous, `stage went backwards at ${moves} moves`);
    previous = stage;
  }
  assert.ok(stageNameFor(0).length > 0, 'stages are named for the player');
});

test('a stage boundary survives a save and restore', () => {
  // The stage comes from `moves`, which is saved, so a game restored right on a
  // boundary has to deal the same pieces the uninterrupted game would.
  for (const moves of [0, 8, 9, 23, 24, 44, 45]) {
    const game = createPlayableGame(20260928);
    game.moves = moves;
    const copy = deserialize(JSON.parse(JSON.stringify(serialize(game))));
    assert.deepEqual(dealTray(copy), dealTray(game), `mismatch at ${moves} moves`);
    assert.deepEqual(serialize(copy), serialize(game));
  }
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
