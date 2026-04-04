# Guard Registry — Vollständige CI/CD-Guard-Übersicht

> **Letztes Update:** 2026-03-15  
> **Quelle:** `.github/workflows/` + `scripts/guards/` + `scripts/ci/`

---

## Übersicht

Das System verwendet **30+ GitHub Actions Workflows** und **8+ Guard Scripts** zur automatischen Regressionsprävention.

---

## 1. Guard Scripts (`scripts/guards/`)

Diese Scripts werden von CI-Workflows und dem Meta-Runner `run-all.mjs` ausgeführt.

| Script | Zweck | Level | Prüft |
|--------|-------|-------|-------|
| `ssot-guard.mjs` | Blockiert direkte `.from()` DB-Reads im Frontend | **HARD FAIL** | Kein `supabase.from()` in UI-Komponenten |
| `blueprint-guard.mjs` | Blockiert "freie" Fragengenerierung ohne Blueprint | **HARD FAIL** | Keine `generateQuestion()` o.ä. ohne Blueprint-Kontext |
| `curriculum-freeze-guard.mjs` | Schützt eingefrorene Curriculum-Assets | **HARD FAIL** | Keine Modifikation bestehender Migrations/SSOT-Docs |
| `edge-import-guard.mjs` | Kontrolliert Edge-Function-Imports | **HARD FAIL** | Keine verbotenen Import-Muster |
| `hard-literal-guard.mjs` | Blockiert Magic Numbers außerhalb Config | **HARD FAIL** | Keine `500`, `1000`, `313` als Literale |
| `pipeline-contract-guard.mjs` | Prüft STEP_KEYS.md Existenz und Vollständigkeit | **HARD FAIL** | SSOT-Marker + Step-Keys vorhanden |
| `integrity-track-aware-guard.mjs` | Integrity-Gate muss track-aware sein | **HARD FAIL** | Threshold-Map, Track-Resolver, EXAM_FIRST-Entry |
| `no-nano-learning-content-guard.mjs` | Kein gpt-5-nano für Learning Content | **HARD FAIL** | Kein `nano` + `learning_content` im selben Routing-Kontext |
| `no-direct-llm-fetch-guard.mjs` | Kein direkter LLM-API-Fetch | **HARD FAIL** | Alle LLM-Calls über `_shared/ai-client.ts` |
| `no-legacy-entitlement-rpc-guard.mjs` | Blockiert gelöschte Legacy-Entitlement-RPCs | **HARD FAIL** | Kein `check_user_entitlement`, `get_user_entitlements*` |
| `dag-parity-guard.mjs` | Pipeline-DAG ↔ Step-Order ↔ Job-Map Synchronität | **HARD FAIL** | FULL_STEP_ORDER, PIPELINE_GRAPH, STEP_TO_JOB_TYPE, JOB_DEFINITIONS bidirektional konsistent |

**Meta-Runner:**
- `run-all.mjs` — Führt alle Guards sequenziell aus
- `run-changed.mjs` — Führt nur Guards für geänderte Dateien aus

---

## 2. CI-Scripts (`scripts/ci/`)

| Script | Zweck | Level |
|--------|-------|-------|
| `check-step-mapping-parity.mjs` | TypeScript ↔ DB ↔ Runner Step-Mapping synchron | **HARD FAIL** |
| `post-deploy-healthcheck.mjs` | Smoke-Test nach Deploy | **HARD FAIL** |
| `issue-on-fail.mjs` | Erstellt GitHub Issue bei Guard-Failure | Utility |

---

## 3. Standalone Guard Scripts (`scripts/`)

