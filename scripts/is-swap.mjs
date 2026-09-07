/**
 * Can Iris settle through Agora's Instant Settlement on Monad testnet?
 *
 * The bounty asks for instant settlement, and Agora ships a product by that
 * name. Their docs list it on Sepolia and Fuji only, but the factory and the
 * AUSD/CTK pair are both deployed on Monad testnet — undocumented, the same way
 * their faucet was.
 *
 * The published example gates swapping behind an APPROVED_SWAPPER role, so the
 * question is whether that gate is closed to us or whether the earlier revert
 * was only a missing allowance.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, getAddress, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const PAIR = getAddress("0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae");
const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
const CTK = getAddress("0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D");

const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const swap = parseAbi([
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
]);

async function main() {
  const account = privateKeyToAccount(process.env.SPONSOR_PK);
  const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  const amountIn = 1_000_000n; // 1 AUSD
  const ctkDecimals = await pub.readContract({ address: CTK, abi: erc20, functionName: "decimals" });

  const before = {
    ausd: await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    ctk: await pub.readContract({ address: CTK, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  };
  console.log("before:", formatUnits(before.ausd, 6), "AUSD /", formatUnits(before.ctk, ctkDecimals), "CTK");

  const [, amountOutMin] = await pub.readContract({
    address: PAIR, abi: swap, functionName: "getAmountsOut", args: [amountIn, [AUSD, CTK]],
  });
  console.log("quote:  1 AUSD →", formatUnits(amountOutMin, ctkDecimals), "CTK");

  console.log("approving…");
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: AUSD, abi: erc20, functionName: "approve", args: [PAIR, amountIn] }),
  });

  console.log("swapping…");
  const hash = await wallet.writeContract({
    address: PAIR, abi: swap, functionName: "swapExactTokensForTokens",
    args: [amountIn, amountOutMin, [AUSD, CTK], account.address, BigInt(Math.floor(Date.now() / 1000) + 300)],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });

  const after = {
    ausd: await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [account.address] }),
    ctk: await pub.readContract({ address: CTK, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  };
  console.log("tx:    ", hash, receipt.status);
  console.log("after: ", formatUnits(after.ausd, 6), "AUSD /", formatUnits(after.ctk, ctkDecimals), "CTK");
  console.log(
    after.ctk > before.ctk
      ? "\n  ✅ Instant Settlement works on Monad testnet, no whitelist needed.\n"
      : "\n  ❌ nothing moved.\n"
  );
}

main().catch((e) => { console.error("\n  ❌", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
