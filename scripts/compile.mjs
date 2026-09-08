import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const names = ["SpikeDelegate", "Probe", "IrisCommitments", "MockAUSD", "IrisScheduler", "IrisDelegate"];
const sources = Object.fromEntries(
  names.map((n) => [`${n}.sol`, { content: readFileSync(`contracts/${n}.sol`, "utf8") }])
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // createToClaimWithAuthorization carries more arguments than the stack
    // holds; the IR pipeline is the supported answer rather than shuffling
    // parameters into structs to please the old codegen.
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

mkdirSync("artifacts", { recursive: true });
const built = {};
for (const n of names) {
  const c = out.contracts[`${n}.sol`][n];
  built[n] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}
writeFileSync("artifacts/contracts.json", JSON.stringify(built, null, 2));

// The app's ABI is written from the same output rather than kept by hand. It
// claimed to be generated for a while before it was, which is exactly how an
// ABI drifts away from the contract it describes without anyone noticing.
writeFileSync(
  "lib/iris-abi.ts",
  "// Generated from contracts/IrisCommitments.sol by `npm run compile`. Do not edit.\n" +
    `export const irisAbi = ${JSON.stringify(built.IrisCommitments.abi, null, 2)} as const;\n`
);
console.log("compiled:", names.join(", "), `(solc ${solc.version()})`);
