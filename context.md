# context.md

Written at the end of the first working session. Read this first in a new
session — it is the shortest path back to being useful.

## What this is

**Block Blast**, a block-placement puzzle, built as a static web app that works
offline and remembers an in-progress game. It is meant to be added to the iPhone
and iPad Home Screen and played like a native app.

- Repo: `https://github.com/MrJonSwift/block-blast` (public — GitHub Pages is
  only free on public repos)
- Branch: `master`
- Live: `https://mrjonswift.github.io/block-blast`
- Deploy: push to `master`; `.github/workflows/pages.yml` runs the logic tests,
  assembles the app shell into `_site/`, and publishes it.

Hard constraints, chosen up front and should not be undone casually:

- **No build step and no dependencies.** Plain ES modules served as-is. There is
  a `package.json` only to make `node tests/run.js` treat `.js` as ESM and to
  hold scripts. Do not introduce a bundler or a framework.
- **iOS-first.** Touch drag, no hover, no keyboard, safe-area insets, no
  network dependency.

## How to work on it

```sh
npm test             # 47 logic tests, plain node, no browser
npm run serve        # static server on 127.0.0.1:8731
npm run test:browser # 72 checks x 7 viewports in headless Chrome; starts its own server
npm run icons        # regenerate icons/ from tools/make-icons.ps1
```

Both test commands should be run before pushing. `npm run test:browser` needs
Chrome or Edge; pass a different port with
`powershell -File tools/probe.ps1 -Port 9412 -Passes 3`.

**Port 8080 is already taken by something else on this machine.** The dev server
defaults to 8731 and walks forward if the port is busy.

## Key files

| File | Lines | Role |
| --- | --- | --- |
| `js/game.js` | 717 | Board, shapes, stages, the tray dealer, scoring, seeded RNG, save format. **No DOM.** |
| `js/render.js` | 208 | Builds board cells, block layer, preview layers, tray, animations. |
| `js/input.js` | 188 | Pointer drag, ghost, snap-to-cell, the two-cell hold. |
| `js/main.js` | 303 | Wiring, save/restore, theme, game-over, SW registration. |
| `js/storage.js` | 53 | `localStorage` wrapper. |
| `styles.css` | 568 | Layout, both themes, animations, landscape layout. |
| `index.html` | 76 | Shell + iOS meta tags. |
| `sw.js` | 75 | Precaches the shell; cache-first. |
| `tests/run.js` | 1110 | Logic tests. |
| `tests/probe.html` | 757 | Browser harness (see below). |
| `tools/serve.js` | 72 | Zero-dep static server, binds `127.0.0.1`. |
| `tools/probe.ps1` | 106 | Runs the harness across viewports. |
| `tools/make-icons.ps1` | 107 | Generates the four PNG icons. |

`js/game.js` is deliberately DOM-free so it can be tested and reasoned about in
node. **Keep it that way** — it is the main reason the logic is trustworthy.

## Game rules as implemented

- 8x8 board (`GRID = 8`), 3 pieces in the tray (`TRAY_SIZE = 3`). A fresh three
  are dealt when the last piece is used.
- 13 shape families authored as ASCII art, expanded into **46** shapes — every
  distinct rotation and reflection of each family. Ids are indexes into the
  flattened list, because that is how a shape is looked up out of a save file.
- Each block stores a *colour index*, not just 1/0, so every block from one
  piece keeps that piece's colour.
- Scoring (`scoreForPlacement`): `filled + lines*10 + combo`, where combo is
  `18 * min(lines-1, 4)` for 2 or more lines. For a 5-cell piece that is
  +5, +15, +43, +71, +99, +127 for 0–5 lines.
- Game over when no remaining tray piece has any legal placement.
- Seeded `mulberry32` PRNG: the seed and a tray counter are saved, so a
  restored game deals exactly the pieces it would have dealt.

## The shape catalogue (rewritten 29 Sep 2026)

