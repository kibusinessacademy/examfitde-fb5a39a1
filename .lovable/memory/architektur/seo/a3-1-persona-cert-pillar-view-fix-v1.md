---
name: A3.1 Persona-Landing↔Cert-Pillar View-Fix v1
description: Root-Cause-Fix der EXISTS-Tautologien in v_persona_landing_cert_pillar_link_candidates. Vorher self-referential (s.source_url=s.source_url) → ALWAYS-TRUE bzw. ALWAYS-FALSE → 346 längst aktive Reziprok-Paare wurden fälschlich als READY_TO_SUGGEST klassifiziert. Fix: outer-aware Subqueries (s.source_url=j.source_url AND s.target_url=j.target_url). Baseline 2026-05-25 nach Fix: 346 ALREADY_ACTIVE + 177 INVALID_PERSONA_ROUTE (umschulung, per-design Skip) + 34 NO_CERT_MAPPING + 0 READY_TO_SUGGEST. RPC admin_suggest_persona_landing_cert_pillar_links existiert NICHT — auch nicht nötig (Bestand bereits live). View hard-locked auf service_role.
type: feature
---

## Pre-Fix State
- View klassifizierte alle 346 reziproken Paare als READY_TO_SUGGEST (False-Positive).
- A2-Memory ("692 persona-reciprocal links live") technisch korrekt (Bestand) aber View-Recon irreführend.

## Post-Fix Decision Distribution
| Decision | Count |
|----------|------:|
| ALREADY_ACTIVE | 346 |
| INVALID_PERSONA_ROUTE | 177 |
| NO_CERT_MAPPING | 34 |
| READY_TO_SUGGEST | 0 |

## Out of Scope
- Dispatcher RPC (kein Bedarf — 0 READY).
- 34 NO_CERT_MAPPING bleiben offen (course_packages ohne certification_id-Mapping); Heilung Teil von Catalog-Mapping-Closure.
- 177 umschulung: per-design skip (Persona-Whitelist {azubi, betrieb, institution}).
