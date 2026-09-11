/**
 * What an amount means where the person receiving it lives.
 *
 * "$200" is the promise, and it is exact: AUSD tracks the dollar and the
 * escrow holds it. But nobody receiving support thinks in dollars — they think
 * in what it buys at home. The concept's secondary pain was exactly this: no one
 * shows honestly how much arrives in hand.
 *
 * So recipient-facing screens add an estimate in the local currency. Three
 * decisions keep it honest:
 *
 * - The currency comes from the device's language and region. Nobody is asked,
 *   nothing is stored, and a guess that is wrong costs one grey line.
 * - The rate prefers the one Chainlink CRE recorded on chain, when it is for the
 *   same currency, and says so. Otherwise it uses the same public source the
 *   workflow reads, and says "today's rate".
 * - It is rounded to three significant figures, so an estimate never looks like
 *   a quote.
 */
import { hexToString, type Address } from "viem";
import { publicClient } from "./chain";

/**
 * The receiver the workflow's local simulations deliver to. The production
 * receiver only accepts reports from Chainlink's DON, which this project has no
 * deploy access to yet, so it has never recorded a rate.
 */
export const SCHEDULER: Address =
  (process.env.NEXT_PUBLIC_IRIS_SCHEDULER as Address) ??
  "0x0e7fc813ef8c28b0d41294feb86512afc3c3fd27";

const PUBLISHED_RATES = "https://open.er-api.com/v6/latest/USD";

/** Region to currency. JavaScript's Intl has no such table, so this is one. */
const REGION_CURRENCY: Record<string, string> = {
  // Corridors from the concept: rails that are slow, costly or unreliable.
  NG: "NGN", AR: "ARS", LB: "LBP", TR: "TRY", VE: "VES",
  RU: "RUB", UA: "UAH", KZ: "KZT", GE: "GEL", AM: "AMD", BY: "BYN", UZ: "UZS",
  KG: "KGS", TJ: "TJS", AZ: "AZN", MD: "MDL",
  // Where senders and students often are.
  PT: "EUR", ES: "EUR", DE: "EUR", FR: "EUR", IT: "EUR", NL: "EUR", AT: "EUR",
  BE: "EUR", IE: "EUR", FI: "EUR", GR: "EUR", CY: "EUR", GB: "GBP", PL: "PLN",
  CZ: "CZK", RS: "RSD", AE: "AED", IL: "ILS", CA: "CAD", AU: "AUD",
  // Other large remittance corridors.
  IN: "INR", PH: "PHP", MX: "MXN", BR: "BRL", EG: "EGP", PK: "PKR", BD: "BDT",
  ID: "IDR", VN: "VND", TH: "THB", KE: "KES", GH: "GHS", ZA: "ZAR", CO: "COP",
  CL: "CLP", PE: "PEN", MA: "MAD", JP: "JPY", CN: "CNY", KR: "KRW",
};

export type LocalRate = {
  currency: string;
  locale: string;
  /** Units of the local currency per dollar. */
  rate: number;
  /** True when the rate is the one Chainlink CRE recorded on chain. */
  attested: boolean;
};

/** The viewer's currency, or nothing when it is the dollar or cannot be told. */
function localCurrency(): { currency: string; locale: string } | undefined {
  if (typeof navigator === "undefined") return undefined;
  const locale = navigator.languages?.[0] ?? navigator.language;
  if (!locale) return undefined;
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined;
  }
  const currency = region ? REGION_CURRENCY[region] : undefined;
  // A second line saying "≈ $200" under "$200" would say nothing.
  if (!currency || currency === "USD") return undefined;
  return { currency, locale };
}

const schedulerAbi = [
  {
    type: "function", name: "latestRate", stateMutability: "view", inputs: [],
    outputs: [
      { type: "bytes3", name: "currency" },
      { type: "uint64", name: "value" },
      { type: "uint40", name: "observedAt" },
    ],
  },
] as const;

async function attestedRate(currency: string): Promise<number | undefined> {
  try {
    const [code, value] = (await publicClient.readContract({
      address: SCHEDULER, abi: schedulerAbi, functionName: "latestRate",
    })) as readonly [`0x${string}`, bigint, number];
    if (value === 0n) return undefined;
    const recorded = hexToString(code).replace(/\0/g, "");
    return recorded === currency ? Number(value) / 1_000_000 : undefined;
  } catch {
    return undefined;
  }
}

async function publishedRate(currency: string): Promise<number | undefined> {
  try {
    const response = await fetch(PUBLISHED_RATES);
    if (!response.ok) return undefined;
    const body = await response.json();
    const rate = body?.result === "success" ? body.rates?.[currency] : undefined;
    return typeof rate === "number" && rate > 0 ? rate : undefined;
  } catch {
    return undefined;
  }
}

let once: Promise<LocalRate | undefined> | undefined;

/**
 * The viewer's currency and a rate for it, worked out once per page. Resolves
 * to nothing whenever any part is missing — the estimate is a nicety, and a
 * screen should never wait on it or break for it.
 */
export function localRate(): Promise<LocalRate | undefined> {
  return (once ??= (async () => {
    const local = localCurrency();
    if (!local) return undefined;
    const onChain = await attestedRate(local.currency);
    if (onChain) return { ...local, rate: onChain, attested: true };
    const published = await publishedRate(local.currency);
    return published ? { ...local, rate: published, attested: false } : undefined;
  })());
}

/** An AUSD amount — six decimals, tracking the dollar — in the local currency. */
export function inLocal(amount: bigint, local: LocalRate): string {
  const value = (Number(amount) / 1_000_000) * local.rate;
  const format = (currencyDisplay: "symbol" | "code") =>
    new Intl.NumberFormat(local.locale, {
      style: "currency",
      currency: local.currency,
      currencyDisplay,
      maximumSignificantDigits: 3,
    });

  // Several currencies are written "$" at home — the Argentine and Mexican
  // pesos among them. Beside "$200" that reads as "$200 is about $303,000".
  // Where the local sign is a dollar sign, the code says which one it means.
  const sign = format("symbol").formatToParts(value).find((part) => part.type === "currency")?.value ?? "";
  return format(sign.includes("$") ? "code" : "symbol").format(value);
}
