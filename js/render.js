import { COLORS, GRID, SHAPES, TRAY_SIZE } from './game.js';

const ANIM_POP = 200;
const ANIM_CLEAR = 180;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

export function createRenderer({ board, tray, toast, stage }) {
  const cells = [];
  const slotNodes = [];
  let linesLayer;
  let previewLayer;
  let blockLayer;
  let metrics = { pitch: 0, block: 0, gap: 0, pieceCell: 0, cell0Left: 0, cell0Top: 0 };
  let boardNodes = new Map();

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const cell = el('div', 'cell', board);
      cells.push(cell);
    }
  }

  // Blocks live in their own absolutely positioned layer. As in-flow grid items
  // their explicit placements would make the auto-placement cursor skip those
  // cells and push the 64 auto-placed cells into extra rows.
  linesLayer = el('div', 'layer lines-layer', board);
  previewLayer = el('div', 'layer preview-layer', board);
  blockLayer = el('div', 'layer block-layer', board);

  for (let i = 0; i < TRAY_SIZE; i++) {
    const slot = el('div', 'slot', tray);
    slot.dataset.slot = String(i);
    slotNodes.push(slot);
  }

  /**
   * Reads the board geometry. Deliberately side-effect free: writing the piece
   * size here would resize the tray, which can reflow the board and make the
   * very numbers read below inconsistent with the ones used a moment later.
   */
  function measure() {
    const first = cells[0].getBoundingClientRect();
    const second = cells[1].getBoundingClientRect();
    const pitch = second.left - first.left;
    const block = first.width;
    const gap = Math.max(0, pitch - block);
    metrics = {
      pitch,
      block,
      gap,
      cell0Left: first.left,
      cell0Top: first.top,
      pieceCell: metrics.pieceCell,
    };
    return metrics;
  }

  /**
   * Sizes tray pieces. Kept separate from measure() so the tray's size is
   * settled before the board geometry is read, and so the tray's box is
   * independent of its contents (see the fixed tray height in styles.css).
   */
  function sizePieces() {
    const gap = measure().gap;
    const trayWidth = tray.clientWidth;
    const slotSize = trayWidth > 0 ? (trayWidth - 2 * gap) / 3 : 0;
    const cell = Math.max(10, Math.floor(Math.min(slotSize, 120) / 5.4));
    if (cell !== metrics.pieceCell) {
      metrics = { ...metrics, pieceCell: cell };
      tray.style.setProperty('--pcell', `${cell}px`);
    }
    return metrics;
  }

  function display(boardArray) {
    boardNodes = new Map();
    blockLayer.textContent = '';
    if (boardArray) {
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const value = boardArray[y * GRID + x];
          if (!value) continue;
          const node = el('div', `block c${value - 1}`, blockLayer);
          node.style.gridRow = String(y + 1);
          node.style.gridColumn = String(x + 1);
          boardNodes.set(`${x},${y}`, node);
        }
      }
    }
  }

  function markNew(placedCells) {
    for (const cell of placedCells) {
      const node = boardNodes.get(`${cell.x},${cell.y}`);
      if (node) node.classList.add('new');
    }
  }

  function markClearing(result) {
    for (const y of result.rows) {
      for (let x = 0; x < GRID; x++) boardNodes.get(`${x},${y}`)?.classList.add('clearing');
    }
    for (const x of result.cols) {
      for (let y = 0; y < GRID; y++) boardNodes.get(`${x},${y}`)?.classList.add('clearing');
    }
  }

  function setPreview(result) {
    previewLayer.textContent = '';
    linesLayer.textContent = '';
    if (!result) return;
    for (const y of result.rows) {
      const hint = el('div', 'line-hint', linesLayer);
      hint.style.gridRow = String(y + 1);
    }
    for (const x of result.cols) {
      const hint = el('div', 'line-hint', linesLayer);
      hint.style.gridColumn = String(x + 1);
    }
    for (const cell of result.cells) {
      const node = el('div', 'ghost-cell', previewLayer);
      node.style.gridRow = String(cell.y + 1);
      node.style.gridColumn = String(cell.x + 1);
      node.classList.add(`c${cell.colorIndex}`);
    }
  }

  function setInvalidPreview(shape, originX, originY) {
    previewLayer.textContent = '';
    linesLayer.textContent = '';
    if (originX < 0 || originY < 0) return;
    for (const [dx, dy] of shape.cells) {
      const x = originX + dx;
      const y = originY + dy;
      if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
      const node = el('div', 'ghost-cell invalid', previewLayer);
      node.style.gridRow = String(y + 1);
      node.style.gridColumn = String(x + 1);
    }
  }

  function buildPiece(piece) {
    const shape = SHAPES[piece.shapeId];
    const node = el('div', 'piece');
    node.style.gridTemplateRows = `repeat(${shape.height}, var(--pcell))`;
    node.style.gridTemplateColumns = `repeat(${shape.width}, var(--pcell))`;
    for (const [dy, dx] of shape.cells.map(([x, y]) => [y, x])) {
      const block = el('div', `piece-block c${piece.colorIndex}`, node);
      block.style.gridRow = String(dy + 1);
      block.style.gridColumn = String(dx + 1);
    }
    return node;
  }

  function renderTray(trayState, options = {}) {
    trayState.forEach((piece, i) => {
      const slot = slotNodes[i];
      slot.textContent = '';
      slot.classList.toggle('picked', options.pickedSlot === i);
      if (piece) slot.appendChild(buildPiece(piece));
    });
  }

  function floatScore(text, isCombo) {
    const node = el('div', `score-pop${isCombo ? ' combo' : ''}`, board.parentElement);
    node.textContent = text;
    setTimeout(() => node.remove(), 900);
  }

  let toastTimer = 0;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1200);
  }

  return {
    board,
    tray,
    cells,
    slotNodes,
    measure,
    sizePieces,
    display,
    markNew,
    markClearing,
    setPreview,
    setInvalidPreview,
    renderTray,
    floatScore,
    showToast,
    get metrics() {
      return metrics;
    },
    anim: { pop: ANIM_POP, clear: ANIM_CLEAR },
    colors: COLORS,
  };
}
