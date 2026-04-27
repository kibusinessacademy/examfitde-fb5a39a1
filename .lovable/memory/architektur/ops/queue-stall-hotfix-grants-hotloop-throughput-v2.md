---
name: Queue-Stall Hotfix — Grants, Hot-Loop-Quarantäne, Throughput v2
description: GRANT EXECUTE für admin_reap_stale_processing_now + admin_get_queue_throughput, neue admin_quarantine_hotloop_jobs RPC (cancel + step deferral), neue admin_get_queue_throughput_v2 mit pending_wait und processing_oldest. Verdrahtet in BlockerOpsPage.
type: feature
---

# Queue-Stall Hotfix — 2026-04-27

## Root Cause für queue#live-Stall
- 5 Processing + 47 Pending, 0 done in 1h, pending_wait_p95 ≈ 17h.
- Treiber: 4 stale `package_run_integrity_check` und 2 stale `package_repair_exam_pool_quality` halten Locks.
- Hot-Loop: `package_promote_blueprint_variants` für Pakete `7472b96f`, `0d351bb2`, `2aba85aa`, `ec0183bd` — bis zu 21 attempts, alle in REQUEUE_LOOP_KILLED, Steps stehen weiter auf `queued`/`pending_enqueue`, Atomic-Trigger erzeugt fortlaufend neue Jobs.
- Reaper-RPCs existierten als SECURITY DEFINER, hatten aber **kein GRANT EXECUTE** — UI-Buttons liefen ins `permission denied`.

## Fix
1. `admin_reap_stale_processing_now(p_max_age_seconds, p_max_cancels)` und `admin_get_queue_throughput(p_window_hours)` neu mit explizitem `is_admin(auth.uid())` Guard + `GRANT EXECUTE TO authenticated`.
2. **Neu: `admin_quarantine_hotloop_jobs(p_attempt_threshold int default 10, p_dry_run bool default true, p_job_types text[] default null)`**
   - Listet alle nicht-terminalen Jobs mit `attempts ≥ threshold` (optional gefiltert nach Typ).
   - Dry-Run liefert Kandidatenliste + `by_type` Histogramm, schreibt Audit `admin_actions:admin_quarantine_hotloop_jobs:dry_run`.
   - Execute: Jobs → `cancelled` mit `last_error += HOTLOOP_QUARANTINE_CANCELLED`, betroffene `package_steps.status` (für meta.step_key) → `deferred` + `last_error='HOTLOOP_QUARANTINE_AUTODEFER'`. Audit `admin_quarantine_hotloop_jobs:execute`.
   - Step-Deferral verhindert, dass Atomic-Trigger neue Jobs für denselben step nachlegt.
3. **Neu: `admin_get_queue_throughput_v2(p_window_hours)`** — wrapped v1, ergänzt:
   - `pending_wait_p50_sec`, `pending_wait_p95_sec` — über alle aktiven `pending`/`queued`-Jobs.
   - `processing_oldest_sec` — Alter des ältesten processing-Jobs (heartbeat/locked/started/created).
4. UI `BlockerOpsPage.tsx`:
   - Throughput-Card umgestellt auf v2 (8 Metriken inkl. pending_wait, oldest_processing, mit Destructive-Highlight bei p95>1h bzw. >10min).
   - Neue **Hot-Loop-Quarantäne** Card mit konfigurierbarem Threshold und Dry-Run/Execute Buttons.

## Bedienung
1. Throughput-Card prüfen (oldest_processing >600s rot ⇒ Reap Now).
2. „Reap Now (aggressive)" entlässt stale processing-Jobs.
3. „Hot-Loop Quarantäne" mit threshold=10, **Dry-Run zuerst** — Toast zeigt by_type Histogramm.
4. Execute cancelt + deferred steps. Pakete bleiben sichtbar, blockieren publish_readiness aber nicht weiter über diesen step.

## Konvention
Beide RPCs setzen `app.transition_source = 'admin_ui:<action>:<uid>'` für Trigger-Honesty (vgl. auto-retry-and-queue-health-audit-v2).
