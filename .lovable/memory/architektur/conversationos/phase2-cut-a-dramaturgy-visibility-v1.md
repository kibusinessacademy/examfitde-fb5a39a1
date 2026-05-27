---
name: ConversationOS Phase 2 Cut A — Dramaturgie-Sichtbarkeit (Eskalations-Kausalität)
description: Debrief macht WARUM ein Gespräch eskalierte sichtbar — sprachliche/strukturelle Muster mit Evidence-Quotes, State-Impact und konkretem Fix.
type: feature
---

# Phase 2 Cut A — Dramaturgy Patterns (2026-05-27)

## Lieferung
- **DB**: `conversation_os_debriefs.dramaturgy_patterns jsonb NOT NULL DEFAULT '[]'`. Array<{pattern_key, pattern_label, severity, frequency, evidence_quotes[], state_impact, why_it_escalated, fix}>.
- **Edge `conversation-os-debrief`**: Tool-Schema erweitert, System-Prompt instruiert auf Kausalität ("nicht: Confidence niedrig — sondern: Konjunktiv ab Turn 4 → Trust −0.2 → Recruiter härter"). User-Prompt liefert Painpoint-History + State-Verlauf pro User-Turn als Beweismaterial.
- **UI `ConversationOSDebriefPage`**: Neue Sektion "Warum hat das Gespräch eskaliert?" zwischen Critical Moments und Improvement Plan. Pro Pattern: Label + Severity-Badge + Frequency + bis zu 3 Zitate + 2-Spalten-Grid (State-Impact orange / Why-It-Escalated neutral) + Fix-Box mit Wrench-Icon.

## Enum pattern_key
`evasion`, `hedging`, `missing_concretization`, `defensive_language`, `missing_structure`, `over_apologizing`, `monologue`, `interruption_avoidance`, `rambling`, `name_dropping_without_substance`. Max 5 Patterns pro Debrief, sortiert nach Severity.

## SSOT-Trennung gewahrt
- Rubric bewertet **User** → Score.
- State Engine steuert **Character-Reaktion** → State-Meter.
- Painpoint-Graph **orchestriert Eskalation** → Painpoint-Badge im Run.
- **Dramaturgy Patterns** = Coach-Erklärung post-hoc → nur im Debrief sichtbar, nicht im Live-Chat.

## Anti-Drift
- Patterns nur mit `>=1 Evidence-Quote` aus Transcript → keine generischen "Confidence niedrig"-Floskeln.
- Keine neue Tabelle (extend statt fork — `EXTEND_EXISTING`).
- Idempotenz erhalten: bestehende Debriefs ohne dramaturgy_patterns liefern `[]` (NOT NULL DEFAULT).

## Nächste Cuts (sequenziell)
- Cut B — Character-Variation pro Painpoint
- Cut C — Realismus-Boost State Engine
- Cut D — Mastery & Progression UI
