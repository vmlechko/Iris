/**
 * The cancellation path as the browser actually walks it.
 *
 * scripts/cancel-gasless.ts proves the mechanism against the chain directly.
 * This proves the part between the interface and the chain: that the relayer
 * accepts a well-formed cancellation, refuses one from somebody else, and
 * builds the calldata itself rather than running whatever it is handed.
 *
 * Needs the dev server up.
 *
 *     npx tsx scripts/cancel-relay.ts [http://localhost:3000]
 */
import "dotenv/config";
import {
  createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData,
  http, keccak256, parseAbi, parseAbiParameters, type Address, type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { IRIS, irisAbi, AUSD } from "../lib/iris";
import { authorizeCommitment } from "../lib/authorize";
import { DELEGATE } from "../lib/delegate";

const base = process.argv[2] ?? "http://localhost:3000";
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

let checks = 0, failures = 0;
function check(what: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
}

/** Timed, because the interface promises the person a number of seconds. */
const timings: { what: string; ms: number }[] = [];

const post = async (body: unknown, label?: string) => {
  const started = Date.now();
  const response = await fetch(`${base}/api/relay`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const result = { status: response.status, body: await response.json() };
  if (label && result.status === 200) timings.push({ what: label, ms: Date.now() - started });
  return result;
};

const inner = (account: Address, to: Address, data: Hex, nonce: bigint) =>
  keccak256(encodeAbiParameters(
    parseAbiParameters("address account, uint256 chainId, address to, bytes32 dataHash, uint256 nonce"),
    [account, BigInt(monadTestnet.id), to, keccak256(data), nonce]
  ));

async function main() {
  const sponsor = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const sponsorWallet = createWalletClient({ account: sponsor, chain: monadTestnet, transport: http(rpc) });

  const sender = privateKeyToAccount(generatePrivateKey());
  const senderWallet = createWalletClient({ account: sender, chain: monadTestnet, transport: http(rpc) });
  console.log(`\nrelayer at ${base}`);
  console.log(`sender     ${sender.address}\n`);

  const amount = 1_000_000n;
  const payments = 3;
  const total = amount * BigInt(payments);
  await pub.waitForTransactionReceipt({
    hash: await sponsorWallet.writeContract({ address: AUSD, abi: erc20, functionName: "transfer", args: [sender.address, total] }),
  });

  const claimSigner = privateKeyToAccount(generatePrivateKey()).address;
  const note = { from: "A test", about: "proving the relayed path" };
  const { salt, validBefore, signature: authSignature } = await authorizeCommitment(sender, {
    claimSigner, amountPerPayment: amount, interval: 3600, paymentsTotal: payments, startNow: false, note,
  });

  // The note is the field a recipient acts on — "from Mum" is why they trust
  // the link at all. It is bound into the ERC-3009 nonce, so a relayer holding
  // the signature cannot keep the schedule and rewrite who it is from.
  const forged = await post({
    action: "create", from: sender.address, claimSigner,
    amountPerPayment: amount.toString(), interval: "3600", paymentsTotal: String(payments),
    startNow: false, validBefore: validBefore.toString(), salt, signature: authSignature,
    note: { from: "Someone else", about: note.about },
  });
  check("a rewritten note is refused", forged.status === 400, forged.body?.error ?? "IT WENT THROUGH");

  const created = await post({
    action: "create", from: sender.address, claimSigner,
    amountPerPayment: amount.toString(), interval: "3600", paymentsTotal: String(payments),
    startNow: false, validBefore: validBefore.toString(), salt, signature: authSignature, note,
  }, "opening a commitment");
  check("the relayer opened the commitment", created.status === 200, JSON.stringify(created.body).slice(0, 120));
  if (created.status !== 200) process.exit(1);

  const id = ((await pub.readContract({ address: IRIS, abi: irisAbi, functionName: "count" })) as bigint) - 1n;
  console.log(`commitment #${id}\n`);

  const data = encodeFunctionData({ abi: irisAbi, functionName: "cancel", args: [id] });
  const senderSignature = await sender.signMessage({ message: { raw: inner(sender.address, IRIS, data, 0n) } });
  const authorization = await senderWallet.signAuthorization({ account: sender, contractAddress: DELEGATE });
  const auth = { chainId: authorization.chainId, nonce: authorization.nonce,
                 r: authorization.r, s: authorization.s, yParity: authorization.yParity };

  // Someone else's address on an otherwise valid cancellation.
  const impostor = await post({
    action: "cancel", from: sponsor.address, id: id.toString(), nonce: "0",
    signature: senderSignature, authorization: auth,
  });
  check("a cancellation claimed by the wrong address is refused", impostor.status === 400,
    impostor.body?.error ?? "");

  const stopped = await post({
    action: "cancel", from: sender.address, id: id.toString(), nonce: "0",
    signature: senderSignature, authorization: auth,
  }, "stopping one");
  check("the sender's cancellation goes through", stopped.status === 200,
    stopped.body?.error ?? stopped.body?.hash ?? "");

  const c = (await pub.readContract({ address: IRIS, abi: irisAbi, functionName: "get", args: [id] })) as { cancelled: boolean };
  check("the commitment is stopped on chain", c.cancelled);

  const refunded = (await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [sender.address] })) as bigint;
  check("the escrow came back to the sender", refunded === total);

  const mon = await pub.getBalance({ address: sender.address });
  check("the sender never held gas", mon === 0n);

  const again = await post({
    action: "cancel", from: sender.address, id: id.toString(), nonce: "0",
    signature: senderSignature, authorization: auth,
  });
  check("cancelling twice is refused", again.status === 400, again.body?.error ?? "");

  console.log("\nHow long the person actually waits");
  for (const t of timings) console.log(`  ${t.what.padEnd(24)} ${(t.ms / 1000).toFixed(1)}s`);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e?.shortMessage ?? e?.message ?? e); process.exit(1); });
