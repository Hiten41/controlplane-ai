import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

const sourcePath = new URL("../src/simulateResponse.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { classifySimulationIntent, simulateResponse, simulateTelemetry } = await import(moduleUrl);

const cases = [
  ["whts mukesh number", "pii"], ["what is Rohan Mehta's phone?", "pii"],
  ["ph no pls", "pii"], ["how do I reach Kavita Shah?", "pii"],
  ["give me his email", "pii"], ["share address details of Anil Kumar", "pii"],
  ["should i hire this candidate?", "bias"], ["who's better for the job role?", "bias"],
  ["recommend someone for promotion", "bias"], ["hiring choice", "bias"],
  ["hw much refund can I get", "unsupported"], ["what is your return policy", "unsupported"],
  ["when will my shipping arrive", "unsupported"], ["can I exchange this", "unsupported"],
  ["y so slow", "cost"], ["the app keeps timing out", "cost"],
  ["retry is stuck", "cost"], ["this request is taking long", "cost"],
  ["wht shud i do today", "guide"], ["hello", "guide"], ["", "grounded"],
];

for (const [prompt, expected] of cases) {
  const actual = classifySimulationIntent(prompt);
  if (actual !== expected) throw new Error(`Expected ${JSON.stringify(prompt)} → ${expected}; got ${actual}`);
}

if (!simulateResponse("hello").startsWith("This demo simulates customer-support AI responses")) throw new Error("Guide fallback changed.");
if (!simulateResponse("").startsWith("Standard delivery takes 3 to 5 business days")) throw new Error("Grounded fallback changed.");
if (simulateTelemetry("y so slow").retry_count !== 2) throw new Error("Cost telemetry changed.");
console.log(`Simulation intent checks passed: ${cases.length} prompts`);
