---
name: healer-regression-guard-and-recovery-tooling-v1
description: BEFORE-Trigger blockiert package_steps→done ohne finished_at + meta.ok='true'. Admin-RPCs für Single-Job-Recovery, Retry-Loop-Detection und Integrity-Report-Diff.
type: feature
---

## Komponenten

1. **`fn_guard_healer_done_invariants`** (BEFORE UPDATE auf `package_steps`)
   - Blockiert Übergang `→ done` wenn `finished_at IS NULL` oder `meta->>'ok' <> 'true'`
   - Bypass nur über `meta.emergency_bypass = 'true'`
   - Loggt nach `step_done_meta_audit` mit `blocked=true` + `block_reason`
   - RAISE EXCEPTION `HEALER_REGRESSION_BLOCKED: …`

2. **`admin_recover_single_job(uuid)`** RPC
   - Re-trigger artifact-aware lock release + step sync für genau einen Job
   - Returns JSON-Diff `{ changes: [{field, before, after}], no_op, ... }`
   - UI: `src/components/admin/heal/SingleJobRecoveryButton.tsx`

3. **`v_retry_loop_candidates`** + **`detect_retry_loops()`** RPC
   - View: Jobs mit ≥4 attempts in letzter Stunde + Guard-Klassifikation
   - RPC: schreibt `admin_notifications` (severity=warning, entity_type=job_retry_loop)
   - De-dupe per entity_id (1h-Fenster)
   - UI: `src/pages/admin/v2/RetryLoopDetectorPage.tsx` → `/admin/ops/retry-loops`

4. **`admin_integrity_report_diff(uuid, int, int)`** RPC
   - Vergleicht 2 `integrity_check_history`-Zeilen für ein Paket
   - Default: zwei neueste; sonst per Versions-Index (1=oldest)
   - Returns `{ a, b, diff: {score_delta, reasons_added, reasons_removed, passed_changed}, explanation }`
   - UI: `src/pages/admin/v2/IntegrityReportDiffPage.tsx` → `/admin/ops/integrity-diff[/:packageId]`

## Routes
- `/admin/ops/step-done-audit` – Audit-Log (existing, jetzt auch blocked-Updates sichtbar)
- `/admin/ops/retry-loops` – Loop-Detector
- `/admin/ops/integrity-diff[/:packageId]` – Version-Diff
