# ExamFit Platform Governance

> **Owner:** Architecture  
> **Letztes Update:** 2026-03-15  
> **Status:** Production — alle Guards aktiv

---

## Zweck

Dieses Dokument ist der **zentrale Einstiegspunkt** für die gesamte System-Governance.
Es verknüpft alle Regeln, Guards, Invarianten und Enforcement-Schichten zu einem geschlossenen System.

**Kernprinzip:** Jede kritische Regel wird auf mindestens 3 Ebenen durchgesetzt:

```
SSOT (Datenquelle) → Contract (Vertrag) → CI Guard → Runtime Guard → Sweep → Monitoring
```

---

## Governance-Landkarte

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        GOVERNANCE LAYERS                                │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │   Database   │  │   Backend   │  │  Frontend   │  │     CI/CD    │  │
│  │             │  │             │  │             │  │              │  │
│  │ • RLS       │  │ • Edge Fns  │  │ • SSOT Views│  │ • 30+ Guards │  │
│  │ • Triggers  │  │ • Runners   │  │ • Canonical │  │ • 8 Guard    │  │
│  │ • Views     │  │ • Job Queue │  │   Titles    │  │   Scripts    │  │
│  │ • Functions │  │ • AI Client │  │ • Badge Gov │  │ • Nightly    │  │
│  │ • Constraints│ │ • Enqueue   │  │ • Track     │  │   Sweeps     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  │
│         │                │                │                │          │
│         └────────────────┴────────────────┴────────────────┘          │
│                                   │                                    │
│                          Observability                                  │
│                    (Leitstelle, Ops Views,                              │
│                     Auto-Heal, Forensics)                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. SSOT-Domains

Jede Domain hat genau **eine** autoritative Quelle. Duplikation ist ein Bug.

### 1.1 Pipeline & Job System

| SSOT | Datei | Zweck |
|------|-------|-------|
| Job-Definitionen | `_shared/job-map.ts` → `JOB_DEFINITIONS` | Steps, DAG, Pool-Routing |
| Step-Reihenfolge | `_shared/job-map.ts` → `FULL_STEP_ORDER` | Topologische Ordnung |
| Step → Job Mapping | `_shared/job-map.ts` → `STEP_TO_JOB_TYPE` | Deterministisches Mapping |
| Pipeline-Graph | `_shared/job-map.ts` → `PIPELINE_GRAPH` | DAG mit Abhängigkeiten |
| Pool-Vertrag | `scripts/job-pool-contract.json` | Golden Snapshot für CI |
| Enqueue-Guard | `_shared/enqueue.ts` | Pool-Validierung bei Erstellung |
| Time-Budgets | `_shared/time-budget.ts` | Edge-Zeitlimits |
| Worker-Concurrency | `_shared/worker-config.ts` | Runner-Governance |

**Referenz:** [SSOT_POOL_RULES.md](SSOT_POOL_RULES.md) · [SSOT_STEP_ORDER_GOVERNANCE.md](SSOT_STEP_ORDER_GOVERNANCE.md) · [pipeline/STEP_KEYS.md](pipeline/STEP_KEYS.md)

### 1.2 Naming & Titel

| SSOT | Objekt | Zweck |
|------|--------|-------|
| Alias-Mapping | `course_title_aliases` (DB-Tabelle) | Alias → Canonical |
| Normalisierung | `normalize_course_title()` (DB-Funktion) | Trim, Case, Alias-Auflösung |
| Anzeige-View | `v_course_display_ssot` | Einzige Quelle für UI-Titel |
| Admin-Liste | `v_admin_visible_course_packages` | Dedupliziert, gefiltert |
| Frontend-Hook | `useCanonicalTitles()` | React-Zugriff auf SSOT |
| Titel-Resolver | `resolveTitle()` | Fallback-sicher |

**Referenz:** [ssot-naming-architecture.md](ssot-naming-architecture.md) · [ssot-allowlist.md](ssot-allowlist.md)

### 1.3 Exam Questions

| SSOT | Objekt | Zweck |
|------|--------|-------|
| Exam-Relevant | `v_exam_relevant_questions` (View) | Zähl-Definition |
| Count-RPC | `count_exam_relevant()` | Standardisierter Zugriff |
| LF-Counts | `get_exam_question_counts_by_lf()` | Pro Lernfeld |

**Drei semantische Tiers:**

1. **Existence** — Existiert überhaupt etwas? (any status)
2. **Exam-Relevant** — Zählt zum Ziel? (View/RPC — **Standard-Tier**)
3. **Validated Pool** — Publish-ready? (approved + Quality Gates)

