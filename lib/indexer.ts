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
/**
 * Envio gives every deployment its own address, and a stable one is a paid
 * feature. This default is whichever deployment was current when it was
 * written, and it only stays right while that deployment lives — redeploy the
 * indexer and it is stale. Set NEXT_PUBLIC_INDEXER_URL rather than trusting it.
 *
 * The indexer only needs redeploying when `indexer/` itself changes; a push
 * that touches only the app can leave the running deployment alone.
 */
const ENDPOINT =
  process.env.NEXT_PUBLIC_INDEXER_URL ??
  "https://indexer.dev.hyperindex.xyz/415483c/v1/graphql";

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

const NOTES = `
  query Notes($ids: [String!]) {
    Commitment(where: { id: { _in: $ids } }) {
      id
      noteFrom
      noteAbout
    }
  }
`;

/**
 * Who each commitment is from, for a whole list at once.
 *
 * The list itself is read from the chain, one call per commitment; asking the
 * chain for the notes too would double that. This is one request for all of
 * them, and if it fails the list simply shows addresses as it did before.
 */
export async function notesFor(ids: bigint[]): Promise<Map<string, string> | null> {
  if (ids.length === 0) return new Map();
  type Row = { id: string; noteFrom: string; noteAbout: string };
  const data = await query<{ Commitment: Row[] }>(NOTES, { ids: ids.map(String) });
  if (!data) return null;
  return new Map(data.Commitment.filter((c) => c.noteFrom).map((c) => [c.id, c.noteFrom]));
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
