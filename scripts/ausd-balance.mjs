import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
const pk = readFileSync(".env","utf8").match(/SPONSOR_PK=(0x[0-9a-fA-F]{64})/)[1];
const acc = privateKeyToAccount(pk);
const c = createPublicClient({ chain: monadTestnet, transport: http() });
const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const bal = await c.readContract({
  address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  abi, functionName: "balanceOf", args: [acc.address],
});
console.log("адрес :", acc.address);
console.log("AUSD  :", formatUnits(bal, 6));
