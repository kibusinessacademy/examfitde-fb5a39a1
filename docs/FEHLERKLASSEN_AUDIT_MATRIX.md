# Fehlerklassen-Audit-Matrix – ExamFit Pipeline

> Stand: 2026-03-28 · Vollständig gehärtet mit P/D/R-Tests, SSOT-Owner, Blast Radius

---

## Legende

| Kürzel | Bedeutung |
|--------|-----------|
| **P** | Prevention – Fehler darf gar nicht entstehen |
| **D** | Detection – Wenn er entsteht, muss er gefunden werden |
| **R** | Recovery – Wenn er da ist, muss er geheilt werden |

### Testabdeckung

| Status | Bedeutung |
|--------|-----------|
| ✅ `implemented` | Harter Invariant-Test mit assertEquals/assert |
| 🟡 `partial` | Test vorhanden, aber nicht alle Sub-Cases |
| 🔵 `smoke-only` | Nur Queryability getestet |
| ⬜ `missing` | Kein Test vorhanden |
| 📋 `known-gap` | Bewusst nicht abgedeckt, dokumentiert |

---

## 1. False Success / False Done

| Feld | Wert |
|------|------|
| **Root Cause** | Step wird als `done` markiert, obwohl die Business-Side-Effect nicht eingetreten ist |
| **SSOT Owner** | DB Trigger (`trg_guard_auto_publish_done`, `trg_guard_step_done_thresholds`) |
| **Blast Radius** | 🔴 learner-facing, 🔴 pipeline-facing, 🟡 revenue-facing |
| **Prevention Guard** | `trg_guard_auto_publish_done`, `trg_guard_step_done_thresholds` |
| **Detection View** | `ops_auto_publish_false_success`, `ops_step_done_below_threshold`, `ops_hollow_completions` |
| **Recovery** | Reconciliation-Trigger, Auto-Heal via stuck-scan |
| **Pflicht-Tests** | ① done ohne Artefakt → failed ② done ohne publishbaren Status → blocked ③ Audit-View = 0 |
| **Priorität** | **P0** |

### Betroffene Steps & Testabdeckung

| Step | Guard | Prevention Test | Detection Test | Status |
|------|-------|-----------------|----------------|--------|
| `auto_publish` | `trg_guard_auto_publish_done` ✅ | Hard assertEquals(failed) | ops_auto_publish_false_success = 0 | ✅ `implemented` |
| `validate_exam_pool` | `trg_guard_step_done_thresholds` | Hard assert(≠done) | ops_step_done_below_threshold = 0 | ✅ `implemented` |
| `validate_learning_content` | `trg_guard_step_done_thresholds` | Hard assert(≠done) | ops_step_done_below_threshold = 0 | ✅ `implemented` |
| `generate_handbook` | `trg_guard_step_done_thresholds` | Hard assert(≠done) | ops_hollow_completions = 0 | ✅ `implemented` |
| `run_integrity_check` | `trg_guard_step_done_thresholds` | Hard assert(≠done) | ops_step_done_below_threshold = 0 | ✅ `implemented` |
| `build_ai_tutor_index` | `trg_guard_step_done_thresholds` | Hard assert(≠done) | ops_step_done_below_threshold = 0 | ✅ `implemented` |
| `quality_council` | — | — | — | 📋 `known-gap` |
| `generate_glossary` | — | — | — | 📋 `known-gap` |

---

## 2. False Block / Stale Block