The player reported that the shapes were "off" and that a run lasted about a
minute before it was hit with "crazy and long shapes". Both complaints were
real, and both were measured before anything was changed.

**What was wrong.** Three separate faults, only the first of which was
suspected:

1. `dealPiece` drew each of the three tray pieces **independently and
   uniformly** from the stage pool. Nothing was in charge of what a tray
   contained. Measured: **73%** of late-game trays held two or more pieces of
   five cells or more, and **26%** held three.
2. The stage boundaries were `0 / 9 / 24 / 45` *pieces placed*, i.e. trays 0, 3,
   8 and 15. A greedy bot died at a **median of 32 pieces / 10 trays**, and 44%
   of runs ended before tray ten — so the 5- and 6-cell shapes were landing
   squarely in the middle of most runs rather than being a late ramp at all.
3. `buildShapes` expanded each family with only four transforms (the seed, one
   rotation, and the two mirrorings of those) instead of the full eight. A
   mirror is only a *new* piece if the piece is chiral, so this silently lost
   orientations: the L-tromino and L-tetromino came out as 4 of their 8, which
   means **the game contained no J shapes at all**, and the T and U lost one each.
   Separately, `y5` was byte-identical to `u3` (both `['#.#','###']`), so the
   "Y piece" was a duplicate of the U and one of the two family names expanded
   to nothing.

**The catalogue now** is 13 families / 46 variants, and **nothing is over five
cells**. Tier 0, available from the very first tray, is 28 variants and holds all
seven tetrominoes (I, O, T, L *and* J, S and Z), the shorter bars, the 2x2 and
the L-tromino. That is 3.5x the old opening pool of 8, and none of it able to
end a run by itself. The 5-cell pieces unlock at 45 pieces placed and the last
two families at 150.

Dropped entirely: the 3x3, all four 6-cell rectangles, the 6-cell L, F4/F5, Y5,
plus5 and the diagonal Z-staircase. The reason they went is not size alone — a
2x2 is 4 cells and trivial, a 5-bar is 5 cells and often a slog — it is that
they have notches, so they eat board space without ever lining a row up. The
survivors are bars, squares and small corner shapes, all of which push towards a
line clear.

## The measure of whether it worked

A greedy bot (`tests/run.js`, "runs last, but still finish") is the regression
test, because the complaint was about run length and nothing else can pin that:

| | before | after |
| --- | --- | --- |
| median run | 10 trays | **49 trays** |
| 10th percentile | 8 trays | **24 trays** |
| runs under 10 trays | 44% | **0%** |
| trays with 2+ pieces of 5+ cells | 73% | **0%** |
| dealt pieces that could not be placed | 8 in 34,551 | **0 in 34,032** |

By play quality: a bot that places at random gets a median of 6 trays, one that
prefers any clearing move 18, and one that maximises clears 49.

## The calm rework (29 Sep 2026, later the same day)

The first fix answered "the shapes are off and the ramp is too fast". Playing it
produced a different complaint, and a better diagnosis:

> I played the game and it killed me in a minute. I want to play this when I'm
> anxious, so it needs to feel successful rather than failing all the time.

That reframed the work. The shape ramp turned out to be a **background** worry.
The felt difficulty was something else, and measuring it gave a different target:

| | before | after |
| --- | --- | --- |
| trays offering a line-completing placement | 30% | **58%** |
| dry spells longer than 5 placements (casual) | 11% | **8%** |
| dry spells longer than 5 placements (greedy) | 11% | **0%** |
| longest dry spell seen (greedy) | 24 | **10** |
| median run, casual player | 18 trays | **40 trays** |

**58% is the ceiling**, not a stopping point: a clear is completable at all on
58% of trays in a real run, so the deal now reaches everything available without
a multi-move search. Stage 0 is the worst case at 51% because the pieces are
small and a fresh board is sparse; the last stage is 72%.

Three changes, and one of them is a deliberate reversal.

### 1. The ramp now advances on success, not on time

