# Block Blast

A block-placement puzzle that runs entirely in the browser, works offline, and
remembers where you left off. No build step, no dependencies, no server.

Live at **https://mrjonswift.github.io/block-blast**

## Play on iPhone or iPad

1. Open the link in Safari.
2. Tap **Share**, then **Add to Home Screen** (turn off "Open as Web App" only if
   you would rather open it in a browser).
3. Launch it from the Home Screen icon.

Once it is a Home Screen app it runs with no browser chrome and works with no
network at all. Offline support only applies to the Home Screen app — a Safari
tab needs a connection.

## Rules

- 8×8 board, three pieces in the tray. A fresh three appear once the last one is
  used.
- Drag a piece onto the board. Valid drops show a ghost preview and highlight
  the rows and columns that will clear.
- Score: +1 per block, +10 per line cleared, plus a combo bonus of 18/36/54/72
  for clearing 2/3/4/5+ lines at once.
- The game ends when no remaining piece fits anywhere. When that happens the card
  offers to **use a refresh** — a fresh tray, board and score untouched — up to
  three times per run. Three is the point: a run that could go on for ever has no
  natural place to stop, so the chances are what make a session finish. It is
  only ever offered on a tray that cannot be played, so it cannot be used to
  reroll for a better hand.
- **The pieces are the easy half and the board is the hard half.** Nothing in the
  game is more than five cells, and the opening pool of 28 shapes is all bars,
  squares and small corner shapes — enough that you never see the same tray
  twice, and none of it able to end a run on its own. Each tray is dealt as a
  unit rather than rolled three times: you never get two of the same shape
  family, and at most one piece of five cells.
- **Difficulty breathes, and it watches how you are doing.** The ramp unlocks
  bigger shapes when you have cleared lines, not when time has passed, so a
  rough patch never arrives with harder pieces on top of it. Separately, the
  size of the pieces follows two things: how full the board is, and how many
  placements it has been since you last cleared a line. Six placements with
  nothing cleared and the next tray is small pieces; a clear on a roomy board
  and the next tray is generous again. If you go a couple of placements without a
  clear, the next tray is also guaranteed to contain a piece that completes a
  line wherever one is available.
- Theme follows the system setting and can be overridden with the toggle in the
  top right.

## How it is put together

| Path | Purpose |
| --- | --- |
| `js/game.js` | Board, pieces, scoring, seeded RNG, save format. No DOM. |
| `js/render.js` | Builds the board, tray, previews and animations. |
| `js/input.js` | Pointer dragging and snap-to-cell. |
| `js/storage.js` | `localStorage` reads and writes. |
| `js/main.js` | Wiring, persistence, theme, service worker registration. |
| `sw.js` | Precaches the shell so the app opens with no network. |

Two details worth knowing if you change this code:

- **Blocks render in their own layer** (`.block-layer`), not as grid items of the
  board. As in-flow items their explicit positions would make CSS Grid's
  auto-placement skip those cells and push the 64 auto-placed cells out of shape.
- **`measure()` never writes styles.** The board is sized from the space left
  over by the tray, so resizing tray pieces mid-drag used to reflow the board
  and shift the snap by a cell. `sizePieces()` is a separate step.
- **Shapes are dealt from a stage, and a stage is a superset of the last.** The
  stage comes from lines cleared, not pieces placed and not score, so playing well
  opens things up rather than raising the stakes, and a player who is struggling
  stays in the friendly pool. `sizeCap()` in `js/game.js` is the other half of
  the ramp and reacts to how full the board is and how long it has been since a
  clear.
- **A whole tray is dealt at once, from one seeded roll.** `dealTray()` composes
  the three pieces against the board as it stands, so it can promise that every
  one of them fits, and that after a dry spell one of them will complete a line.
  It is a function of the seed, the tray index, `lines`, `sinceClear` and the
  board — all saved — so a reloaded app deals the same trays again.
- **The dragged piece is held clear of the finger**, two cells away from it, so
  your hand does not cover the piece you are placing. The tray decides which
  way: up in portrait, where the tray is below the board, and out to the left in
  phone landscape, where the tray is a column beside it. The snap origin comes
  from the same position, so where the piece is drawn is where it lands. When
  the board leaves no room on that side, the hold shrinks to what is there.
  `ghostOffset()` in `js/input.js` is pure, and the browser harness imports it
  rather than repeating the maths.

## Development

```sh
npm install          # nothing to install; just sets the script runner up
npm test             # game logic tests (node, no browser)
npm run serve        # static server on 127.0.0.1:8731
npm run test:browser # drives the real app in headless Chrome at 7 viewports
npm run icons        # regenerate icons/ from tools/make-icons.ps1
```

`npm run test:browser` needs Chrome or Edge. It starts its own server, so stop
any other server on that port first, or pass a different one:

```sh
powershell -File tools/probe.ps1 -Port 9412 -Passes 3
```

`tests/probe.html` is the browser harness: it loads the real `index.html` in a
fixed-size iframe, plays moves with synthetic pointer events, reloads to verify
the save is restored, checks the layout at each viewport, and boots the app on
crafted saves to check the game-over card and the keep-going offer. It writes
its report as it goes, so a run that is cut short by the headless time budget
still shows how far it got.

## Deploying

Push to `master`. The GitHub Actions workflow runs the logic tests, then
publishes the app shell to GitHub Pages.

When you change any file that is part of the app shell, bump `CACHE` at the top
of `sw.js` so installed Home Screen apps pick up the new version.
