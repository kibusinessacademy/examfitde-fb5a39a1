# Fehlerklassen-Audit-Matrix – ExamFit Pipeline

> Stand: 2026-03-28 · Erstellt als strukturiertes Audit über 10 zentrale Fehlerklassen.

---

## Legende

| Kürzel | Bedeutung |
|--------|-----------|
| **P** | Prevention – Fehler darf gar nicht entstehen |
| **D** | Detection – Wenn er entsteht, muss er gefunden werden |
| **R** | Recovery – Wenn er da ist, muss er geheilt werden |

---

## 1. False Success / False Done

| Feld | Wert |
|------|------|
| **Root Cause** | Step wird als `done` markiert, obwohl die Business-Side-Effect nicht eingetreten ist |
| **Prevention Guard** | `trg_guard_auto_publish_done`, `trg_guard_step_done_thresholds` |
| **Detection View** | `ops_auto_publish_false_success`, `ops_step_done_below_threshold`, `ops_hollow_completions` |
| **Recovery** | Reconciliation-Trigger, Auto-Heal via stuck-scan |
| **Pflicht-Tests** | ① done ohne Artefakt → failed ② done ohne publishbaren Status → blocked ③ Audit-View findet Anomalie |
| **Priorität** | **P0** |

### Betroffene Steps

| Step | Postcondition | Guard |
|------|--------------|-------|
| `auto_publish` | `course_packages.status = 'published'` | `trg_guard_auto_publish_done` ✅ |
| `run_integrity_check` | `integrity_report IS NOT NULL` | `trg_guard_step_done_thresholds` |
| `quality_council` | `council_approved = true` | `trg_guard_quality_council_done` |
| `validate_exam_pool` | approved questions ≥ threshold | `trg_guard_step_done_thresholds` |
| `validate_learning_content` | lessons count ≥ competencies | `trg_guard_step_done_thresholds` |
| `generate_handbook` | handbook_sections count ≥ chapters | `trg_guard_step_done_thresholds` |
| `build_ai_tutor_index` | tutor index exists | `trg_guard_step_done_thresholds` |

---

## 2. False Block / Stale Block

| Feld | Wert |
|------|------|
| **Root Cause** | Paket hängt in `blocked`/`quality_gate_failed`/`done` obwohl alle Gates grün |
| **Prevention Guard** | `trg_reconcile_stale_quality_gate_failed` |
| **Detection View** | `ops_publish_eligible_but_stuck`, `ops_blocked_but_ready` |
| **Recovery** | Reconciliation-Trigger befördert automatisch |
| **Pflicht-Tests** | ① Alle Gates grün → Status wechselt ② Stale blocker entfernt → Reconciliation greift ③ View findet alle stuck-Pakete |
| **Priorität** | **P0** |

---

## 3. Phantom Visibility (UI zeigt Unnutzbares)

| Feld | Wert |
|------|------|
| **Root Cause** | Learner sieht Simulation/Kurs der nicht startbar ist |
| **Prevention Guard** | `v_learner_visible_exam_simulations` (strict filter), `can_start_exam_simulation` RPC |
| **Detection View** | `ops_learner_visible_readiness` |
| **Recovery** | Publish-Fix / Quarantine |
| **Pflicht-Tests** | ① nicht-published → unsichtbar ② published ohne Artefakte → nicht startbar ③ Frontend nutzt nur SSOT-View |
| **Priorität** | **P0** |

---

## 4. Phantom Invisibility (Fertiges ist unsichtbar)

| Feld | Wert |
|------|------|
| **Root Cause** | Published Paket mit allen Artefakten erscheint nicht in Learner-UI |
| **Prevention Guard** | SSOT-View enthält alle published Pakete |
| **Detection View** | `ops_publish_eligible_but_stuck` (invers) |
| **Recovery** | View-/Join-Fix |
| **Pflicht-Tests** | ① published + Artefakte → muss sichtbar sein ② Entitlement vorhanden → Zugriff möglich |
| **Priorität** | **P1** |

---

## 5. Zombie Jobs / Orphan Steps / Lease-Defekte

| Feld | Wert |
|------|------|
| **Root Cause** | Job hängt in `processing`, kein Worker; Step `running` ohne Job; Lease abgelaufen |
| **Prevention Guard** | stuck-scan (10-min cron), lease expiry |
| **Detection View** | `ops_building_without_job_or_lease`, `ops_processing_stale`, `ops_next_step_queued_no_job`, `ops_recent_building_without_lease` |
| **Recovery** | stuck-scan redispatch, orphan reclaim |
| **Pflicht-Tests** | ① processing > 30min → erkannt ② running step ohne job → erkannt ③ lease expired → package reclaimable |
| **Priorität** | **P0** |

---

## 6. DAG / Sequence Violations

| Feld | Wert |
|------|------|
| **Root Cause** | Step läuft obwohl Predecessor nicht done; oder Step bleibt blockiert obwohl Predecessor done |
| **Prevention Guard** | `pipeline_dag_edges` + Orchestrator-Prüfung |
| **Detection View** | `ops_prereq_guard_cancelled`, `ops_package_downstream_missing` |
| **Recovery** | Cascade reset, re-enqueue |
| **Pflicht-Tests** | ① Step B ohne Step A done → blocked ② Step A wird done → Step B freigegeben ③ DAG-Kanten = Code-Annahmen |
| **Priorität** | **P0** |

