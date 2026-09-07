/**
 * The relayer. Three actions, no more.
 *
 * Both halves of Iris work from an empty account: the person receiving arrives
 * through a passkey holding nothing, and the person sending signs rather than
 * pays. Someone has to put the transaction on chain, and it is this route.
 *
 * A relayer that submits whatever it is handed is a hot wallet anyone can
 * drain, so this one never takes a call from the caller. It takes arguments,
 * encodes the call itself, simulates it, and refuses anything that would
 * revert. Every action is also rate limited per address and per IP.
 *
 * What keeps it honest is that the signatures do the real work. A claim carries
 * the recipient inside the signature; a creation carries the whole schedule
 * inside the ERC-3009 nonce. Even a relayer acting in bad faith cannot point
 * either one somewhere else.
 */
import { NextResponse } from "next/server";
import { createWalletClient, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { publicClient } from "@/lib/chain";
import { IRIS, irisAbi } from "@/lib/iris";

export const runtime = "nodejs";

/** Agora's testnet faucet. A convenience for a demo, not part of the product. */
const FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Address;
const faucetAbi = [
  { type: "function", name: "requestFunds", stateMutability: "nonpayable",
    inputs: [{ type: "address" }], outputs: [] },
] as const;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;
const hits = new Map<string, number[]>();

function throttled(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_PER_WINDOW;
}

const addr = (v: unknown): v is Address => typeof v === "string" && isAddress(v);
const sig = (v: unknown): v is Hex => typeof v === "string" && isHex(v) && v.length === 132;
const uint = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
const b32 = (v: unknown): v is Hex => typeof v === "string" && isHex(v) && v.length === 66;

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

/** Translate a request into exactly one known call, or refuse it. */
function resolve(body: Record<string, unknown>): { call: Call; subject: string } | string {
  switch (body.action) {
    case "claim": {
      const { id, recipient, signature } = body;
      if (!uint(id) || !addr(recipient) || !sig(signature)) return "Invalid claim.";
      return {
        subject: recipient.toLowerCase(),
        call: { address: IRIS, abi: irisAbi as readonly unknown[], functionName: "claim",
          args: [BigInt(id), recipient, signature] as const },
      };
    }
    case "create": {
      const { from, claimSigner, amountPerPayment, interval, paymentsTotal, startNow, validBefore, salt, signature } = body;
      if (
        !addr(from) || !addr(claimSigner) || !uint(amountPerPayment) ||
        !uint(interval) || !uint(paymentsTotal) || typeof startNow !== "boolean" ||
        !uint(validBefore) || !b32(salt) || !sig(signature)
      ) return "Invalid commitment.";
      return {
        subject: from.toLowerCase(),
        call: { address: IRIS, abi: irisAbi as readonly unknown[], functionName: "createToClaimWithAuthorization",
          args: [from, claimSigner, BigInt(amountPerPayment), Number(interval),
                 Number(paymentsTotal), startNow, 0n, BigInt(validBefore), salt, signature] },
      };
    }
    case "fund": {
      // Testnet only: hands the caller AUSD so a demo can be run end to end.
      const { to } = body;
      if (!addr(to)) return "Invalid address.";
      return { subject: to.toLowerCase(),
        call: { address: FAUCET, abi: faucetAbi as readonly unknown[], functionName: "requestFunds", args: [to] } };
    }
    default:
      return "Unknown action.";
  }
}

export async function POST(request: Request) {
  const key = process.env.SPONSOR_PK as Hex | undefined;
  if (!key) return NextResponse.json({ error: "Relayer is not configured." }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const resolved = resolve(body);
  if (typeof resolved === "string") return NextResponse.json({ error: resolved }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip) || throttled(resolved.subject)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const account = privateKeyToAccount(key);
  const { call } = resolved;

  try {
    // Simulating first means a doomed request costs the relayer nothing, and
    // the caller gets the contract's own reason instead of a failed
    // transaction to puzzle over.
    await publicClient.simulateContract({ ...call, account } as never);
  } catch (e) {
    const reason = (e as { shortMessage?: string }).shortMessage ?? "This cannot be completed.";
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(process.env.MONAD_RPC_URL) });
  const hash = await wallet.writeContract({ ...call, account, chain: monadTestnet } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return NextResponse.json({ hash, status: receipt.status });
}
