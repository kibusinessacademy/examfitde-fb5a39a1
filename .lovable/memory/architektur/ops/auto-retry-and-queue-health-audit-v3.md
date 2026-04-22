---
name: Auto-Retry & Queue Health Audit v3 (Production-Final)
description: Wave-3 Final-Härtung — per-row exception isolation, ASC anti-starvation, safe obsolete check, decision trace storage, force_pending guards + unsafe override, mark_terminal admin marker, bulk action, throttling, job timeline, audit trigger on status+last_error+error.
type: feature
---

## Wave-3 Änderungen vs. v2

1. **Per-Row Exception Isolation**: Jeder Job in `fn_auto_retry_failed_jobs` läuft im eigenen `BEGIN/EXCEPTION`-Block. Ein einzelner kaputter Row stoppt nicht mehr den ganzen Batch.
2. **Anti-Starvation final**: `ORDER BY COALESCE(run_after, updated_at, created_at) ASC` — älteste Failed-Jobs zuerst, deterministisch.
3. **Safe Obsolete Check**: Kein Cast von `last_error` zu `timestamptz`. Vergleich rein über `updated_at`-Spalte.
4. **Decision-Trace Storage** (`job_retry_decisions`): jede Auto-Retry-Entscheidung wird mit Checks (has_package, pkg_status_ok, no_duplicate, no_newer_success, not_admin_terminal, attempts_le_max), cooldown und reason persistiert. Per-job RPC `admin_get_job_timeline` aggregiert Transitions + Decisions + Admin-Actions.
5. **`admin_job_action` mit SSOT-Guards**: `force_pending` prüft jetzt dieselben Guards wie Auto-Retry (Package-Bound, pkg_status, Duplikate, admin_terminal). Override per `_force=true` (Unsafe) — explizit als Schalter im UI markiert.
6. **`mark_terminal` mit explizitem Marker**: Setzt `meta.admin_terminal=true` zusätzlich zu `attempts>=max_attempts`. Auto-Retry skippt diese Jobs absolut (Decision: `skip_admin_terminal`).
7. **Audit-Trigger erweitert**: `AFTER INSERT OR UPDATE OF status, last_error, error` mit `change_kind` (status / status+error / error_only / insert) und `meta_diff`-Spalte für Inline-Diffs.
8. **Bulk-Aktion**: `admin_job_action_bulk(_job_ids[], _action, _reason, _force)` mit Cap 50 und stricter Rate-Limit (10/min).
9. **Rate-Limiting**: `admin_action_throttle` Tabelle + `admin_check_action_throttle()` — 30/min für Single-Actions, 10/min für Bulk pro Admin pro Action-Type. Throttle-Events landen in `admin_actions`.
10. **Job Timeline Page** (`/admin/jobs/timeline`): Filter über `job_id` oder `package_id`, vereint Transitions/Decisions/Admin-Actions chronologisch mit Check-Badges und Diff-Payload.
11. **Inline-Diff im Audit-Log**: Pro Transition-Row aufklappbar mit altem/neuem `last_error`, `error` und `meta` JSON.
12. **Decision-Trace-Panel**: Pro Job-ID alle letzten 5 Retry-Decisions mit Pass/Fail-Badges für jeden Guard.
13. **Bulk-Select im Audit-Log**: Checkboxen pro Row, Toolbar zeigt Anzahl ausgewählter Jobs und Bulk-Aktionen.

## Aufrufer-Konventionen

ALLE Pfade die job_queue-Status ändern MÜSSEN setzen:
```sql
PERFORM set_config('app.transition_source', '<source>', true);
```
Bekannte Quellen: `auto_retry_policy`, `health_check`, `admin_ui:<action>:<uid>`, `runner:<lane>`, `watchdog:<reason>`, `trigger_unknown` (Fallback).

## Decision-Klassen
- `retry` — alle Guards passed, Job neu eingeplant
- `skip_terminal` — Hard-Fail Klasse (HARD_FAIL_*, REQUEUE_LOOP_KILLED)
- `skip_admin_terminal` — meta.admin_terminal=true
- `skip_duplicate` — aktiver Duplikat in fn_job_active_statuses() existiert
- `skip_obsolete` — neuerer completed Job für gleiche (package_id, job_type)
- `skip_no_package` — package-bound Job ohne package_id
- `skip_pkg_status` — Package-Status nicht in [building, queued, blocked, pending, draft]
- `skip_max_retry` — attempts >= class-spezifischer Cap
- `skip_row_error` — interne Exception, isolated, batch läuft weiter
