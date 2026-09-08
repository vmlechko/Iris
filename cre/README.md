# The schedule, as a Chainlink CRE workflow

A commitment says when the next payment is due. Something still has to push it,
and running that from our own server would put the product's central promise
behind an uptime guarantee nobody outside can verify — the recipient would be
trusting us again, which is what the escrow was meant to remove.

So the schedule runs as a workflow. On each tick it asks Iris which commitments
have come due, fetches the exchange rate for the recipient's currency, and
delivers both to `IrisScheduler` in one signed report. Releasing on Iris is
permissionless, so the workflow holds no power over anyone's money: if it stops,
payments are pushed by whoever wants them pushed, the recipient included.

## Deployed

| | |
|---|---|
| `IrisCommitments` | `0x7ed55fed7346ef9b5d4a92771486dcbb1c7b6c14` |
| `IrisScheduler`, production | `0xd035ad453f188e54688601efc2865ee5af1196cf` |
| `IrisScheduler`, simulation | `0x9d1e5e57dda0f1a0e48e596982858cbc7a8e8e78` |

There are two receivers because the forwarder is immutable and *is* the access
control — `onReport` accepts a report from one address and nobody else. The
production receiver trusts Monad testnet's real forwarder,
`0xF8344CFd5c43616a4366C34E3EEE75af79a74482`. The simulation receiver trusts the
mock forwarder, `0xB9F79d863261869B234c481D1f9A7af84AeAd192`, which is what lets
a local run actually deliver a report on chain instead of being rejected.

Both addresses come from `cre workflow supported-chains`, which is scoped to
your tenant. Do not copy them from here into another account's project without
checking.

## Running it

```
cd workflow && bun install
cre login
cre workflow simulate ./workflow --config $PWD/workflow/config.simulate.json --broadcast
```

`config.staging.json` ticks hourly, which is right for production and painful to
watch — the simulator waits for the real clock. `config.simulate.json` ticks
every minute and points at the simulation receiver, so a run finishes in about a
minute.

`--broadcast` sends a real transaction, paid for by `CRE_ETH_PRIVATE_KEY` in
`cre/.env`. Without it the workflow runs but writes nothing.

To give the workflow something to find:

```
npx tsx scripts/seed-due.ts
```

That opens a three-payment schedule a minute apart. The first payment settles
instantly as the commitment opens; the second is what the workflow picks up.

## A run that worked

8 September 2026, against the deployed contracts:

```
[USER LOG] examined 2 commitments, 1 due
[USER LOG] 1 USD = 1321.225569 NGN
[USER LOG] released 1 payment(s) — 0x0c6501ea589f1cfc98b6c9ed90349c6d8c5d339ed8b9f0e8df61caba9e8d060c
```

On chain afterwards: commitment #1 at 2 payments of 3, the rate recorded on the
scheduler as `1 USD = 1321.225569 NGN`, the recipient one AUSD richer — and
still holding exactly zero native MON, which is the point.

## What is not done

`cre whoami` reports **Deploy Access: Not enabled**, so the workflow cannot yet
run on the DON itself; `cre account access` requests that. Everything above is a
local run of the same code against the real chain.
