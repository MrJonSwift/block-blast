const SAVE_KEY = 'blockblast.save.v1';
const THEME_KEY = 'blockblast.theme.v1';
const HINT_KEY = 'blockblast.installHint.v1';
const BEST_KEY = 'blockblast.best.v1';

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable or full */
  }
}

export const storage = {
  loadGame: () => readJson(SAVE_KEY),
  saveGame: (data) => writeJson(SAVE_KEY, data),
  clearGame: () => remove(SAVE_KEY),

  loadBest: () => {
    const value = readJson(BEST_KEY);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  },
  saveBest: (value) => writeJson(BEST_KEY, value),

  loadTheme: () => {
    const value = readJson(THEME_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  },
  saveTheme: (value) => writeJson(THEME_KEY, value),

  hintDismissed: () => readJson(HINT_KEY) === true,
  dismissHint: () => writeJson(HINT_KEY, true),
};
