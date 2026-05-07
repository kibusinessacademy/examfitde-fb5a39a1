---
name: Growth Operating System v1
description: Pflicht-Framework für jede Marketing-/SEO-/Content-/UI-/Conversion-Entscheidung. 7 Layer + Pre-Brief + Anti-Patterns. SSOT in docs/GROWTH_OPERATING_SYSTEM.md.
type: constraint
---

# Growth Operating System v1 — Lovable-Pflichten

Vor JEDEM Feature, das User-facing-Seite, Funnel-Schritt, Content-Asset, Admin-Card oder Shop-Komponente berührt: dieses Dokument **+** `docs/GROWTH_OPERATING_SYSTEM.md` lesen und Brief liefern.

## 7 Layer (kurz)
1. **Market Domination** — Query-Intent-Klassifikation Pflicht (`awareness|problem|comparison|exam_prep|purchase|b2b|institutional`).
2. **Content Graph** — kein Asset ohne `cluster_id` + Links zu Money/Demo/Pricing.
3. **Sales Psychology** — Persona-Matrix (Azubi/Betrieb/Institution) bestimmt CTA-Text.
4. **Programmatic SEO** — Templated Pages nur via Variablen-Matrix + Anti-Cannibalization-Hash.
5. **LLM Visibility** — Pflichtblöcke: TL;DR, Definition, Liste, FAQ, Entity-Table.
6. **Conversion Loop** — jede Seite: funnel_stage + next_action + tracking_event. Keine Sackgasse.
7. **Quality Governance** — Keyword-/Persona-/Funnel-SSOT, Refresh-Detection.

## Pre-Implementation Brief (Pflicht)
1 UI-Ziel · 2 Rolle · 3 Entscheidung · 4 Daten (RPC/View) · 5 Risiko · 6 Sichere Aktion · 7–10 Empty/Loading/Error/Success · 11 Mobile · 12 Performance · 13 Tracking · 14 Akzeptanz.

## Admin UI = Leitstelle
Jede Card: **Status + Severity (P0/P1/P2/OK) + RootCause + LastAction + Trend + Drilldown + RecommendedAction + AuditLink**.
Mutationen: Reason + `auto_heal_log` + Toast + `invalidateQueries`. Sonst reject.

## Shop UI = Conversion-System
Produktseite: Hero(Persona+Ziel+Nutzen) + Primary-CTA above-the-fold = **„Prüfungssimulation starten"** + Trust + Einwand + FAQ+schema.org + ≥3 interne Links + Mobile-Hero + Tracking `{package_id, persona}`.

## Anti-Patterns (hart verboten)
- Isolated content (kein cluster_id)
- Produktseite ohne Primary CTA ATF
- Admin-Mutation ohne Reason+Audit
- Direct client read auf `growth.*` SSOT
- Duplicate keyword_slug
- Persona-Mismatch CTA
- AI-Calls vom Client

## Querverweise
- `docs/GROWTH_OPERATING_SYSTEM.md` (volle SSOT)
- `mem://constraints/admin-ui-leitstelle-v1`
- `mem://constraints/shop-ui-conversion-v1`
- `mem://constraints/migration-discipline-v1` (für SSOT-Tabellen-Rollout)