| Feld | Wert |
|------|------|
| **Root Cause** | Paket hängt in `blocked`/`quality_gate_failed`/`done` obwohl alle Gates grün |
| **SSOT Owner** | DB Trigger (`trg_reconcile_stale_quality_gate_failed`, `trg_enforce_package_status_blocked`) |
| **Blast Radius** | 🔴 pipeline-facing, 🟡 revenue-facing |
| **Prevention Guard** | `trg_reconcile_stale_quality_gate_failed` |
| **Detection View** | `ops_publish_eligible_but_stuck`, `ops_blocked_but_ready` |
| **Recovery** | Reconciliation-Trigger befördert automatisch |
| **Priorität** | **P0** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| ops_publish_eligible_but_stuck = 0 | D | Hard assertEquals(0) | ✅ `implemented` |
| ops_blocked_but_ready = 0 | D | Hard assertEquals(0) | ✅ `implemented` |
| published ≠ blocked_reason | P | Hard assertEquals(0) | ✅ `implemented` |
| blocked → has blocked_reason | P | Hard assertEquals(0) | ✅ `implemented` |
| quality_gate_failed + gates green = 0 | R | Hard assertEquals(0) | ✅ `implemented` |

---

## 3. Phantom Visibility (UI zeigt Unnutzbares)

| Feld | Wert |
|------|------|
| **Root Cause** | Learner sieht Simulation/Kurs der nicht startbar ist |
| **SSOT Owner** | View (`v_learner_visible_exam_simulations`), RPC (`can_start_exam_simulation`) |
| **Blast Radius** | 🔴 learner-facing, 🔴 revenue-facing |
| **Prevention Guard** | Strict filter in SSOT view, server-side start guard |
| **Detection View** | `ops_learner_visible_readiness` |
| **Priorität** | **P0** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| View only shows published | P | Hard assertEquals(0) | ✅ `implemented` |
| All visible have integrity_passed | P | Hard assertEquals(0) | ✅ `implemented` |
| All visible have council_approved | P | Hard assertEquals(0) | ✅ `implemented` |
| All visible have ≥40 approved questions | P | Hard assert per package | ✅ `implemented` |
| ops_learner_visible_readiness = 0 | D | Hard assertEquals(0) | ✅ `implemented` |

---

## 4. Phantom Invisibility (Fertiges ist unsichtbar)

| Feld | Wert |
|------|------|
| **Root Cause** | Published Paket mit allen Artefakten erscheint nicht in Learner-UI |
| **SSOT Owner** | View (`v_learner_visible_exam_simulations`, `v_course_display_ssot`) |
| **Blast Radius** | 🔴 learner-facing, 🔴 revenue-facing |
| **Prevention Guard** | SSOT-View enthält alle published Pakete |
| **Priorität** | **P1** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| published + gates + questions + blueprint → visible | P | Hard assertEquals(0) | ✅ `implemented` |
| published → in v_course_display_ssot | P | Hard assertEquals(0) | ✅ `implemented` |

---

## 5. Zombie Jobs / Orphan Steps / Lease-Defekte

| Feld | Wert |
|------|------|
| **Root Cause** | Job hängt in `processing`, kein Worker; Step `running` ohne Job; Lease abgelaufen |
| **SSOT Owner** | Queue Runner (`stuck-scan`), Edge Function |
| **Blast Radius** | 🔴 pipeline-facing, 🟡 admin-facing |
| **Prevention Guard** | stuck-scan (10-min cron), lease expiry |
| **Detection View** | `ops_building_without_job_or_lease`, `ops_processing_stale`, `ops_next_step_queued_no_job` |
| **Priorität** | **P0** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| ops_building_without_job_or_lease = 0 | D | Hard assertEquals(0) | ✅ `implemented` |
| ops_processing_stale ≤ 5 | D | Hard assert threshold | ✅ `implemented` |
| ops_next_step_queued_no_job (>15min) = 0 | D | Hard assertEquals(0) | ✅ `implemented` |
| No orphan running steps (>60min, no job) | P | Hard assertEquals(0) | ✅ `implemented` |
| No zombie processing jobs (>2h) | P | Hard assertEquals(0) | ✅ `implemented` |

---

## 6. DAG / Sequence Violations

