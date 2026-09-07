/**
 * Claim links.
 *
 * The key goes after the hash. A fragment is never sent to a server, never
 * lands in an access log, and never leaks through a Referer header — which
 * matters here because the key is the money: whoever holds it can bind the
 * commitment. Putting it in a query string would quietly publish it.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export type ClaimLink = { id: string; key: Hex };

export function buildClaimUrl(origin: string, id: bigint, key: Hex): string {
  return `${origin}/claim#${id.toString()}.${key.slice(2)}`;
}

export function readClaimFromHash(hash: string): ClaimLink | undefined {
  const raw = hash.replace(/^#/, "");
  const [id, key] = raw.split(".");
  if (!id || !key || !/^\d+$/.test(id) || !/^[0-9a-fA-F]{64}$/.test(key)) return undefined;
  return { id, key: `0x${key}` as Hex };
}

export const addressOfKey = (key: Hex): Address => privateKeyToAccount(key).address;
