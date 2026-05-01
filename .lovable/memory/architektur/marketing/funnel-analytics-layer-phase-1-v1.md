---
name: Funnel-Analytics-Layer Phase 1
description: 3 Views (24h/7d/30d) für Funnel-KPIs pro package_id × persona × source_page, Admin-only via SECURITY DEFINER RPC, FunnelAnalyticsCard im Growth-Dashboard
type: feature
---

# Funnel-Analytics-Layer Phase 1 (SSOT v1)

## Zweck
Pro `package_id × persona_type × source_page` sehen, wo Nutzer im Verkaufs­prozess aussteigen. Quelle ist ausschließlich `conversion_events`, keine neue Tracking-Tabelle.

## Pflicht-Events (gezählt)
landing_view, lead_magnet_view, lead_gate_shown, lead_gate_start_diagnosis, lead_gate_skip_to_checkout, quiz_started, quiz_completed, quiz_result_viewed, result_cta_clicked, checkout_started/checkout_start, checkout_complete/checkout_completed.

## Resolve-Regeln
- `package_id` zuerst aus `conversion_events.package_id` (Generated Column), Fallback `metadata->>'package_id'::uuid`.
- `persona_type` zuerst aus `metadata->>'persona_type'`, Fallback `metadata->>'persona'`, sonst `'unknown'`.
- `source_page` aus `page_path`, Fallback `metadata->>'source_page'`.
- Events mit `metadata->>'smoke_test' = true` werden permanent ausgeschlossen.
- Funnel-KPIs zählen NUR wenn `package_id IS NOT NULL`. Orphans werden separat ausgewiesen.

## Views (admin-only)
- `v_funnel_conversion_24h`
- `v_funnel_conversion_7d`
- `v_funnel_conversion_30d`

REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT TO service_role only.

## Kennzahlen
landing_views, lead_magnet_views, lead_gate_*, quiz_starts, quiz_completions, result_views, result_cta_clicks, checkout_starts, checkouts_completed, orphan_events_count, landing_to_quiz_rate, quiz_completion_rate, quiz_to_result_rate, result_to_checkout_rate, checkout_completion_rate, full_funnel_conversion_rate.

## Ampel (im RPC, nicht im Frontend gerechnet)
- green:  full_funnel_conversion_rate ≥ 3 %
- yellow: 1 % … < 3 %
- red:    landing_views ≥ 20 und full_funnel_conversion_rate < 1 %
- gray:   sonst (zu wenig Daten)

## RPCs (SECURITY DEFINER + has_role-Gate)
- `public.admin_get_funnel_conversion(p_window text, p_limit int)` — Validiert `p_window IN ('24h','7d','30d')`, dispatcht via `format(... %I ...)` auf die richtige View, liefert Ampel mit aus.
- `public.admin_get_funnel_orphan_summary(p_window text)` — Tracking-Lücken pro event_type.

Beide werfen `42501` ohne Admin-Rolle, `22023` bei ungültigem Window.

## UI
`src/components/admin/growth/FunnelAnalyticsCard.tsx` mit 5 Sektionen:
1. Top-Funnel nach Conversion-Rate
2. Größte Drop-Offs (schwächste Stage pro Zeile)
3. Persona-Vergleich (aggregiert über Pakete)
4. Pakete mit Traffic ≥ 20 aber 0 Checkout
5. Orphan-Event-Warnung oben (nur wenn > 0)

Eingehängt im Tab `dashboard` von `src/pages/admin/v2/GrowthPage.tsx` direkt unter `GrowthDashboardOverview`.

## Smoke
`scripts/funnel-analytics-smoke.mjs` — prüft View-401 für anon + RPC-Block + Window-Validation.

## Was Phase 1 NICHT macht
- Keine Diagnose, keine `growth_actions`, keine A/B-Varianten — kommt in Phase 2/3.
- Kein Cron — Views sind on-demand, RPCs sind STABLE.