| Feld | Wert |
|------|------|
| **Root Cause** | Step läuft obwohl Predecessor nicht done; oder Step bleibt blockiert obwohl Predecessor done |
| **SSOT Owner** | DB Table (`pipeline_dag_edges`), Queue Runner (Orchestrator) |
| **Blast Radius** | 🔴 pipeline-facing, 🟡 admin-facing |
| **Prevention Guard** | `pipeline_dag_edges` + Orchestrator-Prüfung |
| **Detection View** | `ops_prereq_guard_cancelled`, `ops_package_downstream_missing` |
| **Priorität** | **P0** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| 7 critical DAG edges exist | P | Hard assert per edge | ✅ `implemented` |
| Edge count in [20,50] | P | Hard assert range | ✅ `implemented` |
| auto_publish=done → quality_council=done | P | Hard assertEquals(0) | ✅ `implemented` |
| validate_exam_pool=done → generate_exam_pool=done | P | Hard assertEquals(0) | ✅ `implemented` |
| ops_package_downstream_missing ≤ 10 | D | Threshold + warning | ✅ `implemented` |
| ops_prereq_guard_cancelled = 0 | D | Hard assertEquals(0) | ✅ `implemented` |

---

## 7. SSOT-Drift / Schema-Drift / Join-Drift

| Feld | Wert |
|------|------|
| **Root Cause** | Code/Test/View referenziert alte Tabellen, falsche Joins, doppelte Wahrheiten |
| **SSOT Owner** | CI Guard (`ssot-guard.mjs`, `edge-import-guard.mjs`, `hard-literal-guard.mjs`) |
| **Blast Radius** | 🟡 pipeline-facing, 🟡 admin-facing |
| **Prevention Guard** | CI-Guards |
| **Detection View** | `ops_step_mapping_drift`, `ops_phantom_step_drift` |
| **Priorität** | **P1** |

### Testabdeckung

| Test | Typ | Status |
|------|-----|--------|
| CI forbids deprecated tables | P | 🟡 `partial` (CI-Guard, not integration test) |
| SSOT contract snapshots | P | 🟡 `partial` |
| Join consistency UI = API = Worker | D | ⬜ `missing` |

---

## 8. Governance-Gate Drift

| Feld | Wert |
|------|------|
| **Root Cause** | Gates unterschiedlich definiert in Edge-Function, Trigger, UI, View |
| **SSOT Owner** | CI Guard (`pipeline-contract-guard.mjs`), DB Trigger |
| **Blast Radius** | 🔴 pipeline-facing, 🟡 learner-facing |
| **Prevention Guard** | CI-Guard `pipeline-contract-guard.mjs`, `integrity-track-aware-guard.mjs` |
| **Detection View** | `ops_integrity_contract_violations`, `ops_package_qc_matrix` |
| **Priorität** | **P1** |

### Testabdeckung

| Test | Typ | Status |
|------|-----|--------|
| published without governance → impossible | P | 🟡 `partial` (covered by visibility tests) |
| Track-specific thresholds correct | P | ⬜ `missing` |
| Hardcoded thresholds → CI detection | P | 🟡 `partial` |

---

## 9. Artifact Completeness / Hollow Completion

| Feld | Wert |
|------|------|
| **Root Cause** | Artefakt formal vorhanden aber inhaltlich leer/Placeholder |
| **SSOT Owner** | DB Trigger (`trg_guard_step_done_thresholds`), Content Quality Gates |
| **Blast Radius** | 🔴 learner-facing, 🔴 pipeline-facing |
| **Prevention Guard** | `trg_guard_step_done_thresholds`, content quality gates |
| **Detection View** | `ops_hollow_completions`, `ops_step_done_below_threshold` |
| **Priorität** | **P1** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| Published have ≥40 approved questions | P | Hard assertEquals(0) | ✅ `implemented` |
| Published have lessons | P | Hard assertEquals(0) | ✅ `implemented` |
| Published have integrity_report | P | Hard assertEquals(0) | ✅ `implemented` |
| ops_hollow_completions = 0 (active) | D | Hard assertEquals(0) | ✅ `implemented` |
| ops_step_done_below_threshold = 0 (active) | D | Hard assertEquals(0) | ✅ `implemented` |