`stageFor(lines)`, at 20 and 60 lines cleared. A player who has placed 400 pieces
and cleared nothing is still in stage 0; a player who has cleared 60 lines is in
the last stage however few pieces it took.

**This reverses a decision recorded earlier in this file**, which gated the stage
on pieces placed and explicitly rejected gating on score because "playing well
would raise the stakes". That reasoning is right for a game about a high score.
Here playing well is meant to open things up. Score was rejected as the trigger
for a different reason: `scoreForPlacement` pays a point per block, so a player
grinding out 1×1s racks up a score without ever clearing anything.

### 2. The cap breathes in both directions

`sizeCap(stage, pressure, sinceClear)`:

```
if (sinceClear >= 6)     cap -= 2      // stuck: small pieces
else if (sinceClear >= 3) cap -= 1
else if (sinceClear === 0 && pressure < 0.4) cap += 1   // in flow: generous
```

This replaced a `Math.sin(moves / 12)` term. The sine was not only weaker, it was
**almost entirely dead code**: `breather` was only referenced inside the
`stageFor(moves) === 0` branch, so for the last 34 trays of a typical run it did
nothing at all, and while it was live its only effect was one notch in the first
fifteen. A clock cannot know how anyone is doing. `sinceClear` can.

The two inputs are not the same signal on purpose: a board can be roomy while the
player is stuck, and tight while they are in a rhythm.

### 3. A dry spell brings a line-clearing piece

`clearingShapes()` finds every shape in the pool with a placement that completes
a row or a column, and after two placements with nothing cleared one of the three
slots is *required* to take one.

**It is relief, not the default, and the first attempt got that wrong.** Offering
a clear on every tray pushed the greedy median from 49 trays to 184 and the 90th
percentile to 481 — three and a half hours in one run. That is not a calm game,
it is an endless sandbox, and it removes exactly the natural stopping point the
three refreshes exist to provide. Gating it on `sinceClear >= 2` brought the
median to 110 and p90 to 275.

Cost: the scan measures **109–254 µs per deal**, against 7–23 µs before it, so
about ten times the rest of a deal. Still nothing — a deal is once every three
placements, so it is a quarter of a millisecond against a move the player takes a
second over. The comment in `clearingShapes()` originally claimed this was "the
same order as the rest of a deal", which was a guess that turned out to be wrong
by an order of magnitude. It now says the measured numbers.

### The constraint to preserve

**No streaks, no session timers, no "you have been idle", no loss framing in
copy.** A streak counter is the obvious thing to add to a game like this and it
is the single worst addition available: it converts a calming activity into
something that can be lost, which is the opposite of what the game is for. The
card says "Out of room" while refreshes remain and "Run complete" once they are
spent; "Game over" appeared in neither, and had been sitting in the markup
unconditionally, so it was on screen even when three refreshes were available.

Three things to preserve if any of this is touched:

- **The stage is keyed on clears, and the guarantee is keyed on a dry spell.**
  Both are functions of saved state (`lines`, `sinceClear`, the board), so
  neither can break save-and-replay.
- **`sinceClear` defaults to 0 on a save that predates it**, which reads as "no
  dry spell" — the generous direction. `lines` defaults to 0, which puts a
  restored player at the start of the ramp.
- **A run must still finish.** The run-length test asserts an upper bound as well
  as a lower one, because the failure mode here is leniency, not harshness.


## How a tray is dealt

`dealTray()` composes the whole tray at once from a single seeded roll, rather
than rolling three times. The deal is a pure function of the seed, the tray
index, `lines`, `sinceClear` and the board — all of which are saved — so a
reloaded app deals the same trays again, and a refresh re-deals identically.

Per slot, it takes the tightest candidate set that is non-empty, relaxing in this
order: **the clear guarantee**, then **repeated family**, then **the size caps**,
then **`sizeCap`**, then **whether the piece fits at all**. The last two steps are
the point. Fitting on the board is the last thing given up, because a piece you
cannot place is a piece the player cannot act on, while two L's in one tray is
only a matter of taste. On a board with room for nothing but a 1x1 it deals three
1x1s — dull, but playable, and a tray that cannot be played is exactly the case
the refresh card exists to rescue.

