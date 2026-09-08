# Iris indexer

Monad's public RPC caps `eth_getLogs` at a 100-block window. A commitment can
run for a year, so the app cannot read its own history back off the chain
directly — it asks this instead.

Four events in, three entities out:

- **Commitment** — the schedule, what has been released against it, and what
  came back on cancellation.
- **Payment** — one row per release, keyed `<commitment>-<payment number>`.
- **Account** — running totals for one address, on both sides. The app opens on
  this, and a passkey account arrives with no local history to fall back on.

The case worth reading the handlers for is a commitment opened through a claim
link. It is created with a zero recipient, because the person it is for may not
have an address yet, and only learns who it belongs to when the link is
redeemed. `recipient` stays null until then, no account is created for the zero
address, and the recipient is counted exactly once.

## Running the tests

```
npm install
npm run codegen
npm test
```

`npm test` replays a whole commitment — created for nobody, claimed, paid twice,
cancelled — through the handlers with no database and no network.

## Running the indexer

```
npm run dev
```

Two things this needs that the tests do not:

- **Docker**, for the local Postgres and Hasura that `envio dev` brings up.
- **An Envio API token** in `ENVIO_API_TOKEN`, from
  [app.envio.dev/api-tokens](https://app.envio.dev/api-tokens). HyperSync
  rejects unauthenticated queries.

The start block is the first block of 4 September 2026, which precedes the
deployment. The deployment block itself was never recorded and cannot be
recovered with `eth_getCode`, because the public RPC prunes historical state —
`scripts/start-block.mjs` in the repository root bisects on block timestamps
instead.
