---
name: Adaptive Burst + Auto-Pulse + Bronze Auto-Unlock v4
description: Phase-4 Sprint 2026-05-09 — adaptive burst 25/35/50/75 mit health-gate, autonomer recovery_pulse via cron, scope-limitierter bronze tail auto-unlock, forensik-card im Heal-Cockpit
type: feature
---

## Kern
- **Adaptive Burst** statt flat: `fn_adaptive_burst_size(pending)` → 25 / 35 (>100) / 50 (>500) / 75 (>1000). IMMUTABLE, testbar.
- **Health-Gate**: `fn_worker_health_gate()` prüft processing<50, reaper_kills_5m<5, db_latency<250ms.
- **Autonomer Pulse**: Cron `auto-recovery-pulse-5min` → `fn_auto_recovery_pulse_decide()` callt `claim_recovery_pulse(burst, 'default')` NUR wenn pending>100, oldest>10min, gate green. Sonst noop-Audit.
- **Bronze Tail Auto-Unlock**: `admin_bronze_tail_auto_unlock(p_max=5)` setzt `bronze_lock_override=true` auf bestehende pending Tail-Jobs (integrity/council/auto_publish) — Scope: status=building + approved_q≥50 + locked_tail_jobs>0. Kein neuer Enqueue, nur Override-Patch.
- **Forensik UI**: `WorkerThroughputForensicsCard` im Heal-Cockpit Tab "diagnostics" zeigt pro Pool: pending/processing/oldest, batch=25, recommended_burst, gate-Status, Tip-Text, Manual-Pulse-Button.
- **Pre/Post Smoke**: `admin_smoke_dag_heal_pre_post(p_phase pre|post)` für Migration-Bracketing — schreibt Snapshot in `auto_heal_log` als `dag_heal_smoke_pre|_post`.

## Verifikation
- DO-Block in Migration: 4 Burst-Stufen + Gate-Shape grün.
- Vitest 18/18 grün (admin-RPCs refuse anon, burst+suppression truth-tables).
- Cron 193 (auto-recovery-pulse-5min) registriert.

## Restrisiken
- `processing<50` ceiling ist heuristisch; kann bei skalierten Workern zu klein sein → später als config_value.
- Bronze Auto-Unlock greift nur wenn `course_packages.feature_flags.bronze.locked = true`. Trigger-Bypass muss separat getestet werden.

## Dauermaßnahmen
- Adaptive-Burst-Helper als SSOT in claim-Funktionen propagieren (statt p_limit-Default).
- Bronze Auto-Unlock als nightly cron (mit p_max=10) erwägen wenn manuelle Welle stabil läuft.
- WorkerThroughputForensicsCard als erste Tile im Pulse-Bereich beobachten — bei recovery_pulse_eligible=true für >2h alarmieren.
