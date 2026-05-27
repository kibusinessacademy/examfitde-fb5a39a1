---
name: Occupational Intelligence Expansion v1
description: Tiefe Berufs-DNA für HR/Education/Support/Banking/Consulting/Gartenbau + Cert-Mapping; keine neue Runtime
type: feature
---

# Occupational Intelligence Expansion v1 (FROZEN 2026-05-27)

## Ziel
Sechs strategische Verticals mit echter, **vertikalisierter Berufs-DNA** ausstatten und an die SSOT-Curricula andocken — kein Mapping-only, sondern Berufsrealität modellieren. Knowledge/DNA-Expansion, **keine neue AI-Architektur**.

## Schema-Erweiterung `vertical_dna`
Sechs neue JSONB-Spalten (default `[]`):
- `processes` — Kernprozesse
- `documents` — Dokument-Typen
- `workflow_types` — Workflow-Klassen
- `escalations` — Eskalations-Pfade `{label, route}`
- `outcomes` — Outcome-Typen `{label, impact}`
- `persona_seeds` — Persona-Beispiele `{label, context}`

## Tiefe DNA — Reihenfolge
1. **HR** — Recruiting, Interview, Skill-Assessment, Onboarding, Performance, Konflikt, Trennung, BR-Liaison · AGG/BetrVG/DSGVO-Eskalationen · 4 Personas
2. **Education** — Curriculum-Planung, Lesson-Design, Kompetenz-Assessment, Drop-Out-Intervention · AEVO-Anker · 4 Personas
3. **Support** — Triage, FCR, Eskalation L1→L3, KB-Refresh, SLA-Monitoring · 4 Personas
4. **Banking** — KYC, Kreditentscheidung, WpHG-Beratung, AML-Monitoring, BaFin-Reporting · GwG/MaRisk/WpHG-Eskalationen · 5 Personas
5. **Consulting** — Proposal, Discovery, Analyse, Deliverable-Factory, SteerCo, Knowledge-Harvest · Scope/COI-Eskalationen · 4 Personas
6. **Gartenbau** (additiv) — Aufmaß, Angebot, Disposition, Wetter-Replanning, Saison-Kickoff, Nachkalkulation · Wetter/Maschinen/Anwuchs-Eskalationen · 4 Personas

## Certification-Mapping (idempotent, additiv)
| Vertical | Certs |
|----------|-------|
| hr | personaldienstleistungskaufmann · personalfachkaufmann-ihk · kaufmann-bueromanagement-ihk |
| education | aevo |
| support | dialogmarketing (kfm + servicefachkraft) · verkehrsservice · servicekaufmann-luftverkehr |
| banking | bankkaufmann (+ihk) · investmentfondskaufmann · versicherungen-und-finanzanlagen · bilanzbuchhalter-ihk · controller-ihk |
| consulting | betriebswirt-ihk · technischer-betriebswirt-ihk · bilanzbuchhalter-ihk · controller-ihk · markt-und-sozialforschung |
| gartenbau | gärtner-in · florist-in · forstwirt(-in) · landwirt(-in) · fachkraft-agrarservice |

## Bridge-Baseline (2026-05-27 nach Expansion)
| Vertical | Certs | Curricula | Lernfelder | Kompetenzen | Blueprints |
|----------|-------|-----------|------------|-------------|------------|
| banking      | 6 | 4 | 46 | 239 | 2 |
| gartenbau    | 7 | 7 | 75 | 242 | 5 |
| support      | 4 | 4 | 46 | 167 | 3 |
| consulting   | 3 | 3 | 31 |  97 | 1 |
| hr           | 3 | 2 | 19 |  58 | 1 |
| education    | 1 | 1 |  4 |  13 | 0 |

## RPC-Erweiterung
`get_vertical_occupational_dna(_vertical_slug)` liefert zusätzlich `vertical.processes / documents / workflow_types / escalations / outcomes / persona_seeds`. Reader-Lib `src/lib/berufs-ki/occupational-intelligence.ts` typisiert via `OINamedItem`. UI rendert neue Sektion auf `/branchen/:slug`.

## Anti-Drift
- Keine neue Tabelle, keine neue DNA-Quelle, kein AI-Write, keine Generierung.
- Keine Mutation der SSOT-Tabellen (curricula / learning_fields / competencies / exam_blueprints).
- DNA-Anreicherung ist **kuratiert**, nicht generiert.
- Cert-Mapping additiv via `array_remove → array_append` (idempotent).
- Reader-Lib bleibt einziger Lesepfad. Direkte Joins im Frontend verboten.

## Nächste Stufen (deferred)
1. Daily-Brief-Samples pro Persona (Stage 2a).
2. Pain-Point-Simulation auf Basis von `escalations` (Stage 2b).
3. Outcome-Demos pro Vertical (Stage 2c).
4. Vertical-Activation-Layer: DNA → Aktivierung beim Erst-Onboarding.
5. Mapping-Backlog für noch dünne Verticals (education-Spektrum erweitern, sobald Erzieher/Sozialassistent ins Catalog kommen).
