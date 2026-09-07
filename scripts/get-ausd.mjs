/**
 * Draw testnet AUSD from Agora's faucet on Monad.
 *
 * The faucet is documented for Sepolia only, but the same contract is deployed
 * on Monad testnet and funded, so no whitelisting or support ticket is needed
 * to settle in the real asset.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const FAUCET = getAddress("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const account = privateKeyToAccount(process.env.SPONSOR_PK);
const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

const before = await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log("before:", formatUnits(before, 6), "AUSD");

const hash = await wallet.writeContract({
  address: FAUCET,
  abi: parseAbi(["function requestFunds(address)"]),
  functionName: "requestFunds",
  args: [account.address],
});
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log("tx:", hash, receipt.status);

const after = await pub.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log("after: ", formatUnits(after, 6), "AUSD");
