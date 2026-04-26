---
name: cockpit-queue-overview-and-integrity-transparency-v1
description: admin_ops_queue_overview RPC wiederhergestellt, IntegrityHealthBanner zeigt never_checked vs. with_report vs. stale_version, Auto-Recheck-Cron alle 15min mit Cap 250
type: feature
---

# Cockpit Queue-Overview & Integrity-Transparency v1

## Problem
Im admin/cockpit fehlte die RPC `admin_ops_queue_overview` (4× aufgerufen in `admin-ai-page-analysis`). Gleichzeitig hatten 383 Pakete `integrity_passed=false` mit **leerem `integrity_report`** — das Frontend zeigte deshalb generisch `INTEGRITY_FAILED` als Blocker, ohne Diagnose.

## Lösung

### 1. RPC `admin_ops_queue_overview()`
Liefert: status_counts (24h-Window), top_active_types (top 25), oldest_pending_at + age_seconds, stale_processing_count (>10min ohne Heartbeat), throughput_last_hour {completed, failed}.
SECURITY DEFINER, GRANT EXECUTE TO authenticated.

### 2. RPC `admin_get_integrity_failure_summary()`
Aggregierte Diagnose:
- `never_checked` (integrity_report IS NULL) ← häufigste Ursache
- `with_report` (echte Hard-Fails)
- `stale_version` (älter als current_integrity_report_version_num())
- `top_hard_fail_reasons` aus integrity_report->'hard_fails' / 'hard_fail_reasons'

### 3. View `v_admin_integrity_blocker_details`
security_invoker=on, pro-Paket-Diagnose mit blocker_state ENUM-like:
- `NEVER_CHECKED` | `OK` | `STALE_REPORT` | `INTEGRITY_FAILED`

### 4. Auto-Recheck-Cron
Jobname `auto-integrity-recheck-backfill`, Schedule `*/15 * * * *`, ruft `enqueue_integrity_rechecks(p_cap := 250, p_reason := 'auto_backfill_cron')` auf.

### 5. Frontend: `IntegrityHealthBanner`
Pfad: `src/components/admin/cockpit/IntegrityHealthBanner.tsx`. Eingebunden im `CockpitPage` zwischen Header und Status-Cards. Zeigt: Total-Failed, Never-Checked, With-Report, Stale-Version, Top-5-Reasons + manueller Recheck-Button (Cap 250).

## SSOT-Konformität
- Nutzt bestehende `current_integrity_report_version_num()` für Versions-Drift-Check
- Wiederverwendet `enqueue_integrity_rechecks()` (kein neuer Enqueue-Pfad)
- Passt sich automatisch an Schema-Variationen an: liest sowohl `hard_fails` als auch `hard_fail_reasons` aus integrity_report

## Diagnose-Ergebnis nach Fix
- 349 von 383 failed packages waren NEVER_CHECKED (~91%)
- Nur 34 hatten echte Hard-Fail-Reports
- Initial-Backfill 500-Cap, Cron alle 15min Cap 250 → vollständiger Backfill in ~2-3h
