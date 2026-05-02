---
name: Auto-Publish Terminal-Loop Pattern X8
description: job-runner ignorierte {terminal:true} im 422-Body von package-auto-publish → COUNCIL_CONSISTENCY/DIDAKTIK/PRICING-Guards retried 4× → Reaper cancelt → Atomic-Trigger requeuet → Endlos-Loop. Fix in runner + System-Heal.
type: feature
---

## Symptom
Control-Lane DAG-Backlog: 113 pending, 0 completed in 6h, last completed 9h alt. 24h-Stats: 434 cancelled + 53 failed vs 21 completed für `package_auto_publish`.

## Root Cause
Edge function `package-auto-publish` retourniert bei Guard-Failures:
```json
{ "ok": false, "terminal": true, "block_reason": "publish_guard_terminal", "error": "COUNCIL_CONSISTENCY: ..." }
```
mit HTTP 422. Der Runner-Code in `supabase/functions/job-runner/index.ts` (Block ab L1533) prüfte aber nur `permanent:true`, `retry:false`, oder SSOT-Strings — **`terminal:true` wurde ignoriert** → fall-through in standard hard-failure handling → 4× retry → cancel → atomic-trigger requeue.

## Fix
1. **Runner (systemic)**: `isTerminalFlag = parsed.terminal === true` zur 422-terminal-Erkennung hinzugefügt. Job geht direkt auf `cancelled` mit `outcome=terminal`.
2. **Bulk-Heal (X8-Migration)**:
   - Alle pending+failed `package_auto_publish` mit COUNCIL/DIDAKTIK/PRICING/PARKED_PREREQ Errors → cancelled mit `last_error_code='PATTERN_X8_TERMINAL_HEAL'`.
   - `package_steps.auto_publish` für betroffene Pakete → `skipped` mit `meta.skipped_reason` (PATTERN_X8_COUNCIL_NOT_BRIDGED / PRICING_GATE / DIDAKTIK_INCOMPLETE).
   - PARKED_PREREQ Pendings deren council jetzt `done` ist → reset zu fresh attempt (priority=5).

## Cluster (24h vor Heal)
- COUNCIL_CONSISTENCY: 4 failed, viele cancelled
- DIDAKTIK_STEPS_INCOMPLETE: 3 failed
- PRICING_HARD_GATE: 9 failed
- PARKED_PREREQ_NO_OUTPUT: 27 pending

## Operational Notes
- Council-Defer-Bridge fehlt weiterhin: `quality_council` `skipped` setzt nicht `course_packages.council_approved=true`. Long-term Fix wäre, im Defer-Trigger das Flag mit zu setzen, ODER die publish-guard zu relaxen (skipped als equivalent zu done akzeptieren).
- PRICING_GATE-Pakete brauchen Stripe-Price+product_id bevor `auto_publish` re-aktiviert werden kann.
