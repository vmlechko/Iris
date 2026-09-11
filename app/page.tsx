"use client";

import { useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { signIn, endSession, NoPrfError } from "@/lib/account";
import { incomingOf, outgoingOf, balanceOf, money, remaining, whenNext, cadenceLabel, type Commitment } from "@/lib/iris";
import Detail from "@/app/components/Detail";
import { notesFor } from "@/lib/indexer";

type State =
  | { at: "out" }
  | { at: "working" }
  | { at: "in"; address: Address; incoming: Commitment[]; outgoing: Commitment[]; open: Commitment | null; names: Map<string, string>; held: bigint }
  | { at: "error"; message: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Row({ c, side, name, onOpen }: { c: Commitment; side: "in" | "out"; name?: string; onOpen: () => void }) {
  const done = c.paymentsMade >= c.paymentsTotal || c.cancelled;
  return (
    <li className={done ? "row done" : "row"}>
      <button className="rowbutton" onClick={onOpen}>
        <span className="rowmain">
          <strong>{money(c.amountPerPayment)}</strong>{" "}
          <span className="muted">{cadenceLabel(c.interval)}</span>
          <span className="muted small block">
            {side === "in"
              ? `from ${name ?? short(c.sender)}`
              : c.recipient === "0x0000000000000000000000000000000000000000"
                ? "link not opened yet"
                : `to ${short(c.recipient)}`}
            {" · "}
            {c.paymentsMade} of {c.paymentsTotal} sent
          </span>
        </span>
        <span className="when">
          <span>{whenNext(c)}</span>
          {!done && <span className="muted small">{money(remaining(c))} left</span>}
        </span>
      </button>
    </li>
  );
}

export default function Home() {
  const [state, setState] = useState<State>({ at: "out" });

  const enter = async (fn: () => Promise<Address>) => {
    setState({ at: "working" });
    try {
      // Signing in keeps the key for three minutes, for the first send only,
      // so that send does not ask for a second finger. Everything else derives
      // it again with a fresh prompt. See signIn in lib/account.ts.
      const address = await fn();
      const [incoming, outgoing, held] = await Promise.all([
        incomingOf(address), outgoingOf(address), balanceOf(address),
      ]);
      // Names are a nicety: if the indexer is unreachable the list falls back
      // to addresses rather than failing to open.
      const names = (await notesFor(incoming.map((c) => c.id))) ?? new Map<string, string>();
      setState({ at: "in", address, incoming, outgoing, open: null, names, held });
    } catch (e) {
      const err = e as Error;
      if (err.name === "NotAllowedError") {
        setState({ at: "out" });
        return;
      }
      setState({ at: "error", message: err instanceof NoPrfError ? err.message : err.message });
    }
  };

  /** Re-read both sides from the chain, after something changed there. */
  const refresh = async (address: Address) => {
    const [incoming, outgoing, held] = await Promise.all([
      incomingOf(address), outgoingOf(address), balanceOf(address),
    ]);
    const names = (await notesFor(incoming.map((c) => c.id))) ?? new Map<string, string>();
    setState({ at: "in", address, incoming, outgoing, open: null, names, held });
  };

  if (state.at === "in" && state.open) {
    return (
      <Detail
        commitment={state.open}
        viewer={state.address}
        onBack={() => setState({ ...state, open: null })}
        onChanged={() => refresh(state.address)}
      />
    );
  }

  if (state.at === "in") {
    const nothing = state.incoming.length === 0 && state.outgoing.length === 0;
    return (
      <main className="wrap">
        <header className="topline">
          <p className="eyebrow">Your account</p>
          <button className="linkish" onClick={() => { endSession(); setState({ at: "out" }); }}>Sign out</button>
        </header>
        {/* The answer to "how much do I have", which any account owes its
            owner — and which the sending screen used to give only as a reason
            it would not let you continue. */}
        <p className="balance">{money(state.held)}</p>

        {/* Nobody in Iris ever types an address at another person — a claim
            link carries the whole thing. So the address does no work on this
            screen, and thirty-eight hex characters are the loudest possible
            way to say "this is crypto". It stays available for anyone who
            wants to check which account they are in, and out of the way of
            everyone who does not. */}
        <details className="details">
          <summary>Account details</summary>
          <p className="address">{state.address}</p>
        </details>

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
              {state.incoming.map((c) => (
                <Row key={String(c.id)} c={c} side="in" name={state.names.get(String(c.id))} onOpen={() => setState({ ...state, open: c })} />
              ))}
            </ul>
          </section>
        )}

        {state.outgoing.length > 0 && (
          <section>
            <h2>You are sending</h2>
            <ul className="rows">
              {state.outgoing.map((c) => (
                <Row key={String(c.id)} c={c} side="out" onOpen={() => setState({ ...state, open: c })} />
              ))}
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
        <button onClick={() => enter(() => signIn("register"))} disabled={state.at === "working"}>
          {state.at === "working" ? "Waiting…" : "Continue with Face ID"}
        </button>
        <button className="ghost" onClick={() => enter(() => signIn("restore"))} disabled={state.at === "working"}>
          I already have an account
        </button>
      </div>

      {state.at === "error" && <p className="error">{state.message}</p>}
    </main>
  );
}
