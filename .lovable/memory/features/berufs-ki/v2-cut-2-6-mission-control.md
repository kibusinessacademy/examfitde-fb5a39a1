---
name: BerufAgentOS v2 Cut 2.6 Mission Control
description: Read-only Kontrollzentrum für 2.1–2.5 + Cross-Proposal-Konfliktauflösung + go/review/block Empfehlung. HITL-only.
type: feature
---

# Cut 2.6 — Mission Control (FROZEN 2026-05-27)

**Status:** ❄️ FROZEN — strikt READ-ONLY. Keine Mutation, kein Auto-Apply, kein Self-Heal. Nächster Cut frei wählbar (Controlled-Autonomy/Apply-Ledger erst nach explizitem Governance-Cut).

## Scope
Aggregiert Business Intents (2.1) · Outcome Intelligence (2.3) · Fix-Queue (2.4) · Persona-Simulation (2.5) und ergänzt Cross-Proposal-Konfliktauflösung + Executive Decision Layer mit deterministischer Empfehlung.

## DB-Objekte
- `fn_mission_control_recommendation(priority, risk, confidence, conflict_count, persona_conflict)` IMMUTABLE → `'go' | 'review' | 'block'`.
  - block: risk≥0.7 ODER conflict_count≥3 ODER (persona_conflict UND priority<0.5)
  - go: priority≥0.7 UND risk<0.4 UND confidence≥0.7 UND conflict_count=0 UND ¬persona_conflict
  - sonst: review
- View `v_cross_proposal_conflicts` — paarweise Konflikte zwischen offenen Proposals (gleicher vertical_key + same business_intent_id ODER scope-overlap); klassifiziert (business_intent_overlap / scope_overlap / vertical_overlap) + `is_high_tension`.
- View `v_executive_decision_queue` — pro offenem Proposal: priority/risk/impact/confidence + conflict_count + persona_conflict + recommendation.
- Beide Views REVOKED von public/anon/authenticated; nur service_role direct.

## RPCs (alle SECURITY DEFINER + has_role admin)
- `admin_get_mission_control_overview()` — KPI-Snapshot (Intents, Findings, Proposals, Personas, Conflict-Pairs, Decision-Queue go/review/block).
- `admin_get_cross_proposal_conflicts(vertical, only_high_tension, limit)`
- `admin_get_executive_decision_queue(vertical, recommendation, limit)`

## UI
`/admin/berufs-ki/mission-control` (`MissionControlPage.tsx`):
- KPI-Strip (6 Karten: Intents / Findings / Proposals / Persona-Sims / Cross-Proposal Konflikte / Decision Queue)
- Risk Radar (go/review/block-Split)
- Tabs: Decision Queue (Filter Recommendation) · Conflict Matrix (Filter High-Tension)
- Cross-Links zu Fix-Queue, Persona-Sim, Intelligence, Business-Intents
- Loading / Error / Empty hardened
- Klarer HITL-Banner: „Mission Control beobachtet, korreliert und empfiehlt. Anwendungen erfolgen ausschließlich manuell in der Fix-Queue."

## Harte Regeln (kein Auto-Mutate)
- ❌ Kein Auto-Apply  ❌ Keine Workflow-Mutationen  ❌ Kein Self-Heal  ❌ Keine Policy-Änderungen  ❌ Keine Runtime-Writes
- ✅ Aggregation, Konflikt-Detection, Empfehlungs-Erzeugung, Decision-Vorbereitung

## Verifikation 2026-05-27
- Smoke `scripts/berufagentos-cut2-6-smoke.mjs` — alle Checks grün
- Migration `*_mission_control*.sql` (Recommendation-Fn, 2 Views, 3 RPCs)
- HITL-Guard: keine apply_mission_control / auto_apply_decision / mutate_from_mission_control / self_heal_mission_control Symbole in SQL/UI
- Route `/admin/berufs-ki/mission-control` aktiv; Cross-Link von Persona-Sim eingebaut

## Bridges
- Liest aus: `business_intents`, `outcome_intelligence_findings`, `outcome_fix_proposals`, `v_outcome_fix_persona_matrix`
- Schreibt: NICHTS

## Nächster Schritt (NICHT in 2.6)
Controlled-Autonomy / Apply-Ledger erst nach explizitem Governance-Cut mit Rollback-Garantie und Audit-Ledger. Mission Control bleibt das Kontrollzentrum vor jeder Anwendung.
