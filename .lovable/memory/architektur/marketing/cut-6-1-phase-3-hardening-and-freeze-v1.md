---
name: Cut 6.1 Phase 3 Hardening & Freeze
description: HR-Demo Vitest-Smoke + axe-A11y + Audit-Contract-Shape-Tests + Full-Suite-Gate, plus zwei Drift-Bugfixes (quiz_completed package_id stale closure, /demo/hr nicht in route-registry, record_activation_signal ohne Audit-Mirror).
type: feature
---

# Cut 6.1 Phase 3 — Hardening & Freeze (2026-05-26)

Abschluss von Cut 6.1 (HR Activation Demo). Keine neue Feature-Logik —
nur Absicherung, drei strukturelle Fixes, dann Freeze.

## Was geliefert

### Tests (3 neue Files, 7 Tests, alle grün)
- `src/pages/demo/__tests__/DemoHrPage.test.tsx` — Smoke:
  Initial-Render + lead_magnet_view-Tracking, SSE-Parsing
  (meta-Frame → Match-Card, delta-Frames → Plan-Text),
  quiz_started + quiz_completed mit korrekter persona+package_id,
  429-Rate-Limit-Pfad zeigt Alert.
- `src/test/a11y/demo-hr.a11y.test.tsx` — axe-Regression:
  Idle-State (Form + Radios) und Done-State (Match-Card + Plan + CTAs).
  Skipped wie sibling-Demos: color-contrast + region.
- `src/test/contracts/demo-hr-audit-contract.test.ts` —
  Statische Drift-Guard:
  Edge-Function `hr-demo-personalize` darf NUR die 3 registrierten
  `signal_types` verwenden (invoked / completed / rate_limited),
  DemoHrPage darf NUR die 4 erlaubten Funnel-Events feuern
  (lead_magnet_view, quiz_started, quiz_completed, hero_cta_click).

### Drei strukturelle Fixes (durch Tests entdeckt)

1. **package_id stale closure in `quiz_completed`** (DemoHrPage.tsx):
   `meta?.package_id` referenzierte den State-Closure-Wert beim
   `run()`-Aufruf, der vor dem ersten setMeta() noch null war →
   `quiz_completed` wurde immer mit `package_id=null` gefeuert
   (Strict-Event-SSOT-Drift). Fix: lokale `metaLocal`-Variable in
   `run()`, parallel zu setMeta gesetzt. Test verifiziert pkg-UUID.

2. **`/demo/hr` nicht in `src/lib/route-registry.ts`** —
   `cta-routes-no-bundle.test.tsx` schlug Alarm
   (Helmet canonical `/demo/hr` ohne Registry-Eintrag). Eintrag
   hinzugefügt; Route war in AppRoutes bereits registriert.

3. **`record_activation_signal` ohne Audit-Mirror** (Migration):
   3 registrierte Audit-Contracts (`demo_personalize_invoked|
   completed|rate_limited`) wurden nie geschrieben. RPC erweitert
   um `fn_emit_audit`-Call mit Signal-Type→Contract-Mapping
   (request→invoked für Rückwärtskompat). Audit-Emission BEGIN/
   EXCEPTION-isoliert (blockiert Signal-Write nie). Edge-Function
   nutzt jetzt `demo_personalize_invoked` direkt.

## Full-Suite-Gate

- **1419 passed / 6 skipped / 0 echte Fails** (1426 total)
- 1 flaky Timeout: `s3-ui-integration.test.tsx >
  GateHistoryDashboardPage` (Cut-5.1-Pattern, in Isolation 581ms grün).
  Klassifikation: **flaky / unrelated**, nicht regression.

## Freeze-Status

Cut 6.1 ist **eingefroren**. Suite-Status grün (modulo bekannter
S3-Flaky). Keine neue Feature-Logik bis Cut 6.2.

## Was NICHT in Phase 3

- DB-Live-Integration-Tests für audit-mirror (statische Shape-Tests reichen als Drift-Gate)
- Edge-Function Deno-Tests (würden echten AI-Gateway brauchen)
- Persona-Erweiterung (Cut 6.2)
- One-Click-Demos (Cut 6.2)
