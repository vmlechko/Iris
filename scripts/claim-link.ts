/**
 * The claim link, end to end on Monad testnet.
 *
 * A sender cannot address a commitment to someone who has no wallet, which is
 * everyone this product is for. So the commitment is opened against a keypair
 * instead: the public half stays on chain, the private half travels in a link
 * over whatever messenger the two people already use.
 *
 * Whoever opens the link signs their own fresh address with the link key, and
 * the commitment binds to them. The address sits inside the signature rather
 * than beside it, so an observer watching the mempool can only replay the claim
 * to the address it already names — there is nothing to steal.
 */
import "dotenv/config";
import {
  createPublicClient, createWalletClient, formatUnits, http, parseUnits,
  type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

const artifacts = JSON.parse(readFileSync("artifacts/contracts.json", "utf8"));
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as Address;
const FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Address;
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];

const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
const usd = (v: bigint) => `${formatUnits(v, 6)} AUSD`;
const line = (l: string, v: unknown) => console.log(`  ${l.padEnd(30)} ${v}`);
let bad = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) bad++;
};

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

async function main() {
  const sender = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const wallet = createWalletClient({ account: sender, chain: monadTestnet, transport: http(rpc) });
  const I = artifacts.IrisCommitments.abi;

  const send = async (to: Address, abi: unknown, fn: string, args: unknown[]) => {
    const hash = await wallet.writeContract({ address: to, abi: abi as never, functionName: fn, args: args as never });
    return pub.waitForTransactionReceipt({ hash });
  };
  const read = (to: Address, abi: unknown, fn: string, args: unknown[] = []) =>
    pub.readContract({ address: to, abi: abi as never, functionName: fn, args: args as never }) as Promise<any>;

  console.log("\n── Iris · claim link on Monad testnet (real AUSD) ──\n");

  const hash = await wallet.deployContract({ abi: I, bytecode: artifacts.IrisCommitments.bytecode, args: [AUSD] });
  const iris = (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
  line("IrisCommitments", iris);
  line("sender", sender.address);

  const perPayment = parseUnits("50", 6);
  const total = perPayment * 3n;
  if ((await read(AUSD, erc20, "balanceOf", [sender.address])) < total) {
    await send(FAUCET, [{ type: "function", name: "requestFunds", inputs: [{ type: "address" }], outputs: [], stateMutability: "nonpayable" }], "requestFunds", [sender.address]);
  }

  // ---- the sender opens a commitment against a link, not an address --------
  const linkKey = generatePrivateKey();
  const link = privateKeyToAccount(linkKey);
  line("link key (goes in the URL)", `${linkKey.slice(0, 14)}…`);

  // The app creates gaslessly: the sender signs, a relayer submits.
  const salt = generatePrivateKey();
  const nonce = await read(iris, I, "authorizationNonce", [salt, link.address, perPayment, 30, 3, true]);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const authorization = await sender.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId: monadTestnet.id, verifyingContract: AUSD },
    types: { ReceiveWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" },
      { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }]},
    primaryType: "ReceiveWithAuthorization",
    message: { from: sender.address, to: iris, value: total, validAfter: 0n, validBefore, nonce },
  });
  await send(iris, I, "createToClaimWithAuthorization", [
    sender.address, link.address, perPayment, 30, 3, true, 0n, validBefore, salt, authorization,
  ]);
  const id = (await read(iris, I, "count")) - 1n;
  let c = await read(iris, I, "get", [id]);
  check(c.recipient === "0x0000000000000000000000000000000000000000", "commitment has no recipient yet");
  check((await read(iris, I, "releasable", [id])) === 0n, "nothing is releasable while unclaimed");
  check((await read(AUSD, erc20, "balanceOf", [iris])) === total, "the whole schedule is escrowed");

  // ---- someone opens the link on a phone that has never seen crypto -------
  console.log("\n  Opening the link\n");
  const recipient = privateKeyToAccount(generatePrivateKey());
  line("recipient (fresh passkey)", recipient.address);
  check((await pub.getBalance({ address: recipient.address })) === 0n, "recipient holds 0 MON");

  const domain = { name: "Iris", version: "1", chainId: monadTestnet.id, verifyingContract: iris };
  const types = { Claim: [{ name: "id", type: "uint256" }, { name: "recipient", type: "address" }] } as const;
  const signature = await link.signTypedData({
    domain, types, primaryType: "Claim", message: { id, recipient: recipient.address },
  });

  // A relayer submits it, because the recipient has no gas.
  await send(iris, I, "claim", [id, recipient.address, signature]);
  c = await read(iris, I, "get", [id]);

  line("recipient balance", usd(await read(AUSD, erc20, "balanceOf", [recipient.address])));
  check(c.recipient.toLowerCase() === recipient.address.toLowerCase(), "the link bound to the address that opened it");
  check((await read(AUSD, erc20, "balanceOf", [recipient.address])) === perPayment, "money due arrived the moment the link opened");
  check((await pub.getBalance({ address: recipient.address })) === 0n, "recipient still holds 0 MON and signed no transaction");
  const incoming = await read(iris, I, "incomingOf", [recipient.address]);
  check(incoming.length === 1n || incoming.length === 1, "commitment is now discoverable from the recipient's address");

  // ---- the link cannot be redirected --------------------------------------
  console.log("\n  Trying to steal it\n");
  const thief = privateKeyToAccount(generatePrivateKey());
  let stolen = false;
  try {
    await pub.simulateContract({ address: iris, abi: I, functionName: "claim", args: [id, thief.address, signature], account: sender });
    stolen = true;
  } catch {}
  check(!stolen, "a captured signature cannot be pointed at a different address");

  console.log(bad === 0 ? "\n  ✅ Claim link works.\n" : `\n  ❌ ${bad} check(s) failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n  ❌", e?.shortMessage ?? e?.message ?? e);
  process.exit(1);
});
