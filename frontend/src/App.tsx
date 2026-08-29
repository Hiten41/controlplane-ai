import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import { demoPolicies, demoScenarios } from "./demoCatalog";
import type { Audit, Check, Evaluation, Policy, Scenario, Telemetry, UseCase } from "./types";

const useCaseOrder: UseCase[] = ["customer_support", "internal_knowledge_assistant", "decision_support"];

const scenarioMeta: Record<string, { signal: string; description: string; tone: "clear" | "caution" | "risk" }> = {
  clean_answer: { signal: "Baseline", description: "Evidence-backed delivery answer", tone: "clear" },
  unsupported_claim: { signal: "Evidence gap", description: "Unsupported return-policy claim", tone: "caution" },
  pii_leak: { signal: "Privacy", description: "Structured PII in generated output", tone: "risk" },
  biased_suggestion: { signal: "Safety", description: "Biased hiring recommendation", tone: "risk" },
  overlap_sensitive: { signal: "Overlap", description: "PII plus insufficient evidence", tone: "risk" },
  cost_overrun: { signal: "Performance", description: "Latency, tokens, and retries exceed budget", tone: "caution" },
};

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

function numberDetail(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return typeof value === "number" ? value : 0;
}

function statusTone(status: string) {
  if (status === "insufficient_evidence") return "uncertain";
  if (["grounded", "clear", "within_budget"].includes(status)) return "calm";
  return "alert";
}

function statusLabel(status: string) {
  if (status === "insufficient_evidence") return "Evidence unavailable";
  if (status === "unsupported_claim") return "Unsupported claim";
  return pretty(status);
}

