---
name: VerwaltungsOS Oral Bridge v1
description: Live-Simulation der Fachbereichs-Oral-Szenarien — Persona Pressure, Eskalations-Dynamik, Governance-Eval, Scorecards, Debrief
type: feature
---

# VerwaltungsOS Oral Bridge v1 — FROZEN 2026-05-27

Brücke von strukturierter Fachbereichs-DNA (Fachbereichs-DNA v1) zu erlebbarer
Verwaltungs-Simulation. SSOT bleibt `verwaltung_department_dna.oral_training_cases`
— die Bridge generiert KEINE DNA, nur Simulations-Output.

## Architektur

**Tabellen** (RLS auth-only, user_id-scoped):
- `verwaltung_oral_sessions` — id, user_id, department_key, oral_case_key, persona,
  conflict_level, escalation_state (0–5), status, scenario_snapshot (jsonb),
  scores, debrief, started_at, ended_at
- `verwaltung_oral_turns` — session_id, turn_index, role (persona|user|system),
  content, persona_emotion, escalation_delta (−2..+2), evaluation (jsonb)

**RPCs** (SECURITY DEFINER, auth-gated):
- `start_verwaltung_oral_session(_department_key, _oral_case_key, _persona)` → uuid
- `get_verwaltung_oral_session(_session_id)` → jsonb (Session + Turns)
- `finalize_verwaltung_oral_session(_session_id, _scores, _debrief)` → jsonb

**Edge Function** `verwaltung-oral-bridge` (Lovable AI Gateway, `google/gemini-2.5-flash`,
`response_format: json_object`):
- `action=start` → RPC + erste Persona-Eröffnung
- `action=turn` → User-Turn-Insert + parallel (Persona-Reaktion ‖ Governance-Eval) +
  Escalation-State-Update + Persona-Turn-Insert
- `action=debrief` → Score-Aggregation (cluster-gewichtet) + Debrief-Intelligence + Finalize

**UI**:
- `/branchen/verwaltung/oral/:departmentKey/:oralCaseKey` → `VerwaltungOralRunner`
- CTA "Simulation starten" in `VerwaltungDepartmentsSection` pro Oral-Case
- Live: Eskalations-Meter, Emotion-Tag pro Turn, Inline-Eval-Feedback, Scorecard, Debrief-Block

## Cluster-Gewichtung Scorecard

Dimensionen: buergerverstaendlichkeit, deeskalation, fachlichkeit, struktur, empathie, governance_sicherheit (0–100).
Pro KGSt-Cluster eigene Gewichte (z.B. Service → Bürgerverständlichkeit dominant; Bauen/Umwelt → Fachlichkeit + Governance dominant; Sicherheit/Ordnung → Governance + Deeskalation dominant).

## Smoke

`scripts/verwaltung-oral-bridge-smoke.mjs` (4 Checks, GREEN 2026-05-27):
DNA loadable · ≥1 Oral-Case · start RPC blocked für anon · finalize rejects unknown session.

## Anti-Drift (hard rules)

- DNA-Daten NIE in der Bridge erzeugen — nur SSOT lesen.
- Persona-Output NIE in `oral_training_cases` zurückschreiben.
- Keine Mehrfach-Bewerter, keine Parallel-Scorecards — diese Aggregation ist SSOT.
- Erweiterungen (neue Dimensionen / neue Persona-Modi) erfordern Migration + Bridge-Code + Smoke-Update.
- Keine generative Beratung im Persona-Modus ("hier wäre die richtige Antwort…") — verboten im System-Prompt.
