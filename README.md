# Monada

Cross-border support that the recipient can see coming.

Instead of a one-off transfer, the sender creates a **commitment** — "$200 on the 5th,
every month". The money is reserved up front and the recipient sees the confirmed
commitment and a countdown *before* it arrives. The receiving side never installs an
app, never sees a seed phrase, and never needs gas: they open a link, use Face ID, and
the amount is shown in their own currency.

Built for **Monad Metropolis 2026** — Track 02, Consumer Products & Payments.

## Status

Early. Currently validating the account architecture before building the product.

- [x] Project scaffold
- [ ] **Spike: EIP-7702 sponsored gas for a zero-balance account** ← blocking
- [ ] Mera passkey onboarding in the browser
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

## The open question

Monad prevents a *delegated* EOA from dropping below a 10 MON reserve. Our recipient
holds exactly 0 MON. `scripts/spike-7702.ts` answers whether that restriction blocks a
sponsored call from an empty account. Everything else waits on the answer.

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
