/**
 * Put a commitment on chain that is due right now.
 *
 * The CRE workflow can only be shown doing its job if there is something for it
 * to do. This opens a small schedule with `startNow`, so the first payment is
 * releasable the moment it exists, and prints what `dueBatch` then reports —
 * which is exactly the call the workflow makes on its cron tick.
 *
 *     npx tsx scripts/seed-due.ts [recipient]
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, getAddress, parseAbi, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { IRIS, AUSD, AUSD_DECIMALS } from "../lib/iris";
import { irisAbi } from "../lib/iris-abi";

const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

/** Derived from the passkey in the stateless test. Holds no native MON, deliberately. */
const PASSKEY_ACCOUNT = "0xdc0CAcA6C26b31B0eB8584464e149Bda32892856" as Address;

const AMOUNT = 1_000_000n; // 1 AUSD per payment, 6 decimals
const INTERVAL = 60; // a minute, so the next payment comes due while we watch
const PAYMENTS = 3;

async function main() {
  const account = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  // The contract refuses a commitment to yourself, and the workflow ignores
  // one with no recipient, so this pays the passkey account from the stateless
  // test — an address that can actually be signed into to see the money land.
  const recipient = getAddress(process.argv[2] ?? PASSKEY_ACCOUNT);
  const total = AMOUNT * BigInt(PAYMENTS);

  const allowance = await pub.readContract({
    address: AUSD, abi: erc20, functionName: "allowance", args: [account.address, IRIS],
  });
  if (allowance < total) {
    const hash = await wallet.writeContract({
      address: AUSD, abi: erc20, functionName: "approve", args: [IRIS, total],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`approved ${formatUnits(total, AUSD_DECIMALS)} AUSD`);
  }

  const hash = await wallet.writeContract({
    address: IRIS, abi: irisAbi, functionName: "create",
    args: [recipient, AMOUNT, INTERVAL, PAYMENTS, true],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log(`created in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

  const [ids, examined] = await pub.readContract({
    address: IRIS, abi: irisAbi, functionName: "dueBatch", args: [0n, 200n],
  }) as [readonly bigint[], bigint];

  console.log(`\nrecipient  ${recipient}`);
  console.log(`schedule   ${formatUnits(AMOUNT, AUSD_DECIMALS)} AUSD × ${PAYMENTS}, every ${INTERVAL}s`);
  console.log(`dueBatch   examined ${examined}, due ${ids.length}: [${ids.join(", ")}]`);
}

main().catch((e) => {
  console.error(e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
