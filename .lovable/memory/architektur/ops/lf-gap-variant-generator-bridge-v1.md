---
name: LF-Gap Variant-Generator-Bridge v1
description: Ersetzt Coverage-Repair-Loops bei LF_REPAIR_NO_EFFECT durch gezielte package_generate_blueprint_variants Enqueues pro fehlendem Blueprint, idempotent pro Stunde, mit Cron 241.
type: feature
---

## Problem
LF-Repair-Hotloops mit Subcode `LF_REPAIR_NO_EFFECT` (Blueprints vorhanden, aber 0 `validation_passed=true` Varianten) wurden vom Coverage-Repair-Worker endlos requeued, ohne Material zu materialisieren.

## Lösung
- `fn_dispatch_lf_gap_variant_bridge(p_package_id uuid)` — pro Paket:
  - Klassifikator-Gate: nur wenn `subcode='LF_REPAIR_NO_EFFECT'`.
  - Iteriert über `v_exam_pool_lf_repair_gap_classification` mit `gap_class='VARIANT_GAP'`.
  - Selektiert approved BPs (status≠deprecated, approved_at NOT NULL) ohne usable Variant.
  - Enqueued `package_generate_blueprint_variants` pro BP mit `count=5`, `_origin='lf_gap_variant_bridge'`, `enqueue_source='lf_gap_variant_bridge'`, `learning_field_filter`, `competency_id`.
  - Idempotency-Key `lf_gap_var_bridge:<pkg>:<bp>:<YYYYMMDDHH>` — 1 Job/BP/Stunde.
  - Aktiv-Job-Dedup pro `(package_id, blueprint_id)`.
- `admin_dispatch_lf_gap_variant_bridge(uuid)` — Admin-RPC mit `has_role` Gate.
- `fn_auto_dispatch_lf_gap_variant_bridge()` — Bulk-Lauf über alle Pakete mit VARIANT_GAP + 0 usable Variants. Cron 241 `lf-gap-variant-bridge-15min` (`*/15 * * * *`).

## Audit
- `lf_gap_variant_bridge_enqueued` — pro BP eingeplanter Job.
- `lf_gap_variant_bridge_skipped` — Subcode-Mismatch / no curriculum / aktiver Job / idempotenter Bucket.
- `lf_gap_variant_bridge_summary` — Per-Package Zusammenfassung.
- `lf_gap_variant_bridge_bulk_run` — Cron-Lauf-Audit.

## Smoke 2026-05-15
- b064f0c5 (Gold/Silberschmied): 41 BPs → 6 sofort gelandete Jobs, Rest durch `trg_enforce_global_fanout_cap` zurückgehalten (kein Fehler, Cron dispatcht in Folge-Bucket).
- 5d74dcbf (Bürsten/Pinselmacher): 60 BPs → 9 gelandete Jobs analog.
- Keine neuen `package_repair_exam_pool_lf_coverage` Loops.

## Constraints
- Kein Threshold-Senken.
- Kein Coverage-Repair-Requeue.
- Counter `v_enqueued` zählt RETURN NEXT, nicht effektiv gelandete Inserts (Global-Fanout-Cap kann RETURN NULL ohne Exception).

## Rollback
```sql
SELECT cron.unschedule('lf-gap-variant-bridge-15min');
DROP FUNCTION IF EXISTS public.fn_auto_dispatch_lf_gap_variant_bridge();
DROP FUNCTION IF EXISTS public.admin_dispatch_lf_gap_variant_bridge(uuid);
DROP FUNCTION IF EXISTS public.fn_dispatch_lf_gap_variant_bridge(uuid);
```
