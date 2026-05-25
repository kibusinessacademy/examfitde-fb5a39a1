---
name: E3e.4 Bridge Outcome Measurement v1
description: SSOT für empirische Pre/Post-Messung von Bridge-Aktivierungen. View + 2 Tabellen + 3 admin-RPCs + UI-Card. Promotion bleibt manueller Human-Gate.
type: feature
---

# E3e.4 — Bridge Outcome Measurement

Schließt die Kette E3e.0→E3e.3 mit einer messbaren Erfolgs-Schicht. Bevor
Pilot-Suggestions auf `status='active'` promoviert werden, müssen Outcome-Signale
(Views, Conversions) eine messbare Hebung gegen das Pre-Window zeigen.

## Komponenten

- **Tabellen**
  - `seo_bridge_outcome_config` (Singleton, id=1) — Defaults: window_days_pre=14,
    window_days_post=14, min_sample_per_side=20, min_lift_pct_for_promote=5.0
  - `seo_bridge_outcome_snapshots` — historische Pre/Post-Werte pro Edge:
    source/target_views + target_conversions + lift_pct + correlation_id + meta
- **View** `v_seo_bridge_outcome_v1` — read-only, ausschließlich service_role.
  Joint `seo_bridge_activations` (status='activated', not rolled_back) gegen
  `conversion_events` (page-level events) mit URL→path-Normalisierung.
  Berechnet `target_views_lift_pct` und `target_conv_lift_pct` + recommendation:
  `PROMOTE_RECOMMENDED | ROLLBACK_CANDIDATE | HOLD | INSUFFICIENT_SAMPLE | NO_BASELINE`
- **RPCs** (alle SECURITY DEFINER + has_role(admin))
  - `admin_seo_bridge_compute_outcome(p_link_type)` — snapshot persistiert
  - `admin_get_bridge_outcome_summary()` — KPI pro link_type für Cockpit
  - `admin_recommend_bridge_promotion(p_link_type)` — JSON mit promote_ids/rollback_ids
- **UI** `SeoBridgeOutcomeCard` (HealCockpit, neben Activation-Card) — KPI-Strip
  + Snapshot-Button. Promotion explizit kein One-Click.

## Audit-Contracts (registriert)
- `seo_bridge_outcome_snapshot_taken` (link_type, rows_snapshotted, correlation_id)
- `seo_bridge_outcome_config_updated` (field, old_value, new_value)
- `seo_bridge_promotion_recommended` (link_type, candidates_total, promote_recommended, rollback_candidates)

## Signal-Mapping (Pragmatik)
Ohne GSC-Integration nutzt v1 page-level conversion_events als Proxy:
- **Views**: `landing_view | page_view | product_view | shop_view | lead_magnet_view`
- **Conversions**: `checkout_start | checkout_started | checkout_complete`
- **Matching**: `conversion_events.page_path = regexp_replace(url, '^https?://[^/]+', '')`

## Baseline 2026-05-25
85/85 Edges in View klassifiziert → alle `INSUFFICIENT_SAMPLE` (Aktivierung 0-8d alt,
Sample-Akkumulation läuft). Erste verwertbare Recommendations frühestens nach
14d Post-Window = **2026-06-08**.

## Promotion-Workflow (Human-Gate bleibt)
1. Card zeigt `PROMOTE_RECOMMENDED > 0` → Ops-Review
2. `SELECT admin_recommend_bridge_promotion('blog_to_pillar')` → promote_ids
3. Manuelles `UPDATE seo_internal_link_suggestions SET status='active' WHERE id IN (...)`
4. Optional `admin_seo_bridge_activation_rollback` für Rollback-Candidates

**Kein Auto-Flip.** Aktivierung auf `active` ist explizit zweiter Human-Gate
(memory: E3e.3 selective-activation).

## Nächste Cuts
- **E3e.5** Adaptive bridge weighting + perf-Cornerstone-Score → reaktiviert
  `pillar_to_cornerstone_blog` (deaktiviert wegen schwachem word_count-Proxy)
- Optional Cron `seo-bridge-outcome-snapshot-daily` (sobald Post-Window aktiv,
  ab 2026-06-09)
- GSC-Integration (impressions/clicks/avg_position pro URL) als zweite Signal-Quelle
