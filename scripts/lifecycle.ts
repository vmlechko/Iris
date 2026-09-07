/**
 * Full commitment lifecycle against Monad testnet.
 *
 * Nothing here is simulated: contracts are deployed, transactions are mined,
 * and the assertions read state back off the chain. The recipient is generated
 * fresh with zero MON and never signs anything, which is the property the whole
 * product rests on.
 *
 * AUSD is stood in by MockAUSD until access to Agora's staging environment
 * lands. The interface Iris depends on — six decimals, ERC-3009 — is identical.
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

const artifacts = JSON.parse(readFileSync("artifacts/contracts.json", "utf8"));
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

const usd = (v: bigint) => `${formatUnits(v, 6)} AUSD`;
const line = (l: string, v: unknown) => console.log(`  ${l.padEnd(28)} ${v}`);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

async function main() {
  const sponsor = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const wallet = createWalletClient({ account: sponsor, chain: monadTestnet, transport: http(rpc) });

  console.log("\n── Iris · commitment lifecycle on Monad testnet ──\n");
  line("sponsor", sponsor.address);

  const deploy = async (name: "MockAUSD" | "IrisCommitments", args: unknown[] = []) => {
    const hash = await wallet.deployContract({
      abi: artifacts[name].abi,
      bytecode: artifacts[name].bytecode,
      args: args as never,
    });
    const { contractAddress } = await publicClient.waitForTransactionReceipt({ hash });
    line(name, contractAddress!);
    return contractAddress!;
  };

  const ausd = await deploy("MockAUSD");
  const iris = await deploy("IrisCommitments", [ausd]);

  const A = artifacts.MockAUSD.abi;
  const I = artifacts.IrisCommitments.abi;
  const send = async (to: Address, abi: unknown, fn: string, args: unknown[]) => {
    const hash = await wallet.writeContract({ address: to, abi: abi as never, functionName: fn, args: args as never });
    return publicClient.waitForTransactionReceipt({ hash });
  };
  const read = (to: Address, abi: unknown, fn: string, args: unknown[] = []) =>
    publicClient.readContract({ address: to, abi: abi as never, functionName: fn, args: args as never }) as Promise<any>;

  // ---- a recipient who holds nothing and signs nothing --------------------
  const recipient = privateKeyToAccount(generatePrivateKey());
  line("recipient (fresh)", recipient.address);
  check((await publicClient.getBalance({ address: recipient.address })) === 0n, "recipient starts with 0 MON");

  const perPayment = parseUnits("200", 6);
  const payments = 3;
  const interval = 2;

  // ---- instant settlement at creation -------------------------------------
  console.log("\n  Creating a commitment: 200 AUSD × 3, first payment now\n");
  await send(ausd, A, "mint", [sponsor.address, perPayment * BigInt(payments)]);
  await send(ausd, A, "approve", [iris, perPayment * BigInt(payments)]);
  await send(iris, I, "create", [recipient.address, perPayment, interval, payments, true]);

  const id = 0n;
  let c = await read(iris, I, "get", [id]);
  line("recipient balance", usd(await read(ausd, A, "balanceOf", [recipient.address])));
  check((await read(ausd, A, "balanceOf", [recipient.address])) === perPayment, "first payment settled instantly");
  check(c.paymentsMade === 1, "one of three payments made");
  check((await publicClient.getBalance({ address: recipient.address })) === 0n, "recipient still holds 0 MON");

  // ---- the recipient can find it with nothing stored ----------------------
  const incoming = await read(iris, I, "incomingOf", [recipient.address]);
  check(incoming.length === 1 && incoming[0] === id, "commitment is discoverable from the address alone");

  // ---- nothing is due yet -------------------------------------------------
  check((await read(iris, I, "releasable", [id])) === 0n, "nothing releasable before the interval elapses");

  // ---- a scheduler pushes the rest ---------------------------------------
  console.log("\n  Waiting for the schedule, then releasing\n");
  await new Promise((r) => setTimeout(r, (interval + 1) * 1000));
  const due = await read(iris, I, "releasable", [id]);
  line("releasable", usd(due));
  check(due > 0n, "a payment comes due on schedule");

  await send(iris, I, "release", [id]);
  c = await read(iris, I, "get", [id]);
  line("payments made", `${c.paymentsMade} of ${c.paymentsTotal}`);
  check(c.paymentsMade >= 2, "release paid without the recipient signing anything");

  // ---- gasless creation via ERC-3009 -------------------------------------
  console.log("\n  Creating a second commitment gaslessly, signed by a payer with no MON\n");
  const payer = privateKeyToAccount(generatePrivateKey());
  await send(ausd, A, "mint", [payer.address, perPayment]);
  check((await publicClient.getBalance({ address: payer.address })) === 0n, "payer holds 0 MON");

  const nonce = generatePrivateKey();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await payer.signTypedData({
    domain: { name: "Mock AUSD", version: "1", chainId: monadTestnet.id, verifyingContract: ausd },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: payer.address, to: iris, value: perPayment, validAfter: 0n, validBefore, nonce },
  });
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = parseInt(signature.slice(130, 132), 16);

  await send(iris, I, "createWithAuthorization", [
    payer.address, recipient.address, perPayment, interval, 1, true, 0n, validBefore, nonce, v, r, s,
  ]);
  const second = await read(iris, I, "get", [1n]);
  check(second.sender.toLowerCase() === payer.address.toLowerCase(), "the signer is the sender, not the relayer");
  check((await publicClient.getBalance({ address: payer.address })) === 0n, "payer never paid gas");

  // ---- cancellation keeps what is already owed ---------------------------
  console.log("\n  Cancelling the first commitment\n");
  const before = await read(ausd, A, "balanceOf", [sponsor.address]);
  await send(iris, I, "cancel", [id]);
  const after = await read(ausd, A, "balanceOf", [sponsor.address]);
  c = await read(iris, I, "get", [id]);
  line("refunded to sender", usd(after - before));
  check(c.cancelled === true, "commitment is cancelled");
  check(
    (await read(ausd, A, "balanceOf", [iris])) === 0n,
    "escrow is empty: everything went to the recipient or back to the sender"
  );

  console.log(
    failures === 0
      ? "\n  ✅ Lifecycle passes.\n"
      : `\n  ❌ ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n  ❌", e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
