---
name: PRE_HEARTBEAT_KILL Heartbeat-Wrap (post-publish-growth-worker) v1
description: P0-Cut 2026-05-29 gegen pre_heartbeat_kill-Spike in package_post_publish_audit_snapshot (17 terminal/76 pending in 48h). Root-Cause: post-publish-growth-worker claimed bis zu 20 Jobs synchron in einem for-loop, ohne last_heartbeat_at zu stempeln — Reaper killte spätere Loop-Iterationen nach 3min. Fix: heartbeat at-claim + per-job vor handler-Aufruf. Terminal-Status-Regression-Guard verbietet Resurrect von failed→pending — daher neue Pending-Jobs (NICHT alte resurrektieren).
type: feature
---
# PRE_HEARTBEAT_KILL Heartbeat-Wrap

## Symptom
48h-Audit 2026-05-29: pre_heartbeat_kill-Cluster von 4 (72h) → 19 (48h). 17/19 alle aus job_type `package_post_publish_audit_snapshot`, last_error `PRE_HEARTBEAT_KILL_TERMINAL: claimed >= 2 times without ever sending a heartbeat`. Worker selbst meldete 3723 completed in 72h — der Handler funktioniert, das Heartbeat-Stempeln fehlte.

## Root Cause
`supabase/functions/post-publish-growth-worker/index.ts` claimed bis zu `MAX_JOBS_PER_RUN=20` Jobs in einem einzigen UPDATE (alle bekommen `started_at=now()`, `locked_at=now()` — aber **kein** `last_heartbeat_at`). Die Loop verarbeitete dann sequenziell. Spätere Iterationen (Job 15–20) saßen 1–3 Minuten in `processing` ohne Heartbeat → Reaper-Pulse markierte sie stale → nach dem zweiten Reap → `STALE_REAP_LOOP_TERMINAL`/`PRE_HEARTBEAT_KILL_TERMINAL`.

## Fix
Single-Point-Patch im Claim-Block + Per-Iteration-Heartbeat:
- Claim UPDATE setzt zusätzlich `last_heartbeat_at = now()`.
- Vor jedem Handler-Aufruf in der For-Loop: separater `UPDATE job_queue SET last_heartbeat_at=now() WHERE id=job.id`.

Damit fällt jeder Job innerhalb der 3-Min-Window in den Reaper-Schutz, egal an welcher Loop-Position er steht.

## Strukturelle Lehre — Terminal-Status-Regression-Guard
Erst-Versuch war `UPDATE job_queue SET status='pending'` für 17 PRE_HEARTBEAT_KILL_TERMINAL-Reihen. Der Trigger `trg_guard_terminal_status_regression` (`fn_guard_terminal_status_regression`) blockt jede `completed|failed|cancelled` → `pending|processing|...` Transition **silent** (setzt NEW.status:=OLD.status, NEW.completed_at:=OLD.completed_at — andere Felder wie `last_error`, `run_after` rutschen durch, weshalb es aussah, als sei das UPDATE durchgegangen). Lehre: **Failed-Jobs werden nie resurrektiert, sondern als neue Pending-Jobs re-enqueued** (eigener idempotency_key). Bei der Heilung dieses Cuts war kein Re-Enqueue nötig — 76 Pending warten bereits in der Queue und profitieren ab dem nächsten Worker-Run vom Fix.

## Nicht enthalten
- Heartbeat-Wrap für andere generische Worker (council-worker, qc-worker, ai-eval-worker etc.) — analoges Pattern, aber kein akuter Spike. Separater Cut bei Bedarf.
- Cron-Snapshot des Audits — bewusst nicht (manual trigger reicht, NO_AUTONOMOUS_PRODUCTION_WRITES).
- minicheck_producer_missing (14, P1) + pool_fill_bloom_gaps Code↔Live-Diff (9, P2) — eigene Cuts.

## Bezug
- Pipeline-Audit Failed-Jobs 72h SSOT v1 (Cluster pre_heartbeat_kill identifiziert)
- Status Revert Guard v2 (verwandtes Pattern — verbietet building→queued; hier blockt das Pendant terminal→non-terminal)
- Lane-Health RPC + Reap-Loop Guard (Reaper-Hard-Kill nach 2 Stale-Cycles ist genau der Mechanismus, der hier zugeschlagen hat)