**Referenz:** [SSOT_RULES.md](SSOT_RULES.md)

### 1.4 Quality & Publish Gate

| SSOT | Objekt | Zweck |
|------|--------|-------|
| Integrity Check | `run_integrity_check` | Track-aware Integritätsprüfung |
| Publish Gate | `auto_publish` Step | 6 harte Blocker |
| Quality Council | `quality_council` Step | AI-Review vor Publish |
| Immutability Guard | `guard_published_package_immutable` (Trigger) | Schutz veröffentlichter Pakete |

**Harte Publish-Blocker:**

| Blocker | Schwelle |
|---------|----------|
| `EXAM_POOL` | ≥ 500 genehmigte Fragen |
| `HARDISH_TOO_LOW` | ≥ 40% hard/very_hard |
| `BLOOM_GATE` | ≥ 12% UNDERSTAND-Level |
| `ELITE_CONTEXT` | ≤ 30% isoliertes Wissen |
| `COMPETENCY_COVERAGE` | ≥ 85% Kompetenz-Abdeckung |
| `MINICHECK_UNPARSED` | Keine leeren Mini-Checks |

### 1.5 Security & Auth

| SSOT | Mechanismus | Zweck |
|------|-------------|-------|
| RLS | Row-Level Security | Datenzugriffskontrolle |
| Service-Only RPCs | `SECURITY DEFINER` | Systemkritische Operationen |
| Safe Views | `v_exam_questions_safe` | Lösungsschlüssel ausfiltern |
| Rate Limiting | Bucketed Windowing | Abuse-Prevention |
| Audit | `ai_tutor_logs`, `admin_actions` | Forensic Trail |

---

## 2. Enforcement-Schichten

### Schicht 1 — Datenbank (Constraints & Triggers)

| Guard | Typ | Scope |
|-------|-----|-------|
| 7× Elite Governance Constraints | CHECK/TRIGGER | `exam_questions` Approval |
| `guard_published_package_immutable` | TRIGGER | Veröffentlichte Pakete |
| `trg_guard_no_exam_first` | TRIGGER | Track-Enforcement |
| `trg_auto_approve_pipeline_content` | TRIGGER | Pipeline-Deadlock-Prävention |
| `trg_sync_content_to_lessons` | TRIGGER | Content-Version → Lesson-Cache |
| RLS Policies | POLICY | Alle User-facing Tabellen |

### Schicht 2 — Backend (Runtime Guards)

| Guard | Location | Behavior |
|-------|----------|----------|
| Enqueue Pool Guard | `_shared/enqueue.ts` | Throws `SSOT_POOL_GUARD` on mismatch |
| Claim Auto-Fix | `content-runner`, `job-runner` | Auto-korrigiert Pool, setzt `meta.pool_autofixed` |
| Step SSOT Validation | Runner Boot | Prüft DB-Steps gegen SSOT |
| Time Budget Guard | Edge Functions | Enforces execution limits |
| AI Client Wrapper | `_shared/ai-client.ts` | Zentralisierter LLM-Zugriff |

### Schicht 3 — Frontend (Rendering Guards)

| Guard | Mechanismus | Zweck |
|-------|-------------|-------|
| Canonical Title Only | `useCanonicalTitles()` + `resolveTitle()` | Kein Roh-Titel-Rendering |
| Council Badge Evidence | `council_approved_at` Timestamp | Kein Boolean-Flag in UI |
| SSOT View Consumption | `v_admin_visible_course_packages` | Deduplizierte Listen |
| Safe Question Views | `v_exam_questions_safe` | Lösungen ausfiltern |

### Schicht 4 — CI/CD (Automated Guards)

**→ Vollständige Registry:** [GUARD_REGISTRY.md](GUARD_REGISTRY.md)

**Zusammenfassung: 30+ GitHub Actions Workflows + 8 Guard Scripts**

| Kategorie | Workflows | Level |
|-----------|-----------|-------|
| SSOT & Contract | 4 | HARD FAIL |
| Security | 6 | HARD FAIL / WARNING |
| Pipeline Integrity | 5 | HARD FAIL |
| Quality & Content | 3 | HARD FAIL |
| Ops & Monitoring | 4 | WARNING / AUTO-HEAL |
| Build & Deploy | 5 | HARD FAIL |
| Cost & Budget | 2 | WARNING |

### Schicht 5 — Operations (Sweeps & Monitoring)

| Mechanismus | Frequenz | Zweck |
|-------------|----------|-------|
| `stuck-scan` | Continuous | Stuck Jobs erkennen & heilen |
| `ops-nightly-guards` | Nightly (02:10 UTC) | Pipeline-Integritätsprüfung |
| Auto-Heal Policies | Event-driven | Selbstheilung mit Cooldown |
| Leitstelle Dashboard | Real-time | KPI, Health, Blockaden |
| Forensic Monitor | On-demand | Drilldown & manuelle Heilung |

