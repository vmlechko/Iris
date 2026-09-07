import { formatUnits, parseUnits, type Address } from "viem";
import { publicClient, AUSD, AUSD_DECIMALS } from "./chain";
import { irisAbi } from "./iris-abi";

export const IRIS: Address =
  (process.env.NEXT_PUBLIC_IRIS_ADDRESS as Address) ??
  "0x7ed55fed7346ef9b5d4a92771486dcbb1c7b6c14";

export { irisAbi, AUSD, AUSD_DECIMALS };

export type Commitment = {
  id: bigint;
  sender: Address;
  recipient: Address;
  claimSigner: Address;
  amountPerPayment: bigint;
  interval: number;
  nextPaymentAt: number;
  paymentsTotal: number;
  paymentsMade: number;
  cancelled: boolean;
};

/** AUSD carries six decimals, not eighteen. Everything formats through here. */
export const toAusd = (v: bigint) => formatUnits(v, AUSD_DECIMALS);
export const fromAusd = (v: string) => parseUnits(v, AUSD_DECIMALS);

export const money = (v: bigint) =>
  Number(toAusd(v)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number(toAusd(v)) % 1 === 0 ? 0 : 2,
  });

/** Intervals people actually think in, rather than seconds. */
export const CADENCES = [
  { label: "every week", seconds: 7 * 24 * 3600 },
  { label: "every month", seconds: 30 * 24 * 3600 },
  { label: "every 3 months", seconds: 90 * 24 * 3600 },
] as const;

export const cadenceLabel = (seconds: number) =>
  CADENCES.find((c) => c.seconds === seconds)?.label ?? `every ${Math.round(seconds / 86400)} days`;

/** The struct as the contract returns it, before it is made comfortable. */
type RawCommitment = {
  sender: Address;
  recipient: Address;
  claimSigner: Address;
  amountPerPayment: bigint;
  interval: number;
  nextPaymentAt: number;
  paymentsTotal: number;
  paymentsMade: number;
  cancelled: boolean;
};

export async function getCommitment(id: bigint): Promise<Commitment> {
  const c = (await publicClient.readContract({
    address: IRIS,
    abi: irisAbi,
    functionName: "get",
    args: [id],
  })) as unknown as RawCommitment;
  return {
    id,
    sender: c.sender,
    recipient: c.recipient,
    claimSigner: c.claimSigner,
    amountPerPayment: c.amountPerPayment,
    interval: Number(c.interval),
    nextPaymentAt: Number(c.nextPaymentAt),
    paymentsTotal: Number(c.paymentsTotal),
    paymentsMade: Number(c.paymentsMade),
    cancelled: c.cancelled,
  };
}

async function listFor(fn: "incomingOf" | "outgoingOf", who: Address) {
  const ids = (await publicClient.readContract({
    address: IRIS,
    abi: irisAbi,
    functionName: fn,
    args: [who],
  })) as readonly bigint[];
  return Promise.all(ids.map(getCommitment));
}

export const incomingOf = (who: Address) => listFor("incomingOf", who);
export const outgoingOf = (who: Address) => listFor("outgoingOf", who);

/** Remaining value on a commitment, from the recipient's point of view. */
export const remaining = (c: Commitment) =>
  BigInt(c.paymentsTotal - c.paymentsMade) * c.amountPerPayment;

/** "in 3 days", "today" — a countdown reads better than a timestamp. */
export function whenNext(c: Commitment, now = Date.now()): string {
  if (c.cancelled) return "stopped";
  if (c.paymentsMade >= c.paymentsTotal) return "complete";
  const ms = c.nextPaymentAt * 1000 - now;
  if (ms <= 0) return "due now";
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  return weeks < 9 ? `in ${weeks} weeks` : `in ${Math.round(days / 30)} months`;
}