### DAG-Kanten (28 Edges)

```
auto_publish ← quality_council
quality_council ← run_integrity_check
run_integrity_check ← elite_harden, validate_handbook_depth, validate_lesson_minichecks, validate_oral_exam, validate_tutor_index
validate_tutor_index ← build_ai_tutor_index
build_ai_tutor_index ← validate_exam_pool
validate_exam_pool ← generate_exam_pool
generate_exam_pool ← validate_blueprints
validate_blueprints ← auto_seed_exam_blueprints
auto_seed_exam_blueprints ← validate_learning_content
validate_learning_content ← finalize_learning_content
finalize_learning_content ← generate_learning_content
generate_learning_content ← fanout_learning_content
fanout_learning_content ← scaffold_learning_course
validate_oral_exam ← generate_oral_exam
generate_oral_exam ← validate_tutor_index
validate_handbook_depth ← expand_handbook
expand_handbook ← enqueue_handbook_expand
enqueue_handbook_expand ← validate_handbook
validate_handbook ← generate_handbook
generate_handbook ← validate_learning_content
validate_lesson_minichecks ← generate_lesson_minichecks
generate_lesson_minichecks ← validate_learning_content
elite_harden ← validate_exam_pool
generate_glossary ← scaffold_learning_course
```

---

## 7. SSOT-Drift / Schema-Drift / Join-Drift

| Feld | Wert |
|------|------|
| **Root Cause** | Code/Test/View referenziert alte Tabellen, falsche Joins, doppelte Wahrheiten |
| **Prevention Guard** | CI-Guards (`ssot-guard.mjs`, `edge-import-guard.mjs`, `hard-literal-guard.mjs`) |
| **Detection View** | `ops_step_mapping_drift`, `ops_phantom_step_drift` |
| **Recovery** | Schema-Migration + Test-Fix |
| **Pflicht-Tests** | ① Verbotene Tabellen/Spalten → CI fail ② SSOT-Verträge als Snapshots ③ Join-Konsistenz UI = API = Worker |
| **Priorität** | **P1** |

---

## 8. Governance-Gate Drift

| Feld | Wert |
|------|------|
| **Root Cause** | Gates unterschiedlich definiert in Edge-Function, Trigger, UI, View |
| **Prevention Guard** | CI-Guard `pipeline-contract-guard.mjs`, `integrity-track-aware-guard.mjs` |
| **Detection View** | `ops_integrity_contract_violations`, `ops_package_qc_matrix` |
| **Recovery** | Gate-Normalisierung + Re-Integrity-Check |
| **Pflicht-Tests** | ① published ohne Governance → unmöglich ② nicht published trotz Governance → stale ③ Track-spezifische Schwellen korrekt |
| **Priorität** | **P1** |

---

## 9. Artifact Completeness / Hollow Completion

| Feld | Wert |
|------|------|
| **Root Cause** | Artefakt formal vorhanden aber inhaltlich leer/Placeholder |
| **Prevention Guard** | `trg_guard_step_done_thresholds`, content quality gates |
| **Detection View** | `ops_hollow_completions`, `ops_step_done_below_threshold` |
| **Recovery** | Regen-Job, lesson-regen-repair |
| **Pflicht-Tests** | ① Placeholder-Lesson → kein done ② Pool zu klein → Validation blockt ③ Hollow vs real content unterscheidbar |
| **Priorität** | **P1** |

---

## 10. Access / Entitlement / Rollenfehler

| Feld | Wert |
|------|------|
| **Root Cause** | Learner sieht/startet/kauft etwas ohne Berechtigung oder umgekehrt |
| **Prevention Guard** | RLS-Policies, `can_start_exam_simulation` RPC, `v_exam_questions_safe` |
| **Detection View** | Security regression guards |
| **Recovery** | RLS-Fix + Audit |
| **Pflicht-Tests** | ① Anon kann keine sensitiven Tabellen lesen ② Learner ohne Kauf → kein Start ③ Admin-Views leaken keine Rohdaten |
| **Priorität** | **P1** |

---

## Audit-Abschlussregel

Für jede Klasse müssen alle drei Testtypen (P/D/R) grün sein:

| # | Klasse | P | D | R | Status |
|---|--------|---|---|---|--------|
| 1 | False Success | ✅ | ✅ | ✅ | **auto_publish getestet** |
| 2 | Stale Block | ✅ | ✅ | ✅ | Trigger + Views vorhanden |
| 3 | Phantom Visibility | ✅ | ✅ | ⬜ | View + RPC vorhanden |
| 4 | Phantom Invisibility | ⬜ | ⬜ | ⬜ | offen |
| 5 | Zombie/Orphan/Lease | ✅ | ✅ | ✅ | Views + stuck-scan |
| 6 | DAG Violations | ✅ | ✅ | ⬜ | Edges + Guards vorhanden |
| 7 | SSOT/Schema Drift | ✅ | ✅ | ⬜ | CI-Guards vorhanden |
| 8 | Governance Gate Drift | ✅ | ✅ | ⬜ | CI-Guards vorhanden |
| 9 | Hollow Completion | ✅ | ✅ | ✅ | Threshold-Guards |
| 10 | Access/Entitlement | ✅ | ✅ | ⬜ | RLS + Security Guards |
