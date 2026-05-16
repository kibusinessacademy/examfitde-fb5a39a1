---
name: Track 2.3e Repair Outcome Verification v1
description: growth_repair_outcomes Tabelle + AFTER-INSERT-Trigger auf auto_heal_log registriert jeden dispatched attempt. _growth_repair_verify_outcomes re-checkt v_growth_repair_eligibility_v1 + job_queue → outcome signal_closed|job_failed|stale|abandoned. Cron 15min. Admin RPCs summary/recent/verify_now (dry/live mit Reason).
type: feature
---

# Track 2.3e — Repair Outcome Verification (2026-05-16)

## Zweck
Track 2.3c/2.3d dispatched lokale Repairs. 2.3e beweist, ob das Signal wirklich geschlossen wurde. Verhindert "dispatch theatre": Cooldown läuft ab, Worker dispatcht erneut, niemand weiß ob der erste Versuch tatsächlich wirkte.

## Tabelle `growth_repair_outcomes` (service_role only)
- `attempt_log_id uuid UNIQUE` → FK auf `auto_heal_log.id` (idempotent: 1 outcome pro Attempt)
- package_id, signal, expected_job_type, canonical_job_type, idempotency_key, job_id, dispatcher
- dispatched_at / first_checked_at / last_checked_at / verified_at
- verification_attempts int (default 0)
- **outcome**: `pending` | `signal_closed` | `job_failed` | `stale` | `abandoned`
- outcome_detail jsonb (job_status, signal_still_open, checked_at)

Indizes: pending+last_checked, (package_id,signal,dispatched_at desc), (outcome,dispatched_at desc).

## Trigger `trg_growth_repair_register_outcome`
AFTER INSERT auf `auto_heal_log`, feuert nur für
`action_type IN ('growth_local_worker_attempt','growth_repair_dispatch_attempt')`
AND `result_status='dispatched'`. Liest signal/job/idempotency_key aus metadata, INSERT ... ON CONFLICT DO NOTHING. Exception-safe — wirft nie zurück auf die Audit-Insert.

## Verifier `_growth_repair_verify_outcomes(_mode,_limit,_reason,_actor,_trigger_source)`
- service_role only
- Auswahl: outcome='pending' AND dispatched_at < now()-15min AND (last_checked NULL OR < now()-15min)
- Reihenfolge: last_checked NULLS FIRST, dispatched_at
- Pro Zeile:
  1. job_queue.status (wenn job_id bekannt) → `failed` ⇒ outcome=`job_failed`
  2. EXISTS in `v_growth_repair_eligibility_v1` (package_id, signal)? → wenn nein ⇒ `signal_closed`
  3. dispatched_at < now()-4h ⇒ `stale`
  4. verification_attempts+1 ≥ 8 ⇒ `abandoned`
  5. sonst still_pending (counter++)
- `live`: UPDATE outcome + audit per closure (`growth_repair_outcome_verified`)
- `dry_run`: keine Writes außer einer Summary-Audit-Zeile wenn `v_n_scanned>0`
- Run-Summary immer in `auto_heal_log` action_type=`growth_repair_outcome_run`

## Admin RPCs (has_role-Gate, SECURITY DEFINER)
- `admin_growth_repair_outcomes_summary()` — 14d window, totals + by_signal + by_dispatcher + recent_runs (10), inkl. `avg_close_minutes`
- `admin_growth_repair_outcomes_recent(_outcome, _limit≤500)` — Drill-down mit package_key/title
- `admin_growth_repair_verify_now(_mode, _limit, _reason)` — dry_run|live; live verlangt Reason ≥3 Zeichen

## Cron
`growth-repair-verifier-15min` — `*/15 * * * *` → `_growth_repair_verify_outcomes('live', 100, 'cron: 15min verifier', NULL, 'cron_growth_repair_verifier_15min')`.

## Backfill (Migration)
INSERT für alle dispatched-Attempts der letzten 24h, sodass der Verifier sofort Material hat.

## UI
`GrowthClassificationCard` → neue Sektion **Repair Outcome Verification · Track 2.3e** (unter Local Repair Worker):
- KPI-Strip (6×): Total / Pending / Signal closed / Job failed / Stale / Close-rate %
- Avg time-to-close (Minuten) wenn vorhanden
- By signal: `signal: closed✓ / failed✗ / pending…`
- Recent verifier runs (10), color-coded
- Dry-Run + Verify-Now (Reason-Prompt)

## Invarianten
- KEINE Mutation von customer_safe, course_packages.status, Entitlements, Sellability
- Verifier mutiert NUR `growth_repair_outcomes` + Audit, NIE job_queue
- service_role-Tabelle, Frontend nur via RPC
- Trigger ist EXCEPTION-safe (never block producing audit insert)
- Unique attempt_log_id verhindert Doppel-Registrierung bei Trigger-Replay

## Baseline 2026-05-16
- 25 backfilled outcomes (aus letztem `growth_local_worker_attempt`-Batch)
- Erste Verifier-Cron-Welle: ~15min nach Migration
- Erwarteter Close-Rate-Bereich für FANOUT_NOT_STARTED Pilot: 50–80% innerhalb 4h

## Nächster Schritt
2.3f — Auto-Retry/Suppression auf Basis Outcomes: 
- `signal_closed` → Erfolgsmetrik, kein Retry
- `job_failed` → 1× Retry mit Backoff, dann hard-suppress (signal+pkg in suppression table)
- `stale` → Producer-Health-Alert (vermutlich Job hängt oder Artefakt-Generator broken)
