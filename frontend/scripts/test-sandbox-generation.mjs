import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

async function compileAsModule(sourcePath, replacements = []) {
  let source = await readFile(sourcePath, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
}

const simulationPath = new URL("../src/simulateResponse.ts", import.meta.url);
const simulationModule = await compileAsModule(simulationPath);
const generationPath = new URL("../src/sandboxGeneration.ts", import.meta.url);
const generationModule = await compileAsModule(generationPath, [["./simulateResponse", simulationModule]]);
const { generateSandboxResponse } = await import(generationModule);

for (const failure of [new Error("HTTP 503"), new Error("timeout")]) {
  const started = performance.now();
  const generated = await generateSandboxResponse("what is your return policy", true, async () => { throw failure; });
  const elapsed = performance.now() - started;
  if (generated.source !== "simulation") throw new Error("Provider failure did not fall back to simulation.");
  if (!generated.response.includes("90 days")) throw new Error("Fallback did not use the deterministic simulator.");
  if (elapsed >= 4000) throw new Error(`Fallback exceeded demo budget: ${elapsed}ms`);
}

console.log("Sandbox fallback checks passed: 503 and timeout both resolve to demo mode.");
