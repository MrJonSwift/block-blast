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
- The game ends when no remaining piece fits anywhere. If that happens you get
  three **Keep going** chances to re-deal the tray, so one awkward piece does not
  have to end a run. It costs no score, and it is only ever offered on a tray
  that cannot be played, so it cannot be used to reroll for a better hand.
- Difficulty builds over a run rather than starting hard. The first pieces are
  single cells, dominoes, 3-bars, 2×2 squares and L's; the awkward shapes — 5-bars,
  6-cell L's, F and Y pieces — only turn up once you are well into the game. A
  new stage says so once, in a brief toast, and that is the only mention.
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
- **Shapes are dealt from a stage, not from the whole set.** `STAGES` in
  `js/game.js` lists shape *families* per stage, and each stage's pool contains
  the previous one's, so a shape you have never seen is never harder than the
  ones you know. The stage comes from pieces placed, not score, so playing well
  does not raise the stakes.
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
