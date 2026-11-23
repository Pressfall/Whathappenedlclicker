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
                       # including two players meeting online in the Wilds (tests/browser/online.js) and the clan page with
                       # events paying out on both pages (tests/browser/clans.js; SHOTS_DIR=<folder> saves screenshots)
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
| `core/` | logic that needs no page, tested on its own: `calc.js` (prices, bulk buying, prestige awards, offline earnings), `save.js` (versions, migrations, validation, what a prestige keeps), `progress.js` (cloud sync rules, backups, export/import), `guide.js`, `consent.js`, and the clans' rules (below) |
| `world.html`, `world*.js`, `world.css` | The Wilds: the top-down adventure (menu > The Wilds). Its rules are pure and tested in `core/world-*.js`: `world-data.js` (every table: zones, monsters, gear, recipes, caps), `world-logic.js` (the save, crafting, loot, death, trader, quests, statues), `world-combat.js` (mouse-driven weapon physics), `world-craft-score.js` (minigame scoring), `world-gen.js` (seeded maps), `world-bridge.js` (rewards to the main game, and rubies back), `world-gods.js` (the Hall of Gods statues, the hidden one too: costs, and the blessings main.js applies to the clicker; also loaded by index.html), `world-online.js` (PvP checks, loot bags, chat, shared bosses), `world-arena.js` (the Arena: who may hit whom there, duels and team battles run on every page from the same signed messages, Elo ratings, wagers, Glory, the queue, the leaderboard; monthly seasons in UTC: `rollSeason` softly resets the rating at the turn, `claimSeason` pays the best rank's Glory and, from Gold, a season title, and the board is `wilds/v1/arena/season/s{YYYY-MM}`; the old all-time `arena/top` is no longer written), `world-waves.js` (the Proving Grounds' co-op waves: the same wave on every page, harder with more players), `world-mobs.js` (shared monsters: the same kinds everywhere, kills, damage and fights), `world-party.js` (parties: members, tickets, their chat), `world-tour.js` (tournaments: the knockout bracket every page works out from the same record, walkovers and disputes, prize splits), `world-crew.js` (the crew: the clicker's upgrade characters who move to Wildgate once their upgrade's best level is high enough, their quests, shops, trades and the jukebox's music list; also loaded by index.html), `world-dungeons.js` (the hidden dungeons: one under each zone, its way down hidden off the roads (`world-gen.js placeEntrance`) until that zone's boss has fallen to you; alone or a party of up to 4, each party its own copy under the zone key `<dungeon>_<party id>`; three rooms run like the waves (world-waves.js, `roomComposition`, doors from `doorOpen`, a wipe repeats only that room), then the dungeon's boss with health for the party (`bossHp`), the Shared Burden and an enrage; rubies per room and a chest of essences (`chestRoll`) up to daily limits, a dungeon rests 30 minutes after its boss falls to you (`restLeft`), the boss's first kill a week is boosted (its Heart, maybe a Catalyst, a big boss chest) and later kills open a small boss chest out of the day's chests, `world-logic.js` `dungeonRoomCleared` / `dungeonBossLoot`; the Sunken Vault is the coast's, its Drowned King still pays Glory, Vault Seals and a Golden Chest, and Maren's Seal shop is `D.VAULT_SHOP`), `world-relics.js` (the Crucible: forge odds from essences, score, luck, Resonance, a Catalyst and pity, with Mythic and Primordial capped; relic boosts, colours from the essences, uniques, sockets and combos, upgrades; `tools/simulate-relics.js` checks how long each tier takes to find), `world-fuse.js` (fusing at the Crucible: five Wilds relics of one tier and kind become one a tier higher or are all lost; the odds and what feeding essences, rubies and a Catalyst adds; never past your blueprints, never into Mythic or Primordial, never gear for the clicker), `gear.js` (relic tiers, gear for the clicker's five slots and its boosts, the uniques' names, shapes and outlines, and the SVG pictures; also loaded by index.html), `world-market.js` (trading and the Auction Hall: items packed and cleaned on arrival, the deal hash both sides confirm, listings, bids, claims and payouts, and `allowedAuctionWrite`, which says what the database rules allow), `world-guilds.js` (hero guilds: one per clicker upgrade, sold by the Guildmaster by the Rune Altar, 6 in stock with a new stock every two days, each with a contract to finish first; counts live in the Wilds save and main.js reads them: +25% to that upgrade per guild, and `guilds.css` dresses up its button; also loaded by index.html), `world-net-tree.js` (the local relay's data). The page scripts: `world-engine.js` (loop, input, map), `world-actors.js` (player, monsters, bosses, rivals), `world-craft.js` (minigames), `world-ui.js` (HUD and menus), `world-online.js` (playing together), `world-arena.js` (the Arena's matches, Pit, menus), `world-waves.js` (running or following a co-op wave), `world-mobs.js` (sharing the zone's monsters), `world-party.js` (parties in every zone, the party chat and HUD), `world-relics.js` (the Crucible's screens: forge, blueprints, infuse, upgrade, fuse, the Relic Satchel), `world-market.js` (the trade window, the Auction Hall and the loop that settles trades and auctions), `world-tour.js` (opening, joining and playing tournaments, their menus), `world-net-rtdb.js` / `world-net-dev.js` (Firebase Realtime Database, or the local relay in `server.js`), `world.js` (wiring). Add `?whdebug` to the URL for a tuning overlay and test hooks. `tests/world-pace.test.js` keeps the Far Reaches (the four zones past the Waystone) slower than the first four: it works out kit costs, hits to kill and damage taken from the tables, so check it after any balance change there |
| `core/renown.js`, `renown-panel.js`, `renown.css` | Renown: one rank for the clicker and the Wilds together, worked out the same way on both pages from `achievements-data.js` `snapshot()` (both saves). Each level adds CPS and click power in the game (main.js `getRenownBonus`) and rubies in the Wilds (`playerStats`); every 5 levels is a milestone whose two halves are each claimed and noted on their own page. `renown-panel.js` is the ⭐ chip and panel on index.html; the Wilds' panel is in `world-ui.js` |
| `core/challenges.js`, `challenges-panel.js`, `challenges.css` | daily and weekly challenges (the 📋 chip in the game): three of each, picked per day (local) or week (the Wilds' weeks) from `POOL`, only ones the player can do. Progress is a lifetime counter from `achievements-data.js` `snapshot()` (main.js `WHGame.liveSnapshot()`) less its value when the period began; upgrade levels bought are counted by the module itself, so prestiges don't undo them. Dailies pay boosts (all three: an Iron Chest; every 7th day in a row: a Golden Chest); weeklies pay 1 gem and an Hourglass (all three: 2 gems and a Golden Chest), so 5 gems a week at most. State in localStorage `whathappened_challenges` (synced), written only by the game page; a claim is saved before it is paid. how-to-play.html's numbers are tested |
| `core/premium.js`, `core/premium-config.js`, `core/kofi.js`, `premium.js`, `premium-panel.js`, `premium-cloud.js`, `premium.css` | **Holy What Happeneds 👼**, the currency for titles and looks (page themes, clicker hats and accessories (one of each at a time), auras, click numbers, chat effects sent with each chat message as `fx`; in the Wilds weapon skins with hit effects, trails, headwear, wings, tails and outfits, which other players see: `core/world-online.js` `packLooks` carries them in the `lk` string; old `mk_` ids are renamed in `RENAMED`), buffs for a week or a month: 2x clicks, 2x CPS, 2x offline, +10% crit, or all at once (main.js `getHolyBoosts` / `holyOfflineMult`), and, with no limit, gem packs (10 gems each, bigger packs with a bonus, main.js `addGems`), Golden (`x_golden`: 3x the next prestige, at least 15, main.js `getPotentialPrestigeAwards` / `addGolden`), timelapses (hours of income at once, main.js `addCpsSeconds`, plus the followers' eggs and pack cooldowns, `followers-data.js` `skipTime`) and boost bundles (`b_rush`, through items.js `grantItems`, only boosts `core/world-bridge.js` `ITEMS` allows), those four game page only: earned by playing, or bought on Ko-fi. `core/premium-config.js` is the one file the owner edits (Ko-fi page, the price-to-Holy What Happeneds table, the worker's address). Earned Holy What Happeneds are worked out from the saves (`sources`: achievements by rarity, first boss wins, the weekly challenge bonus, every 7th daily streak day, Arena seasons, Varro's 1,500-Glory item) and paid once per grant id; they live in `whathappened_premium` (synced). Bought Holy What Happeneds live only in Firestore `wallets/{uid}`, credited by the Ko-fi worker; the page can only spend them (`firestore-premium.rules`). They never buy boxes, packs, rubies or anything random themselves, and the casino doesn't take them (`tests/premium.test.js`); gems and Golden traded for them can go on lootboxes and casino bets like any others (the owner's choice, 2026-11-10). `node tools/simulate-beans.js` prints what players earn against the prices |
| `kofi-worker/` | the Ko-fi webhook: a Cloudflare Worker that checks the verification token, credits each Ko-fi transaction once into `wallets/{uid}` by the link code in the message, keeps unmatched payments for claiming, and stores no name, email or message. Setup: `docs/kofi-setup.md`; tests: `tests/kofi-worker.test.js`. `node tools/kofi-test-payment.js --code WH-... --amount 5` sends a pretend tip signed with your verification token (from `kofi-worker/.dev.vars`), to test the deployed worker without spending money |
| `core/clan-roles.js` | who may change what in a clan: ranks, and `classifyClanUpdate` (create, claim, join, leave, kick, role, transfer, rename, manage, progress, delete), which the clan page checks with and `firestore-social.rules` mirrors. A clan is held by sign-in ids (`ownerUid`, `roles`, `names`, `acct`); creating, owning and co-leader need an account; old clans are claimed by their owner opening the clan page signed in. `memberByName` / `roleOfName` / `memberIn` (by sign-in id first, so a new name never reads as a kick) let the game notice a kick or a deleted clan; `renameSelf`: a member's own new name; `joinMode` / `minPrestige`: open or closed clans and a prestige requirement |
| `core/clan-levels.js`, `core/clan-buffs.js`, `core/clan-events.js` | the clans' numbers, one copy for both pages: the XP curve, level perks and check-in Clan Points, clan XP from claimed daily and weekly challenges (`questXpOwed`) and this week's contributors (`contrib`, weeks from Monday UTC); the shop's buffs (what a buff multiplies comes only from this table) and filling a buff's bar (`contribute`); clan events: the schedule (`rollSchedule`, 3-day events and 2-day rests), what each kind counts, rewards (`rewardFor`), Clan v Clan pairs and race groups, the bossfight's phase twists (`bossDamage`), Prestige Party placement of prestiges made before a reload, the challenges, the Wilds Hunt (`wh`: monsters defeated in the Wilds, `wildsKillDelta`, members' `wildsCard`), the history of ended events (`events/last_ended_event.recent`, up to 10) and `payEnded`, the one routine that pays a player for ended events (once: claims in localStorage `whathappened_<kind>_claimed_<start>`, synced; across tabs under a Web Lock) |
| `clan.html`, `clan-page.js`, `clan-events-tab.js`, `clans.css` | the clan page: `clan-page.js` (your clan or a preview, members and their menus, chat, check-in, the finder, managing, the shop) starts `clan-events-tab.js` (the Events tab: keeps the schedule moving in a transaction, draws up pairings and boss meta, shows the event with live progress and contributors, runs the challenge events, pays rewards). Where the clan page changes the game's save it also writes `whathappened_clan_delta`, so a game tab that is open takes the change in instead of saving over it |
| `clan-wilds.js` | the clan from the Wilds (world.html, a module; only while in a clan): monsters defeated during a Wilds Hunt go to `events/wilds_hunt_progress`, and a heartbeat with the player's Wilds card shows them "In the Wilds" on the clan page |
| `clan-game.js` | the clan on the game page: gives the clan XP for each claimed challenge, listens to the clan document and the schedule (a Firestore read only when they change), keeps level perks and buffs current, notices a kick or a deleted clan, moves the schedule on when a slot ends (the same transaction as the clan page, `upkeepTx`), so payouts never wait for someone to open the clan page, sends what events count (clicks for Clan v Clan and the bosses, with each phase's twist, into `events/<kind>_progress` with `increment`; prestiges noted before the reload and sent after it), and pays event rewards in the background, so a player who never opens the clan page still gets them |
| `cloud.js`, `account.html/js` | Firebase sign-in and the cloud-save screens; the sync rules themselves are in `core/progress.js`. Both the game (`index.html`) and the Wilds (`world.html`) keep the signed-in account up to date, and the Wilds' save, play time and rubies count as progress there |
| `guide.js`, `save-tools.js`, `consent.css` | first-run guide card, Settings > Save backup, the ad notice |
| `manifest.webmanifest`, `sw.js`, `pwa.js`, `mainimage/icons/` | installing the game as an app. Every page links the manifest. `pwa.js` (loaded by the game and the Wilds) registers the service worker and runs Settings > App > Install. `sw.js` takes pages and code from the network first (the kept copy only when offline), images and sounds from the kept copy refreshed in the background, and never touches other sites (Firebase, ads, fonts) or `/__net/`. Bump its `VERSION` only to throw away everything kept. `_headers` stops hosts caching `sw.js`. The icons come from `node tools/make-icons.js` |
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
- `whathappened_premium` (Holy What Happeneds, `core/premium.js`) is written by both the game and the Wilds, always read fresh and written back at
  once (and under a Web Lock), so neither writes an old copy over the other. It lives outside the main save, so the main save's
  shape (and `SAVE_VERSION`) did not change.
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
- Gear for the game (forged in the Wilds' Crucible) travels in the outbox's `gear` list, checked piece by piece with
  `core/gear.js cleanPiece`; `gear-panel.js` is the only writer of `whathappened_gear` (the pieces and what is worn; in
  `SYNC_KEYS`, never touched by a prestige) and main.js reads its boosts through `getGearBonuses`. A piece sent back to the Wilds
  goes into the inbox's `gear` list, which only main.js writes (`queueWorldGear`); the Wilds puts it in its Relic Satchel.
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
around, less when they all fight side by side. **Real fights send faster** (`sendMode` in `core/world-online.js`): 15 a second
in a live Arena match or the Pit (`duelHz`), 10 a second while a co-op wave or dungeon room is fought (`coopHz`), back to the
rates above as soon as the fight ends. A five-minute duel is then about 0.5 MB for each of the two players. **Co-op waves cost
the most**: the player running a wave sends where its monsters are 10 times a second during a fight and twice a second between
waves (`RATE.hostHz` / `idleHostHz` in `core/world-waves.js`, at most 24 monsters, at most 1,000 characters), so every other
player there downloads an estimated 9 KB/s while a full wave is on (worked out from the snapshot's size, not measured; it was
about 4 KB/s at the old 4.5 a second): a 15-minute run with 4 players is then about 26 MB (it was about 10 MB), so 10 GB is
roughly 380 such runs a month. Past either limit the database refuses players instead of billing; the 🌐 menu
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

- `firestore.rules`: **the full Firestore rules to publish** (replace everything in the console with it). It replaces the old
  open catch-all: the social collections (clans, chats, profiles, leaderboard, events) stay open as before, and everything
  else follows the blocks from the files below. A new collection in the code needs a rule there, or it is refused.
- `firestore-saves.rules`: private cloud saves (signed-in owner only).
- `firestore-codes.rules`: redeem codes (read one by name, never list or write).
- `firestore-premium.rules`: Holy What Happeneds bought on Ko-fi (`wallets`, `kofi_links`, `kofi_payments`): players can only spend their own,
  never add; only the Ko-fi worker (a service account) credits. **Not run against the emulator**; Rules Playground checklist inside.
- `database.rules.json`: the Wilds online (Realtime Database, see above).
- `firestore-social.rules`: leaderboard, chat, profiles and **clans**. **Draft, not run against the emulator.** Read
  `docs/trust-boundaries.md` before publishing it. Its `clans` block holds a clan by Firebase sign-in ids (the spec is
  `core/clan-roles.js`, tested by `tests/clan-roles.test.js`; the Rules Playground checklist is at the bottom of the file).
  Order: deploy the new clan page first and leave about a week, so owners can sign in to an account and claim their clans
  (opening the clan page does it), then publish. Anonymous sign-in must be enabled (the Wilds uses it already).

## Ads and privacy

Nothing from Google AdSense or Google Analytics loads until the player presses Accept (`core/consent.js`); `privacy.html` says the same.
The only ad slot is the banner on the game page. After Accept, `core/consent.js` also loads the AdSense code on the achievements, casino,
leaderboard and privacy pages (they have no slot); if you switch on Auto ads in AdSense, Google could place ads there, so either leave Auto
ads off or update `privacy.html`. The ad slot id on the game page (`data-ad-slot="1234567890"`) is a placeholder and needs your real one.

**Ko-fi and Holy What Happeneds.** Ko-fi payments only ever become Holy What Happeneds (titles, looks, gems, Golden, timelapses and boosts), credited by the worker in `kofi-worker/`; a plain tip gives
nothing unless `donationRate` is set in `core/premium-config.js`. The Ko-fi address and prices live only in that config, and buying stays
closed while it holds placeholders. Setup, secrets and deploying: `docs/kofi-setup.md`. `privacy.html` lists what is kept about a payment;
`tests/info-pages.test.js` checks no other game code mentions Ko-fi.

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
