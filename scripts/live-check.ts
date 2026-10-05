/**
 * The whole product against a live deployment: a sender signs, a recipient
 * claims, and the payment settles through Agora — every transaction put on
 * chain by the deployment's own relayer, not by anything local.
 *
 *     npx tsx scripts/live-check.ts https://iris-eta-kohl.vercel.app
 */
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { authorizeCommitment } from "../lib/authorize";
import { authorizeSettlement, settledOf } from "../lib/settle";
import { AUSD } from "../lib/chain";
import { IRIS } from "../lib/iris";

const BASE = process.argv[2] ?? "https://iris-eta-kohl.vercel.app";
const pub = createPublicClient({ chain: monadTestnet, transport: http() });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

let passed = 0, failed = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "✓" : "✗"} ${what}`); ok ? passed++ : failed++; };

async function relay(body: Record<string, unknown>) {
  const response = await fetch(`${BASE}/api/relay`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as { hash: string };
}

async function main() {
  console.log(`against ${BASE}\n`);
  const sender = privateKeyToAccount(generatePrivateKey());
  const linkKey = generatePrivateKey();
  const claimSigner = privateKeyToAccount(linkKey).address;
  const recipient = privateKeyToAccount(generatePrivateKey());

  const schedule = {
    claimSigner, amountPerPayment: 200_000000n, interval: 2_592_000, paymentsTotal: 6,
    startNow: true, note: { from: "Mum", about: "the flat in Lisbon" },
  };
  const { salt, validBefore, signature } = await authorizeCommitment(sender, schedule);

  const created = await relay({
    action: "create", from: sender.address, claimSigner, amountPerPayment: "200000000",
    interval: "2592000", paymentsTotal: "6", startNow: true, validBefore: String(validBefore),
    salt, signature, note: schedule.note,
  });
  check(!!created.hash, `the sender held nothing and signed; the deployment created the commitment (${created.hash})`);

  const id = (await pub.readContract({ address: IRIS, abi: parseAbi(["function count() view returns (uint256)"]), functionName: "count" })) as bigint - 1n;
  const claimSig = await privateKeyToAccount(linkKey).signTypedData({
    domain: { name: "Iris", version: "1", chainId: monadTestnet.id, verifyingContract: IRIS },
    types: { Claim: [{ name: "id", type: "uint256" }, { name: "recipient", type: "address" }] },
    primaryType: "Claim", message: { id, recipient: recipient.address },
  });
  await relay({ action: "claim", id: String(id), recipient: recipient.address, signature: claimSig });
  const arrived = (await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [recipient.address] })) as bigint;
  check(arrived === 200_000000n, `the recipient opened the link and $200 arrived (${arrived} units)`);
  check((await pub.getBalance({ address: recipient.address })) === 0n, "and they still hold no MON");

  const authorization = await authorizeSettlement(recipient, arrived);
  const settled = await relay({ action: "settle", ...authorization });
  check(!!settled.hash, `settled through Agora Instant Settlement (${settled.hash})`);
  check((await settledOf(recipient.address)) === arrived, "the recipient holds the swapped token, one for one");

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error("✗", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
