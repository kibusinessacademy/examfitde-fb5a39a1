---
name: Phantom Producer Guard v1
description: fn_atomic_enqueue_on_step_queued härtet zwei 60s-Guards (recent_finalized_step + recent_duplicate_job). admin_get_cancel_hotspots RPC + CancelHotspotsCard zeigt per-Paket Burst-Cluster.
type: feature
---

# Phantom Producer Guard v1 (Fix #1 von 4)

## Problem
74% aller Job-Cancellations (113/153 in 168h) waren STEP_ALREADY_DONE_PHANTOM.
Healer-Bursts (queued_tail_reconciler, tail_step_drift_v2_heal) flippten Steps von done → queued → done innerhalb Sekunden, was kurzlebige Job-Inserts erzeugte, die der claim_phantom_guard sofort wieder cancelte.

## Fix
Zwei zusätzliche Guards im Producer-Trigger fn_atomic_enqueue_on_step_queued (vor Job-Insert):

**Guard A — recent_finalized_step (60s):**
- Bei UPDATE: wenn OLD.status IN (done, skipped, failed) UND OLD.finished_at/updated_at > now() - 60s → kein Job, Audit `atomic_enqueue_skipped_recent_finalized_step`.

**Guard B — recent_duplicate_job (60s):**
- Wenn job_queue bereits einen gleichen (package_id, job_type) in den letzten 60s enthält (egal welcher Status) → kein Duplikat, Audit `atomic_enqueue_skipped_recent_duplicate`.

## Diagnostik
- RPC `admin_get_cancel_hotspots(p_hours, p_limit)` (admin-only) liefert per (job_type × reason_code × package_id) Anzahl, %, first/last_seen, package_title, package_status.
- UI: `CancelHotspotsCard` im Heal-Cockpit Diagnostics-Tab. Highlight: Phantom-Bursts (≥3 Cancels desselben Reasons auf demselben Paket).

## Out of scope (folgende Sprints)
- Fix #2 Tail-Healer-Cooldown (queued_tail_reconciler + tail_step_drift_v2)
- Fix #3 Resolver NO_EFFECT-Loop (MAX_ATTEMPTS_EXHAUSTED)
- Fix #4 Generate-Dedup gegen STEP_FINALIZED Race

## Migration
20260511_phantom_producer_guard_v1
Audit: `phantom_producer_guard_v1_installed` in auto_heal_log.
