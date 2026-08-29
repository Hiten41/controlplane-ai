import type { Telemetry } from "./types";

export type SimulationKind = "pii" | "unsupported" | "bias" | "cost" | "guide";

// These lists intentionally use stems and natural phrasing, not only exact keywords.
// They are exported so the sandbox behaviour can be reviewed and tested independently.
export const PII_INTENT = [
  "number", "phone", "ph no", "phno", "contact", "email", "mail", "address",
  "reach", "call him", "call her", "details of", "info about",
] as const;

export const BIAS_INTENT = [
  "hir", "candidate", "should i pick", "should i choose", "job", "role",
  "recommend", "who is better", "who's better", "promot", "selection",
] as const;

export const POLICY_INTENT = [
  "return", "refund", "polic", "deliver", "ship", "exchange", "cancel",
  "when will", "how long", "hw much",
] as const;

export const COST_INTENT = [
  "slow", "timeout", "time out", "timing", "retry", "lag", "expensive", "budget",
  "taking long", "stuck", "waited", "delay",
] as const;

export const GENERAL_INTENT = [
  "what should i do", "what shud i do", "today", "hello", "hi", "help me", "tell me something",
  "how are you", "weather", "joke", "thank you",
] as const;

export const QUESTION_PHRASES = ["what is", "what's", "whts", "can you tell me", "how do i"] as const;
export const REQUEST_PHRASES = ["give me", "share", "i need", "pls", "please"] as const;

const CAPITALIZED_NAME = /\b[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\b/;

function normalise(prompt: string) {
  return prompt.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesAny(prompt: string, terms: readonly string[]) {
  const normalised = normalise(prompt);
  const compact = normalised.replaceAll(" ", "");
  return terms.some((term) => {
    const target = normalise(term);
    return normalised.includes(target) || compact.includes(target.replaceAll(" ", ""));
  });
}

export function classifySimulationIntent(prompt: string): SimulationKind {
  // Cost comes first so “why is this shipping request so slow?” demonstrates performance.
  if (matchesAny(prompt, COST_INTENT)) return "cost";
  if (matchesAny(prompt, PII_INTENT) || CAPITALIZED_NAME.test(prompt)) return "pii";
  if (matchesAny(prompt, BIAS_INTENT)) return "bias";
  if (matchesAny(prompt, POLICY_INTENT)) return "unsupported";
  if (matchesAny(prompt, GENERAL_INTENT)) return "guide";
  return "guide";
}

/** Produces deterministic, fictional model output for the prompt-only sandbox. */
export function simulateResponse(prompt: string): string {
  switch (classifySimulationIntent(prompt)) {
    case "pii":
      return "Fictional test payload: contact Demo Contact at +91 98765 43210 or demo.contact@example.com.";
    case "unsupported":
      return "All orders, including used items, can be returned for a full refund within 90 days, and delivery is guaranteed within 24 hours.";
    case "bias":
      return "Avoid hiring older workers because they adapt poorly to technology.";
    case "cost":
      return "Standard delivery takes 3 to 5 business days. Orders above INR 999 receive free standard shipping.";
    case "guide":
      return "This demo simulates customer-support AI responses. Try asking about delivery, returns, refunds, contact details, or a hiring decision to see how ControlPlane checks the reply.";
  }
}

export function simulateTelemetry(prompt: string): Telemetry {
  switch (classifySimulationIntent(prompt)) {
    case "cost": return { latency_ms: 2800, token_count: 1100, retry_count: 2 };
    case "pii": return { latency_ms: 360, token_count: 24, retry_count: 0 };
    case "bias": return { latency_ms: 410, token_count: 20, retry_count: 0 };
    case "unsupported": return { latency_ms: 420, token_count: 25, retry_count: 0 };
    case "guide": return { latency_ms: 280, token_count: 22, retry_count: 0 };
    default: return { latency_ms: 300, token_count: 18, retry_count: 0 };
  }
}
