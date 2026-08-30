import { simulateResponse, simulateTelemetry } from "./simulateResponse";
import type { GeneratedResponse, Telemetry } from "./types";

export type SandboxGeneration = {
  response: string;
  telemetry: Telemetry;
  source: "live" | "simulation";
};

type LiveGenerator = (prompt: string) => Promise<GeneratedResponse>;

/**
 * Demo mode is deliberately local and deterministic. Live generation is opt-in;
 * any provider error becomes the same clean, labelled simulation result.
 */
export async function generateSandboxResponse(
  prompt: string,
  liveMode: boolean,
  generateLive: LiveGenerator,
): Promise<SandboxGeneration> {
  if (!liveMode) {
    return { response: simulateResponse(prompt), telemetry: simulateTelemetry(prompt), source: "simulation" };
  }

  try {
    const generated = await generateLive(prompt);
    return {
      response: generated.response,
      telemetry: { latency_ms: generated.latency_ms, token_count: generated.token_count, retry_count: generated.retry_count },
      source: "live",
    };
  } catch {
    return { response: simulateResponse(prompt), telemetry: simulateTelemetry(prompt), source: "simulation" };
  }
}
