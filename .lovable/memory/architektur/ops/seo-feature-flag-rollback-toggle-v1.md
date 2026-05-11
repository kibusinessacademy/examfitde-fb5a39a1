---
name: SEO Feature-Flag Rollback Toggle v1
description: Admin-gated Toggle für ops_feature_flags.seo_* via admin_set_seo_feature_flag (Reason-Pflicht ≥5 chars, auto_heal_log Audit). UI SeoRollbackDialog zeigt Aktuell→Ziel-Diff, Confirm-AlertDialog, und letzte 10 Integrity-Gate-Failures (admin_get_recent_integrity_gate_failures, integrity_passed/score/hard_fail/code) als Rollback-Kontext.
type: feature
---

## RPCs
- `admin_set_seo_feature_flag(p_flag_key text, p_enabled bool, p_reason text)` — has_role admin gate, prefix-Check `seo_%`, Reason ≥5 chars, UPSERT in `ops_feature_flags`, Audit in `auto_heal_log` (action_type=`seo_feature_flag_toggle`, target_id=flag_key, metadata enthält previous/new/reason/actor).
- `admin_get_recent_integrity_gate_failures(p_limit, p_window_minutes)` — admin-only, listet `package_run_integrity_check`-Jobs mit `last_error/last_error_code = QUALITY_THRESHOLD_NOT_MET` ODER `meta.last_result.integrity_passed = false`, inkl. score + hard_fail_count + age.

## UI
- `SeoRollbackDialog` (max-w-2xl): State-Diff-Card + Switch-Vorschau (read-only) + Reason-Textarea + Failures-Tabelle (ScrollArea) + 2-stufiger Confirm via AlertDialog.
- `SeoJobHealthCard` ersetzt statisches Hint-Banner durch interaktives Banner mit "Rollback…"/"Aktivieren"-Button.
- onSuccess invalidiert `seo-feature-flags` + `seo-job-health` Queries.

## Sicherheit
- RPC SECURITY DEFINER, REVOKE FROM PUBLIC/anon/authenticated, GRANT EXECUTE TO authenticated, has_role-Gate als 1st Statement.
- Reason wird nicht escaped in DB-Notes — Postgres-Parameter binding macht das sicher; UI-Anzeige als `<em>` ist text-only.

## Files
- `supabase/migrations/<ts>_seo_rollback_toggle_rpcs.sql`
- `src/components/admin/heal/cards/SeoRollbackDialog.tsx`
- `src/components/admin/heal/cards/SeoJobHealthCard.tsx`
