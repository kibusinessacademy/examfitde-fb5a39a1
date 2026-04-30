---
name: Funnel & Platform Integrity Guard v1
description: v_funnel_integrity_check (3 Sub-Ampeln tracking/continuity/attribution, 7d) + v_platform_integrity Master-View (pricing+funnel+seo). FunnelIntegrityCard + PlatformIntegrityCard im Growth-Cockpit Dashboard. CI funnel-integrity-guard.yml stündlich. Baseline 2026-04-30: red — 0% package_id-Coverage in strict events (Tracking-Leck, trackFunnel RPC umgeht edge-fn-Validierung).
type: feature
---

# Funnel & Platform Integrity Guard v1 — 2026-04-30

## Zweck
Tiered Drift-Detektor für Conversion-Tracking + Master-Health-View über alle Domain-Guards.

## Komponenten

### `v_funnel_integrity_check` (security_invoker, authenticated only)
Fenster: letzte 7 Tage, Events `lead_magnet_view`, `quiz_started`, `quiz_completed`, `lead_capture_submitted`, `checkout_complete`.

3 Sub-Ampeln:
- **tracking_completeness**: % strict events (quiz/lead/checkout) mit `metadata.package_id`. ≥95% green, ≥50% yellow, sonst red.
- **funnel_continuity**: alle 4 Pflicht-Events vorhanden? checkout_complete da? quiz_completed→lead_capture ≥30%?
- **attribution_quality**: source_coverage ≥90% + persona_coverage ≥50% = green.

Master-Status = schlechteste Sub-Ampel. `events_total_7d=0` → red (Tracking-Notfall).

### `v_platform_integrity` (security_invoker)
Aggregiert `v_pricing_integrity_check` + `v_funnel_integrity_check` + SEO-Publish (course_packages mit fehlender published seo_content_pages). Schlechteste Domain gewinnt.

### UI
- `PlatformIntegrityCard` + `FunnelIntegrityCard` im `/admin/growth` Dashboard-Tab (top).
- 5-Min Auto-Refetch.

### CI
- `.github/workflows/funnel-integrity-guard.yml` — stündlich (`19 * * * *`), bei Migration-Push, bei Frontend-Tracking-Änderungen.
- `scripts/funnel-integrity-check.mjs` — RED=exit 1, YELLOW=exit 0+warn, GREEN=exit 0.

## Baseline (2026-04-30)
```
events_7d=26  tracking=red(0%)  continuity=green  attribution=yellow
strict_events=9, davon 0 mit package_id
```

## Bekannte Drift-Ursache (Folge-Loop)
Zwei parallele Tracking-Pfade:
- `trackFunnel` (RPC `track_conversion_event_v2`) — von `conversionTracking.ts`, **kein** package_id-Pflichtfeld.
- `useTrackGrowthEvent` (edge fn `track-funnel-event`) — fordert package_id für strict events (400 sonst).

→ Konsolidierung in separater Loop: `track_conversion_event_v2` um `p_package_id` erweitern + Pflicht-Validierung serverseitig spiegeln.

## Master-Status Snapshot
`pricing=red(1 ohne Preis) · funnel=red · seo=red(3 ohne Page) → platform=red`.
