---
name: Strict Event package_id SSOT v1
description: Tracking-Leak-Closure für quiz_started/quiz_completed/lead_capture_submitted/checkout_complete. quizBundleMap erweitert um packageId+persona. LeadQuizRunner reicht package_id/persona/source_page in alle 4 emitFunnelEvent durch. Stripe-Webhook konsolidiert auf emitCheckoutCompleteEvent helper (kanonischer event_type 'checkout_complete', resolved package_id+persona aus product_id→curriculum_id→published course_package). Audit-Simulator markiert Events als smoke_test=true. Guard scripts/guards/strict-event-package-id-guard.mjs + CI workflow strict-event-package-id-guard.yml verhindert Re-Drift.
type: feature
---

# Strict Event package_id SSOT v1 — 2026-04-30

## Geschlossene Lecks

1. **LeadQuizRunner.tsx**: 4 strict events (LEAD_MAGNET_VIEW, QUIZ_STARTED, QUIZ_COMPLETED, LEAD_CAPTURE_SUBMITTED) hatten kein `package_id`/`persona`/`source_page`. Jetzt alle aus `quizBundleMap` durchgereicht.
2. **stripe-webhook/index.ts**: 4 Insert-Stellen schrieben `event_type='checkout_completed'` (mit "d") direkt in `conversion_events` und umgingen die Validierung. Alle auf neuen Helper `emitCheckoutCompleteEvent` umgestellt — schreibt kanonisch `'checkout_complete'` und resolved `package_id` + `persona` aus `product_id → curriculum_id → published course_packages`.
3. **admin-revenue-funnel-audit/index.ts**: Audit-Simulator-Event jetzt mit `smoke_test=true` markiert → Guard-View ignoriert es.

## Mapping-Source

`src/lib/quizBundleMap.ts`:
- `bilanzbuchhalter-pruefungsreife` → packageId `eef4bbe6-…`, persona `fachwirt`
- `fiae-pruefungsreife` → packageId `24c3793c-…`, persona `azubi`
- `aevo-pruefungsreife` + `wirtschaftsfachwirt-pruefungsreife` → packageId `null` (kein published course_package vorhanden — Funnel-Guard zählt als unmatched, das ist korrekt).

## Helper

```ts
// supabase/functions/stripe-webhook/index.ts
emitCheckoutCompleteEvent(adminClient, {
  user_id, contact_id?, curriculum_id?, product_id?,
  session_id, flow, extra?
})
```
- Resolved package_id intern (product_id → curriculum_id → published package).
- Setzt metadata.package_id / metadata.persona / metadata.source_page first-class.

## Regression-Guard

- `scripts/guards/strict-event-package-id-guard.mjs` (1500+ Files in <1s).
- CI: `.github/workflows/strict-event-package-id-guard.yml` (push + PR auf src/ + supabase/functions/).
- Compliant-Helper-Allowlist: `emitCheckoutCompleteEvent(`.
- Smoke-/Simulation-Events exempt via `smoke_test:true` oder `simulation:true` im Block.

## Beobachtung

24h nach Stripe-Webhook-Deploy sollte `tracking_completeness_pct` für `checkout_complete` auf 100% steigen (server-resolved). Quiz-Events steigen sobald echte User über `bilanzbuchhalter`/`fiae`-Quizze laufen.
