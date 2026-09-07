import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { monadTestnet } from "viem/chains";
const c = createPublicClient({ chain: monadTestnet, transport: http() });
const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
try {
  const d = await c.readContract({
    address: AUSD,
    abi: parseAbi(["function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])"]),
    functionName: "eip712Domain",
  });
  console.log("EIP-5267 домен:");
  console.log("  name           ", d[1]);
  console.log("  version        ", d[2]);
  console.log("  chainId        ", d[3]);
  console.log("  verifyingContract", d[4]);
} catch (e) {
  console.log("eip712Domain() отсутствует:", (e.shortMessage ?? e.message).split("\n")[0]);
}
