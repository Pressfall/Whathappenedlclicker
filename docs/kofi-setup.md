# Holy What Happeneds 👼 and Ko-fi: owner setup

Holy What Happeneds are the game's new currency for titles and looks, and for gems, Golden What Happeneds and boosts (a few a
week). Players earn a few by playing, or buy them on Ko-fi. This guide
gets the Ko-fi side running: the shop items, the webhook, the secrets, the Firestore rules and the worker that credits Holy What Happeneds.

Nothing here needs the Firebase Blaze plan or a payment method on Firebase or Cloudflare.

## How it fits together

```
 player (game, signed in)          Ko-fi                      Cloudflare Worker (kofi-worker/)          Firestore
 ───────────────────────          ─────                      ─────────────────────────────────          ─────────
 Get more tab shows a      ──►   pays for a Holy What Happeneds pack,  ──► POST /kofi  (form field `data` = JSON)
 link code WH-XXXX-XXXX-XXXX      code pasted in message      1. verification_token must match      ──► kofi_payments/{txid}  (once per txid)
                                                              2. Holy What Happeneds from core/premium-config.js       wallets/{uid}.balance += Holy What Happeneds
                                                              3. link code -> kofi_links/{code}.uid      wallets/{uid}/credits/{txid}
 👼 chip shows the balance  ◄────────────────────────────────────────────────────────────────────────── wallets/{uid} (read live)
 buying a look: the game lowers wallets/{uid}.balance and logs wallets/{uid}/spends/{id} in one write (rules allow only that)
```

- **Earned Holy What Happeneds** live in the player's save (`whathappened_premium`, synced with their account like the rest of their
  progress). Like gems, the browser is trusted with them.
- **Bought Holy What Happeneds** live only in Firestore `wallets/{uid}`. Only the worker can add to them: it signs in as a Google service
  account, which the security rules don't apply to. A player's browser can only take Holy What Happeneds off its own balance, in the same
  write that records what they paid for.

### Why two pools (the trade-off)

Everything a player earns by playing is decided in their browser (that is how the whole game works), so earned Holy What Happeneds can't be
made cheat-proof without a game server, and a player who edits their save only changes their own game. Real money is
different: it must be credited only by the server, survive a cleared browser, and be checkable when someone writes in.
Keeping the two apart gives that without a server deciding gameplay:

- a player can never mint bought Holy What Happeneds or touch anyone else's balance (rules: decrements only, logged);
- bought Holy What Happeneds and everything bought with them come back on any device signed in to the account (the spends log);
- the cost: two balances behind one number. The game spends earned Holy What Happeneds first and the rest from the account, and takes
  the account's part first, so a refused or failed write costs the player nothing. The rules check that each spend is logged
  with its exact cost, but not what the item should cost: a modified browser could log a cheap price for an expensive look.
  That only affects looks on its own screen, which it could also get by editing its save, so it was not worth a price list
  inside the rules that would have to be kept in step with the game.

### Why a Cloudflare Worker

Firebase Cloud Functions need the Blaze plan. A Cloudflare Worker is free without a card (100,000 requests a day on the free
plan), gets an `https://` address straight away (Ko-fi requires https), keeps secrets out of the code (`wrangler secret`),
has no cold start that could make Ko-fi time out, and can write to Firestore through Firestore's REST API with a service
account. Writes made this way count against Firestore's free Spark quota (20,000 writes a day; a credited payment is 3
writes). Netlify or Vercel functions would also work; a Google Apps Script web app can't choose its HTTP status (so it
couldn't ask Ko-fi to retry after a failed write), and free hosts that sleep (Render) can time out Ko-fi's request.

## What Ko-fi's documentation says, and what to check yourself

From Ko-fi's help article *Does Ko-fi have an API or webhook?* (help.ko-fi.com, read 2026-11-09):

