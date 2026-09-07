"use client";

import { useState } from "react";
import type { Address } from "viem";
import { register, restore, NoPrfError } from "@/lib/account";

type State =
  | { status: "anonymous" }
  | { status: "working" }
  | { status: "ready"; address: Address }
  | { status: "error"; message: string; recoverable: boolean };

export default function Home() {
  const [state, setState] = useState<State>({ status: "anonymous" });

  const run = async (fn: () => Promise<Address>) => {
    setState({ status: "working" });
    try {
      // Only the address is kept. The key was zeroed before this resolved, and
      // is derived again — with a fresh prompt — when money actually moves.
      setState({ status: "ready", address: await fn() });
    } catch (e) {
      const err = e as Error;
      // A dismissed passkey sheet is not a failure worth shouting about.
      const cancelled = err.name === "NotAllowedError";
      setState({
        status: "error",
        message: cancelled ? "" : err.message,
        recoverable: cancelled || err instanceof NoPrfError,
      });
      if (cancelled) setState({ status: "anonymous" });
    }
  };

  if (state.status === "ready") {
    return (
      <main className="wrap">
        <p className="eyebrow">Your account</p>
        <p className="address">{state.address}</p>
        <p className="note">
          Nothing was stored on this device, and no key is being held. Clear your
          browser data, open Iris somewhere else, and the same passkey brings you
          back here.
        </p>
        <button className="ghost" onClick={() => setState({ status: "anonymous" })}>
          Sign out
        </button>
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
        <button
          onClick={() => run(register)}
          disabled={state.status === "working"}
        >
          {state.status === "working" ? "Waiting…" : "Continue with Face ID"}
        </button>
        <button
          className="ghost"
          onClick={() => run(restore)}
          disabled={state.status === "working"}
        >
          I already have an account
        </button>
      </div>

      {state.status === "error" && state.message && (
        <p className={state.recoverable ? "hint" : "error"}>{state.message}</p>
      )}
    </main>
  );
}
