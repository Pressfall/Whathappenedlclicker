# Clans update: change log (2026-11-21)

Fixes, new features, and connections to things added since clans came out (the Wilds, daily and weekly challenges, shared
names, achievements).

## Bugs fixed

- **A new name made you leave your clan.** Since chat and Wilds names became one name (`core/names.js`), changing your
  Wilds name also changed your chat name. The game page then couldn't find you in your clan by name, treated it as a kick,
  and turned your clan perks and buffs off. Now:
  - The game page checks membership by your sign-in id first (`core/clan-roles.js memberIn`).
  - It learns that id from the clan while your name still matches, and the clan page stores it too
    (`whathappened_clan_uid`, synced to your account).
  - Your new name is carried over to the clan: your own `names` entry, the old member lists, your profile, and a
    "✏️ X is now called Y" line in chat. This happens on both pages (`renameSelf`, allowed by the rules spec).
- **Check-ins after a rename** could count twice in one day. Check-ins now record your sign-in id as well as your name.
- **Buying a Clan Shop icon a clanmate had just bought charged you anyway.** The purchase now runs in a transaction. If
  the clan already owns the icon, you aren't charged.
- **Clan chat could miss its newest messages.** The chat is read without an order (an order would need a Firestore index),
  so past 200 messages the newest ones might not load. The game's side panel tried to trim with a query that needs that
  index, so it probably never trimmed. It could also have deleted pinned messages. Now both pages trim from the messages
  they already loaded, keep pinned ones, and the clan page also trims when someone else's messages push the chat over the
  limit.
- **A deleted clan left its members' stats behind** (`clans/{id}/members`). Deleting a clan now removes them too.
- **Clan stats were written every 30 s, even from hidden tabs, with console spam.** The member stats are now written only
  while the game tab is in view (they drive the "online" light). The profile is written at most every 5 minutes, and the
  logging is gone.
- **The Events tab kept showing the old event** if the event running changed kind but kept the same start time. The live
  view is now keyed by kind too.
- **Clan names and descriptions skipped the swear filter.** They now go through the chat's Safe mode filter wherever they
  show. New clan names with swear words (or `< > { } [ ] \ backticks`) are refused, and descriptions are filtered when
  saved.
- **Clan chat effects** (Holy What Happeneds chat FX) were missing from the clan chat rules draft. `fx` is now allowed
  there (`firestore-social.rules`).
- **Chat effects were broken everywhere** (global chat, clan chat, and the shop's preview). Chat effects and the click
  bursts shared the class `bn-cfx`. The bursts' rule (`position: absolute`, 0×0) came later in `premium.css`, so every
  message with an effect was pulled out of its line and collapsed. It overlapped other text or vanished. Chat effects now
  use their own prefix (`bn-chatfx`, `bn-chatfx-<name>`), in `premium.css`, `premium.js chatFxClass`, `premium-panel.js`
  and `clan-page.js`. Messages already sent keep working, because only the effect's id is stored with them. A test in
  `tests/premium-game.test.js` checks that each effect is styled and never uses a click-burst class.

## New features

- **🌲 Wilds Hunt: a new clan event, played in the Wilds.**
  - For 3 days, every monster anyone in your clan defeats in the Wilds counts toward the clan's total.
  - Reward tiers: 50, 150, 400, 800, 1,500 and 2,500 monsters. The top 3 hunters get a bonus.
  - The Events tab shows the total, the tiers, the clan's hunters and a "Go to the Wilds" button.
  - In the Wilds you get a toast when a hunt is on, and another every 50 monsters you send.
  - It joins the schedule automatically. A schedule config still holding the old default list is upgraded once; a list
    you edited by hand is left alone.
  - Rewards pay out like every other event (on the game page or the clan page) and sync between devices.
- **Clan XP from daily and weekly challenges.** Each challenge you claim in the game gives your clan XP: +10 for a daily
  and +30 for a weekly, once each. Challenges claimed while you're not in a clan don't flood a clan you join later.
- **This week's top contributors.** A board on the clan page shows who brought in the most clan XP since Monday (UTC),
  from check-ins and challenges, with a countdown to the new week.
- **Clan overview strip** under the banner: members online, today's check-ins, members in the Wilds, the clan's combined
  CPS, and this week's XP.
- **Wilds info in the member list.** Each member shows their Wilds class, arena rating, best wave and monsters defeated.
  Members playing in the Wilds right now get a "🌲 In the Wilds" tag and a green light. Prestige counts and weekly XP are
  shown too.
- **Member sorting:** by rank, most XP this week, highest CPS, or recently online. The page remembers your choice.
- **Clan settings** (under ⚙️ Manage):
  - Open or close the clan to new members. A closed clan keeps its members.
  - Set how many prestiges a player needs to join.
  - The leader can rename the clan. Names are checked for length, uniqueness and swear words.
  - Changing whether the clan is open posts a line in clan chat.
- **Clan finder:** cards show 🔒 Closed and 🔁 N+ prestiges. Clans you can't join are sorted last, and a new "Only ones I
  can join" filter hides them.
- **In-page dialogs** replace the browser's confirm and prompt boxes: leaving, deleting, kicking (with an optional
  reason), handing over leadership, creating a clan, and choosing a name.
