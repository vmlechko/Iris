/**
 * Spike: can a ZERO-BALANCE EOA execute a sponsored call on Monad testnet?
 *
 * This is the blocking question for the Iris recipient flow. Monad restricts
 * delegated EOAs from dropping below a 10 MON reserve; our recipient will hold
 * exactly 0 MON and never touch gas. If this passes, EIP-7702 + a sponsor is
 * our account architecture. If it fails, we fall back to a meta-transaction
 * relayer and the escrow verifies an EIP-712 signature instead.
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const artifacts = JSON.parse(readFileSync("artifacts/spike.json", "utf8"));

const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpc) });

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

async function main() {
  console.log("\n── Iris · EIP-7702 sponsored-gas spike ──\n");
  line("chain", `${monadTestnet.name} (${monadTestnet.id})`);
  line("rpc", rpc);

  // ---- sponsor -----------------------------------------------------------
  let sponsorPk = process.env.SPONSOR_PK as `0x${string}` | undefined;
  if (!sponsorPk) {
    sponsorPk = generatePrivateKey();
    appendFileSync(".env", `\nSPONSOR_PK=${sponsorPk}\n`);
    console.log("\n  Generated a sponsor key and wrote it to .env");
  }
  const sponsor = privateKeyToAccount(sponsorPk);
  const sponsorWallet = createWalletClient({ account: sponsor, chain: monadTestnet, transport: http(rpc) });

  const sponsorBalance = await publicClient.getBalance({ address: sponsor.address });
  line("sponsor", sponsor.address);
  line("sponsor balance", `${formatEther(sponsorBalance)} MON`);

  if (sponsorBalance === 0n) {
    console.log(
      `\n  ⛔ Sponsor has no MON.\n     Fund it at https://faucet.monad.xyz  →  ${sponsor.address}\n     Then re-run this script.\n`
    );
    process.exit(1);
  }

  // ---- recipient: fresh account, guaranteed zero balance ------------------
  const recipient = privateKeyToAccount(generatePrivateKey());
  const recipientWallet = createWalletClient({ account: recipient, chain: monadTestnet, transport: http(rpc) });
  const recipientBefore = await publicClient.getBalance({ address: recipient.address });
  line("recipient (fresh)", recipient.address);
  line("recipient balance", `${formatEther(recipientBefore)} MON`);

  if (recipientBefore !== 0n) throw new Error("recipient should be empty");

  // ---- deploy delegate + probe (sponsor pays) ----------------------------
  console.log("\n  Deploying spike contracts…");
  const deploy = async (name: "SpikeDelegate" | "Probe") => {
    const hash = await sponsorWallet.deployContract({
      abi: artifacts[name].abi,
      bytecode: artifacts[name].bytecode,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`${name} deploy failed`);
    line(name, receipt.contractAddress);
    return receipt.contractAddress;
  };
  const delegateAddress = await deploy("SpikeDelegate");
  const probeAddress = await deploy("Probe");

  // ---- recipient signs the 7702 authorization (costs nothing) ------------
  console.log("\n  Recipient signs EIP-7702 authorization (offline, no gas)…");
  const authorization = await recipientWallet.signAuthorization({
    account: recipient,
    contractAddress: delegateAddress,
  });
  line("auth nonce", authorization.nonce);

  // ---- sponsor submits the type-4 transaction ---------------------------
  console.log("\n  Sponsor submits type-4 transaction…");
  const probeAbi = parseAbi(["function ping()", "function count(address) view returns (uint256)"]);

  const hash = await sponsorWallet.sendTransaction({
    authorizationList: [authorization],
    to: recipient.address,
    data: encodeFunctionData({
      abi: artifacts.SpikeDelegate.abi,
      functionName: "execute",
      args: [probeAddress, encodeFunctionData({ abi: probeAbi, functionName: "ping" })],
    }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  line("tx", hash);
  line("status", receipt.status);
  line("gas used", receipt.gasUsed);

  // ---- verdict -----------------------------------------------------------
  const seen = await publicClient.readContract({
    address: probeAddress,
    abi: probeAbi,
    functionName: "count",
    args: [recipient.address],
  });
  const recipientAfter = await publicClient.getBalance({ address: recipient.address });
  const code = await publicClient.getCode({ address: recipient.address });

  console.log("\n── Result ──\n");
  line("probe saw recipient", `${seen} time(s)`);
  line("recipient balance after", `${formatEther(recipientAfter)} MON`);
  line("recipient has code", code && code !== "0x" ? `yes (${code.slice(0, 12)}…)` : "no");

  const passed = receipt.status === "success" && seen === 1n && recipientAfter === 0n;
  console.log(
    passed
      ? "\n  ✅ PASS — a zero-balance EOA executed a sponsored call.\n     The 10 MON reserve does not block us. EIP-7702 is the architecture.\n"
      : "\n  ❌ FAIL — see values above. Fall back to the meta-transaction relayer.\n"
  );
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error("\n  ❌ Spike threw:\n");
  console.error(e?.shortMessage ?? e?.message ?? e);
  if (e?.details) console.error("  details:", e.details);
  process.exit(1);
});
