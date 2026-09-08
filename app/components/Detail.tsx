"use client";

/**
 * One commitment, and what has already happened to it.
 *
 * The list on the previous screen answers "what is coming". This answers "what
 * has arrived, and when" — which is the question a recipient actually has, and
 * the one a bank statement answers badly. Each payment links to the chain, so
 * the figure is checkable rather than merely displayed.
 *
 * The history comes from the indexer and the state comes from the chain. If
 * the indexer is unreachable the screen still works; it just cannot show the
 * past.
 */
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { explorerTx } from "@/lib/chain";
import { withSigner } from "@/lib/account";
import { cancelCommitment } from "@/lib/delegate";
import { paymentsFor, type Payment } from "@/lib/indexer";
import Steps from "@/app/components/Steps";
import { money, cadenceLabel, whenNext, remaining, getNote, type Commitment, type Note } from "@/lib/iris";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const NOBODY = "0x0000000000000000000000000000000000000000";

const day = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });

/** Approving, then the sponsored transaction that does it. */
const STOPPING = ["Approving with Face ID", "Stopping the payments"] as const;

type Stopping =
  | { at: "idle" }
  | { at: "confirming" }
  | { at: "working"; step: number }
  | { at: "stopped"; hash: string }
  | { at: "failed"; message: string };

export default function Detail({
  commitment,
  viewer,
  onBack,
  onChanged,
}: {
  commitment: Commitment;
  viewer: Address;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<Payment[] | null | "loading">("loading");
  const [stopping, setStopping] = useState<Stopping>({ at: "idle" });
  // Read from the chain rather than the indexer: this is one commitment, one
  // call, and it should survive the indexer being down.
  const [note, setNote] = useState<Note | undefined>();

  useEffect(() => {
    let live = true;
    paymentsFor(commitment.id).then((rows) => live && setHistory(rows));
    getNote(commitment.id).then((n) => live && setNote(n)).catch(() => {});
    return () => { live = false; };
  }, [commitment.id]);

  const mine = viewer.toLowerCase() === commitment.sender.toLowerCase();
  const finished = commitment.paymentsMade >= commitment.paymentsTotal;
  const canStop = mine && !commitment.cancelled && !finished;

  const stop = async () => {
    setStopping({ at: "working", step: 0 });
    try {
      const { hash } = await withSigner((account) => {
        setStopping({ at: "working", step: 1 });
        return cancelCommitment(account, commitment.id);
      });
      setStopping({ at: "stopped", hash });
      onChanged();
    } catch (e) {
      const error = e as Error;
      if (error.name === "NotAllowedError") {
        setStopping({ at: "idle" });
        return;
      }
      setStopping({ at: "failed", message: error.message });
    }
  };

  return (
    <main className="wrap">
      <header className="topline">
        <p className="eyebrow">{mine ? "You are sending" : "Coming to you"}</p>
        <button className="linkish" onClick={onBack}>Back</button>
      </header>

      <h1 className="sentence">
        {money(commitment.amountPerPayment)} <em>{cadenceLabel(commitment.interval)}</em>
      </h1>

      <p className="lede">
        {mine
          ? commitment.recipient === NOBODY
            ? "The link has not been opened yet."
            : <>To {short(commitment.recipient)}.</>
          : <>From {note?.from?.trim() || short(commitment.sender)}.</>}{" "}
        {note?.about?.trim() ? <>For {note.about.trim()}. </> : null}
        {commitment.paymentsMade} of {commitment.paymentsTotal} sent
        {commitment.cancelled
          ? ". Stopped."
          : finished
            ? ". Complete."
            : <>, {money(remaining(commitment))} still set aside.</>}
      </p>

      {!commitment.cancelled && !finished && (
        <p className="note">Next {whenNext(commitment).toLowerCase()}.</p>
      )}

      <h2>Already paid</h2>
      {history === "loading" && <p className="note">Looking…</p>}
      {history === null && (
        <p className="note">The history is unavailable right now. Everything above is current.</p>
      )}
      {Array.isArray(history) && history.length === 0 && (
        <p className="note">Nothing has been released yet.</p>
      )}
      {Array.isArray(history) && history.length > 0 && (
        <ul className="rows">
          {history.map((p) => (
            <li className="row" key={p.id}>
              <div>
                <strong>{money(p.amount)}</strong>
                <div className="muted small">payment {p.paymentNumber} of {commitment.paymentsTotal}</div>
              </div>
              <div className="when">
                <span>{day(p.releasedAt)}</span>
                <a className="muted small" href={explorerTx(p.txHash)} target="_blank" rel="noreferrer">
                  receipt
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canStop && (
        <div className="actions">
          {stopping.at === "idle" && (
            <button className="ghost" onClick={() => setStopping({ at: "confirming" })}>
              Stop future payments
            </button>
          )}

          {stopping.at === "confirming" && (
            <>
              <p className="note">
                {money(remaining(commitment))} comes back to you. Anything already
                due stays theirs — stopping cannot take back a payment.
              </p>
              <button className="danger" onClick={stop}>Yes, stop it</button>
              <button className="ghost" onClick={() => setStopping({ at: "idle" })}>Leave it running</button>
            </>
          )}

          {stopping.at === "working" && (
            <>
              <button disabled>Stopping…</button>
              <Steps steps={STOPPING} current={stopping.step} />
            </>
          )}
        </div>
      )}

      {stopping.at === "stopped" && (
        <p className="note">
          Stopped.{" "}
          <a href={explorerTx(stopping.hash)} target="_blank" rel="noreferrer">See the receipt</a>.
        </p>
      )}
      {stopping.at === "failed" && <p className="error">{stopping.message}</p>}
    </main>
  );
}
