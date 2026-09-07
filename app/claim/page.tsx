"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import type { Address } from "viem";
import { register, NoPrfError } from "@/lib/account";
import { relay } from "@/lib/relay";
import { getCommitment, cadenceLabel, money, remaining, IRIS, type Commitment } from "@/lib/iris";
import { readClaimFromHash, type ClaimLink } from "@/lib/link";

type Phase =
  | { at: "reading" }
  | { at: "broken" }
  | { at: "waiting"; link: ClaimLink; commitment: Commitment }
  | { at: "receiving" }
  | { at: "received"; commitment: Commitment; address: Address }
  | { at: "failed"; message: string };

export default function Claim() {
  const [phase, setPhase] = useState<Phase>({ at: "reading" });

  useEffect(() => {
    // The key lives in the fragment, so it is read here and never sent
    // anywhere. A link without one is not a link.
    const link = readClaimFromHash(location.hash);
    if (!link) {
      setPhase({ at: "broken" });
      return;
    }
    getCommitment(BigInt(link.id))
      .then((commitment) => setPhase({ at: "waiting", link, commitment }))
      .catch(() => setPhase({ at: "broken" }));
  }, []);

  async function receive(link: ClaimLink, commitment: Commitment) {
    setPhase({ at: "receiving" });
    try {
      // One passkey ceremony. The address it derives is what the link binds to.
      const address = await register();

      // The link's key signs that address, so this claim cannot be redirected
      // even by whoever relays it.
      const signature = await privateKeyToAccount(link.key).signTypedData({
        domain: { name: "Iris", version: "1", chainId: monadTestnet.id, verifyingContract: IRIS },
        types: { Claim: [{ name: "id", type: "uint256" }, { name: "recipient", type: "address" }] },
        primaryType: "Claim",
        message: { id: BigInt(link.id), recipient: address },
      });

      await relay({ action: "claim", id: link.id, recipient: address, signature });
      setPhase({ at: "received", commitment: await getCommitment(BigInt(link.id)), address });
    } catch (e) {
      const err = e as Error;
      if (err.name === "NotAllowedError") {
        setPhase({ at: "waiting", link, commitment });
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
        <p className="lede">Receiving…</p>
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
      <p className="eyebrow">Waiting for you</p>
      <h1>
        {money(c.amountPerPayment)} <em>now</em>.
      </h1>
      <p className="lede">
        Then {money(c.amountPerPayment)} {cadenceLabel(c.interval)}, {left - 1} more{" "}
        {left - 1 === 1 ? "time" : "times"} — {money(remaining(c))} in all, already
        set aside and waiting.
      </p>

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
