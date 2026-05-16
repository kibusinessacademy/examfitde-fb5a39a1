---
name: Operational State v1 Sprint 3
description: Dach-SSOT v_package_operational_state_v1 mit 7 Dimensionen + RPCs + Cockpit-Card. Diagnose-only. customer_safe bleibt eigene Wahrheit.
type: feature
---

# Sprint 3 — v_package_operational_state_v1

## SSOT
`public.v_package_operational_state_v1` (service_role only) liefert pro Paket **7 Dimensionen**:

| Dimension | Werte |
|-----------|-------|
| build_state | published / building / queued / blocked / failed / draft |
| governance_state | approved / review / bronze / not_reviewed |
| commerce_state | ready / gap (+ commerce_gate_state pass-through) |
| customer_state | customer_safe / gap / unknown |
| seo_state | complete (≥4 signals) / partial (≥2) / minimal / unmeasured |
| b2b_state | enterprise_ready / enterprise_partial / b2c_only / undefined |
| ops_state | clean / locked / blocked / repairable / stuck |

Plus **4 Compound-Flags**:
- `customer_safe` — übernommen aus v_package_customer_safe_v1 (NIEMALS überschreiben)
- `ops_attention_required` — locked OR blocked_reason OR bronze OR (council OK, integrity NOT OK)
- `growth_ready` — seo_signal_count ≥ 4
- `enterprise_ready` — B2B enabled AND customer_safe

## RPCs (SECURITY DEFINER + has_role-Gate)
- `admin_get_operational_state_summary()` → jsonb mit total + 4 compound counts + by_<dim> Verteilungen
- `admin_get_operational_state_packages(_build,_governance,_commerce,_customer,_seo,_b2b,_ops,_track,_limit)` → gefilterte Paketliste mit state_payload

## UI
- `OperationalStateCard` in HealCockpitPage Sektion 3 oberhalb von CustomerSafeReadinessCard
- 4 Compound-KPIs + Dim-Verteilung + Drilldown (Dimension × Status → Top 50 Pakete)

## Baseline 2026-05-16
- 439 total / **190 customer_safe** (= Sprint 2 ✓) / 190 enterprise_ready / **34 growth_ready** / 110 ops_attention
- Klare nächste Skalierungsgrenze: SEO/Growth-Instrumentierung (190 customer_safe vs nur 34 growth_ready)

## Wichtig (Anti-Phantom)
- bronze_locked-Detection berücksichtigt feature_flags.bronze als JSON-Objekt (repair_active + manual_bypass), nicht als naiven Boolean-Cast → kein 22P02 invalid input syntax
- Sprint 3 enthält **KEINE Auto-Heals** — reine Diagnose, damit die neue Wahrheit stabil bleibt
- Audit: `auto_heal_log.action_type = 'operational_state_v1_init'`
