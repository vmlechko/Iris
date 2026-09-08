/**
 * Can a sender who holds nothing cancel their own commitment?
 *
 * Cancelling is the one thing in Iris only the sender may do — the contract
 * checks `msg.sender`, so the relayer cannot stand in for them. But our sender
 * arrives through a passkey and holds exactly zero MON, so they cannot pay for
 * the transaction either. IrisDelegate is the way out: the sender signs the
 * exact call, a sponsor submits it under EIP-7702, and it runs as the sender.
 *
 * This walks the whole path with a fresh account, and then tries to abuse it.
 *
 *     npx tsx scripts/cancel-gasless.ts
 */
import "dotenv/config";
import {
  createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData,
  formatEther, formatUnits, http, keccak256, parseAbi, parseAbiParameters,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import { IRIS, irisAbi, AUSD } from "../lib/iris";
import { authorizeCommitment } from "../lib/authorize";
import { DELEGATE } from "../lib/delegate";

const artifacts = JSON.parse(readFileSync("artifacts/contracts.json", "utf8"));
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

const erc20 = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

let checks = 0;
let failures = 0;
function check(what: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
}

/**
 * What the sender signs. Mirrors IrisDelegate.digest: the account, the chain,
 * the target and the calldata are all inside, so the signature cannot be moved
 * anywhere else. signMessage adds the EIP-191 prefix the contract expects.
 */
const innerDigest = (account: Address, to: Address, data: Hex, nonce: bigint) =>
  keccak256(
    encodeAbiParameters(
      parseAbiParameters("address account, uint256 chainId, address to, bytes32 dataHash, uint256 nonce"),
      [account, BigInt(monadTestnet.id), to, keccak256(data), nonce]
    )
  );

async function main() {
  const sponsor = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const sponsorWallet = createWalletClient({ account: sponsor, chain: monadTestnet, transport: http(rpc) });

  // A sender who has never held anything.
  const sender = privateKeyToAccount(generatePrivateKey());
  const senderWallet = createWalletClient({ account: sender, chain: monadTestnet, transport: http(rpc) });
  console.log(`\nsender   ${sender.address}`);
  console.log(`sponsor  ${sponsor.address}\n`);

  check("sender starts with no MON", (await pub.getBalance({ address: sender.address })) === 0n);

  // Tests the delegate the app actually points at. Pass --deploy to try a new
  // one, which is what produced the address in lib/delegate.ts.
  const delegate = await (async (): Promise<Address> => {
    if (!process.argv.includes("--deploy")) return DELEGATE;
    const hash = await sponsorWallet.deployContract({
      abi: artifacts.IrisDelegate.abi,
      bytecode: artifacts.IrisDelegate.bytecode,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  })();
  console.log(`delegate ${delegate}\n`);

  // Fund the sender in AUSD only. Receiving an ERC-20 costs the holder nothing.
  const amountPerPayment = 1_000_000n;
  const paymentsTotal = 3;
  const total = amountPerPayment * BigInt(paymentsTotal);
  const funding = await sponsorWallet.writeContract({
    address: AUSD, abi: erc20, functionName: "transfer", args: [sender.address, total],
  });
  await pub.waitForTransactionReceipt({ hash: funding });

  // The commitment is opened exactly as the app opens one: the sender signs,
  // the sponsor submits, no gas on the sender's side.
  const claimSigner = privateKeyToAccount(generatePrivateKey()).address;
  const note = { from: "A test", about: "proving a cancellation" };
  const schedule = { claimSigner, amountPerPayment, interval: 3600, paymentsTotal, startNow: false, note };
  const { salt, validBefore, signature } = await authorizeCommitment(sender, schedule);

  const createHash = await sponsorWallet.writeContract({
    address: IRIS, abi: irisAbi, functionName: "createToClaimWithAuthorization",
    args: [sender.address, claimSigner, amountPerPayment, 3600, paymentsTotal, false,
           0n, validBefore, salt, signature, note],
  });
  await pub.waitForTransactionReceipt({ hash: createHash });

  const count = (await pub.readContract({ address: IRIS, abi: irisAbi, functionName: "count" })) as bigint;
  const id = count - 1n;
  console.log(`commitment #${id} opened, ${formatUnits(total, 6)} AUSD escrowed\n`);

  const beforeCancel = (await pub.readContract({
    address: AUSD, abi: erc20, functionName: "balanceOf", args: [sender.address],
  })) as bigint;
  check("escrow took the whole schedule", beforeCancel === 0n, `sender holds ${formatUnits(beforeCancel, 6)}`);

  // ---- the part being proved -------------------------------------------
  const cancelData = encodeFunctionData({ abi: irisAbi, functionName: "cancel", args: [id] });
  const inner = innerDigest(sender.address, IRIS, cancelData, 0n);
  const senderSignature = await sender.signMessage({ message: { raw: inner } });

  const authorization = await senderWallet.signAuthorization({ account: sender, contractAddress: delegate });

  const executeData = encodeFunctionData({
    abi: artifacts.IrisDelegate.abi,
    functionName: "execute",
    args: [IRIS, cancelData, 0n, senderSignature],
  });

  const cancelHash = await sponsorWallet.sendTransaction({
    authorizationList: [authorization],
    to: sender.address,
    data: executeData,
  });
  const cancelReceipt = await pub.waitForTransactionReceipt({ hash: cancelHash });
  console.log(`cancel tx ${cancelHash}\n`);

  check("the sponsored cancellation succeeded", cancelReceipt.status === "success");

  const c = (await pub.readContract({ address: IRIS, abi: irisAbi, functionName: "get", args: [id] })) as {
    cancelled: boolean; sender: Address;
  };
  check("the commitment is cancelled", c.cancelled);
  check("and it was cancelled by its sender", c.sender.toLowerCase() === sender.address.toLowerCase());

  const refunded = (await pub.readContract({
    address: AUSD, abi: erc20, functionName: "balanceOf", args: [sender.address],
  })) as bigint;
  check("the whole escrow came back", refunded === total, `${formatUnits(refunded, 6)} AUSD`);

  const senderMon = await pub.getBalance({ address: sender.address });
  check("the sender still holds no MON", senderMon === 0n, formatEther(senderMon));

  const nonceAfter = (await pub.readContract({
    address: sender.address, abi: artifacts.IrisDelegate.abi, functionName: "nonce",
  })) as bigint;
  check("the nonce moved on", nonceAfter === 1n, String(nonceAfter));

  // ---- and now the abuse -----------------------------------------------
  console.log("\nWhat a sponsor holding the signature cannot do");

  const replay = await sponsorWallet
    .sendTransaction({ to: sender.address, data: executeData })
    .then(() => null)
    .catch((e) => e as Error);
  check("replay the same signature", replay !== null, replay ? "rejected" : "IT WENT THROUGH");

  // Same account, same nonce, a different call entirely.
  const stealData = encodeFunctionData({
    abi: erc20, functionName: "transfer", args: [sponsor.address, total],
  });
  const stealExecute = encodeFunctionData({
    abi: artifacts.IrisDelegate.abi,
    functionName: "execute",
    args: [AUSD, stealData, 1n, senderSignature],
  });
  const theft = await sponsorWallet
    .sendTransaction({ to: sender.address, data: stealExecute })
    .then(() => null)
    .catch((e) => e as Error);
  check("point that signature at a transfer of the refund", theft !== null, theft ? "rejected" : "IT WENT THROUGH");

  const stillThere = (await pub.readContract({
    address: AUSD, abi: erc20, functionName: "balanceOf", args: [sender.address],
  })) as bigint;
  check("the refund is still the sender's", stillThere === total, `${formatUnits(stillThere, 6)} AUSD`);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  console.log(`\ndelegate: ${delegate}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
