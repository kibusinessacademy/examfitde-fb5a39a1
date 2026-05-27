---
name: Occupational Intelligence Enrichment v1
description: 4 Berufsrealitäts-Modell-Layer (KPI/Communication/Decision/Document) on top of vertical_dna; read-only Bridge via get_vertical_occupational_dna; UI-Sektion "Operative Berufsintelligenz" auf /branchen/:slug.
type: feature
---

# Occupational Intelligence Enrichment v1 — FROZEN 2026-05-27

Schließt **Occupational Intelligence Graph v1** ab. Übergang von "Berufswissen" → "operative Berufsintelligenz".

## Scope (read-only Bridge — kein neuer Runtime/Agent/Generator)

4 JSONB-Spalten auf `public.vertical_dna`:

| Layer | Spalte | Zweck | Späterer Konsument |
|---|---|---|---|
| KPI-Modelle | `kpi_models` | SLA, Risikoindikatoren, Qualitätsmetriken | DailyBrief, Mission Control, Fix Queue, Outcome Drift |
| Kommunikations-Modelle | `communication_models` | Szenarien, Beteiligte, Eskalation, Tonalität | Persona Simulation, Konflikt-/Stress-Training |
| Entscheidungs-Modelle | `decision_models` | Freigaben, Priorisierung, Approver, Risiko | Governance, Controlled Autonomy, Approval Chains |
| Dokument-Intelligenz | `document_intelligence` | Pflichtfelder, Validation Rules, Fehlerquellen, Governance-Bezug | Document Workflows (Notare, Steuer, Praxen, Verwaltung, Pflege, Kassen) |

## Coverage (2026-05-27)

- **Deep-Seeded (6 strategische):** banking, consulting, education, gartenbau, hr, support
  → je 6 kpi_models / 4–5 comm_models / 4 dec_models / 3 doc_intel
- **Baseline-Seeded (10):** foerdermittel, handwerk, kanzlei, krankenkasse, makler, notar, pflege, praxis, steuer, verwaltung
  → je 3–4 kpi_models / 2 comm_models / 2 dec_models / 2 doc_intel
- 16/16 Verticals ≥ 1 Item pro Layer.

## Contract

- **SSOT bleibt vertical_dna** — keine neue Tabelle, kein Shadow-State.
- **RPC `get_vertical_occupational_dna(_vertical_slug)`** liefert alle 4 Layer unter `vertical.*`.
- **Reader-Lib** `src/lib/berufs-ki/occupational-intelligence.ts` typed via `OINamedItem[]` (offene Felder pro Layer erlaubt).
- **UI** `src/pages/verticals/VerticalDetailPage.tsx` Sektion "Operative Berufsintelligenz" (rendert nur Layer mit Items).
- **Items-Schema (per Convention, kein Hard-Constraint):**
  - kpi_models: `{key,label,target?,risk?,unit?,type?,description?}`
  - communication_models: `{key,label,scenario?,participants[]?,tone?,risk_level?,escalation_to?}`
  - decision_models: `{key,label,approver?,trigger?,risk?,escalation?}`
  - document_intelligence: `{key,document_label,required_fields[]?,validation_rules[]?,common_errors[]?,governance_relevance?}`

## Anti-Drift (hart)

- ❌ Keine AI-generierte DNA. Nur kuratierte Inhalte.
- ❌ Keine Mutation aus dem Frontend / Public-Client. Schreibzugriff = admin only.
- ❌ Kein neuer Runtime (Agent, Worker, Generator) auf dieser Basis in v1.
- ❌ Keine Duplikate neben Verticals (z. B. eigene "vertical_kpi_catalog" Tabelle).
- ✅ Erweiterung erfolgt **on existing SSOT** + Bridge-Layer.

## Audit

- `auto_heal_log` action_type: `occupational_intelligence_enrichment_v1_closed`

## Nächste sinnvolle Schritte (nicht Teil v1)

- Vertical Activation Layer (DailyBrief-Samples, Persona-Sim-Demo, Outcome-Demo) — lesend on top.
- Bridge KPI-Modelle → konkrete `agent_outcome_bundles` Outcomes pro Vertical (read).
- Document-Intelligence → Mapping auf bestehende `documents` Sektion (Validation Rules sichtbar machen).