function HighlightedResponse({ text, spans }: { text: string; spans: string[] }) {
  const matches = [...new Set(spans.filter(Boolean))]
    .map((span) => ({ span, index: text.toLocaleLowerCase().indexOf(span.toLocaleLowerCase()) }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index);
  if (matches.length === 0) return <p>{text}</p>;

  const parts: Array<string | { text: string; flagged: true }> = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push({ text: text.slice(match.index, match.index + match.span.length), flagged: true });
    cursor = match.index + match.span.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <p>{parts.map((part, index) => typeof part === "string" ? part : <mark key={`${part.text}-${index}`}>{part.text}</mark>)}</p>;
}

function TelemetryInstrument({ check, policy }: { check: Check; policy: Policy }) {
  const details = check.details;
  const readings = [
    { label: "Latency", actual: numberDetail(details, "latency_ms"), budget: policy.max_latency_ms, unit: "ms" },
    { label: "Tokens", actual: numberDetail(details, "token_count"), budget: policy.max_token_count, unit: "" },
    { label: "Retries", actual: numberDetail(details, "retry_count"), budget: policy.max_retry_count, unit: "" },
  ];
  return <div className="telemetry-instrument" aria-label="Performance against selected policy budget">
    <div className="telemetry-instrument__head"><span>Policy budget</span><b>{check.status === "within_budget" ? "Within limits" : "Budget breached"}</b></div>
    {readings.map((reading) => {
      const ratio = reading.budget === 0 ? (reading.actual > 0 ? 1 : 0) : Math.min(reading.actual / reading.budget, 1);
      const exceeded = reading.actual > reading.budget;
      return <div className={`instrument-line ${exceeded ? "instrument-line--exceeded" : ""}`} key={reading.label}>
        <span>{reading.label}</span><div className="instrument-line__bar"><i style={{ width: `${Math.max(ratio * 100, 3)}%` }}></i></div><b>{reading.actual}{reading.unit} <small>/ {reading.budget}{reading.unit}</small></b>
      </div>;
    })}
  </div>;
}

function CheckCard({ check, policy }: { check: Check; policy: Policy }) {
  const evidence = check.evidence[0];
  const details = check.details;
  const duration = typeof details.duration_ms === "number" ? details.duration_ms : null;
  const tone = statusTone(check.status);
  return (
    <article className={`check-card check-card--${tone}`}>
      <div className="check-card__topline">
        <span className="eyebrow">{pretty(check.name)}</span>
        <span className={`status status--${check.status}`}>{statusLabel(check.status)}</span>
      </div>
      <div className="score-row">
        <strong>{Math.round(check.score * 100)}</strong><span>{scoreLabel(check)}</span>
        <span className="confidence">{Math.round(check.confidence * 100)}% confidence</span>
      </div>
      <p>{check.reason}</p>
      {check.status === "insufficient_evidence" && <div className="uncertainty-note"><b>Uncertainty, not a falsehood</b><span>No approved source was sufficient to verify this claim.</span></div>}
      {evidence && <div className="evidence"><span>{evidence.source_type ?? "Evidence"} · {evidence.title}</span><p>{evidence.excerpt}</p><small>{evidence.updated_at ? `Current as of ${evidence.updated_at}` : "Approved source"}</small></div>}
      {check.name === "cost_performance" && <TelemetryInstrument check={check} policy={policy} />}
      {duration !== null && <div className="check-duration">Completed in {duration}ms</div>}
      {check.flagged_spans.length > 0 && <div className="flagged"><span>Detected</span>{check.flagged_spans.map((span, index) => <mark key={`${span}-${index}`}>{span}</mark>)}</div>}
    </article>
  );
}

function ControlTower({ result }: { result: Evaluation }) {
  const lanes = [
    { name: "groundedness", label: "Evidence", description: "Approved-source match" },
    { name: "safety_pii", label: "Safety + privacy", description: "PII, bias, unsafe content" },
    { name: "cost_performance", label: "Performance", description: "Latency, tokens, retries" },
  ];
  return <section className="control-tower" aria-label="Parallel policy check readout">
    <div className="control-tower__header"><div><span>CONTROL TOWER</span><h3>Three checks, one release decision</h3></div><p>All lanes started in parallel · completed in <b>{result.total_check_latency_ms}ms</b></p></div>
    <div className="tower-lanes">
      {lanes.map((lane, index) => {
        const check = result.checks.find((item) => item.name === lane.name);
        if (!check) return null;
        const duration = numberDetail(check.details, "duration_ms");
        return <article className={`tower-lane tower-lane--${statusTone(check.status)}`} key={lane.name} style={{ "--lane-delay": `${index * 160}ms` } as CSSProperties}>
          <div className="tower-lane__signal"><span>{String(index + 1).padStart(2, "0")}</span><i></i></div>
          <div><span>{lane.label}</span><strong>{statusLabel(check.status)}</strong><small>{lane.description}</small></div>
          <div className="tower-lane__metric"><b>{Math.round(check.score * 100)}</b><span>score</span><small>{duration}ms</small></div>
        </article>;
      })}
      <div className={`tower-clearance tower-clearance--${result.decision.toLowerCase()}`}><span>RELEASE CLEARANCE</span><strong>{pretty(result.decision)}</strong><small>{releaseCopy(result.release_status)}</small></div>
    </div>
  </section>;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recorded just now";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function safeDraftFromPrompt(prompt: string) {
  const text = prompt.toLocaleLowerCase();
  if (/phone|email|contact|address|personal details|mobile number/.test(text)) {
    return "I can’t share someone’s private contact details. Please use the official support channel or ask the person to contact you directly.";
  }
  if (/hire|hiring|candidate|age|gender|religion|caste/.test(text)) {
    return "I can help assess candidates using job-relevant skills, experience, and structured interview criteria. Personal characteristics should not influence the decision.";
  }
  if (/return|refund|exchange/.test(text)) {
    return "I can help check the return policy. Please confirm the product, order date, and whether the item is unused so support can give you a verified answer.";
  }
  if (/delivery|shipping|arrive|dispatch/.test(text)) {
    return "I can help with delivery information. Please share the order reference through the official support flow so the latest status can be verified.";
  }
  return "I don’t have enough verified information to answer that safely. Please check an approved source or contact support for a confirmed answer.";
}

function App() {
  const [policies, setPolicies] = useState<Record<UseCase, Policy> | null>(demoPolicies);
  const [scenarios, setScenarios] = useState<Scenario[]>(demoScenarios);
  const [useCase, setUseCase] = useState<UseCase>("customer_support");
  const [scenarioId, setScenarioId] = useState("clean_answer");
  const [customPrompt, setCustomPrompt] = useState("How long will delivery take?");
  const [customResponse, setCustomResponse] = useState("Standard delivery takes 3 to 5 business days.");
  const [customTelemetry, setCustomTelemetry] = useState<Telemetry>({ latency_ms: 320, token_count: 16, retry_count: 0 });
  const [result, setResult] = useState<Evaluation | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [reviews, setReviews] = useState<Audit[]>([]);
  const [auditFilter, setAuditFilter] = useState<UseCase | "all">("all");
  const [reviewerId, setReviewerId] = useState("demo-reviewer");
  const [reviewNote, setReviewNote] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationMessage, setEvaluationMessage] = useState("Running parallel checks...");
  const [evaluationPhase, setEvaluationPhase] = useState<"idle" | "checking" | "waiting" | "complete">("idle");
  const [apiStatus, setApiStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [error, setError] = useState("");

  const isCustom = scenarioId === "custom";
  const activeScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0],
    [scenarioId, scenarios],
  );
  const activePolicy = policies?.[useCase];
  const resultFlaggedSpans = result ? result.checks.flatMap((check) => check.flagged_spans) : [];
  const visibleAudits = useMemo(
    () => auditFilter === "all" ? audits : audits.filter((audit) => audit.use_case === auditFilter),
    [auditFilter, audits],
  );
  const decisionMix = useMemo(() => useCaseOrder.map((profile) => {
    const records = audits.filter((audit) => audit.use_case === profile);
    const total = records.length;
    const allowed = records.filter((audit) => audit.final_decision === "ALLOW").length;
    const held = records.filter((audit) => audit.release_status !== "RELEASED").length;
    return { profile, total, allowed, held };
  }), [audits]);

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
      setError("The live policy engine is reconnecting. The demo policies and test cases are ready; allow up to 60 seconds for the free Render service, then retry evaluation.");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, []);

  function loadFixtureIntoSandbox() {
    if (!activeScenario) return;
    setCustomPrompt(activeScenario.prompt);
    setCustomResponse(activeScenario.response);
    setCustomTelemetry(activeScenario.telemetry);
    setScenarioId("custom");
    setResult(null);
  }

  function selectScenario(id: string) {
    setScenarioId(id);
    setResult(null);
  }

  function updateCustomPrompt(value: string) {
    setCustomPrompt(value);
    setCustomResponse(safeDraftFromPrompt(value));
    setResult(null);
  }

  function selectPolicy(profile: UseCase) {
    setUseCase(profile);
    setResult(null);
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
    setEvaluationPhase("checking");
    setEvaluationMessage("Starting parallel policy checks...");
    const wakingTimer = window.setTimeout(() => {
      setEvaluationPhase("waiting");
      setEvaluationMessage("Connecting to the policy engine...");
    }, 2500);
    const coldStartTimer = window.setTimeout(() => {
      setEvaluationMessage("Waking the free demo API — please keep this page open (up to 60 sec on first visit)...");
    }, 8000);
    try {
      const nextResult = await api.evaluate({ use_case: useCase, ...payload });
      setResult(nextResult);
      setEvaluationPhase("complete");
      await refreshRecords();
      setApiStatus("ready");
    } catch {
      setApiStatus("unavailable");
      setEvaluationPhase("idle");
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
      <header className="masthead">
        <div className="wordmark">ControlPlane<span>.ai</span></div>
        <p>Response release console · Team Cocomelon</p>
        <div className="engine-readout"><i className={`pulse pulse--${apiStatus}`}></i><span>Policy engine</span><strong>{apiStatus === "ready" ? "ONLINE" : apiStatus === "checking" ? "CONNECTING" : "RECONNECT NEEDED"}</strong></div>
      </header>

      <section className="console-brief" aria-labelledby="console-title">
        <div><p>LIVE RESPONSE CONTROL</p><h1 id="console-title">Run a response through<br /><em>its release gate.</em></h1></div>
        <p>Choose the policy context and a test signal. The engine checks evidence, safety, and operational cost in parallel before it releases, edits, holds, or blocks the response.</p>
      </section>

      {error && <div className="alert" role="alert"><span>{error}</span><button onClick={() => void loadData()}>Retry connection</button></div>}

      <section className="workspace" id="evaluation-console">
        <div className="panel panel--controls">
          <div className="section-title"><div><p>POLICY CONTROL</p><h2>Choose the risk profile</h2></div></div>
          <div className="policy-grid">
            {useCaseOrder.map((profile) => (
              <button key={profile} className={`policy-card ${profile === useCase ? "policy-card--active" : ""}`} onClick={() => selectPolicy(profile)}>
                <span>{profile === "decision_support" ? "High stakes" : profile === "customer_support" ? "Customer facing" : "Internal"}</span>
                <strong>{policies ? policies[profile].label : pretty(profile)}</strong>
                <small>{policies ? policies[profile].description : "Loading policy..."}</small>
                {policies && <div className="policy-readouts"><span><b>Evidence</b>{Math.round(policies[profile].minimum_groundedness_score * 100)}%</span><span><b>PII</b>{pretty(policies[profile].pii_action)}</span><span><b>Latency</b>{policies[profile].max_latency_ms}ms</span></div>}
              </button>
            ))}
          </div>
          {activePolicy && <><div className="policy-summary">
            <span><b>Version</b>{activePolicy.version}</span><span><b>Evidence</b>≥ {Math.round(activePolicy.minimum_groundedness_score * 100)}%</span><span><b>Latency</b>≤ {activePolicy.max_latency_ms}ms</span><span><b>PII</b>{pretty(activePolicy.pii_action)}</span>
          </div><details className="policy-details"><summary>View configured actions</summary><p>Unsupported → {pretty(activePolicy.unsupported_claim_action)} · Insufficient evidence → {pretty(activePolicy.insufficient_evidence_action)} · Unsafe content → {pretty(activePolicy.unsafe_content_action)} · Cost overrun → {pretty(activePolicy.cost_overrun_action)}</p></details></>}
        </div>

        <div className="panel panel--scenario">
          <div className="section-title"><div><p>RESPONSE GATE</p><h2>Choose a test signal</h2></div><span className="scenario-count">{scenarios.length || 6} test cases</span></div>
          <div className="scenario-deck" aria-label="Demo scenarios">
            {scenarios.map((scenario) => {
              const meta = scenarioMeta[scenario.id] ?? { signal: "Scenario", description: scenario.label, tone: "clear" as const };
              return <button key={scenario.id} className={`scenario-card scenario-card--${meta.tone} ${scenario.id === scenarioId ? "scenario-card--active" : ""}`} onClick={() => selectScenario(scenario.id)} aria-pressed={scenario.id === scenarioId}><span>{meta.signal}</span><strong>{scenario.label}</strong><small>{meta.description}</small></button>;
            })}
            <button className={`scenario-card scenario-card--custom ${isCustom ? "scenario-card--active" : ""}`} onClick={() => selectScenario("custom")} aria-pressed={isCustom}><span>Sandbox</span><strong>Try your own</strong><small>Paste a prompt, response, and telemetry.</small></button>
          </div>
          {isCustom ? <div className="sandbox-grid">
            <label>User prompt<textarea value={customPrompt} onChange={(event) => updateCustomPrompt(event.target.value)} maxLength={5000} /></label>
            <label>Suggested safe response<textarea value={customResponse} onChange={(event) => setCustomResponse(event.target.value)} maxLength={8000} /></label>
            <div className="sandbox-draft-note"><span>Safe draft</span><p>We update this draft when the prompt changes, using the selected policy context. You can still edit it before checking it.</p><button type="button" className="text-button" onClick={() => setCustomResponse(safeDraftFromPrompt(customPrompt))}>Refresh safe draft</button></div>
            <div className="telemetry-inputs"><label>Latency (ms)<input type="number" min="0" value={customTelemetry.latency_ms} onChange={(event) => setCustomTelemetry({ ...customTelemetry, latency_ms: numberOrZero(event.target.value) })} /></label><label>Tokens<input type="number" min="0" value={customTelemetry.token_count} onChange={(event) => setCustomTelemetry({ ...customTelemetry, token_count: numberOrZero(event.target.value) })} /></label><label>Retries<input type="number" min="0" value={customTelemetry.retry_count} onChange={(event) => setCustomTelemetry({ ...customTelemetry, retry_count: numberOrZero(event.target.value) })} /></label></div>
          </div> : <><div className="content-grid"><div><span className="content-label">User prompt</span><p>{activeScenario?.prompt ?? "Loading..."}</p></div><div><span className="content-label">Simulated AI response</span><p>{activeScenario?.response ?? "Loading..."}</p></div></div>{activeScenario && <div className="fixture-tools"><p className="fixture-meta">Fixture telemetry · {activeScenario.telemetry.latency_ms}ms · {activeScenario.telemetry.token_count} tokens · {activeScenario.telemetry.retry_count} retries</p><button className="text-button" onClick={loadFixtureIntoSandbox}>Edit in sandbox</button></div>}</>}
          <ol className={`evaluation-pipeline evaluation-pipeline--${evaluationPhase}`} aria-label="Evaluation pipeline"><li><span></span><div><b>Evidence</b><small>Approved-source match</small></div></li><li><span></span><div><b>Safety</b><small>PII, bias, unsafe content</small></div></li><li><span></span><div><b>Performance</b><small>Latency, tokens, retries</small></div></li></ol>
          <button className="evaluate" onClick={() => void runEvaluation()} disabled={isEvaluating || (!isCustom && !activeScenario)}>{isEvaluating ? evaluationMessage : "Evaluate response"}</button>
          {isEvaluating && <p className="evaluation-hint" role="status">The response remains held until the policy decision is complete.</p>}
        </div>
      </section>

      {result && <section className="result-section" id="control-tower-results" key={result.audit_id}>
        <div className="section-title"><div><p>DECISION ENGINE</p><h2>Release decision</h2></div><span className="result-time">TOTAL {result.total_check_latency_ms}ms</span></div>
        <ControlTower result={result} />
        <div className="result-layout">
          <div className="decision-panel">
            <div className={decisionClass(result.decision)}>{pretty(result.decision)}</div><h3>{result.decision_reason}</h3>
            {result.end_user_response && result.end_user_response !== result.raw_response ? <div className="response-comparison">
              <article className="response-channel response-channel--operator"><span>Original model output · operator only</span><HighlightedResponse text={result.raw_response} spans={resultFlaggedSpans} /></article>
              <article className="response-channel response-channel--released"><span>What the end user sees</span><p>{result.end_user_response}</p></article>
            </div> : <>
              <div className={`release-state release-state--${result.release_status.toLowerCase()}`}><span>{releaseCopy(result.release_status)}</span><p>{result.end_user_response ?? "The original output remains restricted inside the control plane and has not been released."}</p></div>
              {result.decision === "ALLOW" ? <div className="source-match"><span>Source integrity</span><p>The approved source output and released response match exactly.</p></div> : <div className="raw-response"><span>Original model output · operator only</span><HighlightedResponse text={result.raw_response} spans={resultFlaggedSpans} /></div>}
            </>}
            <p className="audit-id">Audit ID · {result.audit_id} · 3 checks completed concurrently in {result.total_check_latency_ms}ms</p>
          </div>
          <div className="check-grid">{result.checks.map((check) => <CheckCard key={check.name} check={check} policy={result.policy} />)}</div>
        </div>
        <div className="decision-trace"><div><span className="trace-label">DECISION PRECEDENCE</span><h3>Why this action was selected</h3><p>Ordered rules make the policy decision inspectable, not opaque.</p></div><ol>{result.decision_trace.map((step, index) => <li key={step.order} style={{ "--trace-delay": `${520 + index * 120}ms` } as CSSProperties}><span className="trace-order">{String(step.order).padStart(2, "0")}</span><span>{step.rule}</span><b>{pretty(step.outcome)}</b><p>{step.detail}</p></li>)}</ol></div>
      </section>}

      <section className="operations-grid">
        <div className="panel review-panel" id="review-queue">
          <div className="section-title"><div><p>HUMAN IN THE LOOP</p><h2>Review queue</h2></div><span className="queue-count">{reviews.filter((review) => review.review_status === "PENDING").length} PENDING</span></div>
          {reviews.some((review) => review.review_status === "PENDING") && <div className="review-form"><label>Reviewer ID<input value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} maxLength={100} /></label><label>Reason required for override<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={1000} placeholder="State why the policy outcome is being changed." /></label></div>}
          {reviews.length === 0 ? <div className="empty-state"><span>Queue clear</span><p>No cases are waiting for a reviewer.</p></div> : reviews.map((review) => (
            <div className="review-card" key={review.audit_id}>
              <div className="review-card__summary"><div><strong>{pretty(review.use_case)}</strong><span>{review.decision_reason}</span></div>{review.flagged_spans.length > 0 && <div className="review-flags">{review.flagged_spans.slice(0, 2).map((span) => <mark key={span}>{span}</mark>)}</div>}<small className={`review-status review-status--${(review.review_status ?? "PENDING").toLowerCase()}`}>{pretty(review.review_status ?? "PENDING")} · {review.audit_id.slice(0, 8)}</small></div>
              {review.review_status === "PENDING" && <div className="review-actions"><button onClick={() => void resolveReview(review.audit_id, "APPROVED")}>Approve hold</button><button className="button--ghost" onClick={() => void resolveReview(review.audit_id, "OVERRIDDEN")}>Override</button></div>}
            </div>
          ))}
        </div>

        <div className="panel audit-panel" id="audit-trail">
          <div className="section-title"><div><p>OBSERVABILITY</p><h2>Audit trail</h2></div></div>
          <div className="decision-mix" aria-label="Decision mix by use case">
            {decisionMix.map((mix) => <div className="mix-card" key={mix.profile}><span>{pretty(mix.profile)}</span><div><i style={{ width: `${mix.total ? (mix.allowed / mix.total) * 100 : 0}%` }}></i><b style={{ width: `${mix.total ? (mix.held / mix.total) * 100 : 0}%` }}></b></div><small>{mix.total ? `${mix.allowed} released · ${mix.held} held` : "No evaluations yet"}</small></div>)}
          </div>
          <div className="audit-toolbar"><span>Filter by policy</span><div>{(["all", ...useCaseOrder] as Array<UseCase | "all">).map((filter) => <button key={filter} className={auditFilter === filter ? "audit-filter--active" : ""} onClick={() => setAuditFilter(filter)}>{filter === "all" ? "All" : pretty(filter)}</button>)}</div></div>
          <div className="audit-head"><span>Decision</span><span>Use case</span><span>Recorded</span><span>Evidence</span><span>Telemetry</span></div>
          {visibleAudits.slice(0, 10).map((audit) => <details className="audit-entry" key={audit.audit_id}><summary className="audit-row"><span className={decisionClass(audit.final_decision)}>{pretty(audit.final_decision)}</span><span>{pretty(audit.use_case)}</span><span>{formatTimestamp(audit.created_at)}</span><span>{pretty(audit.groundedness_status)}</span><span>{audit.cost_latency_ms}ms · {audit.cost_token_count}t</span></summary><div className="audit-detail"><p><b>Audit ID:</b> {audit.audit_id}</p><p><b>Decision:</b> {audit.decision_reason}</p><p><b>Recorded steps:</b> {audit.decision_trace.map((step) => `${step.rule}: ${pretty(step.outcome)}`).join(" → ") || "Legacy audit record"}</p></div></details>)}
          {audits.length === 0 && <div className="empty-state"><span>Awaiting first record</span><p>Run a scenario to create the first audit entry.</p></div>}
          {audits.length > 0 && visibleAudits.length === 0 && <div className="empty-state"><span>No matching records</span><p>Try a different policy filter.</p></div>}
        </div>
      </section>

      <footer><span>ControlPlane.ai</span> · Policy-driven responsible AI infrastructure · Prototype data only</footer>
    </main>
  );
}

export default App;
