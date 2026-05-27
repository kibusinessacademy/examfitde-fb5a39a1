---
name: Occupational Intelligence Bridge v1
description: Read-only Bridge Vertical → Certification-Catalog → Curriculum → Lernfelder → Kompetenzen → Blueprints; SSOT bleibt unangetastet
type: feature
---

# Occupational Intelligence Bridge v1 (FROZEN 2026-05-27)

## Ziel
Branchen-Verticals an die bestehende strukturierte Berufs-DNA andocken — ohne neue DNA-Quelle, ohne Duplikation, ohne Shadow-State.

## SSOT-Pfad
`vertical_dna.vertical_slug` → `certification_catalog.vertical_slugs[]` → `certification_catalog.linked_certification_id` ⇄ `curricula.certification_id` → `learning_fields.curriculum_id` → `competencies.learning_field_id`. Blueprints: `exam_blueprints.curriculum_id`.

## Artefakte
- **View** `public.v_vertical_occupational_intelligence` — Counts pro Vertical (certifications/curricula/learning_fields/competencies/blueprints). GRANT anon+authenticated+service_role.
- **RPC** `public.get_vertical_occupational_dna(_vertical_slug TEXT) → JSONB` — SECURITY DEFINER STABLE; liefert `{ vertical, summary, certifications[], curricula[{learning_fields[], competency_count}] }`. Fehler: `vertical_slug_required` | `vertical_not_found`.
- **Audit-Contract** `vertical_occupational_dna_read` registriert (für spätere Read-Telemetry; noch kein Producer).
- **Reader-Lib** `src/lib/berufs-ki/occupational-intelligence.ts` (nur RPC-Aufruf, keine direkte Table-Query).
- **Bridge-Map** `VERTICAL_INDUSTRY_KEY` in `src/data/verticals.ts` (Drift-Schutz für legacy industry_key-Konsumenten).
- **UI** Sektion „Strukturierte Berufs-DNA" auf `VerticalDetailPage` — echte Counts, kein Hardcode; verbirgt sich bei 0 Certifications.

## Bridge-Baseline (2026-05-27)
| Vertical | Certs | Curr | LF  | Comp | BP  |
|----------|-------|------|-----|------|-----|
| handwerk | 25    | 20   | 226 | 810  | 19  |
| makler   |  8    |  3   |  21 |  76  |  2  |
| kanzlei  |  3    |  3   |  36 | 125  |  3  |
| steuer   |  2    |  2   |  23 |  74  |  2  |
| notar    |  2    |  2   |  24 |  97  |  2  |
| praxis   |  2    |  2   |  24 |  96  |  1  |
| krankenkasse | 2 |  2   |  24 |  96  |  2  |
| pflege   |  2    |  1   |  12 |  36  |  1  |
| verwaltung | 1   |  1   |  12 |  47  |  0  |
| foerdermittel | 4|  2   |  25 | 163  |  1  |
| hr / gartenbau / education / consulting / support / banking | 0 | — | — | — | — |

Lücken (hr/gartenbau/banking/consulting/support/education = 0 Certs) sind kein Bridge-Bug, sondern Mapping-Backlog in `certification_catalog.vertical_slugs[]`.

## Anti-Drift
- Keine neue Tabelle, keine neue DNA-Quelle, kein AI-Write.
- Keine Mutation der SSOT-Tabellen via Bridge.
- RPC-Aufruf ist **einziger** Lesepfad für UI; direkte Joins in Frontend verboten.
- `vertical_dna.vertical_slug` ist immutable (Trigger aus Migration 1).
- Bei neuen Verticals: erst `vertical_dna` + `certification_catalog.vertical_slugs[]` mappen, dann UI.

## Nächste Stufe (deferred, nicht in diesem Cut)
1. Bridge-Coverage-Cockpit (`v_vertical_bridge_gaps`) für die 6 leeren Verticals.
2. Read-Telemetry (Producer für `vertical_occupational_dna_read`) → Adoption-Loop.
3. Vertical Activation Layer (DailyBrief-Samples, Pain-Point-Simulation, Outcome-Demos) auf Bridge-Daten.
