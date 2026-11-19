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

**Why tips and not Shop items** (checked on ko-fi.com/whathappenedclicker and Ko-fi's help, 2026-11-19): a Shop item's buy form
has only the price, so a shop order can't carry the player's link code; every shop order would arrive unmatched and have to be
claimed. The tip box takes any amount from $1, has a "Your message" box (280 characters) and a "Private message" tick. Ko-fi's
free plan also charges 0% on one-time tips and 5% on Shop sales ("Does Ko-fi take a fee?"; PayPal or Stripe add about 3% + $0.30
either way). So the packs are sold as tips: the amount picks the pack.

## Step by step

### 0. Before you start: the Firestore catch-all

Open Firebase console > Firestore Database > Rules. If you see `match /{document=**} { allow read, write: if true; }` or a
test-mode rule (`if request.time < timestamp.date(...)`), **any browser could give itself bought Holy What Happeneds**, whatever the new
rules say (Firestore allows a request if any rule allows it). Don't open buying until that catch-all is gone. Removing it
also needs rules for the clan collections first: see `docs/trust-boundaries.md`, "Before you publish firestore-social.rules".

### 1. Ko-fi: the packs are tips

Nothing to list on Ko-fi. The packs are `tipPacks` in `core/premium-config.js`; the game's Get more tab shows each one with its
tip amount, and the player tips that amount on your page with their link code in the message. Any amount from $1 works: an
amount between packs is paid at the rate of the biggest pack it reaches.

The packs set now (2026-11-19, about 100 per US dollar with a bonus on bigger ones): Small $2 → 200, Medium $5 → 550, Large $10 →
1,200, Huge $20 → 2,600. Change `dollars`, `beans` or `name` there (a test checks a bigger pack never has a worse rate).

On Ko-fi, check two settings:
- Your page's currency must be `tipCurrency` in the config (USD now). Tips in another currency give nothing unless you add a
  rate for it in `donationRate`.
- Settings > Payment: Ko-fi starts new creators in "Get all of Ko-fi" (Standard), which charges 5% on tips too. Turn it off if you
  want tips at 0% (you lose Standard's extras, like supporter-only posts).

For scale: For scale: the cheapest look costs 100 Holy What Happeneds, most cost 200-350, the dearest 600, and
all 19 together cost 6,150 (titles, themes, click numbers and clicker auras on the game page; trails, a halo and wings in the
Wilds). `node tools/simulate-beans.js` shows what players earn for free (a regular player about 30-40 a
month, a dedicated one about 60).

**Gems, Golden and boosts.** The shop also trades Holy What Happeneds for gems and Golden What Happeneds, earned and bought ones
alike (your choice on 2026-11-10): 10 gems for 15, up to 5 times a week, and 1 Golden for 40, up to 2 times a week (the Wilds'
weeks, starting Monday). It also sells two boost bundles from the Items menu, each up to 3 times a week: an Hourglass (an hour of
What Happeneds) for 20, and Holy Rush (2 Energy Drinks, 2 Spare Batteries, a Loaded Dice) for 10. Change the price, the amount or
`perWeek` in `CATALOG` in `core/premium.js` (`x_gems`, `x_golden`, `b_hourglass`, `b_rush`), then run `npm test` and
`node tools/simulate-beans.js`. A bundle may only hold boosts that `ITEMS` in `core/world-bridge.js` allows (a test checks).
These only work on the game page, since gems, Golden and boosts go into the game's saves.
Be aware of what this means: gems buy the Treasury's lootboxes (random contents) and the casino takes gems and Golden, so money
paid on Ko-fi can now end up in lootboxes and casino bets. Several countries treat that as paid lootboxes or gambling, and players
may be minors. The shop says it next to the trade, the privacy page says it, and the game asks under-18s to get a parent's
permission, but none of that is legal advice; if the game grows, ask someone qualified, and consider dropping `x_gems` /
`x_golden` (or limiting them to earned Holy What Happeneds) for players in those countries.

### 2. The config: `core/premium-config.js`

Only `workerUrl` is left to fill in (it is marked `OWNER`):

- `kofiPage`: your Ko-fi page (set: `https://ko-fi.com/whathappenedclicker`).
- `tipCurrency`, `tipPacks`: the packs from step 1 (set).
- `packs`: Ko-fi Shop items that sell Holy What Happeneds. Empty, and best left so (a shop order can't carry the link code).
- Optional `donationRate`: a flat rate for tips in other currencies than `tipCurrency`, e.g. `{ EUR: 100, GBP: 120 }`.
- Optional `subscriptionTiers`: Holy What Happeneds per membership payment, by the tier's exact name on Ko-fi.
- `workerUrl`: fill in after step 4.

Until the Ko-fi page, the worker address and at least one way to buy are filled in, the game's Get more tab says buying
isn't open yet.

### 3. A Google service account for the worker

The worker needs its own login to Firestore. Use a dedicated account that can only use the database:

1. Google Cloud console (console.cloud.google.com), project **whleaderboard** > IAM & Admin > Service Accounts > Create
   service account. Name it `wh-kofi-worker`.
2. Role: **Cloud Datastore User** (that is Firestore read/write; nothing else in the project).
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
   runs. Ko-fi's test uses the example transaction id `00000000-1111-2222-3333-444444444444`; the worker answers 200 and
   credits nothing for it.

### 7. Publish the site and try it

1. Deploy the site with the filled-in config (only after you've reviewed the diff).
2. In the game, sign in, open 👼 > Get more, copy your link code.
3. Buy the cheapest pack yourself with the code in the message. Within a minute the 👼 chip should go up.
4. In Firestore, `kofi_payments/<transaction id>` should say `status: credited` with your uid, and hold no name or email.

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

Never kept: the payer's name, email address, message, shipping address or Discord details. Payments worth no Holy What Happeneds aren't
stored. `privacy.html` says the same; update it if you change what the worker keeps.

## Secrets checklist

- [ ] `KOFI_VERIFICATION_TOKEN`, `GCP_SERVICE_ACCOUNT`, `EMAIL_PEPPER`, `ADMIN_TOKEN` set with `wrangler secret put` (never in
      `wrangler.toml`, never committed).
- [ ] The service account key file deleted from your computer after uploading it.
- [ ] The service account has only **Cloud Datastore User**.
- [ ] No catch-all Firestore rule.
- [ ] If a secret leaks: Ko-fi lets you regenerate the verification token; delete and recreate the service account key;
      `wrangler secret put` the new value and `npx wrangler deploy`.
