"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { restore, withSigner } from "@/lib/account";
import { authorizeCommitment } from "@/lib/authorize";
import { relay } from "@/lib/relay";
import { publicClient, AUSD, AUSD_DECIMALS } from "@/lib/chain";
import { CADENCES, IRIS, irisAbi, fromAusd, money } from "@/lib/iris";
import { formatUnits, type Address } from "viem";
import { addressOfKey, buildClaimUrl } from "@/lib/link";

type Done = { url: string; hash: string };

export default function Send() {
  const [amount, setAmount] = useState("200");
  const [cadence, setCadence] = useState<number>(CADENCES[1].seconds);
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | undefined>();
  const [balance, setBalance] = useState<bigint | undefined>();
  const [address, setAddress] = useState<Address | undefined>();

  // Reading a balance needs no key, so the address is derived once and the
  // signing session is closed before this resolves.
  useEffect(() => {
    restore()
      .then(async (a) => {
        setAddress(a);
        setBalance(
          (await publicClient.readContract({
            address: AUSD,
            abi: [{ type: "function", name: "balanceOf", stateMutability: "view",
                    inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
            functionName: "balanceOf",
            args: [a],
          })) as bigint
        );
      })
      .catch(() => {});
  }, []);

  async function topUp() {
    if (!address) return;
    setBusy(true);
    setError("");
    try {
      await relay({ action: "fund", to: address });
      setBalance(
        (await publicClient.readContract({
          address: AUSD,
          abi: [{ type: "function", name: "balanceOf", stateMutability: "view",
                  inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
          functionName: "balanceOf",
          args: [address],
        })) as bigint
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
  const cadenceLabel = CADENCES.find((c) => c.seconds === cadence)?.label ?? "";

  async function create() {
    setBusy(true);
    setError("");
    try {
      // The link's key never touches the network. It is generated here, its
      // address is what goes on chain, and the key itself only ever appears
      // after the hash in a URL.
      const key = generatePrivateKey() as Hex;
      const claimSigner = addressOfKey(key);
      const schedule = {
        claimSigner,
        amountPerPayment: per,
        interval: cadence,
        paymentsTotal: count,
        startNow: true,
      };

      const { hash } = await withSigner(async (account) => {
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
        });
      });

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
          <Link className="ghost button" href="/">
            Done
          </Link>
        </div>

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
      <h1>
        How much, <em>how often</em>?
      </h1>

      <label className="field">
        <span>They receive</span>
        <div className="amount">
          <span aria-hidden>$</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            aria-label="Amount of each payment"
          />
        </div>
      </label>

      <div className="segmented" role="group" aria-label="How often">
        {CADENCES.map((c) => (
          <button
            key={c.seconds}
            type="button"
            className={c.seconds === cadence ? "on" : ""}
            onClick={() => setCadence(c.seconds)}
          >
            {c.label.replace("every ", "")}
          </button>
        ))}
      </div>

      <label className="field">
        <span>How many times</span>
        <div className="stepper">
          <button type="button" onClick={() => setCount((n) => Math.max(1, n - 1))} aria-label="Fewer">
            −
          </button>
          <strong>{count}</strong>
          <button type="button" onClick={() => setCount((n) => Math.min(600, n + 1))} aria-label="More">
            +
          </button>
        </div>
      </label>

      <p className="summary">
        {money(per)} lands today, then {money(per)} {cadenceLabel}.
        <br />
        <strong>{money(total)}</strong> is set aside now, so every one of those is
        already paid for.
      </p>

      {balance !== undefined && balance < total && (
        <p className="note">
          You hold {formatUnits(balance, AUSD_DECIMALS)} AUSD, and this needs{" "}
          {money(total)}.{" "}
          <button className="linkish" onClick={topUp} disabled={busy}>
            Get test AUSD
          </button>{" "}
          — this is a testnet, so the money is not real.
        </p>
      )}

      <div className="actions">
        <button onClick={create} disabled={!valid || busy || (balance !== undefined && balance < total)}>
          {busy ? "Confirming…" : "Set it aside with Face ID"}
        </button>
        <Link className="ghost button" href="/">
          Cancel
        </Link>
      </div>

      {error && <p className="error">{error}</p>}
    </main>
  );
}
