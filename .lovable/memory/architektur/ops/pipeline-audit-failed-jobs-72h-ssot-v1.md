---
name: Pipeline-Audit Failed-Jobs 72h SSOT v1
description: Pipeline-Audit 2026-05-29 (118 failed + 18.973 cancelled in 72h). Erweitert P0 Ops Diagnostics um v_failed_jobs_72h_clusters + 2 admin-gated RPCs (Summary + Drill-Down). 16 cluster_keys klassifiziert (5 unclassified). Identifizierte Code-Lücken: minicheck_producer_missing (24, läuft 72h gar nicht), pool-fill-bloom-gaps Stale-Deploy hielt an (redeployed), heal_annotation_recursion last_error nesting, audit_fn_signature_drift (1× package_auto_publish ruft fn_emit_audit positional).
type: feature
---
# Pipeline-Audit Failed-Jobs 72h SSOT (P1)

## Audit 2026-05-29 (72h-Fenster)
118 failed + 18.973 cancelled. Cancellations sind weit überwiegend governance-erwartet (OBSOLETE_TAIL_BLOCK_v4 4721, STEP_ALREADY_DONE_PHANTOM 4196, PATTERN_X14_REPLACED_BY_HEAL 1632 — Drift-Detector + Phantom-Guard arbeiten korrekt).

Failed-Cluster nach Migration (verifiziert):
- quality_threshold_not_met 52, deterministic_requeue_loop 35, minicheck_producer_missing 24, heal_annotation_recursion 6, artifact_missing_upstream 5, max_attempts_exhausted 5, stale_lock_loop_hard_kill 5, ai_budget_exhausted 4, pre_heartbeat_kill 4, missing_secret 3, invalid_model_id 2, stale_after_heartbeat 2, ghost_finalization_blocked 1, step_done_mismatch 1, audit_fn_signature_drift 1, unclassified 5.

## Brücke statt Doppelbau
P0 Ops Diagnostics (2026-05-24) deckt 3 Cluster getrennt (Quality-Threshold / Stale-Lock / Exam-Pool-Producer). Statt vierter+fünfter+nter View: eine SSOT-View `v_failed_jobs_72h_clusters` klassifiziert alle 16 Patterns. Zwei admin-gated RPCs:
- `admin_get_failed_jobs_72h_clusters()` → counts + sample + top job_types + is_known_pattern
- `admin_get_failed_jobs_72h_by_cluster(_cluster_key, _limit)` → drill-down
View REVOKEd from anon/authenticated; RPCs SECURITY DEFINER + has_role('admin'). Audit-Snapshot via fn_emit_audit('pipeline_audit_72h_snapshot',…) beim Migrieren.

## Identifizierte Lücken (für Follow-up Cuts)
1. **minicheck_producer_missing (24)**: `package_generate_lesson_minichecks` läuft 72h gar nicht — `package_validate_lesson_minichecks` parkt mit GATE_FAIL: NO_MINICHECKS. Producer-Enqueue-Drift, separater Cut nötig (analog Exam-Pool-Drift-Detection-Pattern).
2. **pool-fill-bloom-gaps Stale-Deploy persistiert (9)**: GOOGLE_AI_API_KEY not configured (3) + invalid model ID (2) + total_ai_budget_exhausted (4). Memory dokumentiert 2026-05-24-Redeploy als Fix, aber Symptome blieben 5 Tage. **Redeploy 2026-05-29 ausgeführt** — beobachten ob Pattern verschwindet, sonst tieferes Diff Code↔Live nötig.
3. **audit_fn_signature_drift (1× package_auto_publish)**: `fn_emit_audit(unknown, jsonb)` Aufruf — Signatur ist `(text,text,text,text,jsonb,text,text)`. Caller-Code unbekannt (1 Vorkommen), aber Audit-SSOT-Verletzung. Pflicht: named args via `_action_type=>…`.
4. **heal_annotation_recursion (6)**: `Auto-healed (was: Auto-healed: re-queued (was)` — Heal-Tag-Wrapper schreibt rekursiv ineinander statt nur das letzte. Cosmetic, signalisiert aber Heal-Loop ohne Fortschritt.
5. **pre_heartbeat_kill (4) auf seo_blog_hero/anchor_section_generate**: Image-Producer senden nie Heartbeat → nach 2 Claims terminal. Heartbeat-Wrap fehlt.
6. **deterministic_requeue_loop (35)** auf `package_repair_exam_pool_lf_coverage`: 12–19 Attempts ohne Terminal — hartcodiertes Retry-Loop ohne progressives Backoff oder Hard-Kill nach N.

## Strukturelle Lehre
Failure-Beobachtung war pro-Pattern-View (1:1) — skaliert nicht. Klassifizierende SSOT-View mit `cluster_key` ist single-point-of-discovery: jede neue Failure-Klasse muss nur einmal in die CASE-Liste, alle Cockpit-Cards lesen aus derselben Quelle. `is_known_pattern` lenkt Aufmerksamkeit auf unclassified.

Zweite Lehre: User-Memory "Deploy edge functions immediately after code/logic changes" gilt auch retroaktiv — wenn ein Memory-Eintrag einen Redeploy als Fix dokumentiert, das Symptom aber zurückkehrt, ist das Redeploy entweder nie durchgegangen oder das Code-↔-Live-Diff hat sich seitdem geöffnet. Redeploy als erste Diagnose statt letzte Maßnahme.

## Nicht enthalten
- UI-Cockpit-Card (FailedJobsClustersCard) — kommt mit nächstem Cut auf bestehende QueuePage-Sektion 3.
- Cron-Snapshot des Audits (manuelle Trigger reicht für jetzt — kein Daten-Verlust ohne Cron).
- Tiefe Diagnostik für minicheck_producer_missing + pool-fill-bloom-gaps (eigene Cuts pro Cluster mit dedizierten Heal-RPCs).
- Auto-Repair: bewusst keine. Architectural-Rule NO_AUTONOMOUS_PRODUCTION_WRITES.

## Bezug
- P0 Ops Diagnostics 2026-05-24 (erweitert)
- Tail-Step Artifact-Aware Defer (erklärt warum viele "failed" governance-erwartet sind)
- job_queue Guard Audit-Mirror Pattern (audit_fn_signature_drift ist Verstoß)
