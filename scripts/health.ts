/**
 * Is the live thing actually alive?
 *
 * Four moving parts hold Iris up, and three of them can fail quietly: a
 * deployment whose relayer key was never set, an Envio endpoint rotated out
 * from under us, a sponsor that has run out of gas. None of these break the
 * page loudly, which is exactly why they need asking about on purpose —
 * before a judge or a tester finds them.
 *
 *     npx tsx scripts/health.ts [url]
 */
import { createPublicClient, http, parseAbi, formatEther, type Address } from "viem";
import { monadTestnet } from "viem/chains";
import { IRIS } from "../lib/iris";
import { SETTLE } from "../lib/settle";

const SITE = process.argv[2] ?? "https://iris-eta-kohl.vercel.app";
const pub = createPublicClient({ chain: monadTestnet, transport: http() });

let bad = 0;
const ok = (good: boolean, what: string) => { console.log(`${good ? "✓" : "✗"} ${what}`); if (!good) bad++; };

/** The indexer the deployed bundle actually points at — not the one in our tree. */
async function indexerOfSite(): Promise<string | undefined> {
  const page = await fetch(SITE).then((r) => r.text()).catch(() => "");
  for (const path of [...new Set(page.match(/\/_next\/static\/chunks\/[^"]+\.js/g) ?? [])]) {
    const js = await fetch(`${SITE}${path}`).then((r) => r.text()).catch(() => "");
    const found = js.match(/https:\/\/indexer[^"']+graphql/)?.[0];
    if (found) return found;
  }
}

async function main() {
  console.log(`${SITE}\n`);

  ok((await fetch(SITE).then((r) => r.status).catch(() => 0)) === 200, "the page is served");

  // An unknown action is the cheapest way to ask "is the relayer configured?"
  // without spending anything: 400 means it got as far as reading the request.
  const relay = await fetch(`${SITE}/api/relay`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "?" }),
  }).then(async (r) => ({ status: r.status, body: await r.json() })).catch(() => undefined);
  ok(relay?.status === 400, `the relayer answers for itself${relay && relay.status !== 400 ? ` — ${relay.body?.error ?? relay.status}` : ""}`);

  const sponsor = process.env.SPONSOR_ADDRESS as Address | undefined;
  if (sponsor) {
    const gas = await pub.getBalance({ address: sponsor });
    ok(gas > 0n, `the sponsor holds ${formatEther(gas)} MON`);
  }

  const onChain = (await pub.readContract({
    address: IRIS, abi: parseAbi(["function count() view returns (uint256)"]), functionName: "count",
  })) as bigint;
  ok(onChain > 0n, `Iris has ${onChain} commitments on chain`);

  const approved = await pub.readContract({
    address: "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae",
    abi: parseAbi(["function hasRole(string,address) view returns (bool)"]),
    functionName: "hasRole", args: ["APPROVED_SWAPPER", SETTLE],
  });
  ok(approved === true, "Agora still lets IrisSettle swap");

  const endpoint = await indexerOfSite();
  ok(!!endpoint, `the deployed app points at ${endpoint ?? "no indexer at all"}`);
  if (endpoint) {
    const rows = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ Commitment(limit: 1000) { id } }" }),
    }).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
    const known = rows?.data?.Commitment?.length;
    ok(known !== undefined, "that indexer answers");
    // Behind by one or two is a sync in progress; behind by more is a rotated
    // endpoint still serving an older deployment's data.
    if (known !== undefined) {
      ok(BigInt(known) + 2n >= onChain, `and has ${known} of ${onChain} commitments`);
    }
  }

  console.log(bad === 0 ? "\nall good" : `\n${bad} thing(s) need attention`);
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e?.shortMessage ?? e?.message ?? e); process.exit(1); });
