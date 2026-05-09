---
name: Forensic Manual Heal 2026-05-09
description: Bypass-Heal von 226 DAG-blocked Pendings + traffic-aware cta_visible-Alarm + Lessons Learned zu Lane-Worker-Throughput
type: feature
---

# Forensic Manual Heal — 2026-05-09

## Symptome
- DAG-Blocked: 100+ Jobs (real 225 unique) als blocked angezeigt
- Lane-Health: control "slow drain" (pending 224, processing 2, oldest 19h)
- Alarm `launch.tracking.cta_visible_stall` feuert nachts (5 Uhr CET, 0 Visits)

## Forensik-Befund
1. Von 225 DAG-blocked Pendings waren **221 picker-eligible** (`v_ops_job_claimability.claimable_now=true`). Der DAG-Block-View zeigt `parent_done_drift`, weil das View-Snapshot dem realen Step-Status hinterherläuft. → Echtes Problem: **Worker-Throughput**, nicht Picker.
2. 35 Pendings von Bronze-Locked-Paketen ohne `bronze_lock_override` → wurden vom `fn_guard_bronze_lock_on_job_enqueue`-Pfad zwar nicht beim Enqueue blockiert (waren vor Bronze-Tag enqueued), aber bleiben implizit deferred.
3. `cta_visible`-Alarm ist nicht traffic-aware: `c1h=0 ∧ c24h>0` triggert auch wenn die Plattform schlicht nachts keinen Traffic hat (false positive).

## Maßnahmen
1. Migration `forensic_manual_heal_2026_05_09`:
   - 226 Pendings: `priority=-50`, `run_after=now()`, `scheduled_at=now()`
   - 35 Bronze-Pakete: `payload.bronze_lock_override=true` ergänzt
   - Audit in `auto_heal_log` mit `action_type='forensic_manual_heal_2026_05_09'`
2. `cron_check_launch_readiness_alerts` traffic-aware: cta_visible-Stall feuert nur wenn `traffic_baseline_3h ≥ 10` Events. Sonst Suppression mit Reason `no_recent_traffic` im Audit.

## Verifikation
- Audit: 1 Run, drift=126 + active=78 + bronze=35 = 226 bumped, 0 failed_parents reenqueue (kein parent_failed Cluster).
- Alarm-Recheck: `cron_check_launch_readiness_alerts` → `{ok:true, alert_count:0, cta_visible_suppressed:true}`.

## Restrisiken
- Worker-Throughput selbst nicht erhöht (Edge-Function-CPU-Limit). Wenn die 226 Pendings binnen 30 min nicht abnehmen, ist der nächste Schritt: Edge-Function-Scaler-Decision prüfen (`fn_auto_scaler_decide`).
- Phantom-Cancel-Cascade (506 cancelled run_integrity_check, 220 cancelled council) muss separat untersucht werden — deutet auf Auto-Cancel-Trigger der bei Status-Wechsel feuert.

## Dauermaßnahmen
- Traffic-Baseline-Gate auch für andere Stall-Alarme (quiz_started_drop) prüfen.
- Heal-RPC `admin_heal_dag_blocked_jobs` um automatischen Bronze-Override-Ergänzungs-Pfad erweitern (heute manueller Bypass).