The resulting guarantee: **every piece in a dealt tray has a legal placement on
the board it was dealt on.** A test asserts it across fifteen board densities.

Hard rules that survive every relaxation: never two pieces of the same family,
never two of five cells, and never more than two of four or more (one in tier 0).
A test checks all three over a thousand trays. The clear guarantee sits above all
of them and *can* override the family rule, which is a deliberate priority: a
tray with a clear in it is worth more than a tray with three different pieces.

### What was deliberately left out

A design sheet for this genre was used as inspiration. Three of its ideas are
**not** in the code, on purpose:

- **The 16-candidate full-solvability search** (proving all three pieces are
  playable in *some* order, with clears simulated mid-sequence). It is three
  levels deep with a board copy and a clear-scan at every node — measured as
  orders of magnitude more work than the placement filter. The filter plus the
  clear scan costs **109–254 µs** per deal, and a deal happens every third move,
  so it is free. The solvability search is not, and it would have to be justified
  by a measurement on a real phone first. It is the reason the clear rate sits at
  58%: that is what is completable, not what the deal fails to find.
- **The board-aware "constructive dealer"** fallback, which is a strict subset of
  what the relaxation ladder already does.
- **The finisher search** (depth-3 search for a sequence that empties the board).
  It is a nice moment but it is a whole extra endgame system.

The sheet's *principle* — that difficulty scales with board pressure and
awkwardness and never with piece length — is the thing that was adopted, and it
is the reason `sizeCap` exists.

### A note on the refresh tests

Two of the refresh tests had to be rewritten rather than adjusted, and the reason
is worth keeping: the new deal guarantees a playable piece, so a refresh can never
hand back another dead tray. The old test rescued three times in a row off one
board, which is now impossible to set up — after the first refresh the game is no
longer over, so `canRescue()` is correctly false. `stuckGame()` in `tests/run.js`
stages a dead position by hand, and the loop re-stages it between rescues the way
a player would.

## Storage keys

`blockblast.save.v1` (board/tray/score/moves/best/rescues/seed/draws),
`blockblast.theme.v1` (`system` | `light` | `dark`), `blockblast.best.v1`,
`blockblast.installHint.v1`. All saves are version-checked and silently
discarded if corrupt.

`rescues` was added after the first release and `SAVE_VERSION` stayed at 1,
because `deserialize` ignores unknown fields and defaults a missing one to 0.
That is deliberate: the field is optional, so an old save needs no migration.

`SAVE_VERSION` went to **2** with the new catalogue, which is the opposite case:
shape ids are indexes into a table that no longer exists, so a v1 save's ids name
the wrong shapes. It is dropped whole and a new run starts. `tests/run.js` asserts
that a v1 payload is rejected, and `tests/probe.html` imports `SAVE_VERSION`
rather than hard-coding 2, so the crafted saves cannot drift from the app.

## The refresh (added 28 Sep 2026, renamed 29 Sep)

The brief was a chill, low-stakes game, and the sharpest edge in it was that one
piece with nowhere to go ends the run. The card now offers to re-deal the tray,
up to `MAX_RESCUES` (3) times per run.

Two things make it safe, and both matter more than the button:

- **The offer is tied to being stuck.** `canRescue()` requires
  `isGameOver(game)`, so it can never be used to reroll a live hand for a better
  one. That is what the cap is protecting — without it an unlimited "reshuffle"
  would be a way to farm the best score.
- **It costs nothing.** The board and the score are untouched, so a rescued run
  is a real run. The re-deal goes through the seeded RNG like any other, which
  is what keeps a reloaded app replaying identically.

**Why three, and why not unlimited.** Making the run endable was the point: a
game that can go on for ever has no natural place to stop, which is its own kind
of pressure. The three chances are the soft ending — the card offers a choice
while they remain, and the third one is the point at which the run is genuinely
over. This is a deliberate decision against the "no fail state" option that was
considered and rejected for exactly that reason.

