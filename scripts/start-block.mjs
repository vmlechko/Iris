/**
 * Which block should the indexer start from?
 *
 * We never recorded the deployment block, and we cannot recover it the obvious
 * way: the public RPC prunes historical state, so `eth_getCode` at an old block
 * fails outright. Block headers survive, though, so we bisect on timestamps and
 * take the first block at or after a date we know precedes the deployment.
 *
 * A start block that is a little too early costs a few seconds of sync. One
 * that is too late silently loses commitments, so we err backwards.
 *
 *     node scripts/start-block.mjs 2026-09-04
 */
const RPC = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function timestampOf(block) {
  const header = await rpc("eth_getBlockByNumber", [`0x${block.toString(16)}`, false]);
  return header ? BigInt(header.timestamp) : null;
}

const date = process.argv[2] ?? "2026-09-04";
const target = BigInt(Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000));
if (Number.isNaN(Number(target))) {
  console.error(`not a date: ${date}`);
  process.exit(1);
}

const latest = BigInt(await rpc("eth_blockNumber", []));

let low = 1n;
let high = latest;
while (low < high) {
  const mid = (low + high) / 2n;
  const timestamp = await timestampOf(mid);
  if (timestamp === null) {
    low = mid + 1n;
    continue;
  }
  if (timestamp >= target) high = mid;
  else low = mid + 1n;
}

const found = await timestampOf(low);
console.log(`start_block  ${low}`);
console.log(`its time     ${new Date(Number(found) * 1000).toISOString()}`);
console.log(`latest       ${latest}`);
