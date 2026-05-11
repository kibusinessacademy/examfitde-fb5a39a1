---
name: SEO Job Health Alert Calibration F5
description: admin_get_seo_job_health hat min_sample_1h_for_rate guard (default 5) — failure_rate_pct_1h ist NULL bei kleinen Samples → kein 100%-Spike-Alert mehr durch einzelne historische Fails. seo_sitemap_refresh aus job_type-Filter entfernt (Phase-2 decommissioned). Reasons-Array zeigt LOW_SAMPLE-Hinweis. Contract-Test src/__tests__/seo-job-health-low-sample.contract.test.ts. Migration-Smoke: DO-Block prüft Threshold-Seed + 0 warn rows mit NULL rate.
type: feature
---

## Why
Tooling-Patch: 1 fail bei 1 total = 100% rate → Dauer-warn ohne Aussage. Außerdem zog Health weiter `seo_sitemap_refresh` (in Phase 2 entfernt) und produzierte phantom-rows.

## Schwellen-Schema
Neue Row in `ops_seo_alert_thresholds`:
- `min_sample_1h_for_rate = 5` (severity=warn)

## Severity-Logik (jetzt)
- failure_rate-Warn feuert NUR wenn `total_1h >= min_sample_1h_for_rate` UND `failure_rate_pct_1h >= failure_rate_pct_1h_warn` (default 30).
- Sonst rate=NULL → severity bleibt `ok` (sofern keine andere Bedingung greift).
- Reasons-Array enthält bei suppressed rate: `LOW_SAMPLE total_1h=<n> < <min_sample> (rate suppressed)`.

## Rollback
Migration setzt admin_get_seo_job_health zurück und löscht `min_sample_1h_for_rate` row. Vorherige Definition: siehe pg_get_functiondef vor 2026-05-11 16:21 UTC.

## Defer
- 6h-Window expansion: bewusst nicht — `failed_6h` ist bereits als observability-only column drin, ohne Severity-Hook. Falls nötig später als separate Schwelle `failure_rate_pct_6h_warn` einführbar.
- F2 (seo_internal_link_suggestions SSOT) — eigene Subphase mit Schema-Diagnose.
