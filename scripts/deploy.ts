/** Deploy IrisCommitments against the real AUSD and print the address. */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Address;
const artifacts = JSON.parse(readFileSync("artifacts/contracts.json", "utf8"));
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];

async function main() {
  const account = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  const hash = await wallet.deployContract({
    abi: artifacts.IrisCommitments.abi,
    bytecode: artifacts.IrisCommitments.bytecode,
    args: [AUSD],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("IrisCommitments:", receipt.contractAddress);
  console.log("explorer:", `${monadTestnet.blockExplorers.default.url}/address/${receipt.contractAddress}`);

}

main().catch((e) => { console.error(e?.shortMessage ?? e?.message ?? e); process.exit(1); });
