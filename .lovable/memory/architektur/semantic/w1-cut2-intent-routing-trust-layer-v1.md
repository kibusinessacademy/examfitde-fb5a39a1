---
name: W1 Cut 2 Intent Routing + Trust Layer v1
description: Deterministic IntentKind SSOT (15 kinds + unknown) + regex-first router + CTA mapping + TrustSignal SSOT (10 kinds, 5 presets) + AdaptiveCta + TrustLayerStrip. Examiner-isolated. Wired into EntityPillarPage.
type: feature
---

## Scope
W1 Cut 2 — Intent Routing + Trust Layer. Pure frontend SSOT, no DB
migration, no AI calls. Sets routing/CTA/trust foundation for Cuts 3+.

## SSOT
- `src/lib/intent/types.ts` — `INTENT_KINDS` (16 incl. unknown), `URGENCY_LEVELS` (4), `EMOTIONAL_STATES` (8), `RECOMMENDED_SURFACES` (8).
- `src/lib/intent/router.ts` — `resolveIntent(signals)` deterministic, regex-first, readiness-fallback. NO AI.
- `src/lib/intent/cta-map.ts` — `ctaFor(intent)` SSOT — every IntentKind has primary+optional secondary+hint.
- `src/lib/trust/signals.ts` — 10 TrustSignalKinds + 5 presets (landing/product/tutor/simulation/oral).
- `src/components/intent/AdaptiveCta.tsx` — single CTA component for surfaces.
- `src/components/trust/TrustLayerStrip.tsx` — wiederverwendbar, data-trust-preset/data-trust-signal Attrs.

## Hard Rules
- Intent layer is examiner-isolated — never recomputes readiness/confidence/verdict.
- Router is deterministic (same input ⇒ same output) — Vitest golden test prüft.
- CTA copy NUR via `ctaFor()` — keine inline-CTAs in neuen Surfaces.
- Trust copy NUR via `trustSignal(kind)` / Presets — keine inline-Trust-Copy.
- Lovable-AI Fallback bewusst NICHT implementiert (Cut 3+).

## Wiring (Cut 2)
- `src/pages/wissen/EntityPillarPage.tsx`: TrustLayerStrip preset="product" unter ReadinessSignalBlock.

## Tests
- `src/__tests__/intent-router.golden.test.ts` — 7 Tests: path match, rule order, urgency escalation, readiness fallback, unknown safe-default, determinism, every IntentKind has CTA.

## Next (Cut 3)
- Wire AdaptiveCta into Hero/Landing surfaces (per-page intent + behaviour signals).
- Trust-Preset `tutor` in AI-Tutor-UI, `simulation` in Exam-Simulation-UI.
- Optional Lovable-AI fallback im Router (low-confidence path) — opt-in pro Surface.
- `intent_routing_events` Producer + DB-View für Analytics.
