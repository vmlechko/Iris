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

/**
 * Fixed salt: the same input must produce the same account, every time.
 *
 * Mera requires exactly 32 bytes, so the domain string is hashed rather than
 * used raw. Changing this string changes every address the app derives.
 */
const SALT_DOMAIN = "iris.account.v1";

let saltOnce: Promise<Uint8Array> | undefined;
const prfSalt = () =>
  (saltOnce ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(SALT_DOMAIN))
    .then((buf) => new Uint8Array(buf)));

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
      prfSalt: await prfSalt(),
    });
    log(`  credential ${created.credentialId}`);
    log(`  prf output ${created.prfOutput.length} bytes`);

    const { account } = await accountFromPrf(created.prfOutput);
    log(`  address    ${account.address}`);
    show(account.address, created.credentialId);
  } catch (e) {
    const message = (e as Error).message;
    log(`✗ ${message}`);

    // Some authenticators report prf as not enabled during registration even
    // though they will evaluate it on a later assertion. The passkey exists at
    // this point, so ask for the PRF output directly before giving up.
    if (!/PRF/i.test(message)) return;
    log("  registration did not report PRF — retrying as an assertion …");
    try {
      const got = await getPasskeyPrfOutput({ rpId: RP.id, prfSalt: await prfSalt() });
      log(`  credential ${got.credentialId}`);
      const { account } = await accountFromPrf(got.prfOutput);
      log(`  address    ${account.address}`);
      log("  PRF works on assertion — registration reporting was the only problem");
      show(account.address, got.credentialId);
    } catch (e2) {
      log(`✗ assertion also failed: ${(e2 as Error).message}`);
      log("  this authenticator has no PRF. Try another one:");
      log("  · Chrome → passkey prompt → “Use a different device” / iCloud Keychain");
      log("  · or a password manager that supports PRF (Bitwarden, 1Password)");
    }
  }
};

el<HTMLButtonElement>("signin").onclick = async () => {
  try {
    log("→ getPasskeyPrfOutput (rpId only, no stored credential) …");
    const got = await getPasskeyPrfOutput({ rpId: RP.id, prfSalt: await prfSalt() });
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

/**
 * Raw WebAuthn, bypassing Mera entirely.
 *
 * When Mera reports no PRF we need to know whether the browser and
 * authenticator support the extension at all, or whether something in our use
 * of the library is at fault. This calls navigator.credentials directly and
 * prints exactly what the platform hands back.
 */
el<HTMLButtonElement>("probe").onclick = async () => {
  const enc = new TextEncoder();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const salt = await prfSalt();

  log("→ raw navigator.credentials.create with prf extension …");
  log(`  platform authenticator available: ${await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()}`);
  if ("getClientCapabilities" in PublicKeyCredential) {
    const caps = await (PublicKeyCredential as any).getClientCapabilities();
    const prfCap = caps["extension:prf"];
    log(`  ► extension:prf = ${prfCap}   ← the answer`);
    log("  all client capabilities:");
    for (const [k, v] of Object.entries(caps).sort()) log(`    ${k.padEnd(28)} ${v}`);
  } else {
    log("  client capabilities: getClientCapabilities() not available");
  }

  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: RP,
        user: { id: enc.encode("iris-probe"), name: "iris-probe", displayName: "Iris probe" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        // Deliberately unconstrained. Pinning authenticatorAttachment to
        // "platform" on macOS Chrome steers the credential into the Chrome
        // profile store, which reports prf.enabled = false. Leaving the choice
        // open lets the full picker appear so iCloud Keychain — which does
        // support PRF from macOS 15 and Chrome 132 — can be selected.
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;

    const ext = cred.getClientExtensionResults() as any;
    log(`  credential id: ${cred.id}`);
    log(`  attachment:    ${cred.authenticatorAttachment ?? "unknown"}`);
    log(`  transports:    ${(cred.response as AuthenticatorAttestationResponse).getTransports?.().join(", ") ?? "n/a"}`);
    log(`  prf result:    ${JSON.stringify(ext.prf ?? null)}`);
    if (ext.prf?.results?.first) {
      log("  ✓ the platform returned PRF output directly — Mera should work here");
    } else if (ext.prf?.enabled) {
      log("  prf.enabled is true but no output at registration — evaluate it on an assertion");
    } else {
      log("  ✗ this authenticator did not enable PRF.");
      log("    On macOS Chrome the profile-bound store does not support PRF.");
      log("    Re-run and pick iCloud Keychain in the picker, or try Safari.");
    }
  } catch (e) {
    const err = e as Error;
    log(`✗ raw create failed [${err.name}]: ${err.message}`);
    if (err.name === "NotAllowedError") {
      log("  NotAllowedError means the ceremony was dismissed, timed out, or the");
      log("  platform refused it — it is not itself a statement about PRF.");
      log("  Complete the Touch ID prompt when it appears and run this again.");
    }
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