The name on the button is **"use a refresh"**, not "keep going": the run is not
over, and the card title reflects the difference — "Out of room" while refreshes
remain, "Run complete" once they are spent.

`rescues` is a single saved integer; `newGame()` gets a fresh game object so it
resets to 0 by construction. The card is rendered by one function in `main.js`
that asks the model whether the offer stands, so the rule lives in `game.js`
only, and the browser harness boots the app on crafted saves at
`rescues` 0, 2 and 3 to check the whole ladder and both card titles.

## The three bugs found on 28 Sep 2026, and why the code looks odd

These were all found by the browser harness, not by reading code. The fixes look
over-engineered unless you know the cause, so they are documented here and in
the README.

1. **Blocks must not be grid items of the board.** Rendered `.block` elements
   are absolutely positioned children of `.block-layer`, a sibling overlay with
   the same 8x8 grid. As in-flow items with explicit `grid-row`/`grid-column`
   they made CSS Grid's auto-placement cursor skip those cells and push the 64
   auto-placed `.cell`s into extra rows, silently misaligning the whole board.
   (Visible symptom was wrong `pitch` and an 8x8 grid with a 9th row.)

2. **`measure()` must never write styles.** The board is sized from the space
   left over by the tray, so sizing tray pieces reflows the board.
   `measure()` used to set `--pcell` as a side effect: it read the cell
   geometry, mutated the tray, the board moved, and the drag then computed its
   origin against a moved board with a stale pitch. This intermittently cost a
   move — worst in landscape — and was nearly impossible to reproduce by
   inspection. Now `measure()` is a pure read and `sizePieces()` is a separate
   step called from `relayout()`. The tray also has a **fixed height (104px)**
   in CSS so its contents can never change its own box.

3. **The game must be saved on every move.** It originally saved only on
   `pagehide`/`visibilitychange`. iOS can discard a web app without ever firing
   those, so closing from the app switcher could lose the last moves.
   `onPlace` now calls `persist()` immediately.

Three smaller ones, since they cost real time: shape ids were family indexes
rather than flattened indexes; `Uint8Array.from` coerced the `-1` sentinel in
`deserialize` back to `255`, silently defeating the validation (now validated
before conversion); and the first version of the drag hold was clamped with the
wrong term — it used the board's far edge, but the deepest legal piece is aimed
half a cell *above* that edge, so the clamp came out ~20px short on a 320px
screen. The unit tests in `tests/run.js` now pin that invariant.

## The two bugs found on 29 Sep 2026

The shape rewrite turned up two more, and both were invisible until measured.

4. **A family must be expanded through its whole orbit, not four transforms.**
   `buildShapes` used `[seed, rotate90(seed), mirror(seed), mirror(rotate90(seed))]`,
   which covers two rotations and two mirrors. That is not the dihedral group: a
   family needs all four rotations of itself *and* of its mirror, because a
   mirror is only a new piece if the piece is chiral. The L-tromino and the
   L-tetromino came out as 4 of their 8 — **so the game had no J pieces at all** —
   and the T and the U lost one orientation each. The user described the shapes as
   "off", and this is part of why: shapes that should have been in the tray never
   were. `orbitSeeds()` now does all eight, and a test recomputes every family's
   true orbit and compares counts, so a family that quietly shrinks fails the
   suite rather than the playtest.

5. **A family name must not point at a shape an earlier one already claims.**
   `y5` and `u3` were both authored as `['#.#','###']`. The dedupe dropped the
   second one, so the "Y piece" was a U and one family name expanded to nothing.
   The same thing nearly happened again during the rewrite: a `u4` authored as
   `['#.','##','#.']` is not a U at all, it is the L-tetromino, so it would have
   expanded to zero variants too. There is no 4-cell U — the smallest U is five
   cells. A test now walks `SHAPE_FAMILIES` and fails on any family that
   expands to nothing or that renders as a shape an earlier one already has.

