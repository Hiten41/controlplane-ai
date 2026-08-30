export type UseCase = "customer_support" | "internal_knowledge_assistant" | "decision_support";
export type Role = "operator" | "reviewer" | "auditor" | "admin";

export type Telemetry = {
  latency_ms: number;
  token_count: number;
  retry_count: number;
};

export type Scenario = {
  id: string;
  label: string;
  prompt: string;
  response: string;
  telemetry: Telemetry;
};

export type GeneratedResponse = {
  response: string;
  latency_ms: number;
  token_count: number;
  retry_count: number;
  provider: "gemini";
};

export type Policy = {
  label: string;
  version: string;
  description: string;
  max_latency_ms: number;
  max_token_count: number;
  max_retry_count: number;
  minimum_groundedness_score: number;
  unsupported_claim_action: string;
  insufficient_evidence_action: string;
  unsafe_content_action: string;
  pii_action: string;
  cost_overrun_action: string;
};

export type Check = {
  name: string;
  score: number;
  confidence: number;
  status: string;
  reason: string;
  evidence: Array<{ id: string; title: string; score: number; excerpt: string; updated_at?: string; source_type?: string }>;
  flagged_spans: string[];
  details: Record<string, unknown>;
};

export type DecisionTraceStep = {
  order: number;
  rule: string;
  outcome: string;
  detail: string;
};

export type Evaluation = {
  audit_id: string;
  created_at: string;
  use_case: UseCase;
  policy: Policy;
  checks: Check[];
  decision: "ALLOW" | "AUTO_EDIT" | "FLAG_FOR_HUMAN_REVIEW" | "BLOCK";
  decision_reason: string;
  raw_response: string;
  end_user_response: string | null;
  release_status: "RELEASED" | "WITHHELD" | "PENDING_REVIEW";
  decision_trace: DecisionTraceStep[];
  total_check_latency_ms: number;
  review_required: boolean;
  policy_context?: { use_case: string; region: string; risk_appetite: string; policy_version: string };
  session_id?: string | null;
  session_risk?: { turn_count: number; risk_turn_count: number; cumulative_severity: string; prior_risks: string[] } | null;
};

export type Metrics = { total_cases: number; correct_decisions: number; accuracy: number; precision: number; recall: number; false_positives: number; false_negatives: number; average_latency_ms: number; p50_latency_ms: number; p95_latency_ms: number; decision_distribution: Record<string, number>; per_category: Record<string, { total: number; correct: number; accuracy: number }> };

export type Audit = {
  audit_id: string;
  created_at: string;
  use_case: string;
  final_decision: string;
  decision_reason: string;
  release_status: "RELEASED" | "WITHHELD" | "PENDING_REVIEW";
  ai_response: string;
  end_user_response?: string | null;
  flagged_spans: string[];
  decision_trace: DecisionTraceStep[];
  groundedness_status: string;
  groundedness_score: number;
  safety_flags: string[];
  pii_detected: Array<{ type: string; value: string }>;
  cost_latency_ms: number;
  cost_token_count: number;
  reviewer_id?: string | null;
  reviewer_action?: string | null;
  override_reason?: string | null;
  review_status?: string;
};
