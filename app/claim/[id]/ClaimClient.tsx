"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";
import { register, signIn, withSigner, endSession, NoPrfError } from "@/lib/account";
import { relay } from "@/lib/relay";
import { getCommitment, getNote, cadenceLabel, money, remaining, balanceOf, IRIS, type Commitment, type Note } from "@/lib/iris";
import { authorizeSettlement, settledOf } from "@/lib/settle";
import Steps from "@/app/components/Steps";
import LocalAmount from "@/app/components/LocalAmount";
import { readKeyFromHash, type ClaimLink } from "@/lib/link";

type Phase =
  | { at: "reading" }
  | { at: "broken" }
  | { at: "waiting"; link: ClaimLink; commitment: Commitment; note?: Note }
  | { at: "receiving"; step: number; steps: readonly string[] }
  | { at: "received"; commitment: Commitment; address: Address; settled?: { amount: bigint; hash: string } }
  | { at: "failed"; message: string };

/** What actually happens when a link is opened: a passkey, then a claim. */
const RECEIVING = ["Creating your account", "Bringing the money in"] as const;

/** The same, when the person asked for it settled through Agora on the way in. */
const SETTLING = [...RECEIVING, "Settling it through Agora"] as const;

export default function ClaimClient({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ at: "reading" });
  /** Keep the dollars, or settle them into CTK through Agora on arrival. */
  const [settle, setSettle] = useState(false);

  useEffect(() => {
    // The key lives in the fragment, so it is read here and never sent
    // anywhere. A link without one is not a link.
    const key = readKeyFromHash(location.hash);
    const link: ClaimLink | undefined = key ? { id, key } : undefined;
    if (!link) {
      setPhase({ at: "broken" });
      return;
    }
    getCommitment(BigInt(link.id))
      .then(async (commitment) => {
        // Who it is from matters more here than anywhere else: this is the
        // screen where a stranger decides whether to trust a link.
        const note = await getNote(BigInt(link.id)).catch(() => undefined);
        setPhase({ at: "waiting", link, commitment, note });
      })
      .catch(() => setPhase({ at: "broken" }));
  }, [id]);

  async function receive(link: ClaimLink, commitment: Commitment) {
    const steps = settle ? SETTLING : RECEIVING;
    setPhase({ at: "receiving", step: 0, steps });
    try {
      // One passkey ceremony. The address it derives is what the link binds to.
      // Settling needs the key once more, after the claim lands, so it is kept
      // for those few seconds rather than asking for a second Face ID.
      const address = settle ? await signIn("register") : await register();
      setPhase({ at: "receiving", step: 1, steps });

      // The link's key signs that address, so this claim cannot be redirected
      // even by whoever relays it.
      const signature = await privateKeyToAccount(link.key).signTypedData({
        domain: { name: "Iris", version: "1", chainId: monadTestnet.id, verifyingContract: IRIS },
        types: { Claim: [{ name: "id", type: "uint256" }, { name: "recipient", type: "address" }] },
        primaryType: "Claim",
        message: { id: BigInt(link.id), recipient: address },
      });

      const before = settle ? await balanceOf(address) : 0n;
      await relay({ action: "claim", id: link.id, recipient: address, signature });

      let settled: { amount: bigint; hash: string } | undefined;
      if (settle) {
        setPhase({ at: "receiving", step: 2, steps });
        // Exactly what this claim brought in — never anything the account
        // already held.
        const arrived = (await balanceOf(address)) - before;
        if (arrived > 0n) {
          const authorization = await withSigner((account) => authorizeSettlement(account, arrived), { allowSession: true });
          const { hash } = await relay({ action: "settle", ...authorization });
          settled = { amount: await settledOf(address), hash };
        }
      }
      endSession();
      setPhase({ at: "received", commitment: await getCommitment(BigInt(link.id)), address, settled });
    } catch (e) {
      endSession();
      const err = e as Error;
      if (err.name === "NotAllowedError") {
        setPhase({ at: "waiting", link, commitment, note: phase.at === "waiting" ? phase.note : undefined });
        return;
      }
      setPhase({ at: "failed", message: err instanceof NoPrfError ? err.message : err.message });
    }
  }

  if (phase.at === "reading") {
    return <main className="wrap"><p className="lede">Opening…</p></main>;
  }

  if (phase.at === "broken") {
    return (
      <main className="wrap">
        <h1>This link is incomplete.</h1>
        <p className="lede">
          Links carry their key after the “#”, and some apps trim that off when
          they preview a link. Ask whoever sent it to share it again, as plain
          text rather than a preview.
        </p>
      </main>
    );
  }

  if (phase.at === "failed") {
    return (
      <main className="wrap">
        <h1>That didn’t go through.</h1>
        <p className="error">{phase.message}</p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  }

  if (phase.at === "received") {
    const c = phase.commitment;
    const left = c.paymentsTotal - c.paymentsMade;
    return (
      <main className="wrap">
        <p className="eyebrow">Received</p>
        <h1>
          {money(c.amountPerPayment)} is <em>yours</em>.
        </h1>
        <p className="lede">
          {left > 0
            ? `And ${money(remaining(c))} more is already set aside — ${money(
                c.amountPerPayment
              )} ${cadenceLabel(c.interval)}, ${left} more ${left === 1 ? "time" : "times"}.`
            : "That was the last payment of this commitment."}
        </p>
        {phase.settled && (
          <p className="note">
            Settled on arrival through Agora Instant Settlement:{" "}
            <strong>{money(phase.settled.amount).replace("$", "")} CTK</strong> is in your
            account, one for one.{" "}
            <a href={`${monadTestnet.blockExplorers.default.url}/tx/${phase.settled.hash}`} target="_blank" rel="noreferrer">
              Receipt
            </a>
          </p>
        )}
        <div className="linkbox">
          <code>{phase.address}</code>
        </div>
        <p className="note">
          This is your account. It exists only as your passkey — nothing was saved
          on this device, so you can open Iris on any other one and find it here.
        </p>
        <Link className="button" href="/">See everything</Link>
      </main>
    );
  }

  if (phase.at === "receiving") {
    return (
      <main className="wrap">
        <p className="eyebrow">Almost there</p>
        <h1>Setting up.</h1>
        <Steps steps={phase.steps} current={phase.step} />
      </main>
    );
  }

  const c = phase.commitment;
  const claimed = c.recipient !== "0x0000000000000000000000000000000000000000";
  const left = c.paymentsTotal - c.paymentsMade;

  if (claimed || c.cancelled) {
    return (
      <main className="wrap">
        <h1>{c.cancelled ? "This was withdrawn." : "This was already opened."}</h1>
        <p className="lede">
          {c.cancelled
            ? "Whoever set this up took it back before it was opened."
            : "Someone has already received this. If that was not you, tell the person who sent it."}
        </p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <p className="eyebrow">
        {phase.note?.from?.trim() ? `From ${phase.note.from.trim()}` : "Waiting for you"}
      </p>
      <h1>
        {money(c.amountPerPayment)} <em>now</em>.
      </h1>
      {/* The first screen a stranger sees, and the one place the question
          "how much is that for me" matters most. */}
      <LocalAmount amount={c.amountPerPayment} detail />
      <p className="lede">
        Then {money(c.amountPerPayment)} {cadenceLabel(c.interval)}, {left - 1} more{" "}
        {left - 1 === 1 ? "time" : "times"}. All {money(remaining(c))} of it is
        already set aside and waiting.
      </p>

      {phase.note?.about?.trim() && (
        <p className="lede">For {phase.note.about.trim()}.</p>
      )}

      {/* Agora Instant Settlement, offered where the money arrives. Off by
          default: dollars are what was promised. On testnet the only pair is
          AUSD/CTK, so CTK is named as the test token it is. */}
      <fieldset className="choice">
        <legend className="small muted">Receive it as</legend>
        <label className={settle ? "option" : "option on"}>
          <input type="radio" name="as" checked={!settle} onChange={() => setSettle(false)} />
          <span>
            <strong>Dollars</strong>
            <span className="muted small block">Kept as they were sent</span>
          </span>
        </label>
        <label className={settle ? "option on" : "option"}>
          <input type="radio" name="as" checked={settle} onChange={() => setSettle(true)} />
          <span>
            <strong>CTK, settled instantly</strong>
            <span className="muted small block">
              Swapped one for one through Agora Instant Settlement. A test token,
              standing in for USDC.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="actions">
        <button onClick={() => receive(phase.link, phase.commitment)}>
          Receive with Face ID
        </button>
      </div>

      <p className="note">
        There is nothing to install and no account to make. Your fingerprint
        creates one, and the money is there.
      </p>
    </main>
  );
}
