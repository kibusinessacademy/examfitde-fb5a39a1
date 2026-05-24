# Premium Experience Phase 1.1 — Premium AI Tutor

**Status:** queued — Start frühestens 7 Tage nach grünem DNS-Cutover.
**Scope-Lock:** Nur Tutor-Layer. Daily Loop / Mobile Focus Flow / Emotional Progression / Exam Sim Premium folgen als 1.2–1.5.

## Constraint-Check (Architectural Continuity Guard)

| Rule | Status | Begründung |
|---|---|---|
| SSOT_FIRST | ✅ | Baut auf `ai_tutor_audit`, `tutor_access_check`, Strict-RAG, `learner_intervention_state` (Bridge 4), `user_competency_mastery`, `learner_readiness_history`. |
| EXTEND_EXISTING | ✅ | Erweitert `ai-tutor` Edge Function + UI, **keine** neue Tabelle. |
| NO_PARALLEL_SYSTEMS | ✅ | Recovery-Logik bleibt in Bridge 4 NBA-Engine. Tutor liest, dispatcht nicht. |
| GOVERNANCE_BEFORE_AUTOMATION | ✅ | Personality-Modes deterministisch aus Signalen abgeleitet, kein Free-Form-LLM-Routing. |
| NO_HIDDEN_STATE | ✅ | Tutor-Persona-Pick wird in `ai_tutor_audit.metadata.persona_mode` mitgeschrieben. |
| FAIL_VISIBLE | ✅ | Refusal-Phrase + Citations bleiben Pflicht. |
| Architecture Freeze post Bridge 16 | ✅ | Kein neuer Intelligence-Layer — pure Surface + deterministisches Persona-Routing über existierende Signale. |

## Cuts (sequenziell, jeder einzeln shipbar)

### 1.1.a — Persona Mode Router (deterministisch)
- Pure helper `derivetutorPersonaMode(signals)` in `src/features/ai-tutor/personaRouter.ts`.
- Inputs (alle existieren): `readiness_state`, days_to_exam, weak_competencies_count, recent_failure_streak, last_session_gap_days, current_question.exam_relevance_score.
- Outputs: `coach | examiner | explainer | motivator | focus_trainer` + reason-trace.
- Truth-table-Tests (≥10 Cases, deterministisch).

### 1.1.b — Tutor System-Prompt-Erweiterung
- `supabase/functions/ai-tutor/index.ts`: Persona-Mode → Tonalität + Frage-Stil + Antwort-Länge-Cap.
- Strict-RAG + `[SOURCES]` bleiben unangetastet.
- Refusal-Phrase bleibt unangetastet.
- Audit: `ai_tutor_audit.metadata.persona_mode` + `persona_reason`.

### 1.1.c — Conversational Coach UI (Mobile-First, 411px)
- Redesign `LearnerTutorPanel`/`AiTutorChat`: Persona-Avatar + Mode-Label, kein generisches Chat-Fenster.
- Sticky bottom input, gesture-friendly, Markdown-Rendering der Antwort, Source-Chips unter jeder Antwort.
- Empty-state zeigt aktuellen Mode + 3 vorgeschlagene Lernfragen aus `learner_intervention_state.suggested_action`.

### 1.1.d — Recovery-UX-Bridge zu Bridge 4
- Wenn Bridge 4 NBA = `rescue_session | weakness_training | retention_nudge`, surfacet Tutor-Card eine "Coach übernimmt jetzt"-CTA → öffnet Tutor mit pre-loaded Stagnation-Kontext.
- Kein neuer Job-Type. Reine UI-Bridge.

### 1.1.e — Stagnation-Detection-Surface (read-only)
- Nutzt existierende `user_competency_mastery.struggling`-Flags + `learner_readiness_history`.
- Tutor-Header zeigt "Du arbeitest gerade an: <competency>. Modus: <persona>."
- Keine neue Tabelle, keine neue RPC.

## Out-of-Scope (explizit)
- Daily Mission System / Momentum Score → Phase 1.2
- TikTok-Focus-Flow Lessons → Phase 1.3
- Kompetenz-Ringe / Readiness-Wellen → Phase 1.4
- Prüfungstag-Modus / Oral Premium → Phase 1.5
- Streak-Premium-Visualisierung → Phase 1.2

## Akzeptanzkriterien
- Truth-Table 100% green (deterministisch).
- `ai_tutor_audit` enthält `persona_mode` für jede Antwort.
- Refusal-Phrase + `[SOURCES]` weiterhin durchgesetzt (bestehende Smokes grün).
- a11y axe regression grün auf neuem Tutor-Panel.
- Mobile 411px: Single-CTA, Sticky Input, keine horizontale Scroll.
- Kein neuer Eintrag in `ops_audit_contract` außer `persona_mode`-Erweiterung des bestehenden `ai_tutor_response_emitted`.

## Trigger-Bedingung Start
1. DNS-Cutover green
2. 7d ohne P0/P1-Incident
3. `auto_heal_log` Cutover-Smoke 7d stabil
4. Memory `mem://constraints/architecture-freeze-post-bridge-16-v1.md` re-checked → "tutor surface only" als zulässige Ausnahme bestätigen
