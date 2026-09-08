"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { withSigner } from "@/lib/account";
import { authorizeCommitment } from "@/lib/authorize";
import { relay } from "@/lib/relay";
import { publicClient, AUSD } from "@/lib/chain";
import { CADENCES, IRIS, irisAbi, fromAusd, money } from "@/lib/iris";
import type { Address } from "viem";
import { addressOfKey, buildClaimUrl } from "@/lib/link";
import Steps from "@/app/components/Steps";

type Done = { url: string; hash: string };

/** The real sequence, named. The middle one covers a top-up when one is needed. */
const SENDING = ["Approving with Face ID", "Setting the money aside", "Making the link"] as const;

export default function Send() {
  const [amount, setAmount] = useState("200");
  const [cadence, setCadence] = useState<number>(CADENCES[1].seconds);
  const [count, setCount] = useState(6);
  // Lengths match the contract's caps, so nobody types a sentence the chain
  // will refuse after they have already touched a finger to it.
  const [from, setFrom] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which named step the person is watching. -1 while nothing is running. */
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | undefined>();
  /**
   * Make sure there is enough to set aside, without saying so.
   *
   * On a testnet the balance is a stage prop, and asking someone to visit a
   * faucet before they can send money is the loudest crypto tell there is. So
   * this happens inside the one action the person actually asked for. On
   * mainnet it simply would not exist: the money would be theirs already.
   */
  async function ensureFunds(who: Address, needed: bigint) {
    const read = () =>
      publicClient.readContract({
        address: AUSD,
        abi: [{ type: "function", name: "balanceOf", stateMutability: "view",
                inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
        functionName: "balanceOf",
        args: [who],
      }) as Promise<bigint>;

    if ((await read()) >= needed) return;
    await relay({ action: "fund", to: who });
    await read();
  }

  const per = useMemo(() => {
    try {
      return fromAusd(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);
  const total = per * BigInt(count);
  const valid = per > 0n && count > 0;

  async function create() {
    setBusy(true);
    setStep(0);
    setError("");
    try {
      // The link's key never touches the network. It is generated here, its
      // address is what goes on chain, and the key itself only ever appears
      // after the hash in a URL.
      const key = generatePrivateKey() as Hex;
      const claimSigner = addressOfKey(key);
      const note = { from: from.trim(), about: about.trim() };
      const schedule = {
        claimSigner,
        amountPerPayment: per,
        interval: cadence,
        paymentsTotal: count,
        startNow: true,
        note,
      };

      const { hash } = await withSigner(async (account) => {
        setStep(1);
        await ensureFunds(account.address, per * BigInt(count));
        const auth = await authorizeCommitment(account, schedule);
        return relay({
          action: "create",
          from: account.address,
          claimSigner,
          amountPerPayment: per.toString(),
          interval: String(cadence),
          paymentsTotal: String(count),
          startNow: true,
          validBefore: auth.validBefore.toString(),
          salt: auth.salt,
          signature: auth.signature,
          note,
        });
      });

      setStep(2);
      const id =
        ((await publicClient.readContract({
          address: IRIS,
          abi: irisAbi,
          functionName: "count",
        })) as bigint) - 1n;

      setDone({ url: buildClaimUrl(location.origin, id, key), hash });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStep(-1);
    }
  }

  if (done) {
    return (
      <main className="wrap">
        <p className="eyebrow">Ready to send</p>
        <h1>
          Send this link to <em>them</em>.
        </h1>
        <p className="lede">
          Opening it is all they have to do. No app, no account, no wallet — the
          first {money(per)} arrives the moment they tap.
        </p>

        <div className="linkbox">
          <code>{done.url}</code>
        </div>

        <div className="actions">
          <button
            onClick={() => {
              if (navigator.share) navigator.share({ url: done.url, title: "Iris" });
              else navigator.clipboard.writeText(done.url);
            }}
          >
            Share the link
          </button>
        </div>

        <Link className="quiet" href="/">
          Done
        </Link>

        <p className="note">
          The key that unlocks this money is in the link itself, after the “#”.
          Anyone who opens it can receive, so send it the way you would send
          anything private.
        </p>
      </main>
    );
  }

  return (
    <main className="wrap">
      <p className="eyebrow">New commitment</p>

      <h1 className="sentence">
        Set aside{" "}
        <span className="edit">
          <span aria-hidden>$</span>
          <input
            inputMode="decimal"
            value={amount}
            style={{ width: `${Math.max(1, amount.length)}ch` }}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Amount of each payment"
          />
        </span>{" "}
        for someone,{" "}
        <em>arriving</em>{" "}
        <span className="edit">
          <select
            value={cadence}
            onChange={(e) => setCadence(Number(e.target.value))}
            aria-label="How often"
          >
            {CADENCES.map((c) => (
              <option key={c.seconds} value={c.seconds}>
                {c.label}
              </option>
            ))}
          </select>
        </span>{" "}
        <span className="edit">
          <input
            inputMode="numeric"
            value={count}
            style={{ width: `${String(count).length}ch` }}
            onChange={(e) => setCount(Math.min(600, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))}
            aria-label="How many payments"
          />
        </span>{" "}
        times.
      </h1>

      <p className="sentence aside">
        They will see it comes from{" "}
        <span className="nowrap">
        <span className="edit">
          <input
            value={from}
            maxLength={32}
            placeholder="you"
            size={Math.max(3, from.length || 3)}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Who it is from"
          />
        </span>
        ,
        </span>{" "}
        for{" "}
        <span className="edit">
          <input
            value={about}
            maxLength={64}
            placeholder="anything"
            size={Math.max(8, about.length || 8)}
            onChange={(e) => setAbout(e.target.value)}
            aria-label="What it is for"
          />
          <span aria-hidden>.</span>
        </span>
      </p>

      <p className="note">
        Both are optional, and both are public forever — they travel with the
        commitment so the person receiving it knows what arrived and why.
      </p>

      <p className="lede">
        {money(per)} lands today. <strong>{money(total)}</strong> is set aside
        now, so every payment after it is already paid for.
      </p>

      <div className="actions">
        <button
          onClick={create}
          disabled={!valid || busy}
        >
          {busy ? "Setting it aside…" : "Set it aside with Face ID"}
        </button>
        {busy && <Steps steps={SENDING} current={step} />}
      </div>

      <Link className="quiet" href="/">
        Cancel
      </Link>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
