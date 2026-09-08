/**
 * Rebuilding both sides of a commitment from events alone.
 *
 * The contract already indexes sender and recipient, but reading that back is
 * the problem: Monad's public RPC caps eth_getLogs at a 100-block window, and a
 * schedule can run for a year. So we fold the events into entities here, and
 * the app asks one GraphQL question instead of walking the chain.
 *
 * The one subtlety is that a recipient may not exist yet. A commitment opened
 * through a claim link is created with a zero recipient and only learns who it
 * belongs to when the link is redeemed, so `recipient` stays null until then.
 */
import { indexer } from "envio";

const NOBODY = "0x0000000000000000000000000000000000000000";

/** Addresses arrive checksummed from the ABI; we key on them, so pick one case. */
const key = (address: string) => address.toLowerCase();

const blankAccount = (id: string) => ({
  id,
  commitmentsSent: 0,
  commitmentsReceived: 0,
  totalEscrowed: 0n,
  totalReceived: 0n,
});

indexer.onEvent(
  { contract: "IrisCommitments", event: "CommitmentCreated" },
  async ({ event, context }) => {
    const id = event.params.id.toString();
    const sender = key(event.params.sender);
    const named = event.params.recipient !== NOBODY;
    const recipient = named ? key(event.params.recipient) : undefined;

    const amountPerPayment = BigInt(event.params.amountPerPayment);
    const paymentsTotal = Number(event.params.paymentsTotal);
    const firstPaymentAt = BigInt(event.params.firstPaymentAt);

    context.Commitment.set({
      id,
      sender,
      recipient,
      amountPerPayment,
      interval: Number(event.params.interval),
      paymentsTotal,
      paymentsMade: 0,
      totalCommitted: amountPerPayment * BigInt(paymentsTotal),
      totalReleased: 0n,
      refunded: 0n,
      firstPaymentAt,
      nextPaymentAt: firstPaymentAt,
      cancelled: false,
      claimed: named,
      createdAt: BigInt(event.block.timestamp),
      createdTx: event.transaction.hash,
    });

    const from = await context.Account.getOrCreate(blankAccount(sender));
    context.Account.set({
      ...from,
      commitmentsSent: from.commitmentsSent + 1,
      totalEscrowed: from.totalEscrowed + amountPerPayment * BigInt(paymentsTotal),
    });

    // A commitment addressed to a known recipient counts for them immediately.
    // One waiting on a claim link is counted when the link is redeemed instead.
    if (recipient) {
      const to = await context.Account.getOrCreate(blankAccount(recipient));
      context.Account.set({ ...to, commitmentsReceived: to.commitmentsReceived + 1 });
    }
  },
);

indexer.onEvent(
  { contract: "IrisCommitments", event: "CommitmentClaimed" },
  async ({ event, context }) => {
    const id = event.params.id.toString();
    const recipient = key(event.params.recipient);

    const commitment = await context.Commitment.get(id);
    if (!commitment) {
      // Only reachable if the start block were set after the creation event.
      context.log.error(`claim for unknown commitment ${id}`);
      return;
    }

    context.Commitment.set({ ...commitment, recipient, claimed: true });

    const to = await context.Account.getOrCreate(blankAccount(recipient));
    context.Account.set({ ...to, commitmentsReceived: to.commitmentsReceived + 1 });
  },
);

indexer.onEvent(
  { contract: "IrisCommitments", event: "PaymentReleased" },
  async ({ event, context }) => {
    const id = event.params.id.toString();
    const recipient = key(event.params.recipient);
    const amount = BigInt(event.params.amount);
    const paymentsMade = Number(event.params.paymentsMade);

    const commitment = await context.Commitment.get(id);
    if (!commitment) {
      context.log.error(`release for unknown commitment ${id}`);
      return;
    }

    context.Commitment.set({
      ...commitment,
      recipient,
      claimed: true,
      paymentsMade,
      nextPaymentAt: BigInt(event.params.nextPaymentAt),
      totalReleased: commitment.totalReleased + amount,
    });

    context.Payment.set({
      id: `${id}-${paymentsMade}`,
      commitment_id: id,
      recipient,
      amount,
      paymentNumber: paymentsMade,
      releasedAt: BigInt(event.block.timestamp),
      txHash: event.transaction.hash,
    });

    const to = await context.Account.getOrCreate(blankAccount(recipient));
    context.Account.set({ ...to, totalReceived: to.totalReceived + amount });
  },
);

indexer.onEvent(
  { contract: "IrisCommitments", event: "CommitmentCancelled" },
  async ({ event, context }) => {
    const id = event.params.id.toString();

    const commitment = await context.Commitment.get(id);
    if (!commitment) {
      context.log.error(`cancellation for unknown commitment ${id}`);
      return;
    }

    const refunded = BigInt(event.params.refunded);
    context.Commitment.set({ ...commitment, cancelled: true, refunded });

    // What was refunded was never really escrowed, as far as the sender's
    // running total is concerned.
    const from = await context.Account.getOrCreate(blankAccount(commitment.sender));
    context.Account.set({ ...from, totalEscrowed: from.totalEscrowed - refunded });
  },
);
