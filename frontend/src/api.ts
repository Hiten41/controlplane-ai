import type { Audit, Evaluation, GeneratedResponse, Metrics, Policy, Role, Scenario, UseCase } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "The API request failed.");
  }
  return response.json() as Promise<T>;
}

export const api = {
  getPolicies: () => request<Record<UseCase, Policy>>("/policies"),
  getScenarios: () => request<Scenario[]>("/scenarios"),
  getAudits: (role: Role = "auditor") => request<Audit[]>(`/audits?actor_role=${role}`),
  getReviews: (role: Role = "reviewer") => request<Audit[]>(`/reviews?actor_role=${role}`),
  getMetrics: () => request<Metrics>("/metrics/evaluation?actor_role=auditor"),
  getPerformance: () => request<{ sequential_latency_ms: number; concurrent_latency_ms: number; improvement_percent: number }>("/metrics/performance?actor_role=auditor"),
  generate: (prompt: string, experimental = false) => request<GeneratedResponse>("/generate", { method: "POST", body: JSON.stringify({ prompt, experimental }) }),
  evaluate: (payload: { use_case: UseCase; prompt: string; response: string; telemetry: Scenario["telemetry"]; region?: string; risk_appetite?: string; session_id?: string; actor_role?: Role }) =>
    request<Evaluation>("/evaluate", { method: "POST", body: JSON.stringify(payload) }),
  review: (auditId: string, action: "APPROVED" | "OVERRIDDEN", reviewerId: string, overrideReason: string) =>
    request<Audit>(`/reviews/${auditId}`, {
      method: "POST",
      body: JSON.stringify({
        reviewer_id: reviewerId,
        action,
        override_reason: overrideReason || null,
      }),
    }),
};