---

## 3. Non-Negotiable Invariants

**→ Vollständige Liste:** [INVARIANTS.md](INVARIANTS.md)

**Top 10 (niemals verhandelbar):**

1. **SSOT ist die einzige Wahrheit.** Keine Duplikation.
2. **CI muss bei Drift fehlschlagen.** Guards 1–9+ erzwingen dies.
3. **Kein direkter `job_queue.insert`** — verwende `enqueueJob()`.
4. **Kein Roh-Titel-Rendering** — nur `canonical_title` via SSOT View.
5. **Kein `council_approved` Boolean in UI** — nur `council_approved_at`.
6. **Kein `EXAM_FIRST` Track** — `AUSBILDUNG_VOLL` ist Standard.
7. **Keine direkte LLM-Fetch** — nur über `_shared/ai-client.ts`.
8. **Keine Nano-Modelle für Learning Content** — leere Antworten.
9. **Veröffentlichte Pakete sind immutable** (didaktische Inhalte).
10. **Gender-inklusive Titel** — immer `/-` Form.

---

## 4. Change Management

### Für Pipeline/Pool/Step-Änderungen:
1. SSOT-Modul aktualisieren (`job-map.ts`)
2. Contract aktualisieren (`job-pool-contract.json`)
3. Backfill-Migration erstellen
4. Deployen
5. Live-Checks durchführen
6. 24h überwachen

### Für neue Ausnahmen in Guards:
1. In `docs/ssot-allowlist.md` dokumentieren (mit Begründung)
2. Allowlist im Guard-Script aktualisieren
3. `docs/ssot-guard-baseline.md` Baseline prüfen

### Für Schema-Änderungen:
1. SQL-Migration in `supabase/migrations/`
2. RLS Policies prüfen/erstellen
3. Schema-Drift-Guard validieren lassen
4. Types auto-generieren lassen

---

## 5. Dokument-Index

| Dokument | Zweck | Pfad |
|----------|-------|------|
| **Governance** (dieses) | Zentraler Einstieg | `docs/GOVERNANCE.md` |
| **Guard Registry** | Alle Guards mit Level | `docs/GUARD_REGISTRY.md` |
| **Invariants** | Non-negotiable Regeln | `docs/INVARIANTS.md` |
| **Architecture** | System-Architektur | `ARCHITECTURE.md` |
| **SSOT Rules** | Exam-Question-Semantik | `docs/SSOT_RULES.md` |
| **Pool Rules** | Job-Pool-Governance | `docs/SSOT_POOL_RULES.md` |
| **Step Order** | Pipeline-Step-Governance | `docs/SSOT_STEP_ORDER_GOVERNANCE.md` |
| **Step Keys** | Kanonische Step-Liste | `docs/pipeline/STEP_KEYS.md` |
| **Naming Architecture** | Titel-SSOT-System | `docs/ssot-naming-architecture.md` |
| **Naming Allowlist** | Erlaubte Ausnahmen | `docs/ssot-allowlist.md` |
| **Naming Baseline** | Guard-Baseline-Snapshot | `docs/ssot-guard-baseline.md` |
| **Integrity Playbook** | Ops-Runbook | `docs/SYSTEM_INTEGRITY_PLAYBOOK.md` |
| **Store Architecture** | Multi-Platform Store | `docs/STORE_ARCHITECTURE.md` |
| **Wave Runbooks** | Rollout-Playbooks | `docs/runbooks/`, `docs/pipeline/` |

---

## 6. Audit-Checkliste (monatlich)

- [ ] Alle CI-Guard-Workflows grün auf `main`?
- [ ] `ssot-guard-baseline.md` Baseline-Zähler unverändert oder reduziert?
- [ ] `v_ops_course_name_collisions` leer?
- [ ] `v_ops_invalid_course_titles` leer?
- [ ] Keine `pool_autofixed` Events in 30 Tagen?
- [ ] Keine `SSOT_STEP_UNKNOWN` Failures?
- [ ] Security-Audit keine High/Critical Vulnerabilities?
- [ ] Auto-Heal Log keine wiederkehrenden Muster?
- [ ] Publish Gate: kein manueller Override in 30 Tagen?
- [ ] Budget-Nutzung unter Threshold?

---

## Änderungshistorie

| Datum | Änderung | Autor |
|-------|----------|-------|
| 2026-03-15 | Initial Governance-Dokument erstellt | System |
