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
npm run test:browser   # optional: drives a throwaway headless Chrome (needs Chrome and Node 22+; set CHROME_PATH if it is not found)
```

What `npm test` covers: bulk purchases, prestige and what survives it, offline earnings, save migrations and damaged saves, cloud-save
conflicts between devices, save export/import, the first-run guide, ad consent, and clan buffs. The first group runs the real `main.js`
against a copy of `index.html` (`tests/helpers/game-harness.js`), so it checks what players get, not a re-implementation. The browser
test blocks ad, analytics, Firestore and Auth hosts, so it never touches production.

## Where things are

| | |
|---|---|
| `index.html`, `main.js` | the game page and most game logic |
| `core/` | logic that needs no page, tested on its own: `calc.js` (prices, bulk buying, prestige awards, offline earnings), `save.js` (versions, migrations, validation, what a prestige keeps), `progress.js` (cloud sync rules, backups, export/import), `guide.js`, `consent.js`, `clan-buffs.js` |
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
- Players can download and import their progress from Settings > Save backup. A save that cannot be read is kept under
  `whathappened_save_damaged` instead of being overwritten.

## Firebase rules

The rules live in the Firebase console, not in this repo; these files are what to paste there:

- `firestore-saves.rules`: private cloud saves (signed-in owner only).
- `firestore-codes.rules`: redeem codes (read one by name, never list or write).
- `firestore-social.rules`: leaderboard, chat and profiles. **Draft, not run against the emulator.** Read
  `docs/trust-boundaries.md` before publishing it.

## Ads and privacy

Nothing from Google AdSense or Google Analytics loads until the player presses Accept (`core/consent.js`); `privacy.html` says the same. For visitors in the EEA, UK and
Switzerland Google also requires its own certified consent message: turn that on in AdSense > Privacy & messaging. The ad slot id on the
game page (`data-ad-slot="1234567890"`) is a placeholder and needs your real one.
