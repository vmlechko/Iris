/**
 * Agora's public API, the part that needs no key.
 *
 * `/v0/metrics` is open, cached for thirty seconds at Agora's edge and served
 * with CORS open, so the browser can ask it directly. Everything else in the
 * API — accounts, wire routes, transactions — needs an organisation key and
 * goes through our server when it arrives.
 */
const METRICS = "https://api.agora.finance/v0/metrics";

/** CAIP-2 id of Monad mainnet, as Agora's metrics name it. */
const MONAD = "eip155:143";

/**
 * How many AUSD are in circulation on Monad, or nothing if Agora cannot be
 * reached. Mainnet on purpose: it is the number that says whether the dollar
 * Iris pays in is real, and a testnet count would say nothing.
 */
export async function ausdOnMonad(): Promise<number | undefined> {
  try {
    const response = await fetch(METRICS);
    if (!response.ok) return undefined;
    const body = await response.json();
    const chain = body?.chains?.find((c: { chainId?: string }) => c.chainId === MONAD);
    const value = Number(chain?.circulatingSupply);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * "$151 million" — rounded, because it is a scale, not a figure to audit.
 * Currency style would abbreviate to "$151M" whatever it is asked, so the
 * dollar sign goes on by hand.
 */
export function scale(dollars: number): string {
  return "$" + new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "long",
    maximumSignificantDigits: 3,
  }).format(dollars);
}
