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
- [ ] Commitment escrow contract
- [ ] Recipient flow
- [ ] Sender flow

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