- **Game page side panel:** the clan tab's header shows the clan's level and the event running now (with a link to it).
  System lines (joins, level-ups, buffs) now show as coloured centred lines instead of "SYSTEM: …".
- **Two new achievements:** Quest Giver (bring your clan 300 XP from challenges; title *Quartermaster*) and Monster Hunter
  (defeat 250 monsters during Wilds Hunts; title *Huntmaster*).

## Under the hood

- `core/clan-roles.js`:
  - New `renameSelf` action and `memberIn`.
  - New manage fields `joinMode` and `minPrestige`; joining a closed clan is refused.
  - New member field `contrib`.
  - A clan rename may change only the name.
- `core/clan-levels.js`: `QUEST_XP`, `questXpOwed`, `withQuestsGiven`, `weekKey`, `addContribution`, `contributors`,
  `weekEndsAt`.
- `core/clan-events.js`:
  - New kind `wh`, plus its rewards and top-3 bonus.
  - `typesFrom` (config upgrade), `wildsKillDelta` (at most 60 a send), `wildsCard`.
- New `clan-wilds.js`, loaded by `world.html` (with `core/clan-events.js`). It does nothing unless you're in a clan.
- `core/progress.js`: new synced keys `whathappened_clan_quests`, `whathappened_clan_uid`, `whathappened_clan_quest_xp`,
  `whathappened_clan_hunted`, and the `whathappened_wh_claimed_` prefix.
- `firestore-social.rules` (draft) matches the spec: `renameSelf`, `contrib`, `joinMode`, `minPrestige`, closed-clan joins,
  and `fx` in clan chat. The published `firestore.rules` already leaves clans and events open, so nothing needs
  publishing for this update.
- Docs: `docs/trust-boundaries.md`, `README.md`, `how-to-play.html` and `faq.html` (new "What is a Wilds Hunt?" entry).

## Tests

- New `tests/clan-overhaul.test.js` (13 tests): renames, membership by id, closed clans, the weekly board, challenge XP,
  the Wilds Hunt's kinds and rewards, the config upgrade, kill counting, Wilds cards, payouts and sync keys.
- `tests/clan-game.test.js` (+2): a renamed player stays in their clan and the clan hears the new name; claimed
  challenges give the clan XP exactly once.
- `tests/browser/clans.js` (+13 checks, now 33): in a real browser it covers the weekly board, the stats strip, a clanmate
  "In the Wilds", closing the clan, the leave dialog, the Wilds Hunt in the Events tab, and on `world.html` monsters
  reaching the hunt, never twice, plus the heartbeat. Every clan write is checked against the rules spec.
