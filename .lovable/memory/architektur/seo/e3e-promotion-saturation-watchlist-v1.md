---
name: E3e Promotion Saturation Watchlist v1
description: Soft-Saturation-Regel für E3e.4 Bridge-Promotion — bevorzugt Targets mit rank_in_target ≤ 2, Watchlist-Targets deferred bis Inbound-Pressure sinkt
type: constraint
---

# E3e.4 Promotion-Gate — Soft Saturation Watchlist

## Regel
Bei jeder `admin_seo_bridge_activation_execute(..., promote_to_active := true)` (E3e.4):
- **Bevorzuge** Pilot-Candidates mit `explainability->>'rank_in_target' <= 2`.
- **Defer** (nicht reject) Candidates auf Targets, die bereits `inbound_active + inbound_suggested >= 3` haben oder auf der Watchlist stehen — solange gleichwertige Pillars mit niedrigerem Inbound-Pressure verfügbar sind.
- **Hard-Cap** der ersten Promotion-Wave: 5 active edges, ausschließlich `link_type='blog_to_pillar'`.
- **Kein Auto-Fanout** über mehrere Bridge-Typen in derselben Wave.

## Aktuelle Watchlist (2026-05-17, nach Wave-1 Live)
| Target | Grund | rank_in_target | Status |
|---|---|---|---|
| `/elektroniker-in-für-betriebstechnik-pruefung` | 3 zusätzliche Pilot-Candidates queued, gate `max_in=5` nicht erreicht aber Frühindikator für Authority-Konzentration | 4 | DEFER bis andere Targets aktiviert |

## Rollback / Pflege
- Watchlist-Einträge werden manuell entfernt, sobald Crawl-/Engagement-Daten Inbound-Pressure als unbedenklich bestätigen.
- Jede Promotion-Wave loggt `seo_bridge_activation_committed` mit `payload.watchlist_skips` (geplant für E3e.4 RPC-Erweiterung).

## Strategischer Kontext
Wave-1 Read-Only-Check (T+0h) bestätigte: similarity=1.0 konstant, 10/10 distinct targets, 0 rejects, additive (nicht exponentielle) Graph-Expansion. Watchlist schützt diesen Zustand bei späteren Wellen.
