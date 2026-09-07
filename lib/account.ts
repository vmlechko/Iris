/**
 * The account layer: a passkey is the whole of it.
 *
 * Mera hands back authenticator-bound entropy and leaves derivation and storage
 * to us, so nothing here writes to disk. The account is rebuilt from the
 * passkey on every visit, which is what lets someone clear storage or open the
 * app on a different device and still arrive at the same address.
 *
 * Measured support: PRF works through iCloud Keychain in both Safari and
 * Chrome, and does not work in Chrome's own profile store. Pinning
 * `authenticatorAttachment` steers macOS Chrome into that profile store, so we
 * never do — see README.
 */
import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  createSecp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";

/**
 * Domain string behind the PRF salt. Mera requires exactly 32 bytes, so this is
 * hashed rather than used raw. Changing it changes every address Iris derives.
 */
const SALT_DOMAIN = "iris.account.v1";

let saltOnce: Promise<Uint8Array> | undefined;
const prfSalt = () =>
  (saltOnce ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(SALT_DOMAIN))
    .then((buf) => new Uint8Array(buf)));

const relyingParty = () => ({ id: location.hostname, name: "Iris" });

/** Thrown when the authenticator produced a passkey that cannot derive a key. */
export class NoPrfError extends Error {
  constructor() {
    super(
      "This passkey cannot secure an Iris account. Choose iCloud Keychain when " +
        "your browser asks where to save it, or open Iris in Safari."
    );
    this.name = "NoPrfError";
  }
}

const isPrfFailure = (e: unknown) => /PRF/i.test((e as Error)?.message ?? "");

async function accountFrom(prfOutput: Uint8Array): Promise<LocalAccount> {
  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  return toViemAccount(session);
}

/** Create a passkey and the account it derives. One prompt, no seed phrase. */
export async function createAccount(): Promise<LocalAccount> {
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: relyingParty(),
      user: { name: "iris", displayName: "Iris" },
      prfSalt: await prfSalt(),
    });
    return accountFrom(created.prfOutput);
  } catch (e) {
    // Some authenticators report PRF as unavailable at registration and then
    // evaluate it happily on an assertion. The passkey exists either way, so
    // ask for the output directly before declaring failure.
    if (!isPrfFailure(e)) throw e;
    try {
      return await restoreAccount();
    } catch {
      throw new NoPrfError();
    }
  }
}

/**
 * Rebuild the account from whatever passkey the platform offers.
 *
 * No credential id is passed: the platform presents the choice, and the fixed
 * salt guarantees the same passkey lands on the same address. This is the whole
 * of the "stateless" story — there is no local state to lose.
 */
export async function restoreAccount(): Promise<LocalAccount> {
  try {
    const got = await getPasskeyPrfOutput({
      rpId: relyingParty().id,
      prfSalt: await prfSalt(),
    });
    return accountFrom(got.prfOutput);
  } catch (e) {
    if (isPrfFailure(e)) throw new NoPrfError();
    throw e;
  }
}
