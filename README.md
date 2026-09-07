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

The account layer is proven end to end. Building the product on top of it now.

- [x] Project scaffold
- [x] Spike: EIP-7702 sponsored gas for a zero-balance account — **passed**
- [x] Mera passkey onboarding in the browser — **stateless test passes**
- [x] PWA shell with Mera as the account layer
- [x] Commitment escrow contract
- [ ] Recipient flow
- [ ] Sender flow

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
- **EIP-7702** — the recipient's EOA gains smart-contract behaviour and a sponsor pays gas, so a zero-balance account can claim.
- **AUSD** (Agora) — settlement asset. `earnAUSD` for funds in flight.
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
EOA smart-contract behaviour, and a sponsor pays the gas.** No smart-account contract to
deploy, no bundler, and Mera remains the entire account layer.

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
