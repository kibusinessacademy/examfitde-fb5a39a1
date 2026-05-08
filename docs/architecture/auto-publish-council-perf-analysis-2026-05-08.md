# Performance / Resilience Analyse — package_auto_publish & package_quality_council

_Date: 2026-05-08 · Trigger: STALE_REAP_LOOP_TERMINAL Welle (~280 Jobs in 7d, 156× auto_publish, 224× quality_council)_

## TL;DR

| Function | CPU-Kill (7d) | Time-Budget? | Chunking? | Idempotenter Resume? | Risiko |
|---|---|---|---|---|---|
| package-quality-council | 224 | ✅ ja (25 s, 60 % defer) | ✅ ja (200/Chunk) | ✅ ja (resume_state) | mittel |
| package-auto-publish | 156 | ❌ nein | ❌ nein | ❌ nein | **hoch** |

**Hauptbefund:** `package-auto-publish` läuft im selben Job-Loop wie der bereits gehärtete Council, hat aber **keine** Time-Budget- oder Resume-Architektur. Damit bekommt der Reaper genau hier die meisten terminalen Verdicts erzeugt.

## 1. package-auto-publish (487 LOC) — Hotspots

Sequentielle DB-Roundtrips ohne Budget-Check (gemessen via `grep -c "sb\."`): **31 Calls**, davon **3 schwere RPCs**:

| # | Call | Worst-Case-Kosten |
|---|---|---|
| L168 | `validate_publish_readiness(p_package_id)` | scannt alle Paket-Steps + Quality-Reports + Question-Pool |
| L329 | `get_difficulty_distribution(p_curriculum_id)` | full scan exam_questions + competency_join |
| L366 | `publish_package_version(p_package_id)` | row-level lock + stats refresh + cache-bust |

Plus: Quality-Gate v2 (L78–134) iteriert `lessons` per Modul **ohne LIMIT** — bei großen Kursen explodiert das.

### Konkrete CPU-Killer

1. **Lesson-Status-Guard** (L78–134) — `lessons.select` pro Modul, dann pro Lesson erneut `course_packages` + ggf. `job_queue.insert`. Bei Kursen mit > 80 Lessons hart am Limit.
2. **Pre-Publish-Audit** (L256–290) — `count(*)` über `exam_questions` mit `not in (...)` (Index-Skip, sequenzieller Scan).
3. **Atomic Publish** (L366) — `publish_package_version` selbst ist ein PL/pgSQL-Block mit ~6 Subqueries; lockt `course_packages` + `package_versions`. Auf großem Pool kann allein der Lock 2–4 s benötigen.

### Empfehlung (ranked nach ROI)

1. **Time-Budget-Klasse aus Council kopieren** (LOC ≤ 30) — bei jedem Phase-Übergang `budget.shouldDefer()` prüfen, bei `true` self-requeue mit `+30s run_after` analog `RESUME_DEFER_SECONDS`.
2. **Lesson-Guard limitieren** (`limit(500)`) und in `auto_heal_log` warnen, wenn größer.
3. **Pre-Publish-Count durch v_admin_publish_readiness ersetzen** — der View ist bereits SSOT und materialisiert.
4. **`publish_package_version` in 2 Schritte splitten** (DB-Migration, separat): „prepare_publish" (lock + checks) + „commit_publish" (status + cache-bust). Erlaubt Batch-Resume.

## 2. package-quality-council (473 LOC) — Resthärtung

Hat bereits Budget-Klasse + Promotion-Chunking. Trotzdem 224 STALE_REAP-Verdicts in 7d. Ursachen:

* **Gate-Phase nicht budgetiert** (L156–248) — `quality_rules` werden voll geladen, jede Rule fährt eigene Subquery. Bei 50+ aktiven Rules und großen Pools kann allein die Gate-Auswertung > 60 s dauern, bevor der erste `budget.shouldDefer()`-Check (in der Promotion-Phase L296) greift.
* **Reclassify-Phase optional** (L268) — gut. Aber `audit_lf_elite_policy` (L350) ist eine schwere RPC und wird **nicht gechunkt**.

### Empfehlung

1. **Budget-Check in Gate-Phase einziehen** (vor jedem Rule-Loop) — falls > 60 % defer, cache `partial_results` in `resume_state.partial_gate_results`.
2. **`audit_lf_elite_policy` → Materialized-View** (DB-Migration). Audit-Phase liest dann nur einen MV-Snapshot (< 100 ms statt mehreren Sekunden).
3. **`quality_rules.config` JSONB komprimieren** — rd. 30 % der Configs duplizieren denselben Subquery-Body; in Helper-Funktion auslagern.

## 3. Pipeline-Wirkung auf Reaper

Solange auto-publish ohne Budget läuft, erzeugt der Reaper-Anti-Loop bei jedem CPU-Kill nach 2 Cycles ein `STALE_REAP_LOOP_TERMINAL` (siehe Memory: `reaper-anti-loop-v1`). Smart-NBA klassifizierte das bisher als „retriable" — gefixt in dieser Session via `isTerminalFailure()`.

**Korrektpfad nach Härtung:** auto-publish kann sich selbst per `+30s run_after` deferren statt vom Reaper getötet zu werden. Erwartung: STALE_REAP-Verdicts der Funktion sinken um > 90 %.

## 4. Roadmap

| Phase | Aufwand | Erwartung |
|---|---|---|
| **Phase 1** (sofort, in dieser Session) | — | Smart-NBA klassifiziert STALE_REAP nicht mehr als retriable, Drift sichtbar in PublishWorkflowStatusCard |
| **Phase 2** (separater PR) | ~120 LOC | TimeBudget in auto-publish + Lesson-Guard-Limit |
| **Phase 3** (DB-Migration) | ~50 LOC SQL | Split `publish_package_version`, MV für `audit_lf_elite_policy` |
| **Phase 4** | Monitoring | KPI: median elapsed_ms < 8 s, p95 < 22 s, STALE_REAP < 5/Woche |

## 5. Quick-Wins (kein Code in dieser Session)

* `worker_pool='control'` für auto-publish setzen (separate CPU-Pool, kein Konflikt mit Bulk-Worker)
* `priority -1` für auto-publish-Jobs (höhere Priorität als generische Builds)
