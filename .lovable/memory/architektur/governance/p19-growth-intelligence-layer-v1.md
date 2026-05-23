---
name: P19 Growth Intelligence Layer v1
description: 6 typisierte Agent-Contracts, Signal-Pipeline (8 Stages), Shared Knowledge Base (5 DB-Tabellen), CMO-Edge-Function, Executive Cockpit /admin/growth-intelligence. Bounded — keine autonomen Mutationen.
type: feature
---

## Was ist P19
Plattform-Säule für **Wettbewerbs- und Markt-Intelligenz**. 6 Agenten als typisierte Contracts (Pure-TS, kein Code-Generator), eine geteilte Wissensbasis (5 RLS-Tabellen, alle Schreibwege via service_role + Audit), und ein CMO-Agent (`executive-agent` edge) der alles zu einem strukturierten Briefing synthetisiert.

## Bounded — was P19 NICHT darf
- Keine autonomen Code-/Schema-Mutationen
- Keine direkten Schreibzugriffe außerhalb der whitelisted RPCs (`admin_record_market_signal`, `admin_record_agent_insight`, `admin_record_growth_briefing`, `admin_run_executive_briefing`)
- Keine zweite Audit-/Queue-/Content-/Governance-Struktur — schreibt in bestehendes `auto_heal_log` via `fn_emit_audit`
- 'Act' der Pipeline ist auf 4 Aktionen begrenzt: `GIL_ACT_WHITELIST`

## Komponenten
- **Contracts** `src/lib/gil/contracts.ts` — `GIL_AGENT_CONTRACTS` mit `allowedInsightTypes`-Whitelist, `isInsightTypeAllowed` Guard.
- **Pipeline** `src/lib/gil/pipeline.ts` — 8 Stages: `collect → normalize → classify → enrich → link → score → detect → act`.
- **Manifest** `src/lib/gil/manifest.ts` — `GIL_SCAFFOLD_MANIFEST_V1` für P20-Course-Factory.
- **DB** 5 Tabellen unter `gil_*` (alle RLS, admin-read, service_role-write).
- **RPCs** Read: `admin_get_growth_intelligence_overview/_briefings/_market_signals/_competitor_profiles/_agent_insights`. Write (service_role): `admin_record_market_signal/_agent_insight/_growth_briefing`. Trigger: `admin_run_executive_briefing` (Audit-Gate ≥8 Zeichen Reason).
- **Edge** `executive-agent` — lädt Kontext, ruft Lovable AI (`google/gemini-2.5-pro`, Tool-Calling), schreibt via `admin_record_growth_briefing`.
- **UI** `/admin/growth-intelligence` — 4 Tabs: Executive Briefing · Signal-Feed · Competitor-Radar · Agenten-Übersicht.

## Audit-Contracts
- `gil_market_signal_recorded` — required: signal_type, source, severity
- `gil_agent_insight_recorded` — required: agent_kind, insight_type, severity
- `gil_growth_briefing_recorded` — required: briefing_kind, headline
- `gil_executive_briefing_requested` — required: reason, dry_run

## Roadmap
- **P20** Signal-Collector (RSS, Semrush API, LinkedIn) — Producer für `gil_market_signals`
- **P20+** Auto-Scaffold via Course-Factory liest `GIL_SCAFFOLD_MANIFEST_V1`
- **P21** Alert-System (Push) bei `severity='critical'` Signalen
- Backfill alter Kurse via dedizierten Job (read-only, nur Defaults)

## Tests
- `src/lib/gil/__tests__/contracts.test.ts` — Contract-Whitelist, Pipeline-Stages, Act-Whitelist, Manifest-Coverage.

## Architecture Continuity Guard
- Proposal `docs/examples/architecture-proposals/p19-growth-intelligence-layer-approved.json`
- Reuse vor Rebuild: nutzt `auto_heal_log`+`fn_emit_audit`, `has_role`, kein neues Audit-/Queue-System
- Bridge vor Fork: SEO-Agent ist komplementär zu bestehender SEO-Pipeline (kein Re-Implement)
