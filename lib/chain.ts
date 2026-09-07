import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "viem/chains";

/** Agora's AUSD on Monad testnet. Verified on chain: 6 decimals, ERC-3009. */
export const AUSD: Address = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export const AUSD_DECIMALS = 6;

export const chain = monadTestnet;

export const publicClient = createPublicClient({
  chain,
  transport: http(process.env.NEXT_PUBLIC_MONAD_RPC_URL),
});

export const explorerTx = (hash: string) =>
  `${chain.blockExplorers.default.url}/tx/${hash}`;
