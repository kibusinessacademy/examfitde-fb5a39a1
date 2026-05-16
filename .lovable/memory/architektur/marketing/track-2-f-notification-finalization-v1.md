---
name: Track 2.F Notification Finalization
description: F1 Contract+Guard, F2 E2E-Smoke, F3 Global Kill-Switch (safety-clamped), F4 Drilldown-RPC, Heal-Cockpit Card
type: feature
---

# Track 2.F — Notification Finalization (v1)

## Ziel
Track 2 produktreif schließen: erklärbar, pausierbar, auditierbar — EU-AI-Act/DSGVO-konform.

## Bausteine
- **F1 Contract** `docs/contracts/notification-policy-contract.md` (9 Invarianten) + CI-Guard `scripts/guards/notification-policy-contract-guard.mjs` + Workflow `notification-policy-contract-guard.yml`.
- **F2 E2E-Smoke** `admin_smoke_notification_e2e()` — 6 Stages: insert_synthetic_job → enforce_policy → dispatch_decision_recorded → drilldown_explainable → kill_switch_does_not_block_critical_resolver → cleanup_synthetic_job. Setzt Kill-Switch toggle+restore und cleant Job.
- **F3 Global Kill-Switch** Single-Row `notification_kill_switch` (paused, reason, actor_uid, updated_at). RPCs `admin_get_notification_kill_switch` + `admin_set_notification_kill_switch(paused, reason)` mit Reason-Pflicht (≥4 Zeichen) und Audit in `auto_heal_log` (`action_type='notification_kill_switch_set'`). Enforcement-Hook in `fn_enforce_notification_policy`: paused=true ⇒ suppress + reason `global_kill_switch` für ALLE Jobs außer `safety_class='critical'` (Defense-in-Depth: critical bleibt allowed). Decision-Row strategy='kill_switch' für Audit-Transparenz.
- **F4 Drilldown** `admin_explain_notification_decision(job_id)` liefert Bundle: job + registry-Row + active policy + dispatch_decisions (DESC) + events (DESC) + kill_switch state. Powers UI "Warum?".

## UI
`NotificationFinalizationCard` im HealCockpit Diagnostics-Tab (nach `PolicyImpactFunnelCard`):
1. Kill-Switch (Status-Badge, Reason-Textarea Pflicht, Pause/Resume mit destruktiv-Variante)
2. E2E-Smoke (Run + PASS/FAIL pro Stage)
3. Drilldown (job_id Input → JSON-Bundle)

## Was bewusst NICHT gebaut wurde
- F5 hard daily/weekly per-learner caps (eigene Tabelle) — Track 2.G
- F6 DSAR-Export Learner-Decisions (`learner_export_notification_decisions`) — Track 2.G
- F7 Suppression-Recovery-Loop-Counter (`policy_retry_count`) — Track 2.G

→ Nach 2.F erst Monetization Track M1 (Paywall/Checkout-Recovery Intents).

## Files
- supabase/migrations/<2026-05-16-track-2-f-notification-finalization>.sql
- src/components/admin/heal/cards/NotificationFinalizationCard.tsx
- docs/contracts/notification-policy-contract.md
- scripts/guards/notification-policy-contract-guard.mjs
- .github/workflows/notification-policy-contract-guard.yml
