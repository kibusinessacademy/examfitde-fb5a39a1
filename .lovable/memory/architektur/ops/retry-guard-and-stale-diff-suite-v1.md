---
name: Retry Guard, Stale-Diff & Exhaustion-Cleanup Suite v1
description: BEFORE-Trigger fn_retry_guard_smart_repair parkt loopende Jobs (NO_MINICHECKS, COVERAGE_GAP, HTTP500@5+) 24h und enqueued Vorgänger-Repair via get_step_prerequisite. Plus 3 Admin-Views + 1 RPC für Drift-Erkennung und Cleanup.
type: feature
---

## Komponenten (Migration 20260425_070510)

1. **fn_retry_guard_smart_repair** (BEFORE UPDATE on job_queue, WHEN status='pending' AND attempts>=3)
   - Park-Signaturen: NO_MINICHECKS, PREREQ_NOT_DONE, MISSING_SOURCE_DATA, NO_BLUEPRINT, NO_LESSONS, COVERAGE_GAP, HTTP 500 (ab attempt 5)
   - Setzt run_after = now()+24h, last_error = 'PARKED_AWAITING_PRECONDITION: <prereq>...'
   - Enqueued Vorgänger-Repair-Job (lane='recovery', priority=80) idempotent (1h-Fenster)
   - Audit in admin_notifications (severity=warning, category=pipeline_ops)

2. **v_admin_stale_marker_diff** — Drift-Klassifikation pro Paket:
   - STALE_EXHAUSTION_PUBLISHED, GHOST_PUBLISHED_FLAG_MISMATCH, STALE_EXHAUSTION_NO_OPEN_STEPS,
     ORPHAN_BUILDING_NO_PROGRESS, GHOST_BLOCKED_NO_FAILURE, PARKED_AWAITING_PREREQ,
     EXHAUSTED_BUT_STILL_RUNNING, CLEAN
   - recommended_action: purge_stale_exhaustion / sync_published_flag / enqueue_next_step_or_finalize / await_prereq_or_manual_unpark / none

3. **v_admin_action_precondition_check** — pro Paket: active_jobs[], parked_jobs[], critical_job_running, action_state ∈ {block_actions_processing, block_actions_critical_job_pending, allow_actions}
   - Kritische Jobtypen: package_run_integrity_check, package_quality_council, package_repair_hardish_balance, package_validate_exam_pool, package_repair_exam_pool_quality

4. **admin_purge_stale_exhaustion(p_package_id uuid, p_trigger_refill bool)** RPC
   - Räumt HARD_FAIL_REPAIR_EXHAUSTED-Marker für Pakete mit drift_class IN STALE_EXHAUSTION_* AND active_jobs=0
   - Optional: enqueued package_run_integrity_check (lane=recovery) wenn p_trigger_refill=true und pkg=building+unpublished

5. **v_admin_blocked_packages_split** — Auto/Manuell-Klassifikation für 17-Block-Übersicht; liefert block_class, block_reason_text, next_step_cta

## Frontend-TODOs (offen, nächster Loop)
- src/pages/admin/v2/StaleMarkerDiffPage.tsx (View 2)
- src/components/admin/heal/PreconditionGate.tsx → blockt Action-Buttons in PackageDrawer (View 3)
- src/components/admin/heal/PurgeExhaustionButton.tsx (RPC 4)
- src/pages/admin/v2/QueuePage.tsx erweitern um Auto/Manuell-Tabs (View 5)
- Routes in src/routes/AppRoutes.tsx ergänzen

## Marketing/SEO/CRM Audit (offen, nächster Loop)
Datenbasis bereits inspiziert: 124 SEO-Keywords, 49 Cluster, 97 SEO-Pages, 111 Internal-Links,
12 Email-Sequences, 3 Lead-Magnets, ABER: 0 Orders, 0 CRM-Contacts, 0 Email-Campaigns,
0 Conversion-Events, 6 Tracking-Events 30d, 3 Profiles, 17 Blocked Pakete, 14/439 published.
Kern-Lücken: Tracking unterversorgt, kein Order-Funnel aktiv, CRM leer, Email-System nicht
operativ. PDF/Excel-Export wird im nächsten Loop erstellt.