| Script | Zweck | Level |
|--------|-------|-------|
| `ci-ssot-guards.sh` | UI SSOT Guards (raw titles, council badge, direct reads, gender) | **HARD FAIL** + WARNING |
| `ssot-guard.mjs` | Frontend `.from()` Guard (Legacy, Duplikat von guards/) | **HARD FAIL** |
| `schema-drift-check.mjs` | Schema-Drift zwischen Code und DB | **HARD FAIL** |
| `rls-security-check.mjs` | RLS-Policy Regression | **HARD FAIL** |
| `security-invariants-check.mjs` | Security Invariants (DEFINER, Views, etc.) | **HARD FAIL** |
| `council-integrity-check.mjs` | Quality Council Konsistenz | WARNING |
| `cost-budget-check.mjs` | AI-Budget-Einhaltung | WARNING |
| `check-pool-contract.ts` | Pool-Contract Golden Snapshot | **HARD FAIL** |
| `edge-guards.ts` | Edge Function SSOT + Sicherheit | **HARD FAIL** |
| `dedupe-scan.mjs` | Duplikat-Detection in Paketen | WARNING |
| `lf-elite-policy-check.mjs` | Lernfeld Elite-Policy Compliance | WARNING |
| `deep-data-integrity-audit.mjs` | Tiefe Datenintegrität | WARNING |
| `job-queue-health-check.mjs` | Job-Queue Gesundheit | WARNING |
| `master-platform-audit.mjs` | Plattform-weiter Audit | WARNING |
| `pipeline-change-audit.mjs` | Pipeline-Änderungs-Audit | WARNING |
| `smoke-published-approved.mjs` | Published Packages haben approved Questions | **HARD FAIL** |
| `e2e-platform-audit.mjs` | End-to-End Plattform-Audit | WARNING |

---

## 4. GitHub Actions Workflows (`.github/workflows/`)

### Build & Quality

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | PR + push main | SSOT Guard, TypeCheck+Build, Vitest, Bundle Size, Lighthouse, Schema Drift, Security Audit, Published Smoke |
| `edge-ci.yml` | PR + push main | Deno Check/Lint, Edge Guards, ESM.SH Guard, Deno.land Guard, SSOT Done-Write Guard, No-Gemini Guard, No-Direct-LLM Guard |
| `pr-preview-deploy.yml` | PR | Preview Deploy |
| `release-train.yml` | Tag/Release | Production Deploy |

### SSOT & Contract Enforcement

| Workflow | Trigger | Zweck |
|----------|---------|-------|
| `ssot-guard.yml` | PR + push main | UI SSOT Guards (4 Guards, sh) |
| `pipeline-mapping-parity.yml` | PR + push main | Step Mapping Parity (TS ↔ DB ↔ Runner) |
| `schema-drift-guard.yml` | PR + push main | Schema Drift Detection |
| `schema-drift-detector.yml` | Schedule | Nightly Schema Drift |
| `guard-no-examfirst-default.yml` | PR + push main | EXAM_FIRST Track-Block |

### Security

| Workflow | Trigger | Zweck |
|----------|---------|-------|
| `security-smoke.yml` | Hourly | Stündliche RLS-Checks |
| `security-abuse-simulation.yml` | 6h | Abuse-Simulation (Rate Limits) |
| `security-deep-audit.yml` | Nightly | Tiefer Security-Audit |
| `security-invariants.yml` | PR + push main | Security Invariants Check |
| `rls-security-regression.yml` | PR + push main | RLS Regression |
| `security-cleanup.yml` | Schedule | Bereinigung abgelaufener Tokens |
| `dependency-security-audit.yml` | Schedule | npm Audit |

### Pipeline & Ops

| Workflow | Trigger | Zweck |
|----------|---------|-------|
| `nightly-pipeline-guards.yml` | Nightly 02:10 UTC | Pipeline-Integrität + Auto-Quarantine |
| `hourly-system-guard-and-revive.yml` | Hourly | System Guard + Auto-Revive |
| `job-queue-health-monitor.yml` | Schedule | Job Queue Monitoring |
| `ops-guard-alerts.yml` | Schedule | Ops-Warnungen |
| `deploy-smoke-check.yml` | Post-Deploy | Smoke nach Deploy |
| `edge-deploy-healthcheck.yml` | Post-Deploy | Edge Function Health |

