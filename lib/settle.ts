/**
 * Agora Instant Settlement, from the recipient's side.
 *
 * A payment arrives in AUSD. The person receiving it can have it settled on
 * the spot into another stablecoin at Agora's fixed price, without holding gas:
 * they sign one ERC-3009 authorization, the relayer submits it to IrisSettle,
 * and IrisSettle swaps through Agora's pair and hands the output straight back.
 *
 * On Monad testnet the only pair is AUSD/CTK — CTK being Agora's test token,
 * one for one. On mainnet the same pair contract is AUSD/USDC, so CTK is named
 * on screen as what it is: a test stand-in, not a currency.
 */
import type { Address, Hex, LocalAccount } from "viem";
import { monadTestnet } from "viem/chains";
import { publicClient, AUSD } from "./chain";
import { DOMAIN, TYPES } from "./authorize";

export const SETTLE: Address =
  (process.env.NEXT_PUBLIC_IRIS_SETTLE as Address) ?? "0x2583ced441aa350855426a329c8aad2bf28320a3";

/** Agora's test token on the testnet pair — 18 decimals, priced 1:1 with AUSD. */
export const CTK: Address = "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D";

export const settleAbi = [
  { type: "function", name: "quote", stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "settlementNonce", stateMutability: "view",
    inputs: [{ name: "salt", type: "bytes32" }, { name: "amountOutMin", type: "uint256" }],
    outputs: [{ type: "bytes32" }] },
  { type: "function", name: "settle", stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" },
      { name: "salt", type: "bytes32" }, { name: "amountOutMin", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;

/** Sign the settlement of `value` AUSD at today's quote. */
export async function authorizeSettlement(account: LocalAccount, value: bigint) {
  const salt = (`0x${crypto.getRandomValues(new Uint8Array(32)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"), "")}`) as Hex;
  // The quote is the floor. The price is fixed, so this is what arrives; if
  // Agora ever set a fee between signing and settling, the swap would revert
  // rather than deliver less than the person agreed to.
  const amountOutMin = await publicClient.readContract({
    address: SETTLE, abi: settleAbi, functionName: "quote", args: [value],
  });
  const nonce = await publicClient.readContract({
    address: SETTLE, abi: settleAbi, functionName: "settlementNonce", args: [salt, amountOutMin],
  });
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await account.signTypedData({
    domain: { ...DOMAIN, chainId: monadTestnet.id, verifyingContract: AUSD },
    types: TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: SETTLE, value, validAfter: 0n, validBefore, nonce },
  });
  return {
    from: account.address,
    value: String(value),
    validBefore: String(validBefore),
    salt,
    amountOutMin: String(amountOutMin),
    signature,
  };
}

/** CTK held, in whole units at AUSD's six decimals so `money` can print it. */
export async function settledOf(who: Address): Promise<bigint> {
  const raw = await publicClient.readContract({
    address: CTK,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view",
            inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
    functionName: "balanceOf",
    args: [who],
  });
  return raw / 10n ** 12n;
}