---

## 10. Access / Entitlement / Rollenfehler

| Feld | Wert |
|------|------|
| **Root Cause** | Learner sieht/startet/kauft etwas ohne Berechtigung oder umgekehrt |
| **SSOT Owner** | RLS Policies, `SECURITY DEFINER` Functions, RPC Guards |
| **Blast Radius** | 🔴 security-facing, 🔴 learner-facing, 🔴 revenue-facing |
| **Prevention Guard** | RLS-Policies, `can_start_exam_simulation` RPC, `v_exam_questions_safe` |
| **Detection View** | Security regression guards |
| **Priorität** | **P1** |

### Testabdeckung

| Test | Typ | Assertion | Status |
|------|-----|-----------|--------|
| anon cannot read exam_questions | P | Hard assert | ✅ `implemented` |
| anon cannot read job_queue | P | Hard assert | ✅ `implemented` |
| anon cannot read package_steps | P | Hard assert | ✅ `implemented` |
| anon cannot write course_packages | P | Restricted | ✅ `implemented` |
| anon cannot read admin_actions | P | Hard assert | ✅ `implemented` |
| anon cannot read auto_heal_log | P | Hard assert | ✅ `implemented` |
| anon cannot read integrity_reports | P | Hard assert | ✅ `implemented` |
| v_exam_questions_safe hides correct_answer | D | Hard assert | ✅ `implemented` |

---

## Audit-Abschlussregel

Für jede Klasse müssen alle drei Testtypen (P/D/R) grün sein:

| # | Klasse | P | D | R | Test-Suite | Coverage |
|---|--------|---|---|---|------------|----------|
| 1 | False Success | ✅ | ✅ | ✅ | `wave1-false-success` | ✅ `implemented` |
| 2 | Stale Block | ✅ | ✅ | ✅ | `wave1-stale-block` | ✅ `implemented` |
| 3 | Phantom Visibility | ✅ | ✅ | — | `wave2-phantom-visibility` | ✅ `implemented` |
| 4 | Phantom Invisibility | ✅ | — | — | `wave2-phantom-invisibility` | ✅ `implemented` |
| 5 | Zombie/Orphan/Lease | ✅ | ✅ | — | `wave1-zombie-orphan` | ✅ `implemented` |
| 6 | DAG Violations | ✅ | ✅ | — | `wave1-dag-sequence` | ✅ `implemented` |
| 7 | SSOT/Schema Drift | 🟡 | 🟡 | ⬜ | CI-Guards | 🟡 `partial` |
| 8 | Governance Gate Drift | 🟡 | 🟡 | ⬜ | CI-Guards | 🟡 `partial` |
| 9 | Hollow Completion | ✅ | ✅ | — | `wave2-artifact-completeness` | ✅ `implemented` |
| 10 | Access/Entitlement | ✅ | ✅ | — | `wave2-entitlement-access` | ✅ `implemented` |

---

## Test-Dateien

| Wave | Datei | Tests |
|------|-------|-------|
| 1A | `wave1-false-success.test.ts` | 10 (6P + 3D + 1 known-gap doc) |
| 1B | `wave1-stale-block.test.ts` | 5 (2P + 2D + 1R) |
| 1C | `wave1-zombie-orphan.test.ts` | 5 (2P + 3D) |
| 1D | `wave1-dag-sequence.test.ts` | 6 (4P + 2D) |
| 2A | `wave2-phantom-visibility.test.ts` | 4 (3P + 1D) |
| 2B | `wave2-phantom-invisibility.test.ts` | 2 (2P) |
| 2C | `wave2-artifact-completeness.test.ts` | 5 (3P + 2D) |
| 2D | `wave2-entitlement-access.test.ts` | 8 (7P + 1D) |
| **Total** | | **45 Tests** |
