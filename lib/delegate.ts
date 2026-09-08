/**
 * Cancelling without gas.
 *
 * Only the sender may cancel — the contract checks `msg.sender` — and our
 * sender holds nothing. So the sender signs the exact call and a sponsor
 * submits it under EIP-7702, where it runs as the sender's own account.
 *
 * The signature covers the account, the chain, the target and the calldata, so
 * the sponsor decides only whether to pay. It cannot change what runs.
 */
import {
  encodeAbiParameters, encodeFunctionData, keccak256, parseAbiParameters,
  type Address, type Hex, type LocalAccount,
} from "viem";
import { chain, publicClient } from "./chain";
import { IRIS, irisAbi } from "./iris";
import { relay } from "./relay";

export const DELEGATE: Address =
  (process.env.NEXT_PUBLIC_IRIS_DELEGATE as Address) ??
  "0xc018dffd9d15e8b63be2252ebb28fb5e2367674c";

const delegateAbi = [
  { type: "function", name: "nonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

/** Mirrors IrisDelegate.digest, before the EIP-191 prefix signMessage adds. */
const inner = (account: Address, to: Address, data: Hex, nonce: bigint) =>
  keccak256(
    encodeAbiParameters(
      parseAbiParameters("address account, uint256 chainId, address to, bytes32 dataHash, uint256 nonce"),
      [account, BigInt(chain.id), to, keccak256(data), nonce]
    )
  );

/** Zero until the account has executed something; the storage is the account's own. */
async function delegateNonce(account: Address): Promise<bigint> {
  try {
    return (await publicClient.readContract({
      address: account, abi: delegateAbi, functionName: "nonce",
    })) as bigint;
  } catch {
    return 0n;
  }
}

export async function cancelCommitment(account: LocalAccount, id: bigint) {
  const data = encodeFunctionData({ abi: irisAbi, functionName: "cancel", args: [id] });
  const nonce = await delegateNonce(account.address);
  const signature = await account.signMessage({ message: { raw: inner(account.address, IRIS, data, nonce) } });

  // The authorization's nonce is the account's transaction count, not the
  // delegate's — a different counter that happens to share the word.
  const txNonce = await publicClient.getTransactionCount({ address: account.address });
  const authorization = await account.signAuthorization!({
    address: DELEGATE,
    chainId: chain.id,
    nonce: txNonce,
  });

  return relay({
    action: "cancel",
    from: account.address,
    id: id.toString(),
    nonce: nonce.toString(),
    signature,
    authorization: {
      chainId: authorization.chainId,
      nonce: authorization.nonce,
      r: authorization.r,
      s: authorization.s,
      yParity: authorization.yParity,
    },
  });
}
