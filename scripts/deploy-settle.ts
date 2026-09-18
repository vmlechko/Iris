/**
 * Deploy IrisSettle and give it the pair's APPROVED_SWAPPER role.
 *
 * On Monad testnet Agora's whitelister grants the role to any address, which
 * is what its stable-swap-examples repository (branch `monad`) does for itself.
 * Without the role every swap reverts, so the script refuses to finish until
 * the role reads back.
 *
 *     npx tsx scripts/deploy-settle.ts
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import { AUSD } from "../lib/chain";

/** From Agora's Protocol Deployments page, Monad testnet. */
export const PAIR = "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae" as Address;
export const CTK = "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D" as Address;
export const WHITELISTER = "0x7c10F56d6f04a51376393a1C3670e966863F6BD5" as Address;

const artifacts = JSON.parse(readFileSync("artifacts/contracts.json", "utf8"));
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];

async function main() {
  const account = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  const hash = await wallet.deployContract({
    abi: artifacts.IrisSettle.abi,
    bytecode: artifacts.IrisSettle.bytecode,
    args: [AUSD, PAIR, CTK],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress!;
  console.log(`IrisSettle   ${address}  (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);

  const grant = await wallet.writeContract({
    address: WHITELISTER,
    abi: parseAbi(["function setApprovedSwapper(address)"]),
    functionName: "setApprovedSwapper",
    args: [address],
  });
  await pub.waitForTransactionReceipt({ hash: grant });

  const approved = await pub.readContract({
    address: PAIR,
    abi: parseAbi(["function hasRole(string,address) view returns (bool)"]),
    functionName: "hasRole",
    args: ["APPROVED_SWAPPER", address],
  });
  if (!approved) throw new Error("the role did not stick");
  console.log(`APPROVED_SWAPPER granted  (tx ${grant})`);

  const quote = await pub.readContract({
    address, abi: artifacts.IrisSettle.abi, functionName: "quote", args: [200_000000n],
  });
  console.log(`quote: 200 AUSD -> ${quote} CTK units`);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
