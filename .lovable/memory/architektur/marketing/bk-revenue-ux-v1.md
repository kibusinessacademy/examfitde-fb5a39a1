---
name: BK-Revenue-UX v1 (BK-Act-2)
description: SSOT für Usage Intelligence, Upgrade-Signal und Locked-Workflow-Preview — Outcome-Selling statt Feature-Selling
type: feature
---

# BK-Revenue-UX v1 — Outcome-Selling Spine

**Status:** live (2026-05-25)

## Ziel
Aus „AI-Workflow ausführen“ wird „berufliche Ergebnisse schneller erreichen“. Keine technischen Limit-Anzeigen, keine statische Pricing-Tabelle — alles wird deterministisch aus echter Nutzung abgeleitet.

## SSOT-RPCs (alle SECURITY DEFINER, learner-scoped via auth.uid())

| RPC | Zweck |
|---|---|
| `learner_get_workflow_usage_summary(p_days)` | Today/Window-Runs, `minutes_saved_window` (via `fn_workflow_time_saved_minutes`), top_workflows, per_day, categories, capacity_hint, business_signal |
| `learner_get_workflow_upgrade_signal()` | Deterministische Empfehlung `stay_free|upgrade_pro|upgrade_business|stay_current` + reasons[] + Trigger-Counts |
| `learner_get_locked_workflow_preview(p_slug)` | Outcome-Copy + Use-Case + estimated_time_saved + Output-Sektionen für gesperrte Workflows |

## Time-Saved Konstanten (`fn_workflow_time_saved_minutes`)
kommunikation=12 · analyse=25 · dokumentation=18 · organisation=8 · fach=15 · lernhilfe=10 (Minuten/Run, IMMUTABLE)

## Upgrade-Trigger (deterministisch)
- **upgrade_business**: `business_locked_30d ≥ 2` ODER (`runs_30d ≥ 40` UND `distinct_workflows_7d ≥ 3`)
- **upgrade_pro** (Free only): `locked_attempts_30d ≥ 1` ODER `runs_7d ≥ 5`
- **stay_current** für business-Tier; **stay_free** sonst

`locked_attempts_30d` zieht aus `auto_heal_log` mit `action_type='workflow_tier_blocked'` und `details->>'user_id'`.

## UI-Module (`src/components/berufs-ki/`)
- `UsageIntelligenceCard` — „Deine Berufs-KI-Woche": Zeitersparnis · Workflows · Distinct · Arbeitslast + Top-3 + Capacity-Hint
- `UpgradeRecommendationBanner` — rendert nur bei `upgrade_pro|upgrade_business`, trackt einmal pro Mount via `fn_emit_audit(workflow_upgrade_signal_shown)`
- `LockedWorkflowPreview` — Modal für Locked-Cards: Outcome · Use-Case · Zeitersparnis · Output-Sektionen · Upgrade-CTA

## Wiring
`BerufsKIWorkbenchPage`: Revenue-Strip (Banner + Usage) über dem Grid (auth-only). Locked-Card-Klick öffnet jetzt `LockedWorkflowPreview` (Modal) statt direkt den Runner.

## Audit-Contract
`workflow_upgrade_signal_shown` (mode `warn`, owner `berufs-ki/revenue-ux`) — Pflichtschlüssel: `recommendation, tier_current, tier_target, reason_count`. Basis für spätere Conversion-Messung (Upgrade-Signal-Impression → Checkout-Conversion).

## Was bewusst NICHT in v1 ist
- Remaining-Capacity-Chip pro Workflow-Karte → später (Cut 2b)
- A/B-Test-Variants für Upgrade-Copy → BK-Act-4
- Stripe-Wiring / Add-On-Credits → BK-Act-3+
- Workflow-Marketplace / Packs → BK-Act-3

## Plattform-Wiederverwendbarkeit
`fn_workflow_time_saved_minutes` + Upgrade-Signal-Pattern wiederverwendbar für ComplianceFit, Voice-Agents, AI-Credits, Usage-Billing.
