/**
 * Signing an ERC-3009 authorization for AUSD.
 *
 * The nonce is not free: the contract requires it to be a hash of the whole
 * schedule, so the signature covers who gets paid rather than only how much
 * leaves the payer. Without that binding an observer could lift the
 * authorization and open a commitment to themselves.
 */
import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, type Address, type Hex, type LocalAccount } from "viem";
import { publicClient, AUSD } from "./chain";
import { IRIS, irisAbi } from "./iris";
import { monadTestnet } from "viem/chains";

/** AUSD calls itself "Agora Dollar" in its EIP-712 domain, not "AUSD". */
export const DOMAIN = { name: "Agora Dollar", version: "1" } as const;

export const TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** What the sender says about the commitment. Both halves may be empty. */
export type Note = { from: string; about: string };

export type Schedule = {
  claimSigner: Address;
  amountPerPayment: bigint;
  interval: number;
  paymentsTotal: number;
  startNow: boolean;
  note: Note;
};

/**
 * Mirrors `IrisCommitments.noteHash`.
 *
 * Computed here rather than read from the contract: it is a pure function of
 * two strings, and a round trip to ask the chain what a hash is would be one
 * more thing to go wrong between the person typing and the signature.
 */
export const noteHash = (note: Note): Hex =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("bytes32 from, bytes32 about"), [
      keccak256(toBytes(note.from)),
      keccak256(toBytes(note.about)),
    ])
  );

export async function authorizeCommitment(account: LocalAccount, schedule: Schedule) {
  const salt = (`0x${crypto.getRandomValues(new Uint8Array(32)).reduce(
    (s, b) => s + b.toString(16).padStart(2, "0"), "")}`) as Hex;

  const nonce = (await publicClient.readContract({
    address: IRIS,
    abi: irisAbi,
    functionName: "authorizationNonce",
    args: [salt, schedule.claimSigner, schedule.amountPerPayment,
           schedule.interval, schedule.paymentsTotal, schedule.startNow,
           noteHash(schedule.note)],
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
