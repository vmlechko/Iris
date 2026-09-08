/**
 * Deploy the CRE report receiver.
 *
 * The forwarder address is the one thing this contract cannot be given later:
 * it is immutable, and it is the whole of the access control — only that
 * address may deliver a report. It comes from `cre workflow supported-chains`,
 * which is tenant-scoped, so it is read at deploy time rather than hardcoded.
 *
 *     npx tsx scripts/deploy-scheduler.ts [forwarder]
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import { IRIS } from "../lib/iris";

/** monad-testnet, selector 2183018362218727504, as of 8 September 2026. */
const FORWARDER = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482" as Address;

const artifacts = JSON.parse(readFileSync("artifacts/contracts.json", "utf8"));
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];

async function main() {
  const forwarder = getAddress(process.argv[2] ?? FORWARDER);
  const iris = getAddress(IRIS);

  const account = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  console.log(`iris       ${iris}`);
  console.log(`forwarder  ${forwarder}`);

  const hash = await wallet.deployContract({
    abi: artifacts.IrisScheduler.abi,
    bytecode: artifacts.IrisScheduler.bytecode,
    args: [iris, forwarder],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress!;

  // Both are immutable and both are load-bearing: the wrong forwarder means
  // either nobody can deliver a report or the wrong party can.
  const [onChainIris, onChainForwarder] = await Promise.all([
    pub.readContract({ address, abi: artifacts.IrisScheduler.abi, functionName: "iris" }),
    pub.readContract({ address, abi: artifacts.IrisScheduler.abi, functionName: "forwarder" }),
  ]);

  if (getAddress(onChainIris as Address) !== iris) throw new Error("iris address did not stick");
  if (getAddress(onChainForwarder as Address) !== forwarder) throw new Error("forwarder did not stick");

  console.log(`\nIrisScheduler  ${address}`);
  console.log(`explorer       ${monadTestnet.blockExplorers.default.url}/address/${address}`);
  console.log(`gas used       ${receipt.gasUsed}`);
  console.log(`\nboth immutables read back correctly`);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
