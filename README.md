# ControlPlane.ai

> A policy-driven safety layer that decides whether an AI response can be released - before it reaches the user.

**Accenture Innovation Challenge 2026 - Round 2**
**Track 1: ControlPlane.ai | Team Cocomelon | IIT (ISM) Dhanbad**

ControlPlane.ai is a working responsible-AI middleware prototype. It evaluates a generated AI response through three parallel checks, applies a policy tailored to the selected use case, returns a transparent decision, and persists an auditable record.

> This is a controlled proof of concept. All people, contact details, and HR data in demo fixtures are fictional.

## Why it matters

AI systems can appear confident while being unsupported, unsafe, privacy-invasive, or unnecessarily expensive. In many enterprise workflows, discovering those failures after a response has been used is too late.

ControlPlane.ai sits at the model input/output boundary. It does not require access to a model's internals; it evaluates the response before release and selects one of four actions:

| Decision | Meaning |
| --- | --- |
| `ALLOW` | The response meets the active use-case policy. |
| `AUTO_EDIT` | A low-risk unsupported claim is safely replaced with a transparent response. |
| `FLAG_FOR_HUMAN_REVIEW` | A reviewer must approve or override the response. |
| `BLOCK` | The response is withheld from the end user. |

## What the prototype demonstrates

- **Three checks in parallel:** groundedness, safety/PII, and cost/performance.
- **Configurable policy profiles:** customer support, internal knowledge assistant, and high-stakes decision support.
- **Evidence-aware uncertainty:** `insufficient_evidence` is explicit; the system does not falsely claim verification when it cannot find a relevant approved source.
- **Tiered intervention:** allow, automatic edit, review queue, or block.
- **Traceability:** each evaluation creates a SQLite-backed audit record containing policy version, scores, evidence, reasons, telemetry, and reviewer activity.
- **Human override:** review cases can be approved or overridden without losing the original decision trail.

## Architecture

```text
                         ┌──────────────────────┐
                         │  React dashboard     │
                         │  policy + review UI  │
                         └──────────┬───────────┘
                                    │ POST /api/evaluate
                         ┌──────────▼───────────┐
                         │   FastAPI gateway    │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐
    │ Groundedness     │  │ Safety / PII     │  │ Cost / performance│
    │ local evidence   │  │ deterministic    │  │ telemetry budgets │
    └────────┬─────────┘  └────────┬─────────┘  └────────┬──────────┘
             └─────────────────────┼─────────────────────┘
                                   ▼
                        ┌──────────────────────┐
                        │ Policy decision      │
                        │ allow/edit/flag/block│
                        └──────────┬───────────┘
                                   ▼
                        ┌──────────────────────┐
                        │ SQLite audit trail   │
                        │ + human review queue │
                        └──────────────────────┘
```

### Processing flow

1. An operator selects one of three use-case policy profiles.
2. The gateway receives a prompt, AI response, and telemetry.
3. The three checks run concurrently using `asyncio.gather`.
4. The policy engine resolves overlapping risks using explicit precedence.
5. The decision, evidence, highlighted risky spans, telemetry, and active policy version are written to the audit log.
6. A flagged case appears in the reviewer queue; a reviewer can approve or override it.

## Policy profiles

| Profile | Core behaviour |
| --- | --- |
| `customer_support` | Tight latency budget. Minor unsupported claims can be auto-edited; PII is blocked. |
| `internal_knowledge_assistant` | Balanced latency and evidence thresholds. Ambiguous cases are routed to review. |
| `decision_support` | Highest groundedness threshold. Unsupported or unverified claims are blocked. |

This makes policy variation visible in the demo: the same unsupported return-policy claim is `AUTO_EDIT` for customer support and `BLOCK` for decision support.

## Detection approach

