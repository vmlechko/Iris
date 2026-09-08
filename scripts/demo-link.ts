/**
 * One claim link, ready to paste somewhere.
 *
 * Opening a commitment through the interface needs a passkey, which a script
 * cannot hold. This does the same thing with a throwaway key so there is
 * always a real link to look at — for checking the card a messenger draws, or
 * for a rehearsal before recording anything.
 *
 *     npx tsx scripts/demo-link.ts "Mum" "the flat in Lisbon"
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatUnits, parseAbi, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { IRIS, irisAbi, AUSD } from "../lib/iris";
import { authorizeCommitment } from "../lib/authorize";
import { buildClaimUrl, addressOfKey } from "../lib/link";

const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);

const AMOUNT = 200_000_000n; // $200
const INTERVAL = 30 * 24 * 60 * 60;
const PAYMENTS = 6;

async function main() {
  const note = { from: process.argv[2] ?? "Mum", about: process.argv[3] ?? "the flat in Lisbon" };
  const origin = process.env.IRIS_ORIGIN ?? "http://localhost:3000";

  const sponsor = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account: sponsor, chain: monadTestnet, transport: http(rpc) });

  // A sender who holds nothing but AUSD, exactly like one arriving by passkey.
  const sender = privateKeyToAccount(generatePrivateKey());
  const total = AMOUNT * BigInt(PAYMENTS);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: AUSD, abi: erc20, functionName: "transfer", args: [sender.address, total] }),
  });

  const linkKey = generatePrivateKey();
  const claimSigner = addressOfKey(linkKey);
  const { salt, validBefore, signature } = await authorizeCommitment(sender, {
    claimSigner, amountPerPayment: AMOUNT, interval: INTERVAL, paymentsTotal: PAYMENTS,
    startNow: true, note,
  });

  const hash = await wallet.writeContract({
    address: IRIS, abi: irisAbi, functionName: "createToClaimWithAuthorization",
    args: [sender.address, claimSigner, AMOUNT, INTERVAL, PAYMENTS, true, 0n, validBefore, salt, signature, note],
  });
  await pub.waitForTransactionReceipt({ hash });

  const id = ((await pub.readContract({ address: IRIS, abi: irisAbi, functionName: "count" })) as bigint) - 1n;

  console.log(`\nfrom      ${note.from}`);
  console.log(`about     ${note.about}`);
  console.log(`schedule  ${formatUnits(AMOUNT, 6)} × ${PAYMENTS}, monthly, first one already paid`);
  console.log(`\n${buildClaimUrl(origin, id, linkKey)}\n`);
}

main().catch((e) => { console.error(e?.shortMessage ?? e?.message ?? e); process.exit(1); });
