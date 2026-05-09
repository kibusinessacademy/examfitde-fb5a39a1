---
name: S5 Hotfix + Manual PHK Heal + Aggregate-State Audit 2026-05-09
description: 10 SQL/Schema-Hotfixes für S5 (count(*), actor_uid weg, helper service-only, terminal threshold off-by-one, generic-reaper-Ausschluss, merge-friendly quarantine, manual_bypass on clear, lane var, no-mutation smoke). Manuelle Heilung 17 control-lane Tail-Jobs mit PHK-Pattern. E2E Cross-Dimension-Audit.
type: feature
---

## Hotfixes
- `count()` → `count(*)` reaffirmed (PG-Invariante, jetzt auch in jeder neuen RPC enforced).
- `auto_heal_log` hat **kein** `actor_uid`/`actor_id` — Actor wandert in `metadata.actor`. INSERTs in `admin_clear_pre_heartbeat_quarantine` korrigiert.
- `fn_is_pre_heartbeat_kill` REVOKED von anon/authenticated — service_role only (interne Liveness-Logik).
- PHK-Terminal-Threshold: `>= v_max_phk - 1` → 2. Kill = terminal (war off-by-one).
- Generic Reaper schließt PHK-Rows aus (`NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)`) → keine Doppel-Klassifikation.
- `pre_heartbeat_quarantine` JSONB merged statt überschrieben — `occurrences` & history bleiben.
- `admin_clear_pre_heartbeat_quarantine` setzt `manual_bypass=true` → künftige Enqueues deterministisch unblocked.
- `admin_lane_e2e_smoke` benutzt `v_lane`/`v_pool` (kein Spalten-Shadowing).
- Migration-Smoke ist read-only (View-SELECT statt `fn_reap_*`).
- Reservierter Code `PRE_HEARTBEAT_QUARANTINED` für künftige Enqueue-Block-Messages.

## Manual Heal
17 control-lane Tail-Jobs (council/integrity/auto_publish/validate_tutor_index) mit `last_heartbeat_at IS NULL` aus letzten 2h re-enqueued: `bronze_lock_override=true`, jittered run_after 60-360s, max_attempts=3, payload mit curriculum_id (guard-Pflicht). Alle 17 Pakete waren `building` mit 269-1172 approved questions — klassisches Edge-Function-CPU-Kill-vor-Heartbeat. Audit `manual_phk_pattern_heal`.

## Aggregate-State Audit (6h)
**Control-Lane** (klar dominant): 543 cancelled · 118 failed · 60 deferred · 37 claimable · 44 processing davon **14 PHK_RISK** (locked_at>3min, last_heartbeat_at IS NULL).
**Generation/Content/Recovery**: marginal (14/2/8 cancelled).
→ Bottleneck ist eindeutig control-lane CPU-Kapazität. S5-Reaper wird die 14 PHK_RISK-Jobs auf nächstem Tick (5min) klassifizieren.

## Architektur-Lehre
S5 reapt sauber, aber Worker-Claim für risky Jobtypes (council/integrity/auto_publish) bleibt CPU-stampede-anfällig. Nächster sinnvoller Schritt: `fn_adaptive_burst_size_v2` um PHK-Rate-Signal erweitern (wenn `phk_1h>0` für (lane,job_type) → cap auf 1-3, run_after-Jitter automatisch).