| Check | Implementation | What it returns |
| --- | --- | --- |
| Groundedness | Transparent token-overlap similarity against five approved local evidence documents | score, confidence, sources, `grounded`, `unsupported_claim`, or `insufficient_evidence` |
| Safety / PII | Explainable regex and pattern checks for emails, phone numbers, sensitive HR data, unsafe advice, and age bias | flags, PII entities, risky spans, severity |
| Cost / performance | Policy-budget comparison using telemetry | latency/tokens/retries, budget breach status |

The design deliberately avoids using a second frontier model as a live judge for every request. The checks are inexpensive, explainable, and suitable for a controlled hackathon demonstration.

## Demo scenarios

| Scenario | Demonstrates | Expected behaviour |
| --- | --- | --- |
| Clean supported answer | Evidence-backed delivery response | `ALLOW` |
| Unsupported return-policy claim | Same content changes outcome by policy | `AUTO_EDIT` for customer support; `BLOCK` for decision support |
| PII leak | Email and phone detection | `BLOCK` |
| Biased hiring suggestion | Human review versus strict blocking | `FLAG_FOR_HUMAN_REVIEW` or `BLOCK` |
| Sensitive overlap case | Unverifiable personal/HR detail plus email | `insufficient_evidence` plus PII detection; `BLOCK` |

## Repository structure

```text
controlplane-ai/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI routes
│   │   ├── database.py             # SQLite audit + review persistence
│   │   ├── schemas.py              # Request/response models
│   │   └── services/               # Checks, evaluator, policy engine
│   ├── data/                       # Policies, evidence base, demo fixtures
│   ├── tests/                      # Decision and concurrency tests
│   └── requirements.txt
├── frontend/
│   ├── src/App.tsx                 # Dashboard and human review UI
│   ├── src/api.ts                  # API client
│   └── src/styles.css              # Visual system
└── README.md
```

## Run locally

### Prerequisites

- Python 3.11+
- Node.js 20+
- pnpm 9+ (or npm)

### 1. Start the FastAPI backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://127.0.0.1:8000`; interactive API documentation is at `http://127.0.0.1:8000/docs`.

### 2. Start the React frontend

Open another terminal:

```powershell
cd frontend
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`.

## Test and build

### Backend tests

```powershell
cd backend
python -m unittest discover -s tests -v
```

The test suite validates all five demo cases, policy-dependent outcomes, and the concurrent-check pattern.

### Frontend production build

```powershell
cd frontend
pnpm build
```

## API summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/policies` | Return policy profiles and thresholds. |
| `GET` | `/api/scenarios` | Return deterministic demo fixtures. |
| `POST` | `/api/evaluate` | Run the three checks and create an audit entry. |
| `GET` | `/api/audits` | Read recent audit records. |
| `GET` | `/api/reviews` | Read review-queue cases. |
| `POST` | `/api/reviews/{audit_id}` | Approve or override a review case. |

Example evaluation request:

```json
{
  "use_case": "decision_support",
  "prompt": "Can I return headphones?",
  "response": "All electronics can be returned for 90 days, even after use.",
  "telemetry": {
    "latency_ms": 412,
    "token_count": 18,
    "retry_count": 0
  }
}
```

## Real versus simulated

### Implemented for real

- Policy configuration and policy-dependent decision logic
- Concurrent check orchestration
- Local evidence matching and explicit uncertainty handling
- Deterministic safety/PII detection
- Audit persistence and review actions
- React dashboard and FastAPI API flow

### Simulated deliberately

- The upstream generative AI response
- Latency, token, and retry telemetry
- Enterprise documents and real user data

## Assumptions and limitations

- Groundedness is controlled evidence similarity, not universal truth verification.
- Pattern-based safety detection is illustrative and must be expanded before real-world use.
- This is not production software or a substitute for legal, regulatory, clinical, HR, or security review.
- A future enterprise implementation would add role-based access controls, encrypted audit retention, governed connectors, policy management workflows, detection evaluation, and monitoring.

## Team

**Team Cocomelon** - IIT (ISM) Dhanbad
Hiten Arora · Somesh Gupta · Ravi Verma
