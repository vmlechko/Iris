/**
 * Reading a commitment's history back.
 *
 * The chain knows the current state of a commitment — how many payments have
 * gone out, when the next one falls due — but not the story of how it got
 * there. That lives in events, and Monad's public RPC hands those back a
 * hundred blocks at a time, which is no way to read a year-long schedule.
 *
 * So history comes from our Envio indexer instead. It is a read-only
 * convenience: if it is unreachable the interface still works, it simply cannot
 * show what has already happened.
 */
const ENDPOINT =
  process.env.NEXT_PUBLIC_INDEXER_URL ??
  "https://indexer.dev.hyperindex.xyz/9d337f5/v1/graphql";

export type Payment = {
  id: string;
  amount: bigint;
  paymentNumber: number;
  releasedAt: number;
  txHash: string;
};

async function query<T>(document: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: document, variables }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body.errors) return null;
    return body.data as T;
  } catch {
    // History is never worth breaking the page over.
    return null;
  }
}

const PAYMENTS = `
  query Payments($commitment: String!) {
    Payment(where: { commitment_id: { _eq: $commitment } }, order_by: { paymentNumber: asc }) {
      id
      amount
      paymentNumber
      releasedAt
      txHash
    }
  }
`;

/** Every payment already released against one commitment, oldest first. */
export async function paymentsFor(id: bigint): Promise<Payment[] | null> {
  type Row = { id: string; amount: string; paymentNumber: number; releasedAt: string; txHash: string };
  const data = await query<{ Payment: Row[] }>(PAYMENTS, { commitment: id.toString() });
  if (!data) return null;
  return data.Payment.map((p) => ({
    id: p.id,
    amount: BigInt(p.amount),
    paymentNumber: p.paymentNumber,
    releasedAt: Number(p.releasedAt),
    txHash: p.txHash,
  }));
}
