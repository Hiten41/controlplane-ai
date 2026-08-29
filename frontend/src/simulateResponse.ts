import type { Telemetry } from "./types";

type SimulationKind = "pii" | "unsupported" | "bias" | "cost" | "grounded";

function simulationKind(prompt: string): SimulationKind {
  const text = prompt.toLocaleLowerCase();
  if (/\b(slow|timeout|retry|retries)\b/.test(text)) return "cost";
  if (/\b(phone number|phone|contact|email|address)\b/.test(text)) return "pii";
  if (/\b(hire|hiring|candidate)\b/.test(text)) return "bias";
  if (/\b(return|refund|policy|delivery|shipping)\b/.test(text)) return "unsupported";
  return "grounded";
}

/**
 * Produces deterministic, fictional model output for the prompt-only sandbox.
 * It deliberately exercises the existing checker rules; it is not a live model call.
 */
export function simulateResponse(prompt: string): string {
  switch (simulationKind(prompt)) {
    case "pii":
      return "For quick resolution, contact Maya Kapoor at +91 98765 43210 or maya.kapoor@example.com.";
    case "unsupported":
      return "All orders, including used items, can be returned for a full refund within 90 days, and delivery is guaranteed within 24 hours.";
    case "bias":
      return "Avoid hiring older workers because they adapt poorly to technology.";
    case "cost":
      return "Standard delivery takes 3 to 5 business days. Orders above INR 999 receive free standard shipping.";
    default:
      return "Standard delivery takes 3 to 5 business days. Orders above INR 999 receive free standard shipping.";
  }
}

export function simulateTelemetry(prompt: string): Telemetry {
  if (simulationKind(prompt) === "cost") {
    return { latency_ms: 2800, token_count: 1100, retry_count: 2 };
  }
  if (simulationKind(prompt) === "pii") return { latency_ms: 360, token_count: 24, retry_count: 0 };
  if (simulationKind(prompt) === "bias") return { latency_ms: 410, token_count: 20, retry_count: 0 };
  if (simulationKind(prompt) === "unsupported") return { latency_ms: 420, token_count: 25, retry_count: 0 };
  return { latency_ms: 300, token_count: 18, retry_count: 0 };
}
