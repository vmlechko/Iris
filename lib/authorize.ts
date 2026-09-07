/**
 * Signing an ERC-3009 authorization for AUSD.
 *
 * The nonce is not free: the contract requires it to be a hash of the whole
 * schedule, so the signature covers who gets paid rather than only how much
 * leaves the payer. Without that binding an observer could lift the
 * authorization and open a commitment to themselves.
 */
import type { Address, Hex, LocalAccount } from "viem";
import { publicClient, AUSD } from "./chain";
import { IRIS, irisAbi } from "./iris";
import { monadTestnet } from "viem/chains";

/** AUSD calls itself "Agora Dollar" in its EIP-712 domain, not "AUSD". */
const DOMAIN = { name: "Agora Dollar", version: "1" } as const;

const TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type Schedule = {
  claimSigner: Address;
  amountPerPayment: bigint;
  interval: number;
  paymentsTotal: number;
  startNow: boolean;
};

export async function authorizeCommitment(account: LocalAccount, schedule: Schedule) {
  const salt = (`0x${crypto.getRandomValues(new Uint8Array(32)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"), "")}`) as Hex;

  const nonce = (await publicClient.readContract({
    address: IRIS,
    abi: irisAbi,
    functionName: "authorizationNonce",
    args: [salt, schedule.claimSigner, schedule.amountPerPayment,
           schedule.interval, schedule.paymentsTotal, schedule.startNow],
  })) as Hex;

  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const value = schedule.amountPerPayment * BigInt(schedule.paymentsTotal);

  const signature = await account.signTypedData({
    domain: { ...DOMAIN, chainId: monadTestnet.id, verifyingContract: AUSD },
    types: TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: IRIS, value, validAfter: 0n, validBefore, nonce },
  });

  return { salt, validBefore, signature, value };
}
