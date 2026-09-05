/**
 * Spike: the Mera bounty's "stateless test".
 *
 * Judges clear local storage or open the app on a fresh device mid-demo, and
 * identity has to reconstruct from the passkey alone. Mera hands us
 * authenticator-bound entropy and leaves derivation and storage to us, so the
 * question is whether we can hold zero state and still land on the same address.
 *
 * The answer hinges on `getPasskeyPrfOutput` accepting only an `rpId`: with no
 * stored credential id the platform picks the passkey, and the same PRF salt
 * yields the same 32 bytes, hence the same key and the same address.
 */
import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  createSecp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";

/** Fixed salt: the same input must produce the same account, every time. */
const PRF_SALT = new TextEncoder().encode("iris.account.v1");

const RP = { id: location.hostname, name: "Iris" };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = (msg: string) => {
  el("log").textContent += `${msg}\n`;
};

/** Addresses seen so far, to tell whether a re-entry rebuilt the same account. */
const seen = new Set<string>();

function storageSummary() {
  const keys = Object.keys(localStorage);
  return keys.length === 0 ? "empty" : `${keys.length} key(s): ${keys.join(", ")}`;
}

function show(address: string, credentialId: string) {
  el("address").textContent = address;
  el("credential").textContent = credentialId;
  el("storage").textContent = storageSummary();
  el("account").hidden = false;

  seen.add(address);
  const verdict = el("verdict");
  if (seen.size === 1) {
    verdict.hidden = true;
    return;
  }
  verdict.hidden = false;
  verdict.className = "fail";
  verdict.textContent =
    `Two different addresses from the same passkey — derivation is not stable (${seen.size} seen).`;
}

function passed(address: string) {
  const verdict = el("verdict");
  verdict.hidden = false;
  verdict.className = "pass";
  verdict.textContent = `Same address rebuilt with nothing stored — ${address}`;
}

async function accountFromPrf(prfOutput: Uint8Array) {
  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  return { account: toViemAccount(session), session };
}

el<HTMLButtonElement>("create").onclick = async () => {
  try {
    log("→ createPasskeyWithPrfOutput …");
    const created = await createPasskeyWithPrfOutput({
      rp: RP,
      user: { name: "iris-demo", displayName: "Iris demo" },
      prfSalt: PRF_SALT,
    });
    log(`  credential ${created.credentialId}`);
    log(`  prf output ${created.prfOutput.length} bytes`);

    const { account } = await accountFromPrf(created.prfOutput);
    log(`  address    ${account.address}`);
    show(account.address, created.credentialId);
  } catch (e) {
    log(`✗ ${(e as Error).message}`);
  }
};

el<HTMLButtonElement>("signin").onclick = async () => {
  try {
    log("→ getPasskeyPrfOutput (rpId only, no stored credential) …");
    const got = await getPasskeyPrfOutput({ rpId: RP.id, prfSalt: PRF_SALT });
    log(`  credential ${got.credentialId}`);

    const { account } = await accountFromPrf(got.prfOutput);
    log(`  address    ${account.address}`);

    const rebuilt = seen.has(account.address);
    show(account.address, got.credentialId);
    if (rebuilt && seen.size === 1) passed(account.address);
  } catch (e) {
    log(`✗ ${(e as Error).message}`);
  }
};

el<HTMLButtonElement>("wipe").onclick = () => {
  localStorage.clear();
  sessionStorage.clear();
  el("storage").textContent = storageSummary();
  log("→ wiped localStorage and sessionStorage");
  log("  now press “Sign in with passkey” — the address must come back identical");
};

log(`rpId ${RP.id}`);
log(`storage ${storageSummary()}`);
log("");
