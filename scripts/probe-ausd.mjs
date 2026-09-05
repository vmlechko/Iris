import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { monadTestnet } from "viem/chains";

const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
const c = createPublicClient({ chain: monadTestnet, transport: http() });

const abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function authorizationState(address,bytes32) view returns (bool)",
  "function nonces(address) view returns (uint256)",
]);

const code = await c.getCode({ address: AUSD });
console.log("bytecode present:", !!code && code !== "0x", code ? `(${(code.length - 2) / 2} bytes)` : "");

for (const [fn, args] of [
  ["name", []], ["symbol", []], ["decimals", []], ["totalSupply", []],
  ["DOMAIN_SEPARATOR", []],
  ["nonces", ["0x0000000000000000000000000000000000000001"]],
  ["authorizationState", ["0x0000000000000000000000000000000000000001", "0x" + "00".repeat(32)]],
]) {
  try {
    const v = await c.readContract({ address: AUSD, abi, functionName: fn, args });
    console.log(`${fn.padEnd(20)} ✓  ${v}`);
  } catch (e) {
    console.log(`${fn.padEnd(20)} ✗  not present / reverted`);
  }
}
