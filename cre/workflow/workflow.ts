/**
 * The Iris scheduler, as a Chainlink CRE workflow.
 *
 * A commitment says when the next payment is due; something still has to push
 * it. Running that from our own server would put the product's central promise
 * behind an uptime guarantee nobody outside can verify — the recipient would be
 * trusting us again, which is the thing the escrow was meant to remove.
 *
 * So the schedule runs here. On each tick the workflow asks Iris which
 * commitments have come due, fetches the day's exchange rate for the
 * recipient's currency, and delivers both to IrisScheduler in one signed
 * report. Two capabilities meet in one place: chain state and an outside data
 * source, which is what an orchestration layer is for.
 *
 * The rate is not decoration. What a recipient cares about is the number in
 * their own currency, and recording the rate at the moment of settlement makes
 * that figure checkable afterwards rather than something the interface drew.
 *
 * Releasing on Iris is permissionless, so nothing here holds power over
 * anyone's money. If this workflow stops, payments are pushed by whoever wants
 * them pushed — the recipient included.
 */
import {
  cre,
  getNetwork,
  median,
  ConsensusAggregationByFields,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  prepareReportRequest,
  LAST_FINALIZED_BLOCK_NUMBER,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbiParameters,
  stringToHex,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";

export const configSchema = z.object({
  schedule: z.string(),
  /** Exchange-rate source. Must return { rates: { [code]: number } }. */
  rateUrl: z.string(),
  /** ISO code of the currency the recipient thinks in. */
  quoteCurrency: z.string().length(3),
  evms: z.array(
    z.object({
      chainSelectorName: z.string(),
      irisAddress: z.string(),
      schedulerAddress: z.string(),
      /** How many commitments to examine per tick. */
      scanLimit: z.number().int().positive(),
      gasLimit: z.string(),
    })
  ),
});
type Config = z.infer<typeof configSchema>;

const DUE_BATCH = [
  {
    type: "function",
    name: "dueBatch",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "uint256[]" }, { type: "uint256" }],
  },
] as const;

type Rate = { rate: number };

/**
 * Fetch the rate off-chain. Every node runs this and the results are reduced
 * by median, so one source misbehaving cannot move the number that gets
 * written.
 */
const fetchRate = (sendRequester: HTTPSendRequester, config: Config): Rate => {
  const response = sendRequester
    .sendRequest({ method: "GET", url: config.rateUrl })
    .result();

  if (response.statusCode !== 200) {
    throw new Error(`rate request failed: ${response.statusCode}`);
  }

  const body = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  const rate = body?.rates?.[config.quoteCurrency];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`no usable rate for ${config.quoteCurrency}`);
  }
  return { rate };
};

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const evm = runtime.config.evms[0];

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: evm.chainSelectorName,
    isTestnet: true,
  });
  if (!network) throw new Error(`unknown network: ${evm.chainSelectorName}`);

  const client = new cre.capabilities.EVMClient(network.chainSelector.selector);

  // 1. Which commitments have come due? One call, not one per commitment.
  const callData = encodeFunctionData({
    abi: DUE_BATCH,
    functionName: "dueBatch",
    args: [0n, BigInt(evm.scanLimit)],
  });
  const raw = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: evm.irisAddress as Address,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const [ids, examined] = decodeFunctionResult({
    abi: DUE_BATCH,
    functionName: "dueBatch",
    data: bytesToHex(raw.data),
  }) as [readonly bigint[], bigint];

  runtime.log(`examined ${examined} commitments, ${ids.length} due`);

  if (ids.length === 0) {
    return "nothing due";
  }

  // 2. What is a dollar worth to the person receiving it today?
  const http = new cre.capabilities.HTTPClient();
  const { rate } = http
    .sendRequest(runtime, fetchRate, ConsensusAggregationByFields<Rate>({ rate: median }))(
      runtime.config
    )
    .result();

  // Six decimals, matching how AUSD counts.
  const scaledRate = BigInt(Math.round(rate * 1_000_000));
  runtime.log(`1 USD = ${rate} ${runtime.config.quoteCurrency}`);

  // 3. Deliver both in one signed report.
  const report = encodeAbiParameters(
    parseAbiParameters("uint256[] ids, bytes3 currency, uint64 rate"),
    [
      ids as readonly bigint[] as bigint[],
      stringToHex(runtime.config.quoteCurrency, { size: 3 }),
      scaledRate,
    ]
  );

  const written = client
    .writeReport(runtime, {
      receiver: evm.schedulerAddress as Address,
      report: runtime.report(prepareReportRequest(report)).result(),
      gasConfig: { gasLimit: evm.gasLimit },
    })
    .result();

  if (written.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`report failed: ${written.errorMessage ?? written.txStatus}`);
  }

  const txHash = bytesToHex(written.txHash ?? new Uint8Array(32));
  runtime.log(`released ${ids.length} payment(s) — ${txHash}`);
  return `released ${ids.length} at ${rate} ${runtime.config.quoteCurrency}/USD`;
};

export function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
}
