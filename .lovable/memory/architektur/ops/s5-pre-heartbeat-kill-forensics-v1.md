---
name: S5 Pre-Heartbeat Kill Forensics
description: PRE_HEARTBEAT_KILL kill-class trennt Edge-Function-CPU-Kills von Worker-Fehlern; nach 2 Vorkommen terminale Quarantäne via course_packages.feature_flags.pre_heartbeat_quarantine; Cockpit-Card im Diagnostics-Tab; per-lane E2E-Smoke RPC.
type: feature
---

## Kern
- **Klassifikation**: `fn_is_pre_heartbeat_kill(locked_at, last_heartbeat_at, grace=180s)` IMMUTABLE pure SQL — Job ist `processing`, `last_heartbeat_at IS NULL`, `locked_at` älter als grace.
- **Reaper erweitert**: `fn_reap_stale_processing_jobs` läuft PHK-Pfad VOR generischem stale-reap. PHK-cutoff = 3min (statt 10min) — schneller Detect.
  - PHK-A: nach 2 PHK-Vorkommen → status=failed, code=`PRE_HEARTBEAT_KILL_TERMINAL`, liveness=killed.
  - PHK-A2: terminale Pakete erhalten `course_packages.feature_flags.pre_heartbeat_quarantine.active=true` (occurrences-counter).
  - PHK-B: erste PHK → status=pending, run_after+5min, code=`PRE_HEARTBEAT_KILL`, liveness=`pre_heartbeat_killed`, meta.pre_heartbeat_kill_count++.
- **Bronze-Lock erweitert**: `fn_is_bronze_locked` blockiert Enqueues für PHK-quarantinierte Pakete (gleicher choke-point wie bronze_quarantine). Manual-Bypass via `pre_heartbeat_quarantine.manual_bypass=true` möglich.
- **CHECK-Constraint**: `job_queue_liveness_status_chk` um `pre_heartbeat_killed` erweitert.

## Diagnostik
- View `v_pre_heartbeat_kill_risk` (service_role only): aggregiert 24h nach (job_type, lane, worker_pool) — phk_1h, phk_24h, phk_terminal_24h, distinct_packages_24h, last_kill_at.
- RPC `admin_get_pre_heartbeat_kill_risk()` SECURITY DEFINER + has_role('admin').
- RPC `admin_clear_pre_heartbeat_quarantine(p_package_id, p_reason)` mit Reason-Pflicht (≥5 chars), audit in `auto_heal_log` (action_type='clear_pre_heartbeat_quarantine').
- RPC `admin_lane_e2e_smoke()` liefert pro Lane (control/generation/content/recovery/default): pending, processing, failed_15m, failure_rate_15m, recommended_burst (v2), pulse_decision (eligible|idle).

## UI
- `PreHeartbeatKillRiskCard` im Heal-Cockpit Tab "diagnostics" (vor QualityGateDecisionsCard). Severity: critical wenn phk_terminal_24h>0, warn wenn phk_1h>0, sonst ok. 4 Stat-Tiles (Hotspots/PHK 1h/PHK 24h/Terminal) + Tabelle.

## Tests
- `src/test/ops/s5-pre-heartbeat-kill.test.ts` 15/15 grün. Anon-Refusals + per-Lane Helper-Calls für alle 5 Lanes.

## Verifikation
- DO-Block in Migration: 3 Truth-Cases von fn_is_pre_heartbeat_kill grün, fn_reap_stale_processing_jobs(60) no-op grün.
- Live-DB 1h: 17 ok + 8 STALE_PROCESSING_EXHAUSTED + 8 STALE_PROCESSING_REAPED + 4 MAX_ATTEMPTS_EXHAUSTED — keine PRE_HEARTBEAT_KILL Events bisher (erwartet, fängt erst neue Wellen).

## Restrisiken
- 3min PHK-cutoff kann bei extrem langen Cold-Starts (Edge-Function init >180s) false-positive Pre-Heartbeat-Kills erzeugen. Falls beobachtet → grace via Helper-Default höher.
- Manual-bypass des PHK-Quarantine ist nur über direkten course_packages-Update möglich (kein Admin-RPC). Falls häufig nötig → analog zu `admin_bronze_quarantine_manual_bypass` ergänzen.