- Ko-fi sends an **HTTP POST** to your webhook URL when a payment completes; the URL **must start with `https://`**.
- ko-fi.com/manage/webhooks (read 2026-11-21) says `type` is `Tip`, `Subscription`, `Commission` or `Shop Order`, while
  its own example tip still says `Donation`. The worker reads `Tip` and `Donation` alike. A Shop Order's `message` is null
  and `shop_items` is `[{ direct_link_code, variation_name, quantity }]`.
- The payment is a JSON object shown as `data = { ... }`, with `verification_token`, `message_id`, `timestamp`, `type`
  (e.g. `"Donation"`), `is_public`, `from_name`, `message`, `amount` (a string like `"3.00"`), `url`, `email`, `currency`,
  `is_subscription_payment`, `is_first_subscription_payment`, `kofi_transaction_id`, `shop_items`, `tier_name`, `shipping`.
- **Your listener must return status 200.** Otherwise Ko-fi "will retry a reasonable number of times with the same
  `message_id`". The worker answers 200 only once a payment is safely handled, and credits each `kofi_transaction_id` once,
  so retries can't pay twice.
- The webhooks page can **send test payments**.

The full field list (including the shape of `shop_items` entries: `direct_link_code`, `variation_name`, `quantity`, and the
`Subscription` / `Shop Order` / `Commission` types) is on ko-fi.com/manage/webhooks, which needs your Ko-fi login, so I
could not read it. The worker is written defensively (form or JSON body, `currency` or `currency_code`, a missing
`quantity` counts as 1).

**Shop packs and the buyer's email** (2026-11-21, your ask: "buy packs instead of donating"). A Shop item's buy form has only
the price (the item editor's "message for buyers" is your message to them, shown after paying), so a Shop order can't carry
the player's link code. It does carry the email the buyer paid with, so:

- The game's Get more tab shows the packs as Ko-fi Shop items and says which email to pay with: the one the player signs in
  with.
- When Ko-fi tells the worker about a payment, the worker finds whose it is by itself: the link code in the message, else the
  game account that signs in with the email it was paid with, if that email is verified (Google sign-in always is; a password
  account once its verification link was clicked). It asks Firebase Authentication (read only), so the service account needs
  the **Firebase Authentication Viewer** role (step 3). Without it, payments with no link code are kept as unmatched.
- **Nothing needs the player's browser to reach the worker** (2026-11-21, your ask: most players play on school computers,
  and school filters block every `*.workers.dev` address). "Check now" (payments made before the account existed or verified
  its email) and "Paid with another email, or without your code?" (transaction ID + that email) are written to Firestore
  `kofi_requests/{uid}`, which school networks allow. The worker looks every minute (a Cron Trigger in `wrangler.toml`) and
  answers by replacing the request; the game shows the answer. The `/collect` and `/claim` addresses still work for older
  pages.
- A link code in a tip's message still wins over the email (someone tipping for a friend).
- Each Shop item's "link buyers receive after purchase" is `https://whathappenedclicker.netlify.app/?holy=get`: the game opens on
  Get more, which checks for the purchase too.

Tips stay, folded under the packs ("Or send a tip with your link code"): the tip box takes any amount from $1, has a "Your
message" box (280 characters) and a "Private message" tick. Ko-fi's free plan charges 0% on one-time tips and 5% on Shop sales
("Does Ko-fi take a fee?"; PayPal or Stripe add about 3% + $0.30 either way), so a Shop pack costs you about 5% more than the
same tip; the packs give the same amounts either way.

## Step by step

### 0. Before you start: the Firestore catch-all

Open Firebase console > Firestore Database > Rules. If you see `match /{document=**} { allow read, write: if true; }` or a
test-mode rule (`if request.time < timestamp.date(...)`), **any browser could give itself bought Holy What Happeneds**, whatever the new
rules say (Firestore allows a request if any rule allows it). Don't open buying until that catch-all is gone. Removing it
also needs rules for the clan collections first: see `docs/trust-boundaries.md`, "Before you publish firestore-social.rules".

### 1. Ko-fi: the packs

