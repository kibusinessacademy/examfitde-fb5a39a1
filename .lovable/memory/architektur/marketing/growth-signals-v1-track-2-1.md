---
name: Growth Signals SSOT v1 Track 2.1
description: v_package_growth_signals_v1 mit 3 strikt getrennten Klassen (visible/instrumented/amplifiable). Diagnose-only. KEIN Hard-Gate auf customer_safe.
type: feature
---

# Track 2.1 — Growth-Signals 3-Klassen-SSOT

## SSOT
`public.v_package_growth_signals_v1` (service_role only, nur is_published=true) trennt Growth in **3 unabhängige Klassen**:

| Klasse | Sub-Signale | ready-Regel |
|--------|-------------|-------------|
| **growth_visible** | seo_present, canonical_ok, no_dead_end | alle 3 true |
| **growth_instrumented** | tracking_pricing_view, tracking_checkout_started, conversion_events_present | alle 3 true |
| **growth_amplifiable** | blog, og_image, indexnow, internal_links, campaign_assets, distribution_targets | ≥5 von 6 |

Compound: `growth_ready_v2 = ALL 3 classes ready`. Ersetzt das Sprint-3-`growth_ready` (das nur Amplifiable misst).

## RPCs (has_role-Gate, SECURITY DEFINER)
- `admin_get_growth_signals_summary()` — total + 3 class status counts + per-Signal counts
- `admin_get_growth_signals_packages(_visible_status,_instrumented_status,_amplifiable_status,_track,_limit)` — gefilterte Paketliste

## UI
- `GrowthSignalsCard` im HealCockpit (Sektion 3, nach OperationalStateCard)
- 3 ClassRows mit Sub-Signal-Verteilung + Drilldown nach Klasse × Status

## Baseline 2026-05-16 (190 published)
- visible:      0 ready / **190 partial** / 0 missing → systemisches Single-Signal-Defizit (canonical drift universell)
- instrumented: 0 ready / 51 partial / **139 missing** → echtes Tracking-Gap (139 ohne conversion_events)
- amplifiable: **69 ready** / 121 partial / 0 missing → gesündeste Klasse
- growth_ready_v2: **0/190**

## Anti-Phantom-Prinzipien (Track 2)
- KEINE impliziten Regeln, keine "SEO pending = unsellable", keine Hard-Gates
- 3 Klassen NICHT vermischt → klar erkennbar was nur observability, was echtes SEO, was nur Marketing-Automation fehlt
- Sprint 2.1 ist **diagnose-only** — Auto-Repair erst nach 2.2 (growth_ready v2) und 2.3 (echte Missing-Klassen)
- Pitfall: v_seo_dead_end_drift.package_id ist `text`, alle anderen `uuid` → NULLIF + ::uuid Cast im CTE
- Audit: action_type=`growth_signals_v1_init`
