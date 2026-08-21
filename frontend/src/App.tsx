import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Audit, Check, Evaluation, Policy, Scenario, UseCase } from "./types";

const useCaseOrder: UseCase[] = ["customer_support", "internal_knowledge_assistant", "decision_support"];

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function decisionClass(decision: string) {
  return `decision decision--${decision.toLowerCase().replaceAll("_", "-")}`;
}

function CheckCard({ check }: { check: Check }) {
  const evidence = check.evidence[0];
  const details = check.details;
  return (
    <article className="check-card">
      <div className="check-card__topline">
        <span className="eyebrow">{pretty(check.name)}</span>
        <span className={`status status--${check.status}`}>{pretty(check.status)}</span>
      </div>
      <div className="score-row">
        <strong>{Math.round(check.score * 100)}</strong><span>risk score</span>
        <span className="confidence">{Math.round(check.confidence * 100)}% confidence</span>
      </div>
      <p>{check.reason}</p>
      {evidence && <div className="evidence"><span>Evidence · {evidence.title}</span><p>{evidence.excerpt}</p></div>}
      {Boolean(details.budget_breached) && <div className="telemetry">{String(details.latency_ms)}ms · {String(details.token_count)} tokens · {String(details.retry_count)} retry</div>}
      {check.flagged_spans.length > 0 && <div className="flagged">{check.flagged_spans.map((span) => <mark key={span}>{span}</mark>)}</div>}
    </article>
  );
}

function App() {
  const [policies, setPolicies] = useState<Record<UseCase, Policy> | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [useCase, setUseCase] = useState<UseCase>("customer_support");
  const [scenarioId, setScenarioId] = useState("clean_answer");
  const [result, setResult] = useState<Evaluation | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [reviews, setReviews] = useState<Audit[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState("");

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

  useEffect(() => {
    async function load() {
      try {
        const [nextPolicies, nextScenarios] = await Promise.all([api.getPolicies(), api.getScenarios()]);
        setPolicies(nextPolicies);
        setScenarios(nextScenarios);
        await refreshRecords();
      } catch {
        setError("Unable to reach the API. Start the FastAPI server on port 8000, then refresh.");
      }
    }
    void load();
  }, []);

  async function runEvaluation() {
    if (!activeScenario) return;
    setError("");
    setIsEvaluating(true);
    try {
      const nextResult = await api.evaluate({
        use_case: useCase,
        prompt: activeScenario.prompt,
        response: activeScenario.response,
        telemetry: activeScenario.telemetry,
      });
      setResult(nextResult);
      await refreshRecords();
    } catch {
      setError("Evaluation failed. Confirm that the backend is running and try again.");
    } finally {
      setIsEvaluating(false);
    }
  }

  async function resolveReview(auditId: string, action: "APPROVED" | "OVERRIDDEN") {
    try {
      await api.review(auditId, action);
      await refreshRecords();
    } catch {
      setError("The review action could not be saved.");
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="brand"><span className="brand__mark"><i></i><i></i><i></i></span>ControlPlane<span>.ai</span></div>
          <p className="hero__kicker">AI GOVERNANCE, IN REAL TIME</p>
          <h1>Trust every response<br /><em>before it ships.</em></h1>
          <p className="hero__copy">A policy-driven safety layer that evaluates AI output, explains its decision, and leaves an audit trail behind.</p>
        </div>
        <div className="hero__badge"><span className="pulse"></span><div><small>System status</small><strong>All checks online</strong></div><b>3</b></div>
      </header>

      {error && <div className="alert">{error}</div>}

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
          {activePolicy && <div className="policy-summary">
            <span>Policy v{activePolicy.version}</span>
            <span>Groundedness ≥ {Math.round(activePolicy.minimum_groundedness_score * 100)}%</span>
            <span>Latency ≤ {activePolicy.max_latency_ms}ms</span>
            <span>PII → {pretty(activePolicy.pii_action)}</span>
          </div>}
        </div>

        <div className="panel panel--scenario">
          <div className="section-title"><span>02</span><div><p>RESPONSE GATE</p><h2>Evaluate a scenario</h2></div></div>
          <label>Demo fixture<select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}</select></label>
          <div className="content-grid">
            <div><span className="content-label">User prompt</span><p>{activeScenario?.prompt ?? "Loading..."}</p></div>
            <div><span className="content-label">Simulated AI response</span><p>{activeScenario?.response ?? "Loading..."}</p></div>
          </div>
          <button className="evaluate" onClick={runEvaluation} disabled={isEvaluating || !activeScenario}>{isEvaluating ? "Running parallel checks..." : "Evaluate response"}</button>
          {activeScenario && <p className="fixture-meta">Fixture telemetry · {activeScenario.telemetry.latency_ms}ms · {activeScenario.telemetry.token_count} tokens · {activeScenario.telemetry.retry_count} retries</p>}
        </div>
      </section>

      {result && <section className="result-section">
        <div className="section-title"><span>03</span><div><p>DECISION ENGINE</p><h2>Policy decision</h2></div></div>
        <div className="result-layout">
          <div className="decision-panel">
            <div className={decisionClass(result.decision)}>{pretty(result.decision)}</div>
            <h3>{result.decision_reason}</h3>
            <div className="processed-response"><span>Output released to the user</span><p>{result.processed_response}</p></div>
            <p className="audit-id">Audit ID · {result.audit_id}</p>
          </div>
          <div className="check-grid">{result.checks.map((check) => <CheckCard key={check.name} check={check} />)}</div>
        </div>
      </section>}

      <section className="operations-grid">
        <div className="panel review-panel">
          <div className="section-title"><span>04</span><div><p>HUMAN IN THE LOOP</p><h2>Review queue</h2></div></div>
          {reviews.length === 0 ? <p className="empty">No cases are waiting for a reviewer.</p> : reviews.map((review) => (
            <div className="review-card" key={review.audit_id}>
              <div><strong>{pretty(review.use_case)}</strong><span>{review.decision_reason}</span><small>{review.review_status ?? "PENDING"} · {review.audit_id.slice(0, 8)}</small></div>
              {review.review_status === "PENDING" && <div className="review-actions"><button onClick={() => resolveReview(review.audit_id, "APPROVED")}>Approve</button><button className="button--ghost" onClick={() => resolveReview(review.audit_id, "OVERRIDDEN")}>Override</button></div>}
            </div>
          ))}
        </div>

        <div className="panel audit-panel">
          <div className="section-title"><span>05</span><div><p>OBSERVABILITY</p><h2>Audit trail</h2></div></div>
          <div className="audit-head"><span>Decision</span><span>Use case</span><span>Evidence</span><span>Telemetry</span></div>
          {audits.slice(0, 5).map((audit) => <div className="audit-row" key={audit.audit_id}><span className={decisionClass(audit.final_decision)}>{pretty(audit.final_decision)}</span><span>{pretty(audit.use_case)}</span><span>{audit.groundedness_status}</span><span>{audit.cost_latency_ms}ms · {audit.cost_token_count}t</span></div>)}
          {audits.length === 0 && <p className="empty">Run a scenario to create the first audit record.</p>}
        </div>
      </section>

      <footer><span>ControlPlane.ai</span> · Responsible AI infrastructure · Prototype data only</footer>
    </main>
  );
}

export default App;
