# Iris

Cross-border support that the recipient can see coming.

*Iris carried messages between worlds along a rainbow bridge — and an iris is also
the part of the eye. Both halves of the name are the product: a bridge across a
border, entered with a glance.*

Instead of a one-off transfer, the sender creates a **commitment** — "$200 on the 5th,
every month". The money is reserved up front and the recipient sees the confirmed
commitment and a countdown *before* it arrives. The receiving side never installs an
app, never sees a seed phrase, and never needs gas: they open a link, use Face ID, and
the amount is shown in their own currency.

Built for **Monad Metropolis 2026** — Track 02, Consumer Products & Payments.

## Status

Working end to end on Monad testnet.

- [x] Mera passkey accounts — the stateless test passes: wipe storage, sign in, same address
- [x] Commitment escrow, with an exploit found against our own first version and fixed
- [x] Sender flow — signs an ERC-3009 authorization, never holds gas
- [x] Recipient flow — opens a link, never signs a transaction
- [x] Cancellation without gas, through EIP-7702
- [x] The schedule as a Chainlink CRE workflow, delivering reports on chain
- [x] History through an Envio indexer, deployed
- [ ] Deployed at a public address

## Deployed on Monad testnet

| | |
|---|---|
| `IrisCommitments` | [`0x7ed55fed7346ef9b5d4a92771486dcbb1c7b6c14`](https://testnet.monadexplorer.com/address/0x7ed55fed7346ef9b5d4a92771486dcbb1c7b6c14) |
| `IrisScheduler` — production | [`0xd035ad453f188e54688601efc2865ee5af1196cf`](https://testnet.monadexplorer.com/address/0xd035ad453f188e54688601efc2865ee5af1196cf) |
| `IrisScheduler` — simulation | [`0x9d1e5e57dda0f1a0e48e596982858cbc7a8e8e78`](https://testnet.monadexplorer.com/address/0x9d1e5e57dda0f1a0e48e596982858cbc7a8e8e78) |
| `IrisDelegate` | [`0xc018dffd9d15e8b63be2252ebb28fb5e2367674c`](https://testnet.monadexplorer.com/address/0xc018dffd9d15e8b63be2252ebb28fb5e2367674c) |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadexplorer.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) |

There are two schedulers because the Chainlink forwarder address is immutable in
`IrisScheduler` and *is* its access control — `onReport` accepts a report from
one address and nobody else. One trusts Monad testnet's real forwarder; the
other trusts the mock forwarder, which is what lets a local simulation deliver a
report on chain instead of being rejected.

## For judges

**Open it in Safari, or in Chrome and choose iCloud Keychain when it asks where
to save the passkey.** This is not a preference. Iris derives its keys through
the WebAuthn PRF extension, and a passkey saved into Chrome's own store comes
back without PRF — the account would not be recoverable. Chrome asking you for a
six-digit PIN is the sign it is about to do that.

There is nothing else to set up. No wallet, no extension, no seed phrase, no test
tokens to go and fetch: the demo tops itself up behind the scenes, because
sending someone to a faucet in the middle of a payment is the one thing this
project is arguing against.

To see the whole thing:

1. Open the app and continue with Face ID. That is the account.
2. Send a commitment — an amount, a cadence, a number of payments.
3. Copy the link it gives you and open it in a private window, or on another
   device. That is the recipient, who has never used the app before.
4. Continue with Face ID there. The first payment arrives as the link is opened.
5. Back on the sender's screen, open the commitment to see what has already been
   paid, and stop it if you like — the refund returns what has not yet come due.

The recipient's account holds zero MON throughout, which you can check on the
explorer. That is deliberate, and the reason is in *The account architecture*
below.

## Pre-existing code

The PWA shell is adapted from Monad's official
[`next-serwist-privy-embedded-wallet`](https://github.com/monad-developers/next-serwist-privy-embedded-wallet)
template: the Serwist service worker (`app/sw.ts`), its Next config wiring, the
offline route, the web-push handler and route, the install prompt, the Geist
fonts and the icon set.

Privy is not part of Iris. The template's authentication — `privy-provider.tsx`
and `UseLoginPrivy.tsx` — was dropped and replaced by `lib/account.ts`, which
derives the account from a passkey through Mera. The bounty asks for Mera to be
the entire account layer, and two account layers would be one too many. The
template's docs advertise a `no-privy` branch; only `main` exists.

Everything else — the account layer, the contracts, the spikes, the product
itself — was written during the hackathon period.

## Stack

- **Monad testnet** (chain `10143`)
- **[Mera](https://docs.monad.xyz/guides/mera)** (`@category-labs/mera`) — passkey accounts, the entire account layer. No seed phrase, no extension.
- **EIP-7702** — lets an account that holds nothing act for itself. Cancelling is the one thing only the sender may do, and `IrisDelegate` runs exactly the call they signed while a sponsor pays for it.
- **AUSD** (Agora) — settlement asset, six decimals.
- **Chainlink CRE** — the payment schedule runs as a workflow rather than on our server, so nobody has to trust our uptime.
- **Envio HyperIndex** — payment history. Monad's public RPC caps `eth_getLogs` at a hundred blocks, and a schedule can run for a year.
- **Next.js + Serwist** (PWA) — mobile experience, opened from a link.
- **viem**, **Solidity**

## The account architecture, verified

Monad prevents a *delegated* EOA from dropping below a 10 MON reserve, and the Iris
recipient holds exactly 0 MON. `scripts/spike-7702.ts` settles whether that blocks a
sponsored call from an empty account. It does not.

A freshly generated account with a zero balance signed an EIP-7702 authorization
offline, a funded sponsor submitted the type-4 transaction, and the call landed:

```
tx        0xe7f5907223cf66c0997b3f6187ff556bda92cd585abe0c435672c397e5af59ca
status    success
gas used  88,452
probe saw the recipient as msg.sender
recipient balance after   0 MON
recipient code            0xef0100 8d7d…   (7702 delegation designator)
```

So the account layer is: **Mera derives a plain EOA from a passkey, EIP-7702 gives that
EOA smart-contract behaviour when it needs it, and a sponsor pays the gas.** No
smart-account contract to deploy, no bundler, and Mera remains the entire account layer.

### Where each half actually goes

The spike answered a question about the recipient, but the recipient turned out not to
need it. Claiming carries the recipient's address inside a signature, so the relayer can
submit `claim` for them and the contract verifies who it is for — no delegation
required. The recipient signs nothing and holds nothing.

EIP-7702 earns its place on the **sender's** side instead. Cancelling is the one thing
only the sender may do — `IrisCommitments.cancel` checks `msg.sender` — and a relayer
cannot stand in for them. `IrisDelegate` closes that: the sender signs the exact call,
a sponsor submits it, and it runs as the sender's own account.

The delegate is small on purpose, because the spike version of it was dangerous. That
one had no access control at all, so anyone could have executed anything through a
delegated account. The shipped one binds the account, the chain, the target, the
calldata and a nonce into the digest it checks, keeps that nonce in the account's own
storage, and rejects the upper half of the signature space. `scripts/cancel-gasless.ts`
proves the path and then tries to abuse it — replaying the signature, and pointing it at
a transfer of the refund. Both are rejected.

### One design rule this exposed

The reserve is a floor on *reductions*, and a balance of zero cannot be reduced. That
holds only while the recipient's native balance stays at zero — AUSD is an ERC-20, so
moving it never touches MON. But if the recipient ever came to hold a small amount of
MON, a delegated account dropping from, say, 0.5 MON toward zero is exactly the case the
rule is written about.

**Never send the recipient native MON.** Their balance stays at zero and gas stays with
the sponsor. Anything else re-opens a question we just closed.

## Running the spike

```bash
npm install
npm run compile
npm run spike:7702      # prints a sponsor address to fund on first run
```

Fund the printed address at [faucet.monad.xyz](https://faucet.monad.xyz), then run it again.

## AI tooling

This project is built with AI coding assistance (Claude). Disclosed per the Metropolis
rules, section 4.1.

## License

MIT

## Verified on-chain (5 Sep 2026)

AUSD on Monad testnet — `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`

| | |
|---|---|
| symbol | `AUSD` |
| **decimals** | **6** — not 18 |
| EIP-712 | `DOMAIN_SEPARATOR()` present |
| ERC-2612 | `nonces()` present |
| **ERC-3009** | **`authorizationState()` present** — gasless transfers by signature |

`npm run probe:ausd` re-runs the check.

ERC-3009 means neither side needs to hold gas for the money to move: the sender signs
`transferWithAuthorization` off-chain and a relayer submits it. Combined with the fact
that scheduled payouts are *pushed* by a keeper, the recipient never signs anything to
receive funds — only to spend them.

## The stateless test, passed

Safari, iCloud Keychain, nothing persisted:

```
create   credential 4GvQoXpkKxEyKeU0TSX3gZP7fho
         prf output 32 bytes
         address    0xdc0CAcA6C26b31B0eB8584464e149Bda32892856
wipe     localStorage and sessionStorage cleared
sign in  address    0xdc0CAcA6C26b31B0eB8584464e149Bda32892856   ← identical
```

`getPasskeyPrfOutput` takes an `rpId` and an *optional* credential id. Omitting
the id lets the platform offer the passkey, and a fixed 32-byte PRF salt yields
the same entropy, the same secp256k1 key, and the same address. Nothing is
written to storage at any point, so there is nothing for a judge to clear.

Together with the 7702 result above, the whole account layer now rests on
measurements rather than assumptions: a passkey produces a stable key, the key
is a plain EOA, 7702 gives that EOA smart-contract behaviour, and a sponsor
pays for it.

## The commitment contract

`contracts/IrisCommitments.sol`. A bank transfer is a promise; a commitment
here is money already set aside. The whole schedule is escrowed at creation, so
the recipient reads what is coming and when rather than being told.

Three properties are deliberate:

- **Releases are permissionless.** Once a payment is due, anyone may push it —
  a scheduler, the sender, the recipient. Nobody has to be trusted to run a
  keeper, and the recipient never signs or holds gas to be paid.
- **Cancellation cannot claw back what is already owed.** A sender may stop
  future payments and take back what is still unscheduled; a payment that has
  come due is released to the recipient on the way out.
- **State lives on chain and both sides are indexed.** `incomingOf` and
  `outgoingOf` rebuild everything from an address, which is what lets the app
  hold nothing locally.

`create` pulls the schedule with an approval. `createWithAuthorization` takes a
signed ERC-3009 authorization instead, so the sender needs neither gas nor a
prior approval and a relayer submits on their behalf — the signer is the
sender, never `msg.sender`.

`scripts/lifecycle.ts` exercises all of it against Monad testnet — deployed
contracts, mined transactions, state read back off the chain:

```
✓ recipient starts with 0 MON
✓ first payment settled instantly
✓ recipient still holds 0 MON
✓ commitment is discoverable from the address alone
✓ nothing releasable before the interval elapses
✓ a payment comes due on schedule
✓ release paid without the recipient signing anything
✓ payer holds 0 MON        (gasless creation)
✓ the signer is the sender, not the relayer
✓ payer never paid gas
✓ escrow is empty: everything went to the recipient or back to the sender
```

A missed scheduler window costs the recipient nothing: `release` catches up on
every payment whose time has passed, which the run above shows as 400 AUSD
becoming claimable in one call.

### How the two people find each other

A sender cannot address a commitment to someone who has no wallet, which is
everyone this is for. Asking them to send an address first is the moment the
product stops being about money and starts being about crypto.

So a commitment can be opened against a **keypair** instead. The public half
stays on chain; the private half travels in a link, over whatever messenger the
two people already use. Whoever opens the link signs their own fresh address
with the link key, and the commitment binds to them — with everything already
due arriving in that same moment, which is the only moment they are watching.

The address sits *inside* the signature rather than beside it. An observer
watching the mempool can only replay the claim to the address it already names,
so the link is safe to send the way people actually send things. `scripts/claim-link.ts`
tries exactly that theft and fails:

```
✓ commitment has no recipient yet
✓ nothing is releasable while unclaimed
✓ the whole schedule is escrowed
✓ recipient holds 0 MON
✓ the link bound to the address that opened it
✓ money due arrived the moment the link opened
✓ recipient still holds 0 MON and signed no transaction
✓ commitment is now discoverable from the recipient's address
✓ a captured signature cannot be pointed at a different address
```

Contact-list matching — the way a messenger shows who is already on it — needs
a phone directory on a server, SMS verification, and native access to an address
book. Safari on iOS has no contacts API at all, and a server holding phone
numbers is exactly the server-as-source-of-truth the stateless test rules out.
The link avoids all three: the address book that matters is the one already in
the messenger. After a first claim the address is known, so the people you have
actually paid become a list built from history rather than from a phone.

### AUSD

Iris settles in Agora's real AUSD, and the lifecycle above runs against it, not
a stand-in. Agora's faucet is documented for Sepolia only, but the same
contract is deployed and funded on Monad testnet, so no whitelisting was
needed:

```bash
npm run get:ausd    # requestFunds(recipient) → 10,000 AUSD
```

Two details cost time and are worth writing down. The faucet's argument is the
recipient, not the asset. And the EIP-712 domain is named **"Agora Dollar"**,
not "AUSD" — signing against the wrong name fails as `InvalidSignature()`,
which reads like a broken signature rather than a wrong domain. The domain is
read off chain via EIP-5267 rather than assumed.

`contracts/MockAUSD.sol` remains for `npm run lifecycle -- --mock`, which is
useful when the faucet is rate limited.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Checks worth running, none of which need a browser:

```bash
npm run lifecycle              # the escrow, end to end on testnet
npm run claim-link             # claim links, including an attempt to steal one
npx tsx scripts/exploit-poc.ts # the authorization exploit we found, still refuted
npx tsx scripts/cancel-gasless.ts   # cancelling from an account holding nothing
npx tsx scripts/cancel-relay.ts     # the same through the relayer (needs npm run dev)
cd indexer && npm test         # the indexer's handlers, no database, no network
```

Open it in **Safari**. In Chrome it works too, but the passkey has to be saved
to iCloud Keychain — Chrome's own profile store cannot do PRF, and a passkey
created there will not rebuild the account. The six-digit PIN prompt is the
tell.

### Deploying

Any Next.js host. One environment variable is required:

| | |
|---|---|
| `SPONSOR_PK` | the relayer's key — see below |
| `MONAD_RPC_URL` | optional, defaults to the public testnet RPC |
| `NEXT_PUBLIC_IRIS_ADDRESS` | optional, defaults to the deployed contract |
| `NEXT_PUBLIC_IRIS_DELEGATE` | optional, defaults to the deployed delegate |
| `NEXT_PUBLIC_INDEXER_URL` | optional, but **set it** — see below |

The indexer URL deserves the warning. Envio gives every deployment its own
address and a stable one is a paid feature, so any push that rebuilds the
indexer changes the link. The default compiled into `lib/indexer.ts` is
whichever deployment was current when it was written; set the variable rather
than trusting it. Getting it wrong costs the history panel and nothing else.

Two things are worth settling before anyone else uses a deployment.

**The domain is part of the account.** A passkey is bound to the hostname it
was created on, so moving to a different address orphans every account made at
the old one. Pick the URL once.

**The relayer is a hot wallet.** Anything the server can sign, the internet can
ask it to sign, and the throttle in `app/api/relay/route.ts` lives in process
memory — on a serverless host that is close to no throttle at all. Give the
deployment its own key rather than a development one, keep the balance small,
and move the throttle into a durable store before this ever touches real money.

## The screens

**Sending.** Amount, cadence, how many times. The line underneath says what
lands today and what is set aside in total, because the number that matters to
a sender is not the transfer, it is the promise they are making. Confirming
signs an ERC-3009 authorization — no gas, no approval — and a relayer puts it
on chain.

**The link.** A URL with the claim key after the `#`. A fragment never reaches
a server, an access log, or a `Referer` header; in a query string the key would
be quietly published to everything in the path.

**Receiving.** The link opens to what is waiting and one button. A passkey
ceremony creates the account, the link's key signs that address, and a relayer
submits the claim. Money due arrives in the same moment. The recipient installs
nothing, holds no gas, and signs no transaction.

**The commitment itself.** Opening one from either list shows what has already
been paid — the date, which payment it was, and a link to the receipt. The
sender also gets one destructive action, and it says what it does before it does
it: stopping returns what has not yet come due, and cannot claw back a payment
that has.

Both sides work from an empty account: the recipient because they have nothing,
the sender because there is no reason they should need to be different.
`createToClaimWithAuthorization` is the gasless half of that, and the schedule
is bound into the ERC-3009 nonce so a lifted authorization cannot be re-pointed
at an attacker's link.

### The relayer

`app/api/relay/route.ts` pays for both. It never accepts a call — only
arguments for one of three known actions, which it encodes itself, simulates,
and refuses if it would revert. Rate limited per address and per IP. What keeps
it honest is that it cannot cheat even if it wanted to: a claim carries the
recipient inside the signature and a creation carries the schedule inside the
nonce.

The third action draws test AUSD from Agora's faucet so the demo can be run end
to end. That one is scaffolding, and says so on screen.

## The scheduler

A commitment says when the next payment is due; something still has to push it.
Doing that from our own server would put the product's central promise behind an
uptime guarantee nobody outside can check — the recipient would be trusting us
again, which is the thing escrow was meant to remove.

So the schedule runs as a **Chainlink CRE workflow** (`cre/workflow`). On each
tick it asks Iris which commitments have come due, fetches the day's exchange
rate for the recipient's currency, and delivers both to `IrisScheduler` in one
signed report.

The rate is not decoration. What a recipient cares about is the number in their
own currency, and recording the rate at the moment of settlement makes that
figure checkable afterwards rather than something the interface drew. It is also
what makes this an orchestration layer rather than a cron job: chain state and
an outside data source meet in one place, under consensus — every node fetches
the rate and the results are reduced by median, so a single misbehaving source
cannot move what gets written.

`dueBatch(offset, limit)` exists for this. A scheduler asking about each
commitment separately would make one request per commitment per tick; the range
is walked on chain instead and only what is worth acting on comes back.

Releasing stays permissionless, so the scheduler holds no power over anyone's
money. If the workflow stops, payments are pushed by whoever wants them
pushed — the recipient included. `IrisScheduler` also swallows a failure on any
single commitment, so one that cannot pay does not hold up the rest of the batch.

## History

The chain knows what a commitment *is* — how many payments have gone out, when
the next one falls due. It is a poor place to ask what already *happened*. That
lives in events, and Monad's public RPC hands those back a hundred blocks at a
time, which is no way to read a schedule that runs for a year.

So history comes from an Envio indexer, in `indexer/`. Four events fold into
three entities: the commitment, one row per payment, and per-address running
totals for both sides — the last because the app opens on them and a passkey
account arrives with no local history to fall back on.

The case worth reading the handlers for is a commitment opened through a claim
link. It is created with a zero recipient, because the person it is for may not
have an address yet, and only learns who it belongs to when the link is
redeemed. No account is created for the zero address, and the recipient is
counted once rather than twice.

`npm test` in `indexer/` replays a whole commitment — created for nobody,
claimed, paid twice, cancelled — with no database and no network, so the
handlers can be checked without the Docker and API token that running the
indexer itself needs. Envio Cloud builds it from this repository, so neither is
needed there either.

Reading history is a convenience, never a dependency: if the indexer is
unreachable the interface still works, it simply cannot show the past.

## Key lifetime

The account key is not something to hold. Deriving it costs a touch of a
finger, so `lib/account.ts` zeroes its session on the way out of every entry
point — including when the work it was opened for throws. What is left is a
policy rather than a mechanism:

| | |
|---|---|
| reading a balance or a history | no key at all |
| moving money | a fresh prompt, every time |
| several steps of one flow | one session, with an expiry the interface shows |

`register()` and `restore()` return an address and nothing else. `withSigner()`
lends a signer for one piece of work and zeroes it after — Mera throws
`SESSION_ENDED` on any later use, so a stray reference is inert rather than
dangerous. `Session.open(ttl)` covers a flow with several steps and closes
itself when the time runs out, exposing `expiresAt` so the interface can say
when: a session that vanishes without warning is worse than one that asks
again.

A per-transaction key is the wrong shape here — the key *is* the account, so a
new one each time would mean a new address each time, and money sent yesterday
would be stranded at yesterday's identity. What should be ephemeral is the
key's residence in memory, not its value. The claim-link key is the opposite
case and is genuinely per-commitment: generated for one link, single-use by
construction, dead once claimed.

## Security

The contract holds other people's money, so it was reviewed rather than
assumed correct. What that turned up:

**An ERC-3009 authorization did not commit to who gets paid.** The signature
covers moving `value` into this contract and nothing more, so an observer could
lift it out of the mempool and open a commitment to *themselves* with it.
`scripts/exploit-poc.ts` did exactly that and walked away with 40 AUSD on a live
deployment. Fixed by requiring the authorization's nonce to equal
`authorizationNonce(...)` — a hash of the recipient, amount, interval, count and
start flag. The nonce is signed, so the schedule is signed with it, and the same
script is now refused while the honest path still settles.

**Catching up on missed payments was a loop.** One iteration per payment due
meant a long-dormant commitment could cost more gas than a block allows and
become impossible to release — the money would be stuck. Replaced with closed-form
arithmetic, so a backlog of any size costs the same.

**Schedule arithmetic could wrap.** `interval * paymentsTotal` was written into a
`uint40` inside an `unchecked` block. Bounded to 366 days and 600 payments, which
keeps the product an order of magnitude inside the type.

Known and accepted, rather than fixed:

- **A sender can front-run a claim with `cancel`.** Escrow guarantees the money
  exists and is not spent elsewhere; it does not make it irrevocable before the
  link is opened. The honest claim is that funds are *set aside*, not that they
  cannot be withdrawn.
- **AUSD can freeze an account.** A frozen recipient makes `release` revert, and
  the commitment stalls until the freeze lifts. Iris cannot route around the
  issuer of a regulated asset, and pretending otherwise would be worse.
- **An unopened link holds the escrow indefinitely** until the sender cancels.

## Authenticator support, measured

The account layer rests on the WebAuthn PRF extension, and PRF is not uniformly
available. Measured on macOS 26 with `spikes/mera-browser`, which calls
`navigator.credentials` directly and prints what the platform returns:

| Browser | Store | `extension:prf` | Result at registration |
|---|---|---|---|
| Safari | iCloud Keychain | true | `{enabled: true, results: {first: …}}` |
| Chrome | iCloud Keychain | true | `{enabled: true, results: {first: …}}` |
| Chrome | Chrome profile | true | **`{enabled: false}`** |

The client capability says nothing about the outcome: Chrome reports
`extension:prf = true` and then hands back a credential with PRF disabled when
the passkey lands in its own profile store. A six-digit PIN prompt during
registration is the tell.

Two consequences for the product:

- Pinning `authenticatorAttachment: "platform"` steers macOS Chrome into the
  profile store. Leaving the selection unconstrained lets the picker appear so
  iCloud Keychain can be chosen.
- A passkey created without PRF cannot rebuild the account, so the failure has
  to be caught at registration and explained, not discovered later when the
  user returns to an account that no longer resolves.
