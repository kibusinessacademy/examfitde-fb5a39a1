---
name: auto_heal_log Identity Defaults
description: BEFORE INSERT Trigger setzt target_type='system'+result_status='unknown' falls NULL. action_type bleibt Pflicht (raise). Single-Point-Fix für 17 globale Cron-Producer. Legacy-Backfill 94380 Einträge mit separatem Audit.
type: feature
---

# auto_heal_log Identity Defaults v1 (2026-05-01)

## Problem
Identity-Guard 5 meldete 2771/40514 auto_heal_log-Einträge in 24h ohne `target_type`/`result_status`.
Root Cause: 17 globale Cron-Producer (pipeline_watchdog, production_guardian, worker_liveness_check, lc_shard_liveness_revive, reap_stale_processing, etc.) loggen System-Cycles ohne Einzelziel.

## Fix (Single-Point-Defaults statt 17 Edge-Function-Refactors)
**Trigger `trg_auto_heal_log_identity_defaults` (BEFORE INSERT):**
- `action_type IS NULL` → **RAISE EXCEPTION** (echter Producer-Bug)
- `target_type IS NULL` → `'system'` (korrekte Semantik für globale Cycles)
- `result_status IS NULL` → `'unknown'` (defensive, Producer SOLL setzen)
- `target_type<>'system' AND target_id IS NULL` → metadata.identity_warning gesetzt (kein Block, sammeln für späteren Producer-Fix)

## Konvention
- `target_type='system'` ist **gültiger Wert** für globale Producer ohne Einzelobjekt (cron-cycles).
- `target_id` darf bei `target_type='system'` NULL sein.
- Andere `target_type` (`'package'`, `'job'`, `'course'`, etc.) erwarten `target_id`.

## Backfill
- 94380 historische Einträge `target_type IS NULL` → `'system'`.
- Separater Audit-Eintrag `action_type='system_backfill_target_type'` mit `metadata.backfill_version='legacy_backfill_v1'`.

## Monitoring
View `v_auto_heal_log_identity_health` (24h-Fenster, service_role only):
- `total_24h`, `missing_action_type`, `missing_target_type`, `missing_result_status`
- `non_system_without_target_id` (Tech-Debt-Counter für Producer-Refactor)
- `guard5_status` ('green' | 'red')

Baseline 2026-05-01 nach Fix: **green**, 0 violations, 233 non_system_without_target_id (Tech-Debt-Liste).

## 7-Tage-Beobachtung
- Stand 2026-05-01: Identity-Guard 5 grün.
- Wenn am 2026-05-08 weiterhin grün → `canonical-identity-contract-guard.mjs` von `MODE=warn` auf `MODE=hard` umstellen.
- non_system_without_target_id Drift wird über `v_auto_heal_log_identity_health` beobachtet.

## Migration
`supabase/migrations/20260501100436_*.sql`
