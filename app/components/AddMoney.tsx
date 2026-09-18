"use client";

/**
 * Where money comes from, before any of it can be set aside.
 *
 * Three real ways in, each named for what the person already has rather than
 * for the rail underneath:
 *
 *   a bank account     Agora's wire route: a US transfer with a reference
 *                      arrives here as AUSD. Needs Agora's API key, so it is
 *                      shown and explained, not faked.
 *   a wallet           AUSD sent straight to this account. Works today — the
 *                      screen watches the chain and says when it lands.
 *   another network    Aurora Intents, which delivers from other chains onto
 *                      Monad mainnet. Not on testnet, so the same honesty.
 *
 * And on this test version a fourth: skip, because the first payment is
 * covered by the demo. That one is labelled as what it is.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { renderSVG } from "uqr";
import { balanceOf, money } from "@/lib/iris";

type Way = "bank" | "wallet" | "network";

/** How often the wallet view looks for an arrival. Monad blocks are sub-second. */
const WATCH_MS = 3000;

function Wallet({ address, from, onArrived }: { address: Address; from: bigint; onArrived: (now: bigint) => void }) {
  const [copied, setCopied] = useState(false);
  const qr = useMemo(() => renderSVG(address, { border: 1 }), [address]);

  useEffect(() => {
    let live = true;
    const look = async () => {
      try {
        const now = await balanceOf(address);
        if (live && now > from) onArrived(now);
      } catch {
        // A missed look is fine; the next one is three seconds away.
      }
    };
    const timer = setInterval(look, WATCH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [address, from, onArrived]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be refused; the address is on screen to select by hand.
    }
  };

  return (
    <div className="deposit">
      <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code of your account address" />
      <p className="small muted">Send AUSD on Monad to</p>
      <p className="address">{address}</p>
      <div className="actions">
        <button className="ghost" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
      </div>
      <p className="watching small muted">
        <span className="pulse" aria-hidden /> Waiting for it to arrive. You can leave this screen open.
      </p>
    </div>
  );
}

export default function AddMoney({
  address,
  held,
  first,
  onBack,
}: {
  address: Address;
  held: bigint;
  /** True right after signing up, not a visit from home. */
  first: boolean;
  onBack: () => void;
}) {
  const [way, setWay] = useState<Way | undefined>();
  const [arrived, setArrived] = useState<bigint | undefined>();

  if (arrived !== undefined) {
    return (
      <main className="wrap">
        <p className="eyebrow">Added</p>
        <p className="balance">{money(arrived - held)}</p>
        <p className="lede">
          It is in your account{held > 0n ? ` — ${money(arrived)} in total` : ""}. Now set some
          aside for someone.
        </p>
        <div className="actions">
          <Link className="button" href="/send">Send money</Link>
          <button className="ghost" onClick={onBack}>Back to my account</button>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="topline">
        <p className="eyebrow">{first ? "One more thing · Add money" : "Add money"}</p>
        <button className="linkish" onClick={way ? () => setWay(undefined) : onBack}>
          {way ? "Other ways" : first ? "Later" : "Back"}
        </button>
      </header>

      {!way && (
        <>
          <h1 className="title">Where is the money now?</h1>
          <p className="lede">
            Iris keeps everything in digital dollars. Choose where yours are
            coming from.
          </p>

          <ul className="rows ways">
            <li className="row">
              <button className="rowbutton" onClick={() => setWay("bank")}>
                <span className="rowmain">
                  <strong>A bank account</strong>
                  <span className="muted small block">A transfer with a reference, arriving as dollars</span>
                </span>
                <span className="tag">Soon</span>
              </button>
            </li>
            <li className="row">
              <button className="rowbutton" onClick={() => setWay("wallet")}>
                <span className="rowmain">
                  <strong>A wallet</strong>
                  <span className="muted small block">AUSD you already hold, sent here</span>
                </span>
              </button>
            </li>
            <li className="row">
              <button className="rowbutton" onClick={() => setWay("network")}>
                <span className="rowmain">
                  <strong>Another network</strong>
                  <span className="muted small block">Dollars on another blockchain, brought over</span>
                </span>
                <span className="tag">Soon</span>
              </button>
            </li>
          </ul>

          {/* Only the test version has this, and it says so. The relayer tops
              up a sender who is short at the moment of the first payment —
              see the create action in app/api/relay/route.ts. */}
          <div className="demo">
            <p className="small muted">
              This is the test version, so your first payment is covered with
              demo dollars. Nothing real moves.
            </p>
            <Link className="button" href="/send">Try it with demo dollars</Link>
          </div>
        </>
      )}

      {way === "wallet" && (
        <>
          <h1 className="title">From a wallet</h1>
          <Wallet address={address} from={held} onArrived={setArrived} />
        </>
      )}

      {way === "bank" && (
        <>
          <h1 className="title">From a bank account</h1>
          <p className="lede">
            Agora, who issue the dollar Iris pays in, give each account its own
            bank details and a reference. A transfer that carries the reference
            becomes dollars here, one for one, without a card or an exchange.
          </p>
          <p className="note">
            We are waiting on access to Agora&apos;s test environment to switch
            this on. Until then, use a wallet or the demo dollars.
          </p>
        </>
      )}

      {way === "network" && (
        <>
          <h1 className="title">From another network</h1>
          <p className="lede">
            Aurora gives your account one address that accepts dollars from
            other blockchains and delivers them here — and sends them back if
            anything goes wrong on the way.
          </p>
          <p className="note">
            Aurora works on the live network only, not on this test version. It
            arrives with the live version of Iris.
          </p>
        </>
      )}
    </main>
  );
}
