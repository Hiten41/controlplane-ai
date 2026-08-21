import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Audit, Check, Evaluation, Policy, Scenario, Telemetry, UseCase } from "./types";

const useCaseOrder: UseCase[] = ["customer_support", "internal_knowledge_assistant", "decision_support"];

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function decisionClass(decision: string) {
  return `decision decision--${decision.toLowerCase().replaceAll("_", "-")}`;
}

function scoreLabel(check: Check) {
  if (check.name === "groundedness") return "evidence match";
  if (check.name === "cost_performance") return "budget pressure";
  return "risk score";
}

function releaseCopy(status: Evaluation["release_status"]) {
  if (status === "RELEASED") return "Released to end user";
  if (status === "PENDING_REVIEW") return "Held for human review";
  return "Withheld from end user";
}

function CheckCard({ check }: { check: Check }) {
  const evidence = check.evidence[0];
  const details = check.details;
  const duration = typeof details.duration_ms === "number" ? details.duration_ms : null;
  return (
    <article className="check-card">
      <div className="check-card__topline">
        <span className="eyebrow">{pretty(check.name)}</span>
        <span className={`status status--${check.status}`}>{pretty(check.status)}</span>
      </div>
      <div className="score-row">
        <strong>{Math.round(check.score * 100)}</strong><span>{scoreLabel(check)}</span>
        <span className="confidence">{Math.round(check.confidence * 100)}% confidence</span>
      </div>
      <p>{check.reason}</p>
      {evidence && <div className="evidence"><span>{evidence.source_type ?? "Evidence"} · {evidence.title}</span><p>{evidence.excerpt}</p><small>{evidence.updated_at ? `Current as of ${evidence.updated_at}` : "Approved source"}</small></div>}
      {Boolean(details.budget_breached) && <div className="telemetry">{String(details.latency_ms)}ms · {String(details.token_count)} tokens · {String(details.retry_count)} retries</div>}
      {duration !== null && <div className="check-duration">Completed in {duration}ms</div>}
      {check.flagged_spans.length > 0 && <div className="flagged">{check.flagged_spans.map((span, index) => <mark key={`${span}-${index}`}>{span}</mark>)}</div>}
    </article>
  );
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function App() {
  const [policies, setPolicies] = useState<Record<UseCase, Policy> | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [useCase, setUseCase] = useState<UseCase>("customer_support");
  const [scenarioId, setScenarioId] = useState("clean_answer");
  const [customPrompt, setCustomPrompt] = useState("How long will delivery take?");
  const [customResponse, setCustomResponse] = useState("Standard delivery takes 3 to 5 business days.");
  const [customTelemetry, setCustomTelemetry] = useState<Telemetry>({ latency_ms: 320, token_count: 16, retry_count: 0 });
  const [result, setResult] = useState<Evaluation | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [reviews, setReviews] = useState<Audit[]>([]);
  const [reviewerId, setReviewerId] = useState("demo-reviewer");
  const [reviewNote, setReviewNote] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationMessage, setEvaluationMessage] = useState("Running parallel checks...");
  const [apiStatus, setApiStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [error, setError] = useState("");

  const isCustom = scenarioId === "custom";
  const activeScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0],
    [scenarioId, scenarios],
  );
  const activePolicy = policies?.[useCase];

  async function refreshRecords() {
    const [nextAudits, nextReviews] = await Promise.all([api.getAudits(), api.getReviews()]);
    setAudits(nextAudits);
    setReviews(nextReviews);
  }

  async function loadData() {
    setApiStatus("checking");
    try {
      const [nextPolicies, nextScenarios] = await Promise.all([api.getPolicies(), api.getScenarios()]);
      setPolicies(nextPolicies);
      setScenarios(nextScenarios);
      await refreshRecords();
      setApiStatus("ready");
      setError("");
    } catch {
      setApiStatus("unavailable");
      setError("Unable to reach the ControlPlane API. On Render's free tier, the first request after inactivity can take up to 60 seconds. Please wait, then retry.");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function loadFixtureIntoSandbox() {
    if (!activeScenario) return;
    setCustomPrompt(activeScenario.prompt);
    setCustomResponse(activeScenario.response);
    setCustomTelemetry(activeScenario.telemetry);
    setScenarioId("custom");
  }

  async function runEvaluation() {
    const payload = isCustom
      ? { prompt: customPrompt.trim(), response: customResponse.trim(), telemetry: customTelemetry }
      : activeScenario;
    if (!payload?.prompt || !payload.response) {
      setError("Add both a user prompt and an AI response before evaluating.");
      return;
    }
    setError("");
    setIsEvaluating(true);
    setEvaluationMessage("Starting parallel policy checks...");
    const wakingTimer = window.setTimeout(() => {
      setEvaluationMessage("Connecting to the policy engine...");
    }, 2500);
    const coldStartTimer = window.setTimeout(() => {
      setEvaluationMessage("Waking the free demo API — please keep this page open (up to 60 sec on first visit)...");
    }, 8000);
    try {
      const nextResult = await api.evaluate({ use_case: useCase, ...payload });
      setResult(nextResult);
      await refreshRecords();
      setApiStatus("ready");
    } catch {
      setApiStatus("unavailable");
      setError("The policy API did not answer. If this is the first visit after inactivity, wait up to 60 seconds for Render to wake it, then select Retry connection.");
    } finally {
      window.clearTimeout(wakingTimer);
      window.clearTimeout(coldStartTimer);
      setIsEvaluating(false);
      setEvaluationMessage("Running parallel checks...");
    }
  }

  async function resolveReview(auditId: string, action: "APPROVED" | "OVERRIDDEN") {
    if (action === "OVERRIDDEN" && !reviewNote.trim()) {
      setError("Add a reviewer reason before recording an override.");
      return;
    }
    try {
      await api.review(auditId, action, reviewerId.trim() || "demo-reviewer", reviewNote.trim());
      setReviewNote("");
      await refreshRecords();
    } catch {
      setError("The review action could not be saved. The case may already be resolved.");
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="brand"><span className="brand__mark"><i></i><i></i><i></i></span>ControlPlane<span>.ai</span></div>
          <p className="hero__kicker">AI GOVERNANCE, IN REAL TIME</p>
          <h1>Trust every response<br /><em>before it ships.</em></h1>
          <p className="hero__copy">A policy-driven control plane that evaluates AI output in parallel, separates restricted content from user-facing output, and preserves an auditable decision record.</p>
        </div>
        <div className="hero__badge"><span className={`pulse pulse--${apiStatus}`}></span><div><small>Demo engine status</small><strong>{apiStatus === "ready" ? "Policy engine online" : apiStatus === "checking" ? "Connecting to API" : "API reconnect needed"}</strong></div><b>3</b></div>
      </header>

      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => void loadData()}>Retry connection</button></div>}

      <section className="workspace">
        <div className="panel panel--controls">
          <div className="section-title"><span>01</span><div><p>POLICY CONTROL</p><h2>Choose the risk profile</h2></div></div>
          <div className="policy-grid">
            {useCaseOrder.map((profile) => (
              <button key={profile} className={`policy-card ${profile === useCase ? "policy-card--active" : ""}`} onClick={() => setUseCase(profile)}>
                <span>{profile === "decision_support" ? "High stakes" : profile === "customer_support" ? "Customer facing" : "Internal"}</span>
                <strong>{policies ? policies[profile].label : pretty(profile)}</strong>
                <small>{policies ? policies[profile].description : "Loading policy..."}</small>
              </button>
            ))}
          </div>
          {activePolicy && <><div className="policy-summary">
            <span>Policy v{activePolicy.version}</span><span>Evidence ≥ {Math.round(activePolicy.minimum_groundedness_score * 100)}%</span><span>Latency ≤ {activePolicy.max_latency_ms}ms</span><span>PII → {pretty(activePolicy.pii_action)}</span>
          </div><details className="policy-details"><summary>View configured actions</summary><p>Unsupported → {pretty(activePolicy.unsupported_claim_action)} · Insufficient evidence → {pretty(activePolicy.insufficient_evidence_action)} · Unsafe content → {pretty(activePolicy.unsafe_content_action)} · Cost overrun → {pretty(activePolicy.cost_overrun_action)}</p></details></>}
        </div>

        <div className="panel panel--scenario">
          <div className="section-title"><span>02</span><div><p>RESPONSE GATE</p><h2>Evaluate a scenario</h2></div></div>
          <label>Demo fixture or sandbox<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}><option value="custom">Custom response sandbox</option>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}</select></label>
          {isCustom ? <div className="sandbox-grid">
            <label>User prompt<textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} maxLength={5000} /></label>
            <label>Simulated AI response<textarea value={customResponse} onChange={(event) => setCustomResponse(event.target.value)} maxLength={8000} /></label>
            <div className="telemetry-inputs"><label>Latency (ms)<input type="number" min="0" value={customTelemetry.latency_ms} onChange={(event) => setCustomTelemetry({ ...customTelemetry, latency_ms: numberOrZero(event.target.value) })} /></label><label>Tokens<input type="number" min="0" value={customTelemetry.token_count} onChange={(event) => setCustomTelemetry({ ...customTelemetry, token_count: numberOrZero(event.target.value) })} /></label><label>Retries<input type="number" min="0" value={customTelemetry.retry_count} onChange={(event) => setCustomTelemetry({ ...customTelemetry, retry_count: numberOrZero(event.target.value) })} /></label></div>
          </div> : <><div className="content-grid"><div><span className="content-label">User prompt</span><p>{activeScenario?.prompt ?? "Loading..."}</p></div><div><span className="content-label">Simulated AI response</span><p>{activeScenario?.response ?? "Loading..."}</p></div></div>{activeScenario && <div className="fixture-tools"><p className="fixture-meta">Fixture telemetry · {activeScenario.telemetry.latency_ms}ms · {activeScenario.telemetry.token_count} tokens · {activeScenario.telemetry.retry_count} retries</p><button className="text-button" onClick={loadFixtureIntoSandbox}>Edit in sandbox</button></div>}</>}
          <button className="evaluate" onClick={() => void runEvaluation()} disabled={isEvaluating || (!isCustom && !activeScenario)}>{isEvaluating ? evaluationMessage : "Evaluate response"}</button>
          {isEvaluating && <p className="evaluation-hint" role="status">The response remains held until the policy decision is complete.</p>}
        </div>
      </section>

      {result && <section className="result-section">
        <div className="section-title"><span>03</span><div><p>DECISION ENGINE</p><h2>Policy decision</h2></div></div>
        <div className="result-layout">
          <div className="decision-panel">
            <div className={decisionClass(result.decision)}>{pretty(result.decision)}</div><h3>{result.decision_reason}</h3>
            <div className={`release-state release-state--${result.release_status.toLowerCase()}`}><span>{releaseCopy(result.release_status)}</span><p>{result.end_user_response ?? "The original output remains restricted inside the control plane and has not been released."}</p></div>
            <div className="raw-response"><span>Restricted operator content</span><p>{result.raw_response}</p></div><p className="audit-id">Audit ID · {result.audit_id} · 3 checks completed in {result.total_check_latency_ms}ms</p>
          </div>
          <div className="check-grid">{result.checks.map((check) => <CheckCard key={check.name} check={check} />)}</div>
        </div>
        <div className="decision-trace"><div><span className="trace-label">DECISION PRECEDENCE</span><h3>Why this action was selected</h3></div><ol>{result.decision_trace.map((step) => <li key={step.order}><span>{step.rule}</span><b>{pretty(step.outcome)}</b><p>{step.detail}</p></li>)}</ol></div>
      </section>}

      <section className="operations-grid">
        <div className="panel review-panel">
          <div className="section-title"><span>04</span><div><p>HUMAN IN THE LOOP</p><h2>Review queue</h2></div></div>
          {reviews.some((review) => review.review_status === "PENDING") && <div className="review-form"><label>Reviewer ID<input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} maxLength={100} /></label><label>Reason required for override<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder="State why the policy outcome is being changed." /></label></div>}
          {reviews.length === 0 ? <p className="empty">No cases are waiting for a reviewer.</p> : reviews.map((review) => (
            <div className="review-card" key={review.audit_id}>
              <div><strong>{pretty(review.use_case)}</strong><span>{review.decision_reason}</span><small>{review.review_status ?? "PENDING"} · {review.audit_id.slice(0, 8)}</small></div>
              {review.review_status === "PENDING" && <div className="review-actions"><button onClick={() => void resolveReview(review.audit_id, "APPROVED")}>Approve hold</button><button className="button--ghost" onClick={() => void resolveReview(review.audit_id, "OVERRIDDEN")}>Override</button></div>}
            </div>
          ))}
        </div>

        <div className="panel audit-panel">
          <div className="section-title"><span>05</span><div><p>OBSERVABILITY</p><h2>Immutable-style audit trail</h2></div></div>
          <div className="audit-head"><span>Decision</span><span>Release</span><span>Evidence</span><span>Telemetry</span></div>
          {audits.slice(0, 5).map((audit) => <details className="audit-entry" key={audit.audit_id}><summary className="audit-row"><span className={decisionClass(audit.final_decision)}>{pretty(audit.final_decision)}</span><span>{pretty(audit.release_status)}</span><span>{pretty(audit.groundedness_status)}</span><span>{audit.cost_latency_ms}ms · {audit.cost_token_count}t</span></summary><div className="audit-detail"><p><b>Audit ID:</b> {audit.audit_id}</p><p><b>Decision:</b> {audit.decision_reason}</p><p><b>Recorded steps:</b> {audit.decision_trace.map((step) => `${step.rule}: ${pretty(step.outcome)}`).join(" → ") || "Legacy audit record"}</p></div></details>)}
          {audits.length === 0 && <p className="empty">Run a scenario to create the first audit record.</p>}
        </div>
      </section>

      <footer><span>ControlPlane.ai</span> · Policy-driven responsible AI infrastructure · Prototype data only</footer>
    </main>
  );
}

export default App;
