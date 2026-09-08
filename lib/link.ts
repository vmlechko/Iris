/**
 * Claim links.
 *
 * The key goes after the hash. A fragment is never sent to a server, never
 * lands in an access log, and never leaks through a Referer header — which
 * matters here because the key is the money: whoever holds it can bind the
 * commitment. Putting it in a query string would quietly publish it.
 *
 * The commitment's number, though, is in the path on purpose. When someone
 * pastes this into a chat, the messenger fetches the page to draw a preview
 * card — and a crawler never sees the fragment. With the number in the path
 * the card can say who is sending what; without it, the card is a blank.
 * Nothing is given away: claiming needs the key, and the number is already
 * public on chain.
 */
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export type ClaimLink = { id: string; key: Hex };

export function buildClaimUrl(origin: string, id: bigint, key: Hex): string {
  return `${origin}/claim/${id.toString()}#${key.slice(2)}`;
}

/** The key alone now; the commitment's number comes from the route. */
export function readKeyFromHash(hash: string): Hex | undefined {
  const raw = hash.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return undefined;
  return `0x${raw}` as Hex;
}

export const addressOfKey = (key: Hex): Address => privateKeyToAccount(key).address;