6. **`hideOverlay()` must clear the keep-going button.** It only ever hid the
   card, leaving `keepGoing.hidden` at whatever `showOverlay()` last set. That
   only became visible once a rescue could deal a *playable* tray, because
   `keepGoing()` then takes the `hideOverlay()` path and never revisits
   `showOverlay()`. The card is invisible either way, so no player ever saw it —
   but the browser harness reads the button directly, and correctly refused to
   accept a stale state. `hideOverlay()` now resets it.

## Testing approach

`tests/probe.html` is a browser harness, not a test file. It fetches the real
`index.html`, injects it into itself, and drives it inside a fixed-size iframe
(so the layout is measured at a real phone viewport — headless Chrome clamps its
own window to about 500px, so `window-size` alone cannot reach 390px). It
synthesizes `PointerEvent`s to play real moves, then reloads the app to verify
the save is restored. It also runs a *snap sweep*: for each column it starts a
drag, reads the origin the app chose, and cancels — so the aim-to-cell mapping
is verified without touching the board.

Aiming in the harness mirrors the app's maths exactly (the app centres the piece
on the finger and then holds it clear, so the finger goes at
`cell0.left + cx * pitch + pieceWidth / 2 - ghostOffset().dx`). That maths now
lives in one exported pure function, `ghostOffset()` in `js/input.js`, and
`tests/probe.html` **imports it** rather than repeating it — so the formula
cannot drift. If you change the hold, the harness follows automatically.

Two things the harness taught us the hard way, both still true:

- The origin is read back from the rendered preview, so it can only be read from
  a *valid* one. An invalid preview drops the cells that fall off the board, and
  its bounding box then starts somewhere else. `sweepOk()` therefore only
  asserts the origin on valid previews, and requires at least 4 of 8.
- Never measure a piece's size by counting words in
  `style.gridTemplateColumns`: the tray uses `repeat(n, var(--pcell))`, so a
  2-wide piece counts as 4. `getComputedStyle` resolves it, or take the width
  and height from `SHAPES` like the app does.
- To boot the app on a save the test wrote, unload it first
  (`frame.src = 'about:blank'`) and only then write to `localStorage`. The app
  persists on `pagehide` — bug #3 above — so the outgoing document re-saves its
  own state on the way out and quietly replaces the crafted one. This cost an
  hour; `loadWithSave()` is the fix.
- `tools/probe.ps1` used to report a run with **zero** checks as a pass, since
  it counted `FAIL` lines and a crashed harness produced none. It now fails on
  an empty report. For the same reason `tests/probe.html` writes its report as
  it goes rather than only at the end: a run cut short by the headless
  `--virtual-time-budget` still shows how far it got. The budget is 120000 in
  `probe.ps1`; phase 3 needs four more app boots and does not fit in less.

## The drag hold (added 28 Sep 2026)

A finger covers whatever is under it, so the dragged piece is held two cells
clear of it. Which way depends on the tray, read from the measured layout
rather than a copy of the CSS breakpoint: the tray is below the board in
portrait, so the piece is held **up**; it is a column beside the board in phone
landscape, so the piece is held **out to the left**. The snap origin is derived
from the same position, so this one offset decides both where the piece is drawn
and where it lands.

The board usually fills its stage in landscape, so there is little room below
it. `ghostOffset()` clamps the hold to what the screen can spare:

    room = viewEdge - (cell0 + GRID * pitch) + pitch - block / 2 - EDGE

The deepest legal placement is a one-cell piece in the last origin, which is
aimed half a cell *above* the board's far edge — hence `+ pitch - block / 2`
rather than the board's edge itself. Getting that term wrong is the bug the
unit tests in `tests/run.js` were written to catch. The invariant to preserve
if you touch it: **the finger needed for the deepest legal placement is always
still on screen.**

## Current state

