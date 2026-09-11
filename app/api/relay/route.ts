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
 * inside the ERC-3009 nonce; a cancellation carries the target and the calldata
 * inside the digest IrisDelegate checks. Even a relayer acting in bad faith
 * cannot point any of them somewhere else.
 *
 * What the signatures do not protect is the relayer's own gas. The throttle
 * below lives in process memory, and on a serverless host each instance keeps
 * its own, so it slows a casual caller and nothing more. The defences that
 * hold across instances are the ones that read the chain instead:
 *
 * - Nothing costs gas until it has been shown to succeed. Calls are simulated,
 *   and a creation's ERC-3009 signature is checked off chain before the
 *   relayer so much as tops the sender up.
 * - There is no way to ask for test funds on their own. Topping up happens
 *   only inside a creation that carries a genuine signature, so it cannot be
 *   driven by a loop of bare addresses.
 * - Below a reserve the relayer stops topping anyone up, and below a floor it
 *   stops altogether, so whatever someone burns, the last of the gas is left
 *   for claims and cancellations.
 *
 * None of this stops a determined attacker with a script and fresh keys from
 * spending the relayer down to its reserve. Doing that needs a durable rate
 * limit, which needs a store this project does not have yet.
 */
import { NextResponse } from "next/server";
import {
  createWalletClient, encodeFunctionData, http, isAddress, isHex, parseEther, recoverTypedDataAddress,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { publicClient } from "@/lib/chain";
import { IRIS, irisAbi, AUSD, balanceOf } from "@/lib/iris";
import { DOMAIN, TYPES, noteHash } from "@/lib/authorize";
import { DELEGATE } from "@/lib/delegate";

export const runtime = "nodejs";

/** Agora's testnet faucet. A convenience for a demo, not part of the product. */
const FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Address;
const faucetAbi = [
  { type: "function", name: "requestFunds", stateMutability: "nonpayable",
    inputs: [{ type: "address" }], outputs: [] },
] as const;

/**
 * Gas the relayer protects for itself. Below RESERVE it stops topping senders
 * up — that is the demo's convenience, not the product. Below FLOOR it stops
 * entirely rather than fail halfway through somebody's claim.
 */
const RESERVE = parseEther("1");
const FLOOR = parseEther("0.25");

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

/**
 * The note is the one field a recipient would act on — "from Mum" is the whole
 * reason they trust the link. The contract binds it into the ERC-3009 nonce, so
 * a relayer cannot rewrite it; this only refuses one the contract would refuse,
 * before it costs anybody a transaction.
 */
type Note = { from: string; about: string };
const note = (v: unknown): v is Note => {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.from === "string" && typeof n.about === "string" &&
    new TextEncoder().encode(n.from).length <= 32 &&
    new TextEncoder().encode(n.about).length <= 64
  );
};

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

/** A creation's authorization, kept so it can be verified before anything is spent. */
type Funding = {
  from: Address;
  value: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
  schedule: {
    claimSigner: Address; amountPerPayment: bigint; interval: number;
    paymentsTotal: number; startNow: boolean; note: Note;
  };
};

/** Translate a request into exactly one known call, or refuse it. */
function resolve(body: Record<string, unknown>): { call: Call; subject: string; funding?: Funding } | string {
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
      const said = body.note ?? { from: "", about: "" };
      if (
        !addr(from) || !addr(claimSigner) || !uint(amountPerPayment) ||
        !uint(interval) || !uint(paymentsTotal) || typeof startNow !== "boolean" ||
        !uint(validBefore) || !b32(salt) || !sig(signature) || !note(said)
      ) return "Invalid commitment.";
      return {
        subject: from.toLowerCase(),
        call: { address: IRIS, abi: irisAbi as readonly unknown[], functionName: "createToClaimWithAuthorization",
          args: [from, claimSigner, BigInt(amountPerPayment), Number(interval),
                 Number(paymentsTotal), startNow, 0n, BigInt(validBefore), salt, signature, said] },
        funding: {
          from, salt, signature,
          value: BigInt(amountPerPayment) * BigInt(paymentsTotal),
          validBefore: BigInt(validBefore),
          schedule: {
            claimSigner, amountPerPayment: BigInt(amountPerPayment), interval: Number(interval),
            paymentsTotal: Number(paymentsTotal), startNow, note: said,
          },
        },
      };
    }
    default:
      return "Unknown action.";
  }
}

const executeAbi = [
  {
    type: "function", name: "execute", stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "bytes" }, { type: "uint256" }, { type: "bytes" }],
    outputs: [{ type: "bytes" }],
  },
] as const;

type Authorization = { chainId: number; nonce: number; r: Hex; s: Hex; yParity: number };

const isAuthorization = (v: unknown): v is Authorization => {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    a.chainId === monadTestnet.id &&
    typeof a.nonce === "number" && Number.isInteger(a.nonce) && a.nonce >= 0 &&
    b32(a.r) && b32(a.s) &&
    (a.yParity === 0 || a.yParity === 1)
  );
};

/**
 * Cancelling takes a different shape from the rest: it is a type-4 transaction
 * carrying the sender's EIP-7702 authorization, not a plain call.
 *
 * The authorization only says "run IrisDelegate as me". What actually runs is
 * decided by the signature the sender made over the calldata, and that calldata
 * is built here rather than accepted from the caller — so this route can put
 * one thing through a delegated account, a cancellation, and nothing else.
 */
