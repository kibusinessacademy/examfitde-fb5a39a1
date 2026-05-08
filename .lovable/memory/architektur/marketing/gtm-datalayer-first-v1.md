---
name: GTM DataLayer-First Architektur v1
description: GTM-K39CL625 als Event-Orchestrator. Frontend pusht NUR DataLayer; Pixel/GA4/Ads/Meta/Matomo werden im GTM-Container verkabelt. trackFunnel ist Single-Call, Fan-out via gtmEmitFunnel zu window.dataLayer mit kanonischen Top-Level-Feldern (package_id, persona, curriculum_id, source_page, page_path).
type: feature
---

## Architektur
- **SSOT bleibt Supabase**: `track_conversion_event_v2` RPC schreibt `conversion_events` (Revenue/Funnel-Truth).
- **GTM ist Orchestrator, nicht SSOT**: Container `GTM-K39CL625` verteilt DataLayer-Events an GA4 / Google Ads / Meta / LinkedIn / Matomo.
- **Frontend-Regel**: Keine Pixel/GA4/Ads-Tags hardcoded in React. Nur `window.dataLayer.push(...)` via `src/lib/gtm.ts`.

## Implementierung
- `src/lib/gtm.ts`:
  - `gtmPush(payload)` — low-level, never throws.
  - `gtmEmitFunnel(funnelEventType, opts)` — mappt FunnelEventType → kanonisches GTM-Event (`FUNNEL_TO_GTM_EVENT`) + Top-Level `package_id/persona/curriculum_id/source_page/page_path`.
  - Standalone-Helpers: `trackPersonaSelected`, `trackAiTutorUsed`, `trackOralExamStarted`, `trackMasteryReached`, `trackExamSimulationStarted`, `trackExamStarted`, `trackExamCompleted`, `trackH5P`.
- `src/lib/conversionTracking.ts` ruft `gtmEmitFunnel` direkt nach RPC — ein Call, beide Senken. DataLayer-Fehler dürfen RPC nie blockieren.

## Standard-Event-Katalog (GTM)
| GTM-Event              | Quelle                   |
|------------------------|--------------------------|
| `landing_view`         | trackFunnel(page_view)   |
| `cta_clicked`          | trackFunnel(hero_cta_click / cta_clicked / quiz_cta_clicked / bundle_cta_clicked) |
| `cta_visible`          | trackFunnel(cta_visible) |
| `quiz_started`         | trackFunnel(quiz_started) |
| `quiz_completed`       | trackFunnel(quiz_completed) |
| `lead_magnet_viewed`   | trackFunnel(lead_magnet_view) |
| `lead_magnet_downloaded` | trackFunnel(lead_magnet_download) |
| `lead_captured`        | trackFunnel(lead_capture_submitted) |
| `lernplan_viewed`      | trackFunnel(lernplan_viewed) |
| `pricing_view`         | trackFunnel(pricing_view) |
| `add_to_cart`          | trackFunnel(add_to_cart) |
| `checkout_started`     | trackFunnel(checkout_start) |
| `purchase_completed`   | trackFunnel(checkout_complete) |
| `doi_confirmed`        | trackFunnel(doi_confirmed) |
| `pruefung_begonnen`    | trackExamStarted (gtm.ts) |
| `pruefung_abgeschlossen` | trackExamCompleted (gtm.ts) |
| `bestanden` / `nicht_bestanden` | trackExamCompleted, abgeleitet |
| `exam_simulation_started` | trackExamSimulationStarted |
| `oral_exam_started`    | trackOralExamStarted |
| `ai_tutor_used`        | trackAiTutorUsed |
| `mastery_reached`      | trackMasteryReached |
| `persona_selected`     | trackPersonaSelected |
| `h5p_started/answered/completed/progress` | trackH5P |
| `spa_pageview`         | useGtmPageView |
| `consent_update`       | setConsent (CookieConsentBanner) |

## Pflichtfelder im DataLayer
Jeder paketgebundene Push enthält Top-Level: `package_id`, `persona`, `curriculum_id`, `source_page`, `page_path` (null wenn unbekannt). GTM-Trigger können darauf direkt filtern, ohne in `metadata` zu greifen.

## Consent Mode v2
Default `denied` (DE/AT/CH/EU) wird in `index.html` VOR GTM-Loader gesetzt. `setConsent` in `src/lib/gtm.ts` ruft `gtag('consent','update',...)` und persistiert in `localStorage('ef_consent_v1')`. Bei Folgebesuchen wird die Entscheidung in `index.html` re-applied bevor GTM startet.

## Was NICHT ins GTM gehört
- Business-Logik (Lern-/Revenue-Truth bleibt Supabase).
- Entscheidungen über Entitlements / Access.
- Pricing-Berechnung.

## Debug
`?gtm_debug=1` an URL oder `localStorage.setItem('ef_gtm_debug','1')` aktiviert `console.log('[GTM]', payload)`. Runbook: `docs/runbooks/ga4-gtm-debug.md`.
