"use client";

/**
 * "≈ ₦265,000" beside "$200" — the dollars are the promise, this is what it
 * means at home. Renders nothing until there is something true to show.
 */
import { useEffect, useState } from "react";
import { localRate, inLocal, type LocalRate } from "@/lib/fx";

export default function LocalAmount({ amount, detail = false }: { amount: bigint; detail?: boolean }) {
  const [local, setLocal] = useState<LocalRate | undefined>();

  useEffect(() => {
    let live = true;
    localRate().then((rate) => live && setLocal(rate));
    return () => {
      live = false;
    };
  }, []);

  if (!local) return null;

  if (!detail) return <span className="local inline">≈ {inLocal(amount, local)}</span>;

  return (
    <p className="local">
      ≈ {inLocal(amount, local)}{" "}
      <span className="small">
        {local.attested ? "at the rate Chainlink recorded on chain" : "at today's rate"}
      </span>
    </p>
  );
}