async function cancellation(body: Record<string, unknown>) {
  const { from, id, nonce, signature, authorization } = body;
  if (!addr(from) || !uint(id) || !uint(nonce) || !sig(signature) || !isAuthorization(authorization)) {
    return "Invalid cancellation." as const;
  }

  const commitment = (await publicClient.readContract({
    address: IRIS, abi: irisAbi, functionName: "get", args: [BigInt(id)],
  }).catch(() => null)) as { sender: Address; cancelled: boolean } | null;

  if (!commitment) return "No such commitment." as const;
  if (commitment.sender.toLowerCase() !== from.toLowerCase()) {
    return "Only the sender can stop a commitment." as const;
  }
  if (commitment.cancelled) return "This is already stopped." as const;

  const data = encodeFunctionData({ abi: irisAbi, functionName: "cancel", args: [BigInt(id)] });

  return {
    subject: from.toLowerCase(),
    to: from,
    data: encodeFunctionData({
      abi: executeAbi, functionName: "execute",
      args: [IRIS, data, BigInt(nonce), signature],
    }),
    authorization: { address: DELEGATE, ...authorization },
  };
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

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(process.env.MONAD_RPC_URL) });

  const gas = await publicClient.getBalance({ address: account.address });
  if (gas < FLOOR) {
    return NextResponse.json(
      { error: "The demo has run out of test gas and needs a top-up before it can send anything." },
      { status: 503 }
    );
  }

  if (body.action === "cancel") {
    const stop = await cancellation(body);
    if (typeof stop === "string") return NextResponse.json({ error: stop }, { status: 400 });
    if (throttled(ip) || throttled(stop.subject)) {
      return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
    }
    // A forged signature passes every check above — the sender of any
    // commitment is public — and would only fail inside the delegate, after
    // the relayer had paid for the attempt. Simulating the type-4 call first
    // means it fails here instead, for free.
    try {
      await publicClient.call({
        account, to: stop.to, data: stop.data, authorizationList: [stop.authorization],
      } as never);
    } catch {
      return NextResponse.json({ error: "This cancellation was not signed by the sender." }, { status: 400 });
    }

    try {
      const hash = await wallet.sendTransaction({
        authorizationList: [stop.authorization],
        to: stop.to,
        data: stop.data,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        return NextResponse.json({ error: "The cancellation did not go through." }, { status: 400 });
      }
      return NextResponse.json({ hash, status: receipt.status });
    } catch (e) {
      const reason = (e as { shortMessage?: string }).shortMessage ?? "This cannot be completed.";
      return NextResponse.json({ error: reason }, { status: 400 });
    }
  }

  const resolved = resolve(body);
  if (typeof resolved === "string") return NextResponse.json({ error: resolved }, { status: 400 });

  if (throttled(ip) || throttled(resolved.subject)) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const { call, funding } = resolved;

  if (funding) {
    const { from, value, validBefore, salt, signature, schedule } = funding;

    // Checked off chain, so a creation nobody actually signed costs nothing —
    // not the simulation, and above all not a top-up.
    const nonce = (await publicClient.readContract({
      address: IRIS, abi: irisAbi, functionName: "authorizationNonce",
      args: [salt, schedule.claimSigner, schedule.amountPerPayment, schedule.interval,
             schedule.paymentsTotal, schedule.startNow, noteHash(schedule.note)],
    })) as Hex;

    const signer = await recoverTypedDataAddress({
      domain: { ...DOMAIN, chainId: monadTestnet.id, verifyingContract: AUSD },
      types: TYPES,
      primaryType: "ReceiveWithAuthorization",
      message: { from, to: IRIS, value, validAfter: 0n, validBefore, nonce },
      signature,
    }).catch(() => undefined);

    if (!signer || signer.toLowerCase() !== from.toLowerCase()) {
      return NextResponse.json(
        { error: "This commitment was not signed by the account paying for it." },
        { status: 400 }
      );
    }

    // On testnet the sender's balance is a stage prop, so the relayer supplies
    // it — but only here, behind a genuine signature, and never below reserve.
    if ((await balanceOf(from)) < value) {
      if (gas < RESERVE) {
        return NextResponse.json(
          { error: "The demo's test funds are running low. Try a smaller amount, or come back shortly." },
          { status: 503 }
        );
      }
      const topUp = await wallet.writeContract({
        address: FAUCET, abi: faucetAbi, functionName: "requestFunds", args: [from],
        account, chain: monadTestnet,
      });
      await publicClient.waitForTransactionReceipt({ hash: topUp });
    }
  }

  try {
    // Simulating first means a doomed request costs the relayer nothing, and
    // the caller gets the contract's own reason instead of a failed
    // transaction to puzzle over.
    await publicClient.simulateContract({ ...call, account } as never);
  } catch (e) {
    const reason = (e as { shortMessage?: string }).shortMessage ?? "This cannot be completed.";
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const hash = await wallet.writeContract({ ...call, account, chain: monadTestnet } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return NextResponse.json({ hash, status: receipt.status });
}
