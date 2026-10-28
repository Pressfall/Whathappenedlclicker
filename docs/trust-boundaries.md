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
so normal play keeps gems scarce, whatever happens online.

**Online play** (Realtime Database, `database.rules.json`) is shared, so it has the same limits as the clan features, but it was
designed around them:

| What | Who decides | What a modified page can do | What limits it |
|---|---|---|---|
| Positions, looks, chat (`p`, `i`) | each player, for themselves | Lie about where they are or what they hold | Rules: signed-in writers only write their own entry; sizes checked. Chat is cleaned and length-capped; the swear filter applies on display |
| PvP hits (`h`) | the player who is hit | Send hits that never happened | The hit player's page checks range against the attacker's last position, the hit rate against the weapon, and caps damage at the most that weapon could do (`validateHit`); then shield and armor apply. Rules: hits are signed with the sender's id and only the target can read them |
| Loot bags (`l`) | the knocked-out player drops; anyone takes | Drop bags of materials from nowhere | Only Wilds materials (never keys), at most 999 each; they never reach the main game except through crafting, which is capped |
| Shared boss (`b`) | everyone in the arena | Report fake damage or a fake kill | Rewards still come from each page's own `bossLoot` under the daily caps; the worst case is a free boss kill |

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
