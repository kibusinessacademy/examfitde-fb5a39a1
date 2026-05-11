---
name: SEO Alert Threshold Konfiguration v1
description: ops_seo_alert_thresholds (4 Keys empty_result/requeue_loop/http_400/failure_rate_pct) admin-konfigurierbar via admin_get/set_seo_alert_threshold. admin_get_seo_job_health liest Schwellen dynamisch (kein Hardcode mehr). UI SeoThresholdsDialog im SeoJobHealthCard (Sliders-Button), Multi-Edit + Reason-Pflicht ≥5 chars + Audit auto_heal_log.action_type='seo_alert_threshold_update'.
type: feature
---

## SSOT
Tabelle `ops_seo_alert_thresholds` (PK threshold_key). RLS on, REVOKE FROM authenticated, GRANT to service_role only. Lese-/Schreibzugriff ausschließlich via SECURITY DEFINER RPC mit `has_role(_,'admin')`-Gate.

## Seeds
- empty_result_1h_critical = 5 (CRIT)
- requeue_loop_1h_critical = 3 (CRIT)
- http_400_1h_warn = 3 (WARN)
- failure_rate_pct_1h_warn = 30 (WARN)

## RPCs
- `admin_get_seo_alert_thresholds()` — admin-only Liste
- `admin_set_seo_alert_threshold(key, value≥0, reason≥5)` — Update + Audit (`action_type=seo_alert_threshold_update`, target_id=key, metadata.previous/new/severity/reason/actor_uid)
- `admin_get_seo_job_health()` — refactored: WITH thresholds CTE, COALESCE-Fallback auf alte Hardcodes als Defense-in-Depth.

## UI
`SeoThresholdsDialog` (max-w-3xl): Tabelle mit Severity-Badge, Key, Aktuell, Neu (Input number≥0). Dirty-Highlight + Multi-Save in einer Reason. Auf Save: Loop über dirty keys → invalidiert `seo-alert-thresholds` + `heal-cockpit/seo-job-health`. Trigger via Sliders-Button in `SeoJobHealthCard`-Header.

## Files
- `supabase/migrations/<ts>_seo_alert_thresholds.sql`
- `src/components/admin/heal/cards/SeoThresholdsDialog.tsx`
- `src/components/admin/heal/cards/SeoJobHealthCard.tsx` (Header-Button + Dialog-Mount)
