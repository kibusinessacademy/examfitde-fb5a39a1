---
name: Heal-Härtung Phase 1 Backend
description: Snapshots, Verifikationsreports, Conflict-Check, Verify-Gate, Rollback, Limit-Guard und Root-Cause-Analyse für gehärteten manuellen Bypass-Heal
type: feature
---

Phase 1 der Heal-Härtung. Alle manuellen Bypass-Heals laufen jetzt über transaktional gehärtete RPCs mit Snapshot, Conflict-Check, Verify-Gate und persistierten Reports.

## Neue Tabellen

- **`heal_snapshots`** — Vor-Zustand (steps + jobs + package fields) vor jedem Hard-Heal. Indexiert nach `package_id`. Admin-only RLS.
- **`heal_verification_reports`** — Persistente Reports pro Heal-Run mit before/after, steps_reset, jobs_cancelled, recovery_jobs_planned, conflicts, verify_passed, verify_findings, duration_ms. Admin-only RLS.

## Neue RPCs (alle SECURITY DEFINER, search_path=public, GRANT to authenticated + service_role)

| RPC | Zweck |
|---|---|
| `analyze_package_root_cause(uuid)` | Priorisierte Trigger-Liste (MISSING_BLUEPRINTS, MISSING_EXAM_QUESTIONS, EXHAUSTION_LIMIT, HARD_FAIL_BREAKER, QUEUED_WITHOUT_JOB, STALE_LOCK, BLOCKED_REASON_SET) mit Score 0–100 + empfohlener HealAction (mode + reset_from_step + enqueue_plan + rationale) |
| `admin_check_heal_conflicts(uuid, text[])` | Findet aktive pending/processing Jobs und markiert solche, die mit geplanten job_types kollidieren würden. Liefert recommendation: proceed/cancel_active_jobs_recommended/cancel_conflicts_first |
| `admin_step_reset_detailed(uuid, text[], text, text, bool, bool)` | Reset einzelner Schritte mit zuverlässig gesetzter Meta: `allow_regression`, `allow_regression_by`, `allow_regression_at`, `admin_bypass_reset_at`, `admin_bypass_reason`. Optional Clear von exhausted/repair_exhausted/hard_fail_count. Schreibt system_heal_log |
| `admin_manual_heal_package_v2(uuid, text[], text, bool, text[], text)` | **Vollständiger Bypass-Heal als Transaktion:** Lock+Snapshot → Conflict-Check → Cancel kollidierende Jobs → Detailed Step Reset → Clear blocked_reason + status='building' → **Verify-Gate** (status, blocked_reason, alle Reset-Steps queued) → Persist Report. Bei Verify-Fail: `RAISE EXCEPTION` ⇒ Postgres rollt komplette Transaktion zurück |
| `admin_rollback_heal(uuid, text, bool)` | Stellt Schritt-Status, Schritt-Meta und Package-Felder aus Snapshot wieder her. Markiert Snapshot als rolled_back. Schreibt system_heal_log |
| `admin_auto_repair_limit_status(uuid, int, int)` | Limit-Guard mit konfigurierbaren Schwellen (Default warn=70%, critical=90%). Severity-Klassifikation: ok/warn/critical/exhausted. Returns Summary + steps_at_risk sortiert nach Severity |

## Service-Integration

- **`src/lib/admin/heal/healService.ts`** — Hard-Heal-Pfad ruft jetzt `admin_manual_heal_package_v2` (statt nicht-existentem `admin_manual_heal_package`). HealResult enthält neu: `snapshotId`, `reportId`, `verifyPassed`, `jobsCancelled`, `conflicts`. HARD_FAIL_BREAKER-Detection (incl. neuer `HEAL_VERIFY_FAILED` Token via Token-Match auf `EXHAUSTED`/`REPAIR_EXHAUSTED`) bleibt aktiv.
- **`src/lib/admin/heal/healDiagnostics.ts`** — Neue API-Layer mit Wrappern: `analyzePackageRootCause`, `checkHealConflicts`, `getAutoRepairLimitStatus`, `rollbackHeal`, `stepResetDetailed`, `listVerificationReports`, `listHealSnapshots`.

## Verifikationsreport-Felder (heal_verification_reports)

Jeder Bypass-Heal generiert automatisch einen Report mit:
- Status before/after (package_status, blocked_reason)
- steps_reset (Array mit step_key, previous_status, meta_diff, reset_at)
- jobs_cancelled (Anzahl)
- recovery_jobs_planned + recovery_job_types
- conflicts (vollständiger admin_check_heal_conflicts-Snapshot)
- verify_passed + verify_findings
- duration_ms, created_by, snapshot_id

## Rollback-Strategie (umgesetzt: Auto-Verify + manuelles Rollback)

1. **Auto-Verify-Gate:** Innerhalb derselben Transaktion wie der Heal — bei Fail erfolgt automatisches DB-Rollback via RAISE EXCEPTION.
2. **Manuelles Rollback:** Operator kann via `admin_rollback_heal(snapshot_id)` jederzeit den Vor-Zustand wiederherstellen. Snapshot kann nur einmal zurückgerollt werden (rolled_back_at-Idempotenz).

## Offen für Phase 2

- UI-Page mit Live-Queue + Stornier-Action pro Job
- UI für Root-Cause-Anzeige im Heal-Cockpit
- UI-Toast/Banner bei Limit-Guard warn/critical
- UI-Button für manuelles Rollback aus Report-Liste