### Quality & Content

| Workflow | Trigger | Zweck |
|----------|---------|-------|
| `content-quality-gate.yml` | PR + push main | Content Quality Enforcement |
| `council-integrity-gate.yml` | PR + push main | Council Integrity |
| `duplicate-detector.yml` | Schedule | Duplikat-Erkennung |
| `lf-elite-policy-gate.yml` | PR + push main | Elite Policy Compliance |

### Cost & Budget

| Workflow | Trigger | Zweck |
|----------|---------|-------|
| `cost-token-budget-gate.yml` | PR + push main | Token/Budget Limits |
| `export-audit.yml` | Schedule | Export-Audit (Kostencontrol) |

### Testing

| Workflow | Trigger | Zweck |
|----------|---------|-------|
| `e2e-full-journey.yml` | Schedule | Full E2E Journey |
| `learner-e2e.yml` | PR + push main | Learner-E2E Tests |

---

## 5. Guard-Enforcement-Matrix

| Domain | CI Guard | Runtime Guard | DB Guard | Nightly Sweep |
|--------|----------|---------------|----------|---------------|
| Pool Routing | ✅ `check-pool-contract` | ✅ Enqueue Guard + Auto-Fix | — | ✅ stuck-scan |
| Step Order | ✅ `edge-guards.ts` | ✅ Runner Boot Validation | — | ✅ SSOT_STEP_UNKNOWN |
| Naming/Titles | ✅ `ci-ssot-guards.sh` | — | ✅ `normalize_course_title()` | ✅ Collision Views |
| Exam Questions | ✅ `ssot-guard.mjs` | — | ✅ 7× Elite Constraints | ✅ Integrity Check |
| Published Packages | ✅ `smoke-published-approved` | — | ✅ Immutability Trigger | ✅ Hollow-Published Guard |
| Security | ✅ `rls-security-check` | ✅ SECURITY DEFINER | ✅ RLS Policies | ✅ Hourly Smoke |
| Track Governance | ✅ `guard-no-examfirst` | ✅ DB Trigger | ✅ `trg_guard_no_exam_first` | — |
| LLM Access | ✅ `no-direct-llm-fetch` | ✅ `ai-client.ts` Wrapper | — | — |
| Content Quality | ✅ `content-quality-gate` | ✅ Quality Council | ✅ Auto-Approve Trigger | ✅ Nightly Guards |
| Budget | ✅ `cost-budget-check` | ✅ Budget Policies | ✅ `ai_budget_policies` | ✅ Daily Budget Check |

---

## 6. Hinzufügen neuer Guards

1. Script in `scripts/guards/` erstellen
2. In `run-all.mjs` registrieren
3. GitHub Workflow erstellen oder bestehendem hinzufügen
4. In dieser Registry dokumentieren
5. Enforcement-Matrix aktualisieren
6. `docs/GOVERNANCE.md` Invariants prüfen

---

## 5. Runtime Guards (DB-Level)

| Guard | Zweck | Level | Mechanismus |
|-------|-------|-------|-------------|
| `enqueue_job_if_absent()` | Verhindert aktive Job-Dubletten | **HARD BLOCK** | RPC: idempotenter Insert mit Dedupe-Check |
| `v_ops_job_failure_classification` | Klassifiziert Failures in protected_stop vs real_failure | **INFO** | DB View auf `job_queue` |
| `v_ops_job_failure_summary_24h` | 24h-KPI-Zusammenfassung | **INFO** | Aggregat-View |

---

## Änderungshistorie

| Datum | Änderung |
|-------|----------|
| 2026-03-15 | Initial Registry erstellt |
| 2026-03-15 | Runtime Guards: enqueue_job_if_absent, Failure Classification Views |
