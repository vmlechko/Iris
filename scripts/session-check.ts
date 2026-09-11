/**
 * The sign-in session, without a passkey.
 *
 * Signing in now holds the account key for three minutes so the first send
 * does not ask for Face ID twice. That makes the session the one place a key
 * outlives a single action, so the properties that keep it narrow are worth
 * checking directly rather than trusting:
 *
 * - it closes itself when the time runs out;
 * - once closed it cannot be used — and neither can a reference to the
 *   account that someone kept from before, which is the case that would matter;
 * - closing twice is harmless, since sign-out, expiry and page-hide can race.
 *
 * WebAuthn cannot run here, so the session is built from an ordinary key. The
 * part under test is what Iris does with a key once it has one.
 *
 *     npx tsx scripts/session-check.ts
 */
import { Session, SessionClosedError } from "../lib/account";
import { createSecp256k1SigningSession } from "@category-labs/mera";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";

let checks = 0;
let failures = 0;
function check(what: string, ok: boolean, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  — ${detail}` : ""}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fresh = (ttlMs: number) =>
  Session.adopt(createSecp256k1SigningSession({ privateKey: hexToBytes(generatePrivateKey()) }), ttlMs);

async function main() {
  const key = generatePrivateKey();
  const session = Session.adopt(createSecp256k1SigningSession({ privateKey: hexToBytes(key) }), 60_000);

  console.log("\nWhile it is open");
  check("it is open", session.open);
  check("it signs as the account it was derived for", session.address === privateKeyToAccount(key).address);
  const kept = session.use();
  const signature = await kept.signMessage({ message: "iris" });
  check("it can sign", signature.length === 132);

  console.log("\nOnce it is closed");
  session.close();
  check("it reports closed", !session.open);
  let refused: unknown;
  try { session.use(); } catch (e) { refused = e; }
  check("use() refuses", refused instanceof SessionClosedError);
  let stale: unknown;
  try { await kept.signMessage({ message: "iris" }); } catch (e) { stale = e; }
  check("a reference kept from before cannot sign either", stale !== undefined,
    String((stale as Error)?.message ?? "").slice(0, 60));
  session.close();
  check("closing twice is harmless", !session.open);

  console.log("\nWhen the time runs out");
  const brief = fresh(80);
  check("a short session starts open", brief.open);
  await sleep(200);
  check("it closes itself", !brief.open);
  check("and reports no time left", brief.remainingMs === 0);

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