- Working tree has the shape/progression/calm rework uncommitted; deployed site
  is still the old build, live returns 200.
- `npm test` 47/47, `npm run test:browser` 76/76 at all 7 viewports, and the
  last full run was repeated 3x with no flakes. One earlier run showed a single
  `1024x768` failure that stopped after 49 checks and passed on two subsequent
  full runs — a mid-run cut, not a real failure, and the reason the harness writes
  its report as it goes.
- Offline was verified for real against the deployed site: load once to install
  the SW, then reload with `--host-resolver-rules="MAP * ~NOTFOUND"` and the app
  still boots from cache. **Not re-verified since the rewrite** — the cache name
  moved to `blockblast-v7` and the SHELL is unchanged, so it should still hold.
- **Not yet played on a real phone.** The greedy bot says runs last about five
  times longer, but a bot is not a thumb: the size-cap breakpoints and the
  45/150 boundaries are starting values and a playtest should decide whether they
  stay.
- No dev server left running; no stray files on disk.

## Things to know before changing things

- **Bump `CACHE` at the top of `sw.js` whenever an app file changes**
  (currently `blockblast-v7`), or already-installed Home Screen apps keep
  serving the old shell. `skipWaiting` + `clients.claim` handle the rest.
- The artifact must contain exactly the files in the `SHELL` array in `sw.js`.
  The workflow copies an explicit list into `_site/`; `upload-pages-artifact`
  passes its `path` to `tar` as a single argument, so a multi-line list there
  fails (this already bit us once).
- iOS quirks that are load-bearing: the meta tags in `index.html`,
  `viewport-fit=cover` plus `env(safe-area-inset-*)`, `touch-action: none` on
  the board and tray, `overscroll-behavior: none` to kill pull-to-refresh, and
  `100dvh` with a `vh` fallback. Offline only works from the Home Screen app,
  never from a Safari tab — hence the dismissible install hint.
- `container-type: size` on `.stage` is what makes the board the largest square
  that fits. `aspect-ratio` with `max-height: 100%` does **not** clamp
  reliably and broke iPad and phone landscape.
- The theme toggle cycles system → light → dark and always writes a resolved
  `data-theme` to `<html>`; there is no `prefers-color-scheme` media query in
  the CSS, by design, so the two themes are defined exactly once.

## Known gaps and possible next steps

Nothing is broken. These are deliberate omissions, in rough priority order:

- **No sound.** Decided against in the first session.
- **No haptics.** `navigator.vibrate` does not exist in iOS Safari; would need
  a different approach or nothing.
- **Single board, no modes.** No daily challenge, no streak, no high-score
  history (only a single best).
- **Game over detection is a brute-force scan** over all 64 origins for each
  tray piece on every move, and the deal filters candidates with the same scan
  (7–23µs a tray). Fine at this size; would need to be smarter if the grid grew.
- **A dealt tray is not proven solvable in some order.** Each piece is checked to
  have a legal placement on the board as it stands, which stops the tray that
  cannot be played at all. Proving all three can be placed in *some* order, with
  clears simulated mid-sequence, is a depth-3 search and was measured as far more
  expensive. It is the obvious next fairness upgrade if a playtest ever finds a
  tray that is individually playable but not as a set.
- **The install hint is not shown on desktop** and has no "don't ask again"
  beyond one dismissal, stored in localStorage.
- **No export/import of a save**, and no defence against a wiped
  `localStorage`. Home Screen apps are exempt from Safari's 7-day purge, so this
  is mostly theoretical, but it is the one way a real save could be lost.
- **Accessibility is basic:** the board has `role="grid"` but the cells are not
  focusable and there is no screen-reader announcement of score or game over.
- Not tested on real iOS hardware yet — only in headless Chrome at phone and
  tablet sizes. Worth a pass on a real device, especially drag feel and
  safe-area insets on notched models. The two-cell drag hold and the keep-going
  card both want a look on a real thumb: the first is a feel question no
  harness can answer, and the second is what a nervous player will actually
  press.
