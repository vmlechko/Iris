/**
 * Replay a commitment's whole life through the handlers.
 *
 * No database and no network: the test indexer feeds simulated logs straight
 * into the handlers, which is the only part we wrote and so the only part worth
 * testing. What it proves is the thing that is easy to get wrong — that a
 * commitment opened for someone who has no address yet ends up attributed to
 * the right person, exactly once, after the claim link is redeemed.
 *
 *     npm test
 */
import { createTestIndexer, TestHelpers } from "envio";
import "../src/handlers.js";

const [ALICE, BOB, CAROL] = TestHelpers.Addresses.mockAddresses;
const NOBODY = "0x0000000000000000000000000000000000000000" as const;

const AUSD = (whole: number) => BigInt(whole) * 1_000_000n;
const MONTH = 30 * 24 * 60 * 60;
const START = 1_757_000_000;
/** Above the config's start_block, or the simulator filters every event out. */
const FIRST_BLOCK = 60_827_700;

let checks = 0;
let failures = 0;

/** Entities are full of bigints, and JSON.stringify refuses to print those. */
const show = (value: unknown) =>
  value === undefined
    ? "undefined"
    : JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}n` : v));

function check(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  const detail = ok ? "" : `  — got ${show(actual)}, wanted ${show(expected)}`;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}${detail}`);
}

const at = (n: number) => ({
  number: FIRST_BLOCK + n,
  timestamp: START + n * 60,
  hash: `0x${(n + 1).toString(16).padStart(64, "0")}`,
});
const tx = (n: number) => ({ hash: `0x${(n + 1).toString(16).padStart(64, "0")}` });

const test = createTestIndexer();

await test.process({
  chains: {
    10143: {
      simulate: [
        // Alice opens a commitment for someone who has no address yet.
        {
          contract: "IrisCommitments",
          event: "CommitmentCreated",
          block: at(0),
          transaction: tx(0),
          params: {
            id: 1n,
            sender: ALICE,
            recipient: NOBODY,
            amountPerPayment: AUSD(50),
            interval: BigInt(MONTH),
            paymentsTotal: 6n,
            firstPaymentAt: BigInt(START),
          },
        },
        // The sender said who it is from and what it is for.
        {
          contract: "IrisCommitments",
          event: "CommitmentNoted",
          block: at(0),
          transaction: tx(0),
          params: { id: 1n, from: "Alice", about: "the flat" },
        },
        // Bob opens the link.
        {
          contract: "IrisCommitments",
          event: "CommitmentClaimed",
          block: at(1),
          transaction: tx(1),
          params: { id: 1n, recipient: BOB },
        },
        // Two payments come due and are pushed.
        {
          contract: "IrisCommitments",
          event: "PaymentReleased",
          block: at(2),
          transaction: tx(2),
          params: {
            id: 1n,
            recipient: BOB,
            amount: AUSD(50),
            paymentsMade: 1n,
            nextPaymentAt: BigInt(START + MONTH),
          },
        },
        {
          contract: "IrisCommitments",
          event: "PaymentReleased",
          block: at(3),
          transaction: tx(3),
          params: {
            id: 1n,
            recipient: BOB,
            amount: AUSD(50),
            paymentsMade: 2n,
            nextPaymentAt: BigInt(START + 2 * MONTH),
          },
        },
        // A second commitment, addressed directly — no claim link involved.
        {
          contract: "IrisCommitments",
          event: "CommitmentCreated",
          block: at(4),
          transaction: tx(4),
          params: {
            id: 2n,
            sender: CAROL,
            recipient: BOB,
            amountPerPayment: AUSD(10),
            interval: BigInt(MONTH),
            paymentsTotal: 3n,
            firstPaymentAt: BigInt(START + MONTH),
          },
        },
        // Alice stops the first one. Four payments were never released.
        {
          contract: "IrisCommitments",
          event: "CommitmentCancelled",
          block: at(5),
          transaction: tx(5),
          params: { id: 1n, sender: ALICE, refunded: AUSD(200) },
        },
      ],
    },
  },
});

console.log("\nA commitment opened for someone with no address yet");
const first = await test.Commitment.getOrThrow("1");
check("is attributed to whoever redeemed the link", first.recipient, BOB.toLowerCase());
check("is marked claimed", first.claimed, true);
check("carries who it is from", first.noteFrom, "Alice");
check("and what it is for", first.noteAbout, "the flat");
check("escrowed the whole schedule up front", first.totalCommitted, AUSD(300));
check("counts what has actually been released", first.totalReleased, AUSD(100));
check("tracks how many payments went out", first.paymentsMade, 2);
check("carries the next due date forward", first.nextPaymentAt, BigInt(START + 2 * MONTH));
check("is cancelled", first.cancelled, true);
check("returned what was still unscheduled", first.refunded, AUSD(200));

console.log("\nA commitment nobody wrote anything about");
const unlabelled = await test.Commitment.getOrThrow("2");
check("says nothing rather than something wrong", unlabelled.noteFrom, "");

console.log("\nThe zero address is not a person");
const nobody = await test.Account.get(NOBODY);
check("no account is created for it", nobody, undefined);

console.log("\nReleases");
const payments = await test.Payment.getAll();
check("one row per release", payments.length, 2);
const second = payments.find((p) => p.id === "1-2");
check("keyed by commitment and payment number", second?.id, "1-2");
check("linked back to the commitment", second?.commitment_id, "1");
check("records who pushed it to", second?.recipient, BOB.toLowerCase());
check("and how much moved", second?.amount, AUSD(50));

console.log("\nRunning totals, which is what the app opens on");
const alice = await test.Account.getOrThrow(ALICE.toLowerCase());
check("Alice sent one commitment", alice.commitmentsSent, 1);
check("her total is net of the refund", alice.totalCommitted, AUSD(100));

const bob = await test.Account.getOrThrow(BOB.toLowerCase());
check("Bob is on the receiving end of two", bob.commitmentsReceived, 2);
check("counted once each, not twice for the claim", bob.commitmentsSent, 0);
check("and has been paid what was released", bob.totalReceived, AUSD(100));

const carol = await test.Account.getOrThrow(CAROL.toLowerCase());
check("Carol's direct commitment counts in full", carol.totalCommitted, AUSD(30));

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
