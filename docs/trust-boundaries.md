# Trust boundaries: what the online features believe

The game itself is single-player, so a player editing their own save only affects themselves. The online features are
different: leaderboard, chat, clans, events and profiles are **shared**, and everything in them is written by the players'
own browsers. This page lists what each one trusts, what was changed, and what is still open.

## What this review could and could not see

- **The deployed Firestore rules are not in this repo** (`firestore-saves.rules` says clans, chat and leaderboards "need their
  own rules"; `tools/notes.txt` says "CHANGE RULES IN FIREBASE EVENTUALLY"). I could not read them. If they are still test-mode
  or a `match /{document=**} { allow read, write: if true; }` catch-all, **everything below is wide open to anyone with the
  public Firebase config**, and the saves and codes rules are bypassed too (Firestore allows a request if any rule allows it).
  Check the Rules tab in the Firebase console first.
- The rules in `firestore-social.rules` were **not run** against the Firestore emulator (it needs Java, which was not
  available). They were written from what the client code sends. Test them in the Rules Playground before publishing.
- The social features have **no sign-in**: the browser picks a username and writes under it. A rule cannot tell who is writing,
  so rules can check the shape and size of a write but cannot stop one player writing as another.

## Collection by collection

| Collection | Written by | What the client sends | What a hostile client can do today | What `firestore-social.rules` adds | Still needed |
|---|---|---|---|---|---|
| `leaderboard` | game page, **Submit score** | `{name, title, score (a Number), type, createdAt}`, two docs per submission | Post any score under any name, as often as they like | Append-only; name 1-32, title <= 64, score a non-negative number, `type` alltime/monthly, `createdAt` = server time; no update/delete | Sign-in and one doc per uid; there is no way to verify an idle-game score server-side, so the board stays "for fun" (the page now says so) |
| `profiles/{username}` | game page (hourly and with each autosave when in a clan), clan page | score, golden, clanPoints, title, clanId/Name/Role, kick notice | Overwrite anyone's profile; set `clanId`, `clanRole: leader`, or a kick message on another player | Only known fields, bounded; username matches the doc id; no delete | Key profiles by uid, not by a name anyone can type |
| `global_chat`, `clan_chat` | game page, clan page | `{name, message <= 500, title, createdAt, ...}` | Post as any name; delete anyone's messages (the game trims by deleting); pin/unpin | Append-only, shape and length, server time; deletes only for messages older than an hour; pinning may only touch the pin fields | Sign-in; trim with a Firestore TTL policy instead of client deletes (today the trimming code **downloads the whole chat collection** on each trim) |
| `clans/{id}` | clan page | membership arrays, owner, `clanXp`, check-in, buff state, logo, icon, description | Take over or disband any clan; add or remove members; set XP (clan level perks are capped by a table, level 20); set buff state | *not covered* (needs sign-in to be meaningful) | Owner/leader checks need a signed-in writer; XP and shop spending belong on a server |
| `clans/{id}/members/{username}` | game page (`points`, `gpoints`, `clanPoints`, `lastCps`, `mainClicks`), clan page | self-reported numbers | Report any number; clan events rank and reward from these | *not covered* | Server-side tallying for anything that pays out |
| `events/*` | clan page | event schedule, pairings, progress, results | Start, end or reshuffle events for everyone | *not covered* | Move scheduling to a scheduled function; clients read only |
| `codes/{CODE}` | read-only | reward definition | Nothing: `firestore-codes.rules` allows `get` only | already in `firestore-codes.rules` | Redemption is remembered in the player's own save, so clearing it re-redeems; fine for giveaways, not for scarce rewards |
| `saves/{uid}` | cloud.js | the player's own save | Nothing beyond their own document | already in `firestore-saves.rules` (owner only, rev must go up by exactly one) | - |

## The Wilds (world.html)

The adventure's save (`whathappened_world`) and the rewards it sends to the main game (gems, Golden What Happened, lootboxes,
through `core/world-bridge.js`) are trusted exactly like the main save, so a player editing their own storage only affects themselves.
The bridge clamps every reward entry (`LIMITS`), and the world caps what it sends per day and week (`CAPS` in `core/world-data.js`)
so normal play keeps gems scarce, whatever happens online. Rubies going the other way (Golden traded in the Divine menu, `rubies`
codes) sit in `whathappened_world_inbox`, written only by the main game and also local, so the same applies; the Golden is taken
and saved before the rubies are queued. At most 4 Golden can be traded a week; the count is kept in `whathappened_golden_trades` (written only by the game, synced like the save, client-trusted like everything else here). Things bought in the Wilds that also cost gems and Golden (the Auto Clicker, `BUYS` in the bridge) travel as an outbox entry naming only what was bought; the game charges its own prices and keeps what it still has to charge in `whathappened_world_owed` (written only by the game), and never charges for an item already owned.

