/**
 * End to end on Monad testnet: a fresh account that holds no MON receives
 * AUSD, signs one ERC-3009 authorization, and a sponsor settles it through
 * Agora Instant Settlement. Then the ways a relayer could cheat.
 *
 *     npx tsx scripts/settle-check.ts
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { readFileSync } from "node:fs";
import { AUSD } from "../lib/chain";
import { DOMAIN, TYPES } from "../lib/authorize";

const SETTLE = (process.env.IRIS_SETTLE ?? "0x2583ced441aa350855426a329c8aad2bf28320a3") as Address;
const CTK = "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D" as Address;
const FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as Address;

const { abi } = JSON.parse(readFileSync("artifacts/contracts.json", "utf8")).IrisSettle;
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];

let passed = 0, failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  ok ? passed++ : failed++;
};

async function main() {
  const sponsor = privateKeyToAccount(process.env.SPONSOR_PK as Hex);
  const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account: sponsor, chain: monadTestnet, transport: http(rpc) });
  const person = privateKeyToAccount(generatePrivateKey());
  const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });

  // Stage: the person has AUSD, as a recipient does after a claim.
  const fund = await wallet.writeContract({
    address: FAUCET, abi: parseAbi(["function requestFunds(address)"]), functionName: "requestFunds", args: [person.address],
  });
  await pub.waitForTransactionReceipt({ hash: fund });
  const ausdBefore = await bal(AUSD, person.address);
  check(ausdBefore > 0n, `person holds ${ausdBefore} AUSD units and 0 MON`);

  const value = 200_000000n;
  const minOut = (await pub.readContract({ address: SETTLE, abi, functionName: "quote", args: [value] })) as bigint;
  const salt = generatePrivateKey() as Hex;
  const nonce = (await pub.readContract({ address: SETTLE, abi, functionName: "settlementNonce", args: [salt, minOut] })) as Hex;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await person.signTypedData({
    domain: { ...DOMAIN, chainId: monadTestnet.id, verifyingContract: AUSD },
    types: TYPES, primaryType: "ReceiveWithAuthorization",
    message: { from: person.address, to: SETTLE, value, validAfter: 0n, validBefore, nonce },
  });
  const args = (over: Partial<{ from: Address; value: bigint; minOut: bigint }> = {}) =>
    [over.from ?? person.address, over.value ?? value, 0n, validBefore, salt, over.minOut ?? minOut, signature] as const;

  const reverts = async (a: ReturnType<typeof args>) => {
    try { await pub.simulateContract({ account: sponsor, address: SETTLE, abi, functionName: "settle", args: a }); return false; }
    catch { return true; }
  };

  // What a dishonest relayer might try, before the real one.
  check(await reverts(args({ minOut: 0n })), "a relayer cannot lower the signed floor");
  check(await reverts(args({ value: value + 1n })), "a relayer cannot take more than was signed");
  check(await reverts(args({ from: sponsor.address })), "an authorization cannot be spent from someone else");

  const t0 = Date.now();
  const hash = await wallet.writeContract({ address: SETTLE, abi, functionName: "settle", args: args() });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  check(receipt.status === "success", `settled in one transaction, ${Date.now() - t0} ms (${hash})`);

  const ctk = await bal(CTK, person.address);
  check(ctk === minOut, `person received ${ctk} CTK units — the quote exactly`);
  check((await bal(AUSD, person.address)) === ausdBefore - value, "exactly 200 AUSD left the person");
  check((await bal(AUSD, SETTLE)) === 0n && (await bal(CTK, SETTLE)) === 0n, "the contract kept nothing");
  check((await pub.getBalance({ address: person.address })) === 0n, "the person still holds 0 MON");
  check(await reverts(args()), "the same authorization cannot be settled twice");

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e?.shortMessage ?? e?.message ?? e); process.exit(1); });
