import { SHAPES, previewPlacement } from './game.js';

export function createDragController({ renderer, getGame, isBusy, onPlace, onDragStateChange }) {
  const drag = {
    active: false,
    slot: -1,
    shape: null,
    node: null,
    pointerId: null,
    originX: -1,
    originY: -1,
    valid: false,
  };

  function begin(event) {
    if (drag.active || isBusy()) return;
    const slotNode = event.target.closest('.slot');
    if (!slotNode) return;
    const slot = Number(slotNode.dataset.slot);
    const game = getGame();
    const piece = game.tray[slot];
    if (!piece) return;

    const shape = SHAPES[piece.shapeId];
    const { block, gap } = renderer.measure();
    const node = document.createElement('div');
    node.className = `drag c${piece.colorIndex}`;
    node.style.gridTemplateRows = `repeat(${shape.height}, ${block}px)`;
    node.style.gridTemplateColumns = `repeat(${shape.width}, ${block}px)`;
    node.style.gap = `${gap}px`;
    for (const [dy, dx] of shape.cells.map(([x, y]) => [y, x])) {
      const cell = document.createElement('div');
      cell.className = 'drag-block';
      cell.style.gridRow = String(dy + 1);
      cell.style.gridColumn = String(dx + 1);
      node.appendChild(cell);
    }
    document.body.appendChild(node);

    drag.active = true;
    drag.slot = slot;
    drag.shape = shape;
    drag.node = node;
    drag.pointerId = event.pointerId;
    // Capture keeps events flowing if the finger leaves the tray. It throws if
    // the pointer is already gone, which must not abort the drag.
    try {
      slotNode.setPointerCapture(event.pointerId);
    } catch {
      /* capture unavailable; the window-level listeners still work */
    }
    slotNode.classList.add('picked');
    onDragStateChange(true);
    move(event);
  }

  function move(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    const { block, gap, pitch, cell0Left, cell0Top } = renderer.measure();
    const pieceWidth = drag.shape.width * block + (drag.shape.width - 1) * gap;
    const pieceHeight = drag.shape.height * block + (drag.shape.height - 1) * gap;

    const left = event.clientX - pieceWidth / 2;
    const top = event.clientY - pieceHeight / 2;
    drag.node.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;

    // Measured from the first cell rather than the board's padding box: the
    // same fractional geometry that positioned the ghost, so the snap is exact.
    const originX = Math.round((left - cell0Left) / pitch);
    const originY = Math.round((top - cell0Top) / pitch);

    if (originX === drag.originX && originY === drag.originY) return;
    drag.originX = originX;
    drag.originY = originY;

    const result = previewPlacement(getGame(), drag.slot, originX, originY);
    drag.valid = Boolean(result);
    if (result) renderer.setPreview(result);
    else renderer.setInvalidPreview(drag.shape, originX, originY);
  }

  function finish(commit) {
    if (!drag.active) return;
    const { slot, originX, originY, valid } = drag;
    if (commit && valid) onPlace(slot, originX, originY);

    drag.node.remove();
    drag.active = false;
    drag.slot = -1;
    drag.shape = null;
    drag.node = null;
    drag.pointerId = null;
    drag.originX = -1;
    drag.originY = -1;
    drag.valid = false;

    renderer.setPreview(null);
    renderer.renderTray(getGame().tray);
    onDragStateChange(false);
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    begin(event);
  }

  function onPointerMove(event) {
    move(event);
  }

  function onPointerUp(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    finish(true);
  }

  function onPointerCancel(event) {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    finish(false);
  }

  // pointerdown starts on the tray; the rest are window-level so a drag keeps
  // tracking after the finger leaves the tray, with or without pointer capture.
  renderer.tray.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('blur', () => finish(false));
  window.addEventListener('contextmenu', (event) => {
    if (drag.active) event.preventDefault();
  });

  return {
    isDragging: () => drag.active,
    cancel: () => finish(false),
  };
}
