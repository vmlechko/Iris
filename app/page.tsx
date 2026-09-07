"use client";

import { useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { register, restore, NoPrfError } from "@/lib/account";
import { incomingOf, outgoingOf, money, remaining, whenNext, cadenceLabel, type Commitment } from "@/lib/iris";

type State =
  | { at: "out" }
  | { at: "working" }
  | { at: "in"; address: Address; incoming: Commitment[]; outgoing: Commitment[] }
  | { at: "error"; message: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Row({ c, side }: { c: Commitment; side: "in" | "out" }) {
  const done = c.paymentsMade >= c.paymentsTotal || c.cancelled;
  return (
    <li className={done ? "row done" : "row"}>
      <div>
        <strong>{money(c.amountPerPayment)}</strong>{" "}
        <span className="muted">{cadenceLabel(c.interval)}</span>
        <div className="muted small">
          {side === "in" ? `from ${short(c.sender)}` : c.recipient === "0x0000000000000000000000000000000000000000"
            ? "link not opened yet"
            : `to ${short(c.recipient)}`}
          {" · "}
          {c.paymentsMade} of {c.paymentsTotal} sent
        </div>
      </div>
      <div className="when">
        <span>{whenNext(c)}</span>
        {!done && <span className="muted small">{money(remaining(c))} left</span>}
      </div>
    </li>
  );
}

export default function Home() {
  const [state, setState] = useState<State>({ at: "out" });

  const enter = async (fn: () => Promise<Address>) => {
    setState({ at: "working" });
    try {
      // Only the address is kept. The key was zeroed before this resolved and
      // is derived again, with a fresh prompt, whenever money moves.
      const address = await fn();
      const [incoming, outgoing] = await Promise.all([incomingOf(address), outgoingOf(address)]);
      setState({ at: "in", address, incoming, outgoing });
    } catch (e) {
      const err = e as Error;
      if (err.name === "NotAllowedError") {
        setState({ at: "out" });
        return;
      }
      setState({ at: "error", message: err instanceof NoPrfError ? err.message : err.message });
    }
  };

  if (state.at === "in") {
    const nothing = state.incoming.length === 0 && state.outgoing.length === 0;
    return (
      <main className="wrap">
        <header className="topline">
          <p className="eyebrow">Your account</p>
          <button className="linkish" onClick={() => setState({ at: "out" })}>Sign out</button>
        </header>
        <p className="address">{state.address}</p>

        {nothing && (
          <p className="lede">
            Nothing here yet. Set money aside for someone and send them a link —
            they will not need an account to receive it.
          </p>
        )}

        {state.incoming.length > 0 && (
          <section>
            <h2>Coming to you</h2>
            <ul className="rows">
              {state.incoming.map((c) => <Row key={String(c.id)} c={c} side="in" />)}
            </ul>
          </section>
        )}

        {state.outgoing.length > 0 && (
          <section>
            <h2>You are sending</h2>
            <ul className="rows">
              {state.outgoing.map((c) => <Row key={String(c.id)} c={c} side="out" />)}
            </ul>
          </section>
        )}

        <div className="actions">
          <Link className="button" href="/send">Send money</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <h1>
        Support that <em>arrives</em> on time.
      </h1>
      <p className="lede">
        Set money aside for someone once, and they can see every payment coming
        before it lands. No app to install, no wallet, no seed phrase.
      </p>

      <div className="actions">
        <button onClick={() => enter(register)} disabled={state.at === "working"}>
          {state.at === "working" ? "Waiting…" : "Continue with Face ID"}
        </button>
        <button className="ghost" onClick={() => enter(restore)} disabled={state.at === "working"}>
          I already have an account
        </button>
      </div>

      {state.at === "error" && <p className="error">{state.message}</p>}
    </main>
  );
}
