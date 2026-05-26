---
name: ConversationOS Cut 1 — Painpoint Graph + State Engine + Live Pipeline
description: SSOT für ConversationOS Live-Engine. Painpoint-Graph + State-Engine getrennt von Rubric. HR-InterviewOS Pilot.
type: feature
---

## SSOT-Tabellen (2026-05-26)
- `conversation_os_painpoint_graphs` — zustandsbasierte Eskalations-Graphen (trigger_conditions, character_reaction, escalation_paths, state_deltas, cooldown_turns, max_activations_per_session). 22 Seeds: 16 hr_interview_os + 6 leadership_os.
- `conversation_os_sessions` — user-scoped Live-Sessions mit `conversation_state` (trust/tension/confidence/rapport 0–1), `active_painpoint_id`, `painpoint_history`, `painpoint_activation_counts`, Rubric-Scores.
- `conversation_os_turns` — Turn mit `state_snapshot`, `state_delta`, `painpoint_triggered`, `scoring_delta`, `latency_ms`.
- `conversation_os_debriefs` — `transcript_annotations`, `rubric_breakdown` (mit evidence_quote), `critical_moments` (Top-3), `improvement_plan`, `state_trajectory`, `certificate_eligible`.

## Strikte Trennung
- **Rubric** bewertet User → für Score/Debrief.
- **State Engine** steuert Charakter-Reaktion → niemals dem User direkt angezeigt im Chat (nur im State-Meter).
- **Painpoint-Graph** orchestriert Eskalation deterministisch (rule + state-threshold), nicht LLM-Wahl.

## Edge Functions (deployed)
- `conversation-os-start` — Auth-gated; lädt Scenario, erstellt Session, erzeugt Opening-Turn (lead_prompts oder LLM-Fallback).
- `conversation-os-turn` — SSE-Stream. Pipeline: detectUserSignals (rule-based) → selectPainpoint (trigger match + state threshold + cooldown + max activations) → applyStateDeltas → User-Turn persistieren → System-Prompt mit State + Painpoint-Injection → Stream → assistant-Turn + Session-Update im TransformStream flush. Header `x-conv-painpoint` + `x-conv-state` für UI.
- `conversation-os-debrief` — `google/gemini-2.5-pro` mit tool_choice `create_debrief`. Idempotent (returns existing). Aktualisiert Session.status=completed + total_score + rubric_scores.

## UI (HR InterviewOS Pilot only)
- `/os/hr-interview` — Scenario-Karten klickbar wenn `route_slug === 'hr-interview'` → Run.
- `/os/hr-interview/run/:scenarioId` — State-Meter im Header (Trust/Tension/Confidence/Rapport), Painpoint-Badge, SSE-Chat, End-Session-Button.
- `/os/hr-interview/debrief/:sessionId` — Score-Hero, Rubric-Breakdown mit Evidence-Quotes, Critical Moments mit better_alternative, Improvement Plan, State-Trajektorie.
- `/os/hr-interview/history` — Mastery pro Dimension + Sessions-Liste.

## Determinismus-Regeln (Cut 1)
- Painpoint feuert nur wenn `matchScore > 0` UND `cooldown_turns` abgelaufen UND `max_activations_per_session` nicht erreicht.
- State-Conditions akzeptieren Format `state.<key><op><number>` (z.B. `state.trust<0.4`).
- Cooldown verhindert "Session 1=Session 2=Session 3" Repetition.

## NICHT in Cut 1
Voice, B2B-Dashboard, Zertifikat-PDF, Multiplayer, andere Verticals (Leadership = Phase 2 nach Pilot-Daten).

## Bekannte Pre-Existing Linter-Findings
Migration triggert 2573 Project-wide Linter-Issues (alle pre-existing, nicht aus dieser Migration). Keine neuen ERROR aus Cut-1-Migration.
