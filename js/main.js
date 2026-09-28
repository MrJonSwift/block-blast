import { GRID, createPlayableGame, deserialize, isGameOver, placePiece, serialize } from './game.js';
import { createDragController } from './input.js';
import { createRenderer } from './render.js';
import { storage } from './storage.js';

const THEME_META = { light: '#eef1fa', dark: '#121420' };
const THEME_GLYPH = { light: '☀', dark: '☾', system: '◐' };
const THEME_ORDER = ['system', 'light', 'dark'];

const dom = {
  board: document.getElementById('board'),
  tray: document.getElementById('tray'),
  toast: document.getElementById('toast'),
  stage: document.querySelector('.stage'),
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  themeToggle: document.getElementById('theme-toggle'),
  themeGlyph: document.getElementById('theme-glyph'),
  overlay: document.getElementById('overlay'),
  overlayScore: document.getElementById('overlay-score'),
  overlayNote: document.getElementById('overlay-note'),
  newGame: document.getElementById('new-game'),
  install: document.getElementById('install'),
  installClose: document.getElementById('install-close'),
};

const media = window.matchMedia('(prefers-color-scheme: dark)');
let theme = storage.loadTheme();

function applyTheme() {
  const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_META[resolved]);
  dom.themeGlyph.textContent = THEME_GLYPH[theme];
  dom.themeToggle.setAttribute(
    'aria-label',
    `Theme: ${theme}. Tap to change.`
  );
}

function cycleTheme() {
  theme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  storage.saveTheme(theme);
  applyTheme();
}

media.addEventListener?.('change', () => {
  if (theme === 'system') applyTheme();
});

let game = loadOrCreateGame();
let busy = false;
let animating = 0;

const renderer = createRenderer(dom);

function loadOrCreateGame() {
  const best = storage.loadBest();
  const restored = deserialize(storage.loadGame());
  if (restored) {
    restored.best = Math.max(restored.best, best);
    return restored;
  }
  const fresh = createPlayableGame();
  fresh.best = best;
  return fresh;
}

function persist() {
  storage.saveGame(serialize(game));
  storage.saveBest(game.best);
}

function paintHud(bump) {
  dom.score.textContent = game.score.toLocaleString();
  dom.best.textContent = game.best.toLocaleString();
  if (bump) {
    dom.score.classList.remove('bump');
    void dom.score.offsetWidth;
    dom.score.classList.add('bump');
  }
}

function showOverlay() {
  dom.overlayScore.textContent = game.score.toLocaleString();
  dom.overlayNote.textContent = game.best === game.score ? 'New personal best' : `Best ${game.best.toLocaleString()}`;
  dom.overlay.hidden = false;
}

function hideOverlay() {
  dom.overlay.hidden = true;
}

function newGame() {
  game = createPlayableGame();
  game.best = Math.max(game.best, storage.loadBest());
  busy = false;
  hideOverlay();
  renderer.display(game.board);
  renderer.renderTray(game.tray);
  paintHud(false);
  persist();
}

function onPlace(slot, originX, originY) {
  const result = placePiece(game, slot, originX, originY);
  if (!result) return;

  // Reconstruct the board as it looks before the clear, so the dissolve
  // animation can play out on cells that are already logically gone.
  const shown = Uint8Array.from(game.board);
  for (const cell of result.cells) shown[cell.y * GRID + cell.x] = cell.colorIndex + 1;

  renderer.display(shown);
  renderer.markNew(result.cells);
  renderer.renderTray(game.tray);
  paintHud(true);
  // Save on every move: iOS can discard a web app without ever firing
  // pagehide, and the payload is tiny.
  persist();

  busy = true;
  animating += 1;

  renderer.floatScore(`+${result.gained}`, result.lines >= 2);

  const finish = () => {
    animating -= 1;
    if (animating === 0) {
      renderer.display(game.board);
      busy = false;
    }
  };

  if (result.lines === 0) {
    window.setTimeout(finish, renderer.anim.pop);
  } else {
    window.setTimeout(() => {
      renderer.markClearing(result);
      window.setTimeout(finish, renderer.anim.clear);
    }, renderer.anim.pop);
  }

  if (result.gameOver) {
    window.setTimeout(() => {
      persist();
      showOverlay();
    }, renderer.anim.pop + renderer.anim.clear + 120);
  }
}

const drag = createDragController({
  renderer,
  getGame: () => game,
  isBusy: () => busy,
  onPlace,
  onDragStateChange: (dragging) => {
    if (dragging) return;
    renderer.setPreview(null);
  },
});

dom.newGame.addEventListener('click', () => {
  drag.cancel();
  newGame();
});

dom.themeToggle.addEventListener('click', cycleTheme);

function maybeShowInstallHint() {
  if (storage.hintDismissed()) return;
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;
  if (standalone) return;
  dom.install.hidden = false;
}

dom.installClose.addEventListener('click', () => {
  dom.install.hidden = true;
  storage.dismissHint();
});

function relayout() {
  // Settle the tray's piece size first: it must not change the board's geometry
  // while a drag is reading it.
  renderer.sizePieces();
  renderer.measure();
  if (drag.isDragging()) drag.cancel();
}

window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => window.setTimeout(relayout, 120));

// The model is mutated synchronously on every move, so the save is always
// consistent, even if the app is backgrounded mid-animation.
function persistOnHide() {
  persist();
}

document.addEventListener('visibilitychange', persistOnHide);
window.addEventListener('pagehide', persistOnHide);

function boot() {
  applyTheme();
  relayout();
  renderer.display(game.board);
  renderer.renderTray(game.tray);
  paintHud(false);
  persist();
  maybeShowInstallHint();
  if (isGameOver(game)) showOverlay();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable (private mode, or non-https) */
    });
  });
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) relayout();
});
