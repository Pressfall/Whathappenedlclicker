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
conflicts between devices, save export/import, the first-run guide, ad consent, clan buffs, chat safety, the help pages (their tables against the game data), and the Wilds (weapon physics, crafting
scores, map generation, the recipe tree, caps on gems and Golden, and rewards reaching the game). The first group runs the real `main.js`
against a copy of `index.html` (`tests/helpers/game-harness.js`), so it checks what players get, not a re-implementation. The browser
test blocks ad, analytics, Firestore and Auth hosts, so it never touches production.

## Where things are

| | |
|---|---|
| `index.html`, `main.js` | the game page and most game logic |
| `core/` | logic that needs no page, tested on its own: `calc.js` (prices, bulk buying, prestige awards, offline earnings), `save.js` (versions, migrations, validation, what a prestige keeps), `progress.js` (cloud sync rules, backups, export/import), `guide.js`, `consent.js`, `clan-buffs.js` |
| `world.html`, `world*.js`, `world.css` | The Wilds: the top-down adventure (menu > The Wilds). Its rules are pure and tested in `core/world-*.js`: `world-data.js` (every table: zones, monsters, gear, recipes, caps), `world-logic.js` (the save, crafting, loot, death, trader, quests, statues), `world-combat.js` (mouse-driven weapon physics), `world-craft-score.js` (minigame scoring), `world-gen.js` (seeded maps), `world-bridge.js` (rewards to the main game, and rubies back), `world-gods.js` (the Hall of Gods statues, the hidden one too: costs, and the blessings main.js applies to the clicker; also loaded by index.html), `world-online.js` (PvP checks, loot bags, chat, shared bosses), `world-arena.js` (the Arena: who may hit whom there, duels and team battles run on every page from the same signed messages, Elo ratings, wagers, Glory, the queue, the leaderboard), `world-waves.js` (the Proving Grounds' co-op waves: the same wave on every page, harder with more players), `world-mobs.js` (shared monsters: the same kinds everywhere, kills, damage and fights), `world-party.js` (parties: members, tickets, their chat), `world-tour.js` (tournaments: the knockout bracket every page works out from the same record, walkovers and disputes, prize splits), `world-crew.js` (the crew: the clicker's upgrade characters who move to Wildgate once their upgrade's best level is high enough, their quests, shops, trades and the jukebox's music list; also loaded by index.html), `world-guilds.js` (hero guilds: one per clicker upgrade, sold by the Guildmaster by the Rune Altar, 6 in stock with a new stock every two days, each with a contract to finish first; counts live in the Wilds save and main.js reads them: +25% to that upgrade per guild, and `guilds.css` dresses up its button; also loaded by index.html), `world-net-tree.js` (the local relay's data). The page scripts: `world-engine.js` (loop, input, map), `world-actors.js` (player, monsters, bosses, rivals), `world-craft.js` (minigames), `world-ui.js` (HUD and menus), `world-online.js` (playing together), `world-arena.js` (the Arena's matches, Pit, menus), `world-waves.js` (running or following a co-op wave), `world-mobs.js` (sharing the zone's monsters), `world-party.js` (parties in every zone, the party chat and HUD), `world-tour.js` (opening, joining and playing tournaments, their menus), `world-net-rtdb.js` / `world-net-dev.js` (Firebase Realtime Database, or the local relay in `server.js`), `world.js` (wiring). Add `?whdebug` to the URL for a tuning overlay and test hooks. `tests/world-pace.test.js` keeps the Far Reaches (the four zones past the Waystone) slower than the first four: it works out kit costs, hits to kill and damage taken from the tables, so check it after any balance change there |
| `core/renown.js`, `renown-panel.js`, `renown.css` | Renown: one rank for the clicker and the Wilds together, worked out the same way on both pages from `achievements-data.js` `snapshot()` (both saves). Each level adds CPS and click power in the game (main.js `getRenownBonus`) and rubies in the Wilds (`playerStats`); every 5 levels is a milestone whose two halves are each claimed and noted on their own page. `renown-panel.js` is the ⭐ chip and panel on index.html; the Wilds' panel is in `world-ui.js` |
| `cloud.js`, `account.html/js` | Firebase sign-in and the cloud-save screens; the sync rules themselves are in `core/progress.js`. Both the game (`index.html`) and the Wilds (`world.html`) keep the signed-in account up to date, and the Wilds' save, play time and rubies count as progress there |
| `guide.js`, `save-tools.js`, `consent.css` | first-run guide card, Settings > Save backup, the ad notice |
| `how-to-play.html`, `wilds-guide.html`, `upgrades-followers-gems.html`, `faq.html`, `about.html`, `pages.css` | the help and info pages linked from the game's footer: static, no scripts (readable with JavaScript off), no ads. `tests/info-pages.test.js` checks their tables against the game data, so update them when prices or packs change |
| `sitemap.xml`, `robots.txt` | for search engines; add a new public page to the sitemap |
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
  `core/world-data.js`. An outbox entry can also carry `items`: consumables from the crew's quests, only the timed boosts listed
  in `ITEMS` in `core/world-bridge.js` (never gem or Golden items), and `packs`: follower packs bought with Glory, which main.js
  hands to `followers-data.js` `grantFreePacks` (they wait in the followers save's `freePacks`, to open free on the Followers page).
  Gems and Golden from the Glory shop go through the same daily caps as everything else from the Wilds.
- `whathappened_upgrade_best` (written only by `main.js`) keeps the best level each upgrade ever reached, so a prestige never sends
  the crew home from the Wilds; `whathappened_renown` (written only by `renown-panel.js` on the game page) lists the Renown
  milestones whose game half was claimed. The Wilds notes its own half in its save. Both keys are in `SYNC_KEYS`.
- Players can download and import their progress from Settings > Save backup. A save that cannot be read is kept under
  `whathappened_save_damaged` instead of being overwritten.
- Once a player has some progress (a special, 25 upgrade levels, or any prestige), the game page shows a one-time reminder to save to an
  account or download a save file (`guide.js`, rule in `core/guide.js` `saveReminderDue`). It is skipped if this browser already syncs
  to an account or a save file was downloaded, and remembers itself in `whathappened_save_reminder` (`shown` / `done`): a per-browser
  flag, not progress, so it is deliberately not in `SYNC_KEYS`.

## The Wilds online

Players in the same zone see each other live, chat, fight each other outside town (PvP) and share boss fights. In the Arena they
fight only in the Pit and in matches (duels, 2v2, 3v3), and in the Proving Grounds they fight waves together. In production this
runs on **Firebase Realtime Database**, which has to be switched on once in the Firebase console:

1. Build > Realtime Database > **Create database** (any location). If it is not in us-central1, copy the database URL shown at the
   top of its Data tab into `DATABASE_URL` in `world-net-rtdb.js`.
2. Realtime Database > Rules: paste `database.rules.json` and publish. (These are not the Firestore rules.)
3. Authentication > Sign-in method: enable **Anonymous**. Online play always signs in anonymously to this project (the Wilds' own, separate from the accounts project), so a player's account and saves are never involved.

Until that is done the Wilds still works; the 🌐 button just says online play isn't available. On `localhost`, `npm start` serves a
small stand-in for the database (in `server.js`), so online play can be tried with two browsers (or a normal and a private window)
without touching Firebase. Add `?whnet=rtdb` to the URL to use the real database locally, or `?whnet=off` to play offline.

**After an update that changes `database.rules.json`, publish it again** (step 2). Parties added `wilds/v1/party` (members,
tickets, the party chat); tournaments added `wilds/v1/arena/tour`, and the Proving Grounds' leaderboard `wilds/v1/arena/waves`:
without them there are no parties or tournaments online, and only the rating board. Shared monsters added `k` (when a monster fell) and `m` (the monsters a
player is fighting) to every wild zone. The Far Reaches, the Arena and the Proving Grounds
added zones (`coast`, `storm`, `ruins`, `sky`, `arena`, `trials`), new player fields (rating, title, class, match, queue, party, best
wave), messages between players (`d`: invitations and knockouts), the co-op waves' shared run (`w`) and the Arena's leaderboard
(`wilds/v1/arena/top`). With the old rules those zones simply have no online play: everything else, and the Proving Grounds alone,
still works; without the `k` and `m` rules every player simply has their own monsters, as before.

Cost: each player sends a short position line and receives the same from everyone else in their zone, so downloads grow with
the square of the players in a zone. Sends are throttled (`RATE` and `sendDue` in `core/world-online.js`): about 2.5 a second
while walking or aiming, about 6 a second only with another player close by outside town, a heartbeat every 2.5 s standing
still, and events (shots, casts, shield, getting hurt) at once. Measured on the local relay: ~0.2 KB/s per other player while
walking (it was ~0.75 KB/s at 10 a second), ~0.03 KB/s standing still. The free Spark plan allows 100 players online at once and
10 GB of downloads a month: roughly 90 hours a month of 10 players walking around together (it was ~30), more when they stand
around, less when they all fight side by side. **Co-op waves cost more**: the player running a wave sends where its monsters are
about 4.5 times a second (`RATE.hostHz` in `core/world-waves.js`, at most 24 monsters, at most 1,000 characters), so every other
player there downloads an estimated 3.5-4 KB/s while a full wave is on (worked out from the snapshot's size, not measured): a
15-minute run with 4 players is then about 10 MB, so 10 GB is roughly 900 such runs a month. Past either limit the database refuses players instead of billing; the 🌐 menu
then says the Wilds is full (try `WH_NET_MAX=1 npm start` to see it locally). `world.html?whdebug` shows the update rates and an
estimated download rate in the bottom-left overlay.

**Shared monsters are cheap**: every page builds the zone's monsters itself (same places and kinds, from the zone's seed), so no
monster positions travel while nobody fights. What is sent: a kill is one number (`k/<id>`), and a player fighting sends only the
monsters they are fighting, three times a second, about 30 characters each (`RATE` in `core/world-mobs.js`, at most 6 monsters,
at most 320 characters). Estimate, worked out from the report size and not measured: about 0.3-0.5 KB/s to each other player in the
zone while someone is fighting, and nothing while you are alone in a zone or nobody fights. It stacks on top of the position
traffic above, which is still the bulk of it.

**Parties, tournaments and the boards are small too.** A party member writes one short record when they change zone, and each
party chat line once (the last 30 are kept). A tournament is one record of a few KB at most (16 players and their results), read
while you are in it or have the Tournaments tab open; the leaderboards are read once when opened, and each player writes their own
row after a match or a new best wave.

## Firebase rules

The rules live in the Firebase console, not in this repo; these files are what to paste there:

- `firestore-saves.rules`: private cloud saves (signed-in owner only).
- `firestore-codes.rules`: redeem codes (read one by name, never list or write).
- `database.rules.json`: the Wilds online (Realtime Database, see above).
- `firestore-social.rules`: leaderboard, chat and profiles. **Draft, not run against the emulator.** Read
  `docs/trust-boundaries.md` before publishing it.

## Ads and privacy

Nothing from Google AdSense or Google Analytics loads until the player presses Accept (`core/consent.js`); `privacy.html` says the same.
The only ad slot is the banner on the game page. After Accept, `core/consent.js` also loads the AdSense code on the achievements, casino,
leaderboard and privacy pages (they have no slot); if you switch on Auto ads in AdSense, Google could place ads there, so either leave Auto
ads off or update `privacy.html`. The ad slot id on the game page (`data-ad-slot="1234567890"`) is a placeholder and needs your real one.

**Tips.** The Ko-fi links (page footer and Settings > Help & privacy) were taken out until there is a real Ko-fi page. To bring them back,
restore them from git history along with the Tips line in `privacy.html`, and update the Ko-fi test in `tests/info-pages.test.js`. Tips
must unlock nothing in the game (that test checks no game code mentions them).

**`core/consent.js` is not a Google-certified CMP.** For visitors in the EEA, UK and Switzerland Google requires its own certified consent
message (AdSense > Privacy & messaging > European regulations). That message is shown by the AdSense code itself, and the AdSense code only
loads after a visitor presses Accept in our notice, so once the Google message is published those visitors see **two prompts in a row**: ours,
then Google's (only if they allowed ads in ours; declining ours means neither ads nor Google's message). They don't overlap on screen,
both choices are respected, and our notice says Google may ask again. This is kept on purpose: it is strict opt-in everywhere (nothing from
Google loads before a choice, in any country), Analytics is never covered by Google's ad message so it needs our question anyway, and the
alternative (loading the AdSense code before any choice for those regions, guessing the region in the browser) would show no prompt at all
to anyone whose region was guessed wrong. Our notice offers Accept / Decline of equal weight plus Choose (ads and visit counting
separately, nothing ticked in advance; `wh_ad_consent` / `wh_analytics_consent`). AdSense now creates and publishes a message
automatically for new sites, so check Privacy & messaging even if you never set one up. This is not legal advice; if the game grows,
have someone qualified look at it.
