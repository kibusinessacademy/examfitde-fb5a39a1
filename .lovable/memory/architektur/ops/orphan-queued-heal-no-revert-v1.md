---
name: orphan-queued-heal no-revert + cooldown
description: fn_heal_orphan_queued_steps revertiert nicht mehr auf pending_enqueue bei dedup-reject. Step bleibt queued + 5min cooldown via meta.last_enqueue_attempt. Eliminiert Reverter-Loop (123/6h → 0) der control-Lane blockierte.
type: feature
---
Root Cause control-lane Standstill: pg_cron `fn_heal_orphan_queued_steps(800)` setzte queued→pending_enqueue wenn `enqueue_job_if_absent` wegen Dedup ablehnte → Heiler-Kollision mit pending_enqueue→queued Promotor.

Fix: Bei reject NUR `meta.last_enqueue_attempt` + `last_enqueue_reject_reason` stempeln, Status bleibt `queued`. 5-Min Cooldown skipt Re-Versuche. Audit `orphan_queued_dedup_cooldown` in auto_heal_log.
