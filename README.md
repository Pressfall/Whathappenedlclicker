# WHAT HAPPENED clicker

A browser idle/clicker game: plain HTML, CSS and JavaScript (no build step), with Firebase for optional accounts, cloud saves,
chat, clans and the leaderboard.

## Run it

```
npm start        # serves the folder at http://localhost:8000 (set PORT to change it)
```

Open `http://localhost:8000`. The game keeps its progress in the browser's `localStorage`. Sign-in and the online features
use the project's Firebase config from the HTML files, so they talk to the real Firebase project.

## Test it

```
npm install      # once; the only dependency is jsdom, used by the tests
npm test         # about a minute: unit tests plus the real game scripts running in jsdom
npm run test:browser   # optional: drives a throwaway headless Chrome (needs Chrome and Node 22+; set CHROME_PATH if it is not found),
                       # including two players meeting online in the Wilds (tests/browser/online.js)
```

What `npm test` covers: bulk purchases, prestige and what survives it, offline earnings, save migrations and damaged saves, cloud-save
conflicts between devices, save export/import, the first-run guide, ad consent, clan buffs, and the Wilds (weapon physics, crafting
scores, map generation, the recipe tree, caps on gems and Golden, and rewards reaching the game). The first group runs the real `main.js`
against a copy of `index.html` (`tests/helpers/game-harness.js`), so it checks what players get, not a re-implementation. The browser
test blocks ad, analytics, Firestore and Auth hosts, so it never touches production.

## Where things are

| | |
|---|---|
| `index.html`, `main.js` | the game page and most game logic |
| `core/` | logic that needs no page, tested on its own: `calc.js` (prices, bulk buying, prestige awards, offline earnings), `save.js` (versions, migrations, validation, what a prestige keeps), `progress.js` (cloud sync rules, backups, export/import), `guide.js`, `consent.js`, `clan-buffs.js` |
| `world.html`, `world*.js`, `world.css` | The Wilds: the top-down adventure (menu > The Wilds). Its rules are pure and tested in `core/world-*.js`: `world-data.js` (every table: zones, monsters, gear, recipes, caps), `world-logic.js` (the save, crafting, loot, death, trader, quests, statues), `world-combat.js` (mouse-driven weapon physics), `world-craft-score.js` (minigame scoring), `world-gen.js` (seeded maps), `world-bridge.js` (rewards to the main game, and rubies back), `world-gods.js` (the Hall of Gods statues, the hidden one too: costs, and the blessings main.js applies to the clicker; also loaded by index.html), `world-online.js` (PvP checks, loot bags, chat, shared bosses), `world-net-tree.js` (the local relay's data). The page scripts: `world-engine.js` (loop, input, map), `world-actors.js` (player, monsters, bosses, rivals), `world-craft.js` (minigames), `world-ui.js` (HUD and menus), `world-online.js` (playing together), `world-net-rtdb.js` / `world-net-dev.js` (Firebase Realtime Database, or the local relay in `server.js`), `world.js` (wiring). Add `?whdebug` to the URL for a tuning overlay and test hooks |
| `cloud.js`, `account.html/js` | Firebase sign-in and the cloud-save screens; the sync rules themselves are in `core/progress.js` |
| `guide.js`, `save-tools.js`, `consent.css` | first-run guide card, Settings > Save backup, the ad notice |
| `firestore-*.rules` | Firestore rules to copy into the Firebase console (see below) |
| `docs/trust-boundaries.md` | what the online features trust, and what is still open |

Files in `core/` work both as `<script>` tags in the browser and with `require()` in Node. New game logic that does not need the page
belongs there, with a test; `main.js` keeps a thin wrapper with the old function name so nothing else has to change.

## Saves

- The main save is `localStorage["whathappened_save"]` (and a legacy copy under `whathappened_save_v1`). To change its shape, bump
  `SAVE_VERSION` in `core/save.js` and add a step to `MIGRATIONS`; `tests/save.test.js` shows the pattern.
- **A new progress key must be added to `SYNC_KEYS` in `core/progress.js`**, or it will not follow the player to another device.
- The Wilds keeps its own save, `whathappened_world` (rubies, gear, materials; written only by `world.html`), so prestige never
  touches it. Gems, Golden What Happened and lootboxes earned there are listed in that save's outbox; the game applies them when it
  opens (or right away if it is open in another tab) and records the last one applied in `whathappened_world_ack` (written only by
  `main.js`). One writer per key means neither page can overwrite the other. How much reaches the game is capped in `CAPS` in
  `core/world-data.js`.
- Players can download and import their progress from Settings > Save backup. A save that cannot be read is kept under
  `whathappened_save_damaged` instead of being overwritten.

## The Wilds online

Players in the same zone see each other live, chat, fight each other outside town (PvP) and share boss fights. In production this
runs on **Firebase Realtime Database**, which has to be switched on once in the Firebase console:

1. Build > Realtime Database > **Create database** (any location). If it is not in us-central1, copy the database URL shown at the
   top of its Data tab into `DATABASE_URL` in `world-net-rtdb.js`.
2. Realtime Database > Rules: paste `database.rules.json` and publish. (These are not the Firestore rules.)
3. Authentication > Sign-in method: enable **Anonymous**. Players who are signed in to an account play as that account.

Until that is done the Wilds still works; the 🌐 button just says online play isn't available. On `localhost`, `npm start` serves a
small stand-in for the database (in `server.js`), so online play can be tried with two browsers (or a normal and a private window)
without touching Firebase. Add `?whnet=rtdb` to the URL to use the real database locally, or `?whnet=off` to play offline.

Cost: each player sends a short position line about 10 times a second while moving, and receives the same from everyone else in
their zone (about 1 KB/s per other player). The free Spark plan allows 100 players online at once and 10 GB of downloads a month,
which is roughly 30 hours a month of 10 players playing together; switch to the Blaze plan if the game outgrows that.

## Firebase rules

The rules live in the Firebase console, not in this repo; these files are what to paste there:

- `firestore-saves.rules`: private cloud saves (signed-in owner only).
- `firestore-codes.rules`: redeem codes (read one by name, never list or write).
- `database.rules.json`: the Wilds online (Realtime Database, see above).
- `firestore-social.rules`: leaderboard, chat and profiles. **Draft, not run against the emulator.** Read
  `docs/trust-boundaries.md` before publishing it.

## Ads and privacy

Nothing from Google AdSense or Google Analytics loads until the player presses Accept (`core/consent.js`); `privacy.html` says the same. For visitors in the EEA, UK and
Switzerland Google also requires its own certified consent message: turn that on in AdSense > Privacy & messaging. The ad slot id on the
game page (`data-ad-slot="1234567890"`) is a placeholder and needs your real one.