**Online play** (Realtime Database, `database.rules.json`) is shared, so it has the same limits as the clan features, but it was
designed around them:

| What | Who decides | What a modified page can do | What limits it |
|---|---|---|---|
| Positions, looks, chat (`p`, `i`) | each player, for themselves | Lie about where they are or what they hold | Rules: signed-in writers only write their own entry; sizes checked. Chat is cleaned and length-capped; the swear filter applies on display |
| PvP hits (`h`) | the player who is hit | Send hits that never happened | The hit player's page checks range against the attacker's last position, the hit rate against the weapon, and caps damage at the most that weapon could do (`validateHit`); then shield and armor apply. Ability hits (`k: 'ab'`, the ability id in `w`) are checked against that ability's reach, hits per cast and cooldown, with damage capped from the weapon the attacker shows; their stun, slow, burn and push come from the hit player's own copy of the ability table, never from the sender. Staff spells (`k: 'spell'`) must come from a staff the attacker shows, within the spell's flight range, capped at a full-charge spell, burning or adding frost stacks as that staff's magic does in the hit player's table; the Mystic-only rule is checked against the class the attacker's page shows (`i/cl`; older pages show none, and then it is not checked). Rules: hits are signed with the sender's id and only the target can read them |
| Loot bags (`l`) | the knocked-out player drops; anyone takes | Drop bags of materials from nowhere | Only Wilds materials (never keys), at most 999 each; they never reach the main game except through crafting, which is capped |
| Shared boss (`b`) | everyone in the arena | Report fake damage or a fake kill | Rewards still come from each page's own `bossLoot` under the daily caps; the worst case is a free boss kill |
| Arena messages (`d`) | the sender, signed with its uid; only the player they are for reads them | Send invitations, refusals or knockout reports that are not true | A message only ever says something about its sender: a page can report itself knocked out (`down`) or gone (`quit`), never anyone else. Each page runs its own copy of the match (`core/world-arena.js reduce`) from the invitation (roster, everyone's rating at that moment, stake, start time) and those first-hand reports, so a cheater who never reports being knocked out only makes rounds time out: a match that never ends is a draw and gives the stakes back, never a loss for the honest side. A knockout credit (`ko`) only counts on the receiver if it recently hit that player. Rules: signed by `from`, readable only by `$to` |
| Arena ratings, Glory, wagers | each player's own save | Give themselves any rating, Glory or rubies | Like the rest of the save, it only affects themselves. A wager's pot is paid by the winner's page to itself, so a page whose opponent cheats (or a network split where each side thinks the other left) can make rubies that were never staked; the stake list caps that at 5,000 a match, and rubies only reach the game through the capped exchanges. Win-trading with one opponent stops paying after 3 matches a day |
| Arena leaderboard (`wilds/v1/arena/top`) | each player, for their own record | Post any rating | Rules: only your own record, its fields bounded. The board says it is for fun, like the game's leaderboard |
| Waves leaderboard (`wilds/v1/arena/waves`) | each player, for their own record | Post any best wave | Same as the rating board: only your own record, bounded fields, "for fun" |
| Parties (`wilds/v1/party/{pid}`) | members (`m/<uid>`, their own), ticket holders (`inv`), members (chat lines `c`) | Join a party uninvited, read its chat, speak as someone else, use a party to dodge PvP | Only someone holding a ticket can read a party or become a member, and only a member hands out tickets (the founder takes the first). Chat lines are signed (`u` must be the writer) and are cleaned and filtered like zone chat. Party members can't hurt each other: the victim's page refuses the hit (`validateHit`, reason `party`), so a party is only ever a promise between its own members; an arena match's foes are always fair game |
| Tournaments (`wilds/v1/arena/tour/{tid}`) | the host (settings, start, call off), each entrant (their own entry and their own results) | Claim wins they didn't get, skip the fee, start early | The bracket is worked out on every page from the record (`core/world-tour.js bracket`). A player writes only their own results, once, stamped within 10 s of the server's time; a decision depends only on records stamped before it and is final 15 s later. Claiming a win you didn't get only makes the pairing disputed (both out); a walkover claim stands only if the other player doesn't answer within 30 s. Like a wager, fees and prizes move on each page (`tourJoin` / `tourSeen`, each paid once), so a page that skips its fee only cheats the pot it shares; prizes never exceed the fees taken (at most 5,000 x 16). A locked-tier tournament lends each player a kit for its duels; their own gear stays in the save, and a lying page only changes its own stats (hits are still capped by the weapon it shows) |
| Co-op waves (`w`) | the page running the wave (the lowest id in the room), everyone's damage | Report fake damage, move the monsters, end the run | Like the shared boss: rewards come from each page's own `waveCleared` (rubies and Glory under a daily cap, never gems or Golden), and wave monsters drop nothing, so the worst case is a free wave. Rules: a new run only with a new `gen`; the host's snapshot only under its own uid; sizes bounded |
| Shared monsters (`k`, `m`) | each player, for their own report (`m/<uid>`); any player, for a kill time (`k/<id>`) | Report a monster dead that is not, move monsters, report any damage, make the others' copies of a monster follow a fake position | Everything stays inside the Wilds: a kill only makes others' copies fall (and a copy shows nothing but a monster), loot is rolled by each page's own `monsterLoot` for the monsters it fought, and rubies and materials are capped like every Wilds reward. A made-up kill only costs other players a monster; made-up damage only shortens a monster's life for them. Reports are bounded (6 monsters, 320 characters), and a page ignores one that has gone quiet for 2.5 s. Rules: `m/<uid>` is writable only by that uid, a kill time must be a number under a valid monster id |
| Class (`i/cl`) | each player | Claim another class | Shown since the Arena update so the player hit can refuse staff spells from a class that can't cast them (`validateHit`, reason `class`); a page that lies about its class can still cast, so this only stops honest mistakes and old pages |

A cheater can't take gems or Golden from other players, and anything they make up stays inside the Wilds' caps. Making online fights
authoritative would need a server (e.g. Cloud Functions or a small game server) deciding hits and loot.

## Fixed in the code

- **Clan buffs trusted the clan document's multipliers.** `refreshClanBuff` in `main.js` read `cpsMult` / `clickMult` / expiry
  from `clans/{id}.activeBuffs`, which every member's browser can write. One forged write (`cpsMult: 1e30`) would have
  multiplied the income of every player in the clan, and through them the leaderboard. The document now only says *which* buffs
  are on; what they do comes from a fixed table (`core/clan-buffs.js`, kept in step with the shop in `clan.html` by a test), unknown
  buffs are ignored, and an end time is never trusted past 24 hours. Covered by `tests/clan-buffs.test.js`.
- **Custom clan logos could point at any website.** The logo is a field any member can write, shown as `<img src>`. A link to another
  site tells that site who is looking at the clan. The clan page now only shows an image embedded in the document (`data:image/...`, which is
  what the shop uploads).
- **The leaderboard page says its scores are unchecked.**
- **Chat safety is client-side only** (`core/chat-safety.js`, every chat: global, clan, clan page, the Wilds). The swear filter is on
  unless the player turned it off; repeats in a row are shown once with a count and walls of one repeated character are squashed, on
  the reader's screen; each page limits its own sending (a 1.5 s gap, 5 messages per 20 s, no repeating the same line within a minute).
  None of it stops a determined spammer: a modified page, a reload or a second browser skips the send limits, messages stay in the
  database as sent, the filter is a fixed English word list, and there is no reporting, muting, or banning. Doing that properly needs
  the server side: sign-in for chat, Firestore rules that rate-limit per user (e.g. a `lastChatAt` field checked against `request.time`),
  and a way to remove a player.

Checked and fine: names, messages, titles, clan names and descriptions are HTML-escaped everywhere they are drawn (leaderboard, both chats,
clan page). Clan level perks come from a table indexed by level 1-20, so a forged `clanXp` is bounded.

## Not fixed (needs a decision)

These cannot be fixed by rules alone, because nothing says who is writing:

1. **Leaderboard scores, clan points, event results and rewards are whatever the browser says.** For a clicker that keeps its state
   in the browser this cannot be made trustworthy; the realistic goal is to limit what one forged write does to *other* players.
2. **Clan ownership and membership are writable by anyone.** Anyone can set `owner` or remove members.
3. **Event state is shared and writable by anyone.**

The path that would close most of this: require Firebase Authentication (an anonymous account is enough to start), key `profiles`,
leaderboard entries and clan members by uid, then write rules that check `request.auth.uid` against the owner/leader fields, and move
clan XP, clan-point payouts and event scheduling into Cloud Functions so no client writes them. That is a rewrite of the clan page's data
layer, so it is left for you to schedule; the draft rules are the cheap first step.

## Before you publish `firestore-social.rules`

1. Firebase console > Firestore > Rules: copy your current rules somewhere (you will want to roll back).
2. Remove any catch-all or test-mode rule, and add the `saves` and `codes` blocks from the other two rules files.
3. Add the blocks and helper functions from `firestore-social.rules`.
4. Run the checklist at the bottom of that file in the Rules Playground, then play a session: submit a score, chat globally and in a
   clan, join and leave a clan. `clans`, `clans/*/members` and `events` have no rule in these files, so with the catch-all removed
   **clans will stop working** until you add rules for them. Decide first whether you want the stopgap of leaving those three open
   (as they effectively are today) or to do the sign-in work.