**Shop packs** (`packs` in `core/premium-config.js`): one Ko-fi Shop item per pack (Shop > Add product > Digital item), with
- the price and amount of the matching tip pack (Small $2 → 200, Medium $5 → 550, Large $10 → 1,200, Huge $20 → 2,600),
  "Pay what you want" off;
- Assets > Deliver from your own link: `https://whathappenedclicker.netlify.app/?holy=get`;
- "Leave a message or instructions for buyers" on, saying the Holy What Happeneds go to the game account that signs in with
  the email they paid with, and how to claim with the transaction ID if they used another one.
The part of the item's link after `ko-fi.com/s/` is its `code` in `packs`. An item that isn't in `packs` gives nothing (so
the "Submit a new background/song/skin" item is ignored by the worker, as it should be).

**Tip packs** (`tipPacks`): the game's Get more tab shows each one with its tip amount, and the player tips that amount on your
page with their link code in the message. Any amount from $1 works: an amount between packs is paid at the rate of the biggest
pack it reaches.

The packs set now (2026-11-19, about 100 per US dollar with a bonus on bigger ones): Small $2 → 200, Medium $5 → 550, Large $10 →
1,200, Huge $20 → 2,600. Change `dollars`, `beans` or `name` there (a test checks a bigger pack never has a worse rate).

On Ko-fi, check two settings:
- Your page's currency must be `tipCurrency` in the config (USD now). Tips in another currency give nothing unless you add a
  rate for it in `donationRate`.
