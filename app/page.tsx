"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { signIn, endSession, NoPrfError } from "@/lib/account";
import { incomingOf, outgoingOf, balanceOf, money, remaining, whenNext, cadenceLabel, type Commitment } from "@/lib/iris";
import Detail from "@/app/components/Detail";
import LocalAmount from "@/app/components/LocalAmount";
import AddMoney from "@/app/components/AddMoney";
import { ausdOnMonad, scale } from "@/lib/agora";
import { notesFor } from "@/lib/indexer";

type State =
  | { at: "out" }
  | { at: "working" }
  | { at: "in"; address: Address; incoming: Commitment[]; outgoing: Commitment[]; open: Commitment | null; names: Map<string, string>; held: bigint;
      /** The add-money screen, and whether it is the last step of signing up. */
      adding: { first: boolean } | null }
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
          {/* Only on what is coming in: the sender's device cannot know the
              recipient's currency, and guessing it from their own would lie. */}
          {side === "in" && <> <LocalAmount amount={c.amountPerPayment} /></>}
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

  // Agora's own count of the dollar Iris pays in, live. Shown only if it
  // arrives: an introduction should never wait on a third party.
  const [inUse, setInUse] = useState<number | undefined>();
  useEffect(() => {
    ausdOnMonad().then(setInUse);
  }, []);

  const enter = async (fn: () => Promise<Address>, fresh = false) => {
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
      // Someone who has just made an account and has nothing yet is asked where
      // their money is before anything else — an empty account with a "Send"
      // button is a dead end.
      const empty = incoming.length === 0 && outgoing.length === 0 && held === 0n;
      setState({ at: "in", address, incoming, outgoing, open: null, names, held, adding: fresh && empty ? { first: true } : null });
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
    setState({ at: "in", address, incoming, outgoing, open: null, names, held, adding: null });
  };

  if (state.at === "in" && state.adding) {
    return (
      <AddMoney
        address={state.address}
        held={state.held}
        first={state.adding.first}
        onBack={() => refresh(state.address)}
      />
    );
  }

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
          <button className="ghost" onClick={() => setState({ ...state, adding: { first: false } })}>Add money</button>
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

      <ol className="how">
        <li><span><strong>Choose how much and how often.</strong> $200 a month, for six months.</span></li>
        <li><span><strong>Send them a link.</strong> They open it and see every payment coming.</span></li>
        <li><span><strong>It arrives on schedule.</strong> Stop it whenever you want.</span></li>
      </ol>

      {inUse && (
        <p className="small muted">
          Paid in AUSD, the digital dollar issued by Agora — {scale(inUse)} of it
          in use on the network Iris runs on.
        </p>
      )}

      <div className="actions">
        <button onClick={() => enter(() => signIn("register"), true)} disabled={state.at === "working"}>
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
