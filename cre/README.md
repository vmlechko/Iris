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
| `IrisCommitments` | `0x9f7f068b3297c77490b9606063e0f827a2db9a48` |
| `IrisScheduler`, production | `0x67b9053d1e1232b5219bcc2be2e68365f48204b1` |
| `IrisScheduler`, simulation | `0x0e7fc813ef8c28b0d41294feb86512afc3c3fd27` |

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

5 October 2026 — against the addresses above: `IrisCommitments`
`0x9f7f068b3297c77490b9606063e0f827a2db9a48` and the simulation receiver
`0x0e7fc813ef8c28b0d41294feb86512afc3c3fd27`.

```
[USER LOG] examined 12 commitments, 1 due
[USER LOG] 1 USD = 1331.279356 NGN
[USER LOG] released 1 payment(s) — 0x86623e09c5c214090bda110fa08e1c9ffa3ba3990cea69ee05d321dfd83d36ff
```

On chain afterwards: that transaction succeeded in block 68392944, the rate
reads back off the scheduler as `NGN 1331.279356` with today's timestamp, and
the recipient is one AUSD richer while still holding exactly zero native MON,
which is the point.

The rate is not decoration: the app prefers the one recorded here over the
public source whenever it is for the viewer's own currency, and says which it
used. See *What it is worth at home* in the root README.

## What is not done

`cre whoami` reports **Deploy Access: Not enabled**, so the workflow cannot yet
run on the DON itself; `cre account access` requests that. Everything above is a
local run of the same code against the real chain.