- Settings > Payment: Ko-fi starts new creators in "Get all of Ko-fi" (Standard), which charges 5% on tips too. Turn it off if you
  want tips at 0% (you lose Standard's extras, like supporter-only posts).

For scale: the cheapest look costs 100 Holy What Happeneds, most cost 250-450, the dearest 600, and all 108 together cost 38,300
(titles, page themes, clicker hats and accessories (one of each worn at a time), auras, click effects (a burst where you click and a glow on the +N) and chat effects; and in the Wilds, which everyone there sees,
weapon skins with their own hit effects, trails, headwear, wings, tails and outfits, Easton Bundy's among them). 48 of them
come from the game itself, each card saying where from (`ref`): Somalian Pirate, Grape God, Goonsaw Man, Divine Money Man, WH Vrill,
WH Hacker and more (a test checks every one names a real upgrade, Divine upgrade or skin).
`node tools/simulate-beans.js` shows what players earn for free (a regular player about 30-40 a month, a dedicated one about
50-60).

**Buffs** (your asks, 2026-11-20): 2× click power or 2× CPS for 30 days at 250 each, or for a week at 75; 2× offline earnings for 30
days at 150; +10% crit chance for 30 days at 200 (Lucky Streak); and 2× Everything (clicks, CPS and offline) for 30 days at 550.
Buying one that is running adds its days (at most a year ahead). They live in the earned-Holy state (synced); main.js applies them
(`getHolyBoosts`; the offline one through `holyOfflineMult`, for the part of the time away it ran). **Item bundles**: Holy Rush 10,
Lucky Dice 15, Time Traveler 22, Frenzy Pack 25, Singularity 30, Mega Rush 40 (only boosts `core/world-bridge.js` allows).

The shop opens on **Currency** (gem packs and Golden together), has a search across every section and a "Hide owned" switch.

**Chat effects** go out with every global and clan chat message (`fx`, the effect's id) and show for everyone on the game page
and the clan page; an id a page doesn't know shows as plain text. The open `global_chat` / `clan_chat` rules take the extra field.

**One name** for chat and the Wilds (`core/names.js`): the Wilds' name wins when the two differ, an automatic "Adventurer1234"
never does, and both now sync with the account.

**Gems, Golden, timelapses and boosts, with no limit** (your choice on 2026-11-20; before that each had a weekly limit). Earned and
bought Holy What Happeneds alike (your choice on 2026-11-10):
- Gem packs at 10 gems for each Holy What Happened, bigger packs with a bonus: 50 for 5, 275 for 25 (+10%), 600 for 50 (+20%),
  1,300 for 100 (+30%), 3,500 for 250 (+40%).
- Golden What Happeneds for 40: three times what the player's next prestige would give, never fewer than 15 (`GOLDEN` in
  `core/premium.js`). The price is the one from before; nothing about it was asked for.
- Timelapses: 1, 4, 12 or 24 hours of the player's income at once (what they make per second now, like an Hourglass) for 10, 35,
  90 and 160, and the followers' nursery eggs and pack cooldowns move on by as much (`followers-data.js` `skipTime`). Not before
  they make anything per second.
- Holy Rush (2 Energy Drinks, 2 Spare Batteries, a Loaded Dice) for 10, from the Items menu.

Change prices and amounts in `CATALOG` in `core/premium.js`, then run `npm test` and `node tools/simulate-beans.js`. A bundle may
only hold boosts that `ITEMS` in `core/world-bridge.js` allows (a test checks). These only work on the game page, since gems,
Golden, income and boosts go into the game's saves. With no limit and 10 gems each, a dedicated player's earned Holy What
Happeneds alone come to about 500 gems a month (the game itself gives about 20 a month from weekly challenges), and 40 for at
least 15 Golden is far more Golden than Varro's 1 for 2,500 Glory: raise the prices if that's more than you want.

Be aware of what this means: gems buy the Treasury's lootboxes (random contents) and the casino takes gems and Golden, so money
paid on Ko-fi can now end up in lootboxes and casino bets. Several countries treat that as paid lootboxes or gambling, and players
may be minors. The shop says it next to the trade, the privacy page says it, and the game asks under-18s to get a parent's
permission, but none of that is legal advice; if the game grows, ask someone qualified, and consider dropping the gem packs and
`x_golden` (or limiting them to earned Holy What Happeneds) for players in those countries.

### 2. The config: `core/premium-config.js`

Only `workerUrl` is left to fill in (it is marked `OWNER`):

- `kofiPage`: your Ko-fi page (set: `https://ko-fi.com/whathappenedclicker`).
- `tipCurrency`, `tipPacks`: the packs from step 1 (set).
- `packs`: the Ko-fi Shop items that sell Holy What Happeneds (step 1). Matched to the buyer by the email they paid with.
- Optional `donationRate`: a flat rate for tips in other currencies than `tipCurrency`, e.g. `{ EUR: 100, GBP: 120 }`.
- Optional `subscriptionTiers`: Holy What Happeneds per membership payment, by the tier's exact name on Ko-fi. Every other
  monthly payment (a monthly tip from the tip box's "Make it monthly", which Ko-fi sends as a `Subscription` with no tier
  name, or a tier not listed) pays by its amount like a tip, every month. A renewal may come without the first month's
  message: then it finds the player by the email it was paid with, or waits for them to collect or claim it.
- `workerUrl`: fill in after step 4.

Until the Ko-fi page, the worker address and at least one way to buy are filled in, the game's Get more tab says buying
isn't open yet.

### 3. A Google service account for the worker

The worker needs its own login to Firestore. Use a dedicated account that can only use the database:

1. Google Cloud console (console.cloud.google.com), project **whleaderboard** > IAM & Admin > Service Accounts > Create
   service account. Name it `wh-kofi-worker`.
2. Roles: **Cloud Datastore User** (that is Firestore read/write) and **Firebase Authentication Viewer** (read only: which
   account signs in with a payer's email). Nothing else in the project. (Granted on the existing account 2026-11-21: Google
   Cloud console > IAM & Admin > IAM > the service account's pencil > Add another role.)
3. Open the account > Keys > Add key > Create new key > JSON. A file downloads. **Never put it in the repo**
   (`.gitignore` ignores `*service-account*.json` and `whleaderboard-*.json`, but keep it outside the project folder anyway),
   and delete it after step 4.

(Firebase console > Project settings > Service accounts > Generate new private key also works, but that key can do anything
in the whole project. The dedicated one is safer.)

### 4. Deploy the worker (Cloudflare)

1. Make a free Cloudflare account (dash.cloudflare.com). No card is needed for Workers.
2. In a terminal, in the project's `kofi-worker` folder (Node 18 or newer):
   ```bash
   npx wrangler login
   ```
3. `ALLOWED_ORIGINS` in `kofi-worker/wrangler.toml` is set to `https://whathappenedclicker.netlify.app`, the address the game
   runs on. Only that site may send claim requests; add a custom domain there (comma separated) if the game moves to one.
4. Set the secrets (each command asks for the value; nothing is written to a file):
   ```bash
   npx wrangler secret put KOFI_VERIFICATION_TOKEN
   ```
   Paste the token from ko-fi.com/manage/webhooks > Advanced > Verification Token.
   ```powershell
   Get-Content "C:\path\to\the-key-file.json" -Raw | npx wrangler secret put GCP_SERVICE_ACCOUNT
   ```
   (the whole JSON key file from step 3; on macOS/Linux: `npx wrangler secret put GCP_SERVICE_ACCOUNT < the-key-file.json`)
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Run that twice and use the two results for:
   ```bash
   npx wrangler secret put EMAIL_PEPPER
   ```
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   ```
   Keep `ADMIN_TOKEN` somewhere safe (a password manager): it lets you credit payments by hand. Don't change
   `EMAIL_PEPPER` later, or unclaimed payments can't be claimed any more.
5. Deploy:
   ```bash
   npx wrangler deploy
   ```
   It prints the address, like `https://wh-kofi.yourname.workers.dev`. Open it in a browser: it should say the webhook is
   running. Put that address (no trailing slash) in `workerUrl` in `core/premium-config.js`.

The worker bundles `core/premium-config.js` and `core/kofi.js` when it deploys. **Whenever you change the config, deploy both
the site and the worker**, or they'll disagree about what a pack is worth.

### 5. Firestore rules

Copy the three `match` blocks and the `beans...` functions from `firestore-premium.rules` into your rules, next to the saves
and codes blocks. Run the Rules Playground checklist at the bottom of that file, then Publish.

### 6. The Ko-fi webhook

1. ko-fi.com/manage/webhooks > Webhook URL: `https://wh-kofi.yourname.workers.dev/kofi` > Update.
2. Send a test payment from that page. In a terminal in `kofi-worker`, `npx wrangler tail` shows the worker's log while it
   runs. If Ko-fi's test uses the example transaction id `00000000-1111-2222-3333-444444444444`, the worker answers 200 and
   credits nothing for it; with any other id it may keep one "unmatched" record in `kofi_payments`, which you can delete.
   Either way it proves Ko-fi reaches the worker and the token matches.

### 7. Test it without spending money

Do this before you push the config with `workerUrl` in it, so players don't see buying open while you test.

1. Run the game on your computer with the worker's address filled in only there: put it in `workerUrl`, don't commit it yet,
   and run `npm start` (the game at http://localhost:8000; `ALLOWED_ORIGINS` already lets that page send claims).
2. Sign in, open 👼 > Get more, and copy your link code.
3. Put your Ko-fi verification token where the test script finds it, in `kofi-worker/.dev.vars` (never committed):
   ```
   KOFI_VERIFICATION_TOKEN=paste-the-token-here
   ```
4. Send pretend tips, signed with your token, through the real worker into your account:
   ```bash
   node tools/kofi-test-payment.js --code WH-XXXX-XXXX-XXXX --amount 5 --worker https://wh-kofi.yourname.workers.dev
   ```
   It prints what the worker did. Then check, in the game:
   - the 👼 chip went up by the pack's amount (550 for $5);
   - spending works: buy a look, and trade for gems;
   - `--twice` sends the same payment two times and it is credited once;
   - `--no-code --amount 2 --email you@example.com` keeps a payment to be claimed: claim it in Get more > "Paid without your
     code?" with the transaction id it prints and that email.
5. In Firestore, `kofi_payments/TEST-...` should say `status: credited` with your uid, and hold no name or email.

The script has to reach the worker from your computer. `node tools/kofi-test-payment.js --check` tests just that (no token,
no payment). School and work web filters often block every `workers.dev` address (a school district's ContentKeeper filter
files them under "Proxies: Filtering-Bypass"): the script then says the worker can't be reached from this network, and opening
the worker's address in a browser shows the filter's block page. Run the test from another network, such as home. Don't try to
get around the filter. Real payments aren't affected: Ko-fi sends them to the worker from its own servers. Only "Paid without
your code?" claims come from the player's browser, so a player on such a network can't claim until they're elsewhere.

What the script credits is real, on your own account: spend it, or lower `wallets/<your uid>.balance` in the Firebase console.
Anyone with the verification token could do the same, so keep it secret (Ko-fi lets you regenerate it).

Optional, with real money: a $1 tip from another Ko-fi account confirms Ko-fi's real messages match. PayPal and Stripe keep their
fee (about $0.30) even if you refund it.

### 8. Publish

1. Commit `workerUrl` and push. Buying opens for everyone once the site deploys.
2. Keep `npx wrangler tail` open for the first real tips if you like; `kofi_payments` lists each one.

## Fixing a payment

**Someone paid without their link code** (or with a typo). The payment is kept as `unmatched` in `kofi_payments`, with a
keyed hash of the email instead of the email.

- The player can claim it themselves: 👼 > Get more > "Paid without your code?", with the Ko-fi transaction ID and the
  email they paid with.
- Or you give it to them. Find the payment's transaction ID in your Ko-fi dashboard and ask the player for their link code
  (Get more tab), then:
  ```bash
  curl -X POST https://wh-kofi.yourname.workers.dev/admin/resolve -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -H "content-type: application/json" -d "{\"txid\":\"THE-TRANSACTION-ID\",\"code\":\"WH-XXXX-XXXX-XXXX\"}"
  ```

**A payment the worker didn't store** (an item missing from `packs`, a tip before you set `donationRate`): add `"beans": N`
to the same command to credit it by hand. It still credits each transaction ID once.

**Refunds and chargebacks**: Ko-fi doesn't send a webhook for them. In the Firebase console, lower that player's
`wallets/{uid}.balance` by hand (your console edits aren't limited by the rules). `kofi_payments` tells you whose it was.

**The player has no link code yet**: they need to open Get more once while signed in; that creates it.

## What is kept, and where

| Where | What | Who can read it |
|---|---|---|
| `kofi_payments/{txid}` | type, amount, currency, paid/received time, packs and Holy What Happeneds, link code, uid; for an unclaimed payment a keyed email hash (deleted on claim) | only the worker and you (console) |
| `wallets/{uid}` | bought balance, lifetime total, lifetime spent, last spend id | the player and you |
| `wallets/{uid}/credits/{txid}` | Holy What Happeneds, kind, packs, time | the player and you |
| `wallets/{uid}/spends/{id}` | item, cost, time | the player and you |
| `kofi_links/{code}` | uid, time made | the player (their own) and the worker |
| `kofi_emails/{keyed email hash}` | uid, time noted: the account whose verified sign-in email that is | only the worker and you (console) |
| `kofi_requests/{uid}` | the player's latest Check now or claim (a claim's transaction ID and email only until the worker answers, about a minute), then the answer | the player (their own) and the worker |

Never kept: the payer's name, email address, message, shipping address or Discord details. Payments worth no Holy What Happeneds aren't
stored. `privacy.html` says the same; update it if you change what the worker keeps.

## Secrets checklist

- [ ] `KOFI_VERIFICATION_TOKEN`, `GCP_SERVICE_ACCOUNT`, `EMAIL_PEPPER`, `ADMIN_TOKEN` set with `wrangler secret put` (never in
      `wrangler.toml`, never committed).
- [ ] The service account key file deleted from your computer after uploading it.
- [ ] The service account has only **Cloud Datastore User** and **Firebase Authentication Viewer**.
- [ ] No catch-all Firestore rule.
- [ ] If a secret leaks: Ko-fi lets you regenerate the verification token; delete and recreate the service account key;
      `wrangler secret put` the new value and `npx wrangler deploy`.
