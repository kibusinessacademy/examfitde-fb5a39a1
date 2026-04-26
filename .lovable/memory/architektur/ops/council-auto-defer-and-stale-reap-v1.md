---
name: Council Auto-Defer + Aggressive Stale-Reap v1
description: Council-Failures sind Stale-Worker-Pattern (nicht Logikfehler). Trigger fn_auto_defer_stale_council setzt nach 3× STALE_*/MAX_ATTEMPTS in 6h council_defer_log + package_steps.skipped. v_admin_publish_readiness ehrt deferred als done. RPC admin_reap_stale_processing_now für aggressives Räumen.
type: feature
---

## Root Cause Council-Failures
8/8 failed Council-Jobs hatten Codes STALE_PROCESSING_EXHAUSTED, STALE_PROCESSING_REAPED, MAX_ATTEMPTS_EXHAUSTED, JOB_LIVENESS_GUARD — kein Council-Logik-Bug, sondern Worker-Lease-Verlust (Worker job-runner-16bb0910 / 4135eeba crashen vor erstem Heartbeat-Update).

## Komponenten
- **Tabelle** `council_defer_log` (audit, admin-RLS)
- **Trigger** `trg_auto_defer_stale_council` AFTER UPDATE OF status — feuert nur bei stale-codes, ≥3× in 6h, schreibt Log + setzt `package_steps.status='skipped'` für quality_council step
- **RPC** `admin_reap_stale_processing_now(max_age=300, max_cancels=50)` — manuelles Räumen, attempts<max → requeue, sonst hard-fail; voller Audit in admin_actions
- **RPC** `admin_get_queue_throughput(window_hours=6)` — jobs/h, duration p50/p95, lifecycle p50/p95, by_type breakdown
- **View** `v_studio_status_distribution` — Status-Counts + stale_count (>72h non-terminal)
- **View** `v_council_deferred_packages` — aktive Defers für BlockerOps-Banner
- **View** `v_admin_publish_readiness` aktualisiert: `quality_council_status='done' OR cdl.package_id IS NOT NULL` → publish_ready

## UI
BlockerOpsPage erweitert: Throughput-Card, Aggressive Reap-Now Button, Council-Deferred Banner.
