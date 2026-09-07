/**
 * The account layer: a passkey is the whole of it.
 *
 * Mera hands back authenticator-bound entropy and leaves derivation and storage
 * to us, so nothing here writes to disk. The account is rebuilt from the
 * passkey on every visit, which is what lets someone clear storage or open Iris
 * on a different device and still arrive at the same address.
 *
 * The key is never held longer than the work that needs it. Deriving it is a
 * touch of a finger, so there is no reason to keep a copy lying in memory
 * between actions: every entry point below zeroes its session on the way out,
 * including when the work it was opened for throws.
 *
 * What that leaves is a policy rather than a mechanism, and the policy is:
 *
 *   reading a balance or a history   no key at all
 *   moving money                     a fresh prompt, every time
 *   several steps of one flow        one session, with an expiry the UI shows
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
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { Address, LocalAccount } from "viem";

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

/** Thrown when a session is used after it expired or was closed. */
export class SessionClosedError extends Error {
  constructor() {
    super("Your signing session has expired. Confirm with Face ID to continue.");
    this.name = "SessionClosedError";
  }
}

const isPrfFailure = (e: unknown) => /PRF/i.test((e as Error)?.message ?? "");

// --------------------------------------------------------------- derivation

async function derive(mode: "register" | "restore"): Promise<Secp256k1SigningSession> {
  const salt = await prfSalt();
  if (mode === "restore") {
    try {
      const got = await getPasskeyPrfOutput({ rpId: relyingParty().id, prfSalt: salt });
      return createSecp256k1SigningSession({ privateKey: got.prfOutput });
    } catch (e) {
      if (isPrfFailure(e)) throw new NoPrfError();
      throw e;
    }
  }
  try {
    const created = await createPasskeyWithPrfOutput({
      rp: relyingParty(),
      user: { name: "iris", displayName: "Iris" },
      prfSalt: salt,
    });
    return createSecp256k1SigningSession({ privateKey: created.prfOutput });
  } catch (e) {
    // Some authenticators report PRF as unavailable at registration and then
    // evaluate it happily on an assertion. The passkey exists either way, so
    // ask for the output directly before declaring failure.
    if (!isPrfFailure(e)) throw e;
    try {
      return await derive("restore");
    } catch {
      throw new NoPrfError();
    }
  }
}

/** Derive, read the address, and zero the key before returning. */
async function addressOnly(mode: "register" | "restore"): Promise<Address> {
  const session = await derive(mode);
  try {
    return toViemAccount(session).address;
  } finally {
    session.end();
  }
}

// ------------------------------------------------------------- entry points

/** Create a passkey and return the address it derives. Holds no key after. */
export const register = () => addressOnly("register");

/** Rebuild the account from whatever passkey the platform offers. */
export const restore = () => addressOnly("restore");

/**
 * Run one piece of work that needs to sign, then zero the key.
 *
 * The account handed to `fn` stops working the moment this returns, so a stray
 * reference cannot be used later — Mera throws `SESSION_ENDED` on any signing
 * method after `end()`.
 */
export async function withSigner<T>(fn: (account: LocalAccount) => Promise<T>): Promise<T> {
  const session = await derive("restore");
  try {
    return await fn(toViemAccount(session));
  } finally {
    session.end();
  }
}

/**
 * A session for a flow with several steps, so the user is not asked for a
 * finger between each one.
 *
 * It closes itself when the time runs out. `expiresAt` is public precisely so
 * the interface can say when — a session that vanishes without warning is worse
 * than one that asks again.
 */
export class Session {
  readonly address: Address;
  readonly expiresAt: number;

  #session: Secp256k1SigningSession | undefined;
  #account: LocalAccount;
  #timer: ReturnType<typeof setTimeout>;

  private constructor(session: Secp256k1SigningSession, ttlMs: number) {
    this.#session = session;
    this.#account = toViemAccount(session);
    this.address = this.#account.address;
    this.expiresAt = Date.now() + ttlMs;
    this.#timer = setTimeout(() => this.close(), ttlMs);
  }

  static async open(ttlMs = 120_000): Promise<Session> {
    return new Session(await derive("restore"), ttlMs);
  }

  get open(): boolean {
    return this.#session !== undefined;
  }

  get remainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  /** The signer, while the session lasts. */
  use(): LocalAccount {
    if (!this.#session) throw new SessionClosedError();
    return this.#account;
  }

  /** Zero the key now. Safe to call twice. */
  close(): void {
    if (!this.#session) return;
    clearTimeout(this.#timer);
    this.#session.end();
    this.#session = undefined;
  }
}
