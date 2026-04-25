---
name: Hardish Handler + Heal-Strategy Toggles v1
description: Setting-gated package_repair_hardish_balance Edge-Function plus admin_settings für Strategy-Toggles, RPCs für Audit-Drilldown, Cluster-Erklärung, Integrity-Refresh-mit-Diff
type: feature
---

## Problem
- `admin_resolve_repair_strategy_for_package` lieferte für Hardish-Lücken stets `manual_review_required` mit Reason `hardish_too_low_..._handler_not_implemented` → stale Audit-Cluster.
- Healcheck warnte fälschlich `HEAL_CLUSTER_NOT_IN_VIEW`, obwohl Cluster existierten — UI bot keine Erklärung.
- Kein Admin-Pfad, einen frischen Integrity-Check für ein Paket gezielt anzustoßen und das Reasons-Diff zu sehen.

## Lösung
1. **`admin_settings` Tabelle** mit RLS (admin-only) und `admin_set_setting(key, value)` RPC.
   Default-Toggles: `heal_strategy_hardish_balance|too_few_approved|isolated_knowledge` (alle `enabled=false`).
2. **Resolver-Branch**: Bei `hardish_too_low` und aktivem Toggle → `package_repair_hardish_balance` Job statt `manual_review_required`.
3. **Edge-Function** `package-repair-hardish-balance`: Promotion-First (`tier1_passed → approved` für hard+apply/analyze/evaluate/create), kein LLM-Call. Fail-Reason `HARDISH_NO_PROMOTABLE_QUESTIONS_..._require_llm_fill` wenn keine Kandidaten existieren — ersetzt stale `handler_not_implemented`.
4. **RPCs**:
   - `admin_get_audit_reason_drilldown(p_package_id, p_reason_substr)` → integrity_check_history + step_done_meta_audit + admin_notifications.
   - `admin_healcheck_cluster_explanation()` → known_via=`produced_data|view_defn|unknown` pro Cluster.
   - `admin_refresh_integrity_check_with_diff(p_package_id)` enqueued frischen `package_run_integrity_check` (nur wenn nicht aktiv).
   - `admin_get_integrity_diff(p_package_id, prev_history_id?)` → reasons_added/removed + score_delta.
5. **UI**:
   - StepDoneAuditPage: Drilldown-Button pro Row → AuditReasonDrilldown Dialog.
   - HealCockpit: HealClusterExplanationPanel + Link auf `/admin/ops/heal-settings`.
   - PackageDrawer: RefreshIntegrityWithDiffButton.
   - HealStrategySettingsPage: Switch pro Strategy-Toggle, audited via admin_notifications.

## Sicherheits-Default
Alle neuen Toggles sind per Default **aus**. Live-Verhalten unverändert, bis Admin explizit aktiviert.

## Job-Type Registrierung
`package_repair_hardish_balance` registriert in:
- `_shared/enqueue.ts` REPAIR_JOB_TYPES
- `_shared/runner-lanes.ts` RECOVERY_JOB_TYPES + concurrency=2 + runtime=8s
- `_shared/job-map.ts` JOB_DISPATCH (default pool, edge `package-repair-hardish-balance`)
