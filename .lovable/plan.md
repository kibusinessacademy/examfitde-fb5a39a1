
# ExamFit Oral Trainer v2 — echte Prüfergespräche pro Kurs

Ziel: Jeder Kurs erhält einen echten mündlichen Trainer, der sich wie ein IHK-Fachgespräch anfühlt — nicht "Frage → Antwort → Gut". Quelle bleibt strikt SSOT (curricula, competencies, exam_blueprints, exam_questions, user_competency_progress). Keine zweite Wissensbasis.

Anti-Drift (hart):
- Keine neuen Frage-Inhalte erzeugen oder persistieren, die nicht auf einer `competency_id` oder `exam_question_id` referenzieren.
- Voice ist Cut 4 — startet **nicht** mit Phase 1.
- Mastery-Update läuft ausschließlich über existierende `update_mastery_from_minicheck`-Logik (neue RPC nutzt denselben Pfad).
- Pro Curriculum maximal eine aktive Trainer-Route — keine parallelen Oral-Engines neben `verwaltung-oral-bridge` / `conversation-os-turn`. Bridge, don't fork.

---

## Cut 1 — SSOT-Schema + Szenario-Seed (Migration)

Neue Tabellen:

- `oral_exam_scenarios`
  - `id`, `curriculum_id` (FK), `competency_ids` uuid[], `title`, `situation` (text — kontextueller Aufhänger, z. B. "Marktanteile sinken"), `role_context` (z. B. "Industriekaufmann"), `difficulty` ('easy'|'medium'|'hard'), `exam_duration_min` int, `mode` ('quick'|'fachgespraech'|'pruefung'), `source` ('seeded'|'derived_from_blueprint'), `source_blueprint_id` nullable, `created_at`
  - GRANT: anon SELECT (für Vorschau Marketing), authenticated SELECT, service_role ALL
  - RLS: SELECT public (kein PII), INSERT/UPDATE/DELETE nur service_role / admin via `has_role`

- `oral_exam_conversation_blueprints`
  - `id`, `scenario_id` (FK), `step_index` int, `state` ('INTRO'|'EXPLORE'|'CHALLENGE'|'TRANSFER'|'SUMMARY'), `prompt_type` ('opening'|'depth'|'follow_up'|'practice_transfer'|'critical_challenge'|'closing'), `prompt_text`, `expected_keywords` text[], `evaluation_focus` ('fachlichkeit'|'struktur'|'begriffe'|'praxis'|'kommunikation')
  - GRANT/RLS analog

- `oral_exam_examiner_personas` (Seed: 4 Personas — sachlich, kritisch, praxisorientiert, stress)
  - `id`, `key`, `name`, `style_directives` jsonb (tonality, interrupt_probability, gegenfragen_density, time_pressure), `voice_id` (für Cut 4, nullable)

- `oral_exam_sessions`
  - `id`, `user_id` (auth.users), `curriculum_id`, `scenario_id`, `mode`, `examiner_persona_key`, `state` ('INTRO'|...|'COMPLETED'|'ABORTED'), `started_at`, `completed_at`, `scores` jsonb (overall + 5 Dimensionen), `debrief` jsonb, `mastery_deltas` jsonb
  - RLS: user_id = auth.uid()

- `oral_exam_turns`
  - `session_id`, `turn_index`, `role` ('examiner'|'candidate'), `content`, `state` (snapshot), `prompt_blueprint_id` nullable, `evaluation` jsonb (per-dimension Score + keywords_hit), `created_at`

Seed:
- 4 Examiner-Personas.
- 1 Initial-Szenario pro Curriculum, generiert aus `course_packages.title` + Top-3 Kompetenzen + 2 zufälligen `exam_questions` als Aufhänger. Quelle markiert `derived_from_blueprint`. Idempotent (UPSERT auf `(curriculum_id, source_blueprint_id, mode)`).
- Conversation-Blueprint pro Szenario: 6 Steps (INTRO → 2× EXPLORE → CHALLENGE → TRANSFER → SUMMARY), Prompt-Texte aus exam_question.question_text + Templates.

Audit: `ops_audit_contract` Eintrag `oral_exam_session_started`, `oral_exam_session_completed`, `oral_exam_scenario_seeded`.

---

## Cut 2 — Conversation-Engine (Edge Function `oral-exam-turn`)

Lovable AI Gateway, Model `google/gemini-2.5-flash`, `response_format: json_object`. Actions:

- `start { curriculum_id, mode, scenario_id? }` → wählt Szenario (gewichtet nach Mastery-Gaps via `v_user_weakness_map`), zufällige Persona, INSERT session + ersten examiner-Turn (INTRO-Prompt aus Blueprint, durch Persona-Stil rephrased), Return `{session_id, examiner_turn, state}`.
- `turn { session_id, candidate_text }` → INSERT candidate-Turn → State-Machine entscheidet nächsten `prompt_blueprint`-Step (oder Critical-Challenge bei schwacher Antwort, oder Transfer wenn Score solide) → parallel: (a) Evaluation der Candidate-Antwort gegen `expected_keywords` + Rubric (5 Dimensionen, 0–100) (b) Persona-formuliert nächsten Prompt → Header `x-oral-state`, `x-oral-persona`.
- `finalize { session_id }` → Aggregiert Turn-Scores cluster-gewichtet, schreibt `scores` + `debrief` (Stärken/Schwächen/Prüfungsfallen/Nächste Übungen/Verbesserungen — strukturiertes JSON, gerendert in UI). Ruft `update_mastery_from_minicheck` pro `target_competency` mit Mapping `overall ≥ 80 → mastered`, `50–79 → partial`, `<50 → not_mastered` (nur verbessern, nicht verschlechtern unter aktuelles Level). Schreibt `mastery_deltas`.

State-Machine deterministisch in SQL-Helper `fn_oral_next_state(_session_id, _last_score)`. Quality-Gate (silence/gibberish/<2 Wörter) übernimmt Pattern aus `conversation-os-turn` — Refusal-Turn der Persona statt freundlichem Weiter-Chat, 3 Fails → `state='ABORTED'`.

---

## Cut 3 — UI `/kurs/:curriculumId/oral`

Neue Page `OralExamRunner`:
- Mode-Switch (Schnelltraining 5 min · Fachgespräch 15 min · Abschlussprüfung 30 min).
- Header: Persona-Name + Stil-Badge, State-Indikator (INTRO → SUMMARY Stepper), Timer.
- Chat-Surface: Examiner-Bubble + Candidate-Textarea (Voice-Toggle disabled in Cut 3 mit Tooltip "Cut 4").
- Live: kein Score während Session (anti-Gamification, fühlt sich wie echte Prüfung).
- End-Screen: Scorecard (5 Dimensionen Radar), Debrief-Card, Mastery-Delta-Liste, CTA "Schwächen ins Minicheck übernehmen".
- Hook: `useOralExamSession` (start/turn/finalize via supabase.functions.invoke).
- Einstieg: Card im `CurriculumPickerGate`-Folge-Screen + Tile in `LearnerDashboard` neben "Mündliche Prüfung".

Telemetrie via `learnerInstrumentation`: `oral_exam_started`, `oral_exam_turn`, `oral_exam_completed`, `oral_exam_aborted`.

---

## Cut 4 — Voice-Layer (BRIDGE_DONT_FORK von VerwaltungsOS Voice)

- Persona → Voice-ID Mapping in `oral_exam_examiner_personas.voice_id` (Brian/Daniel/George/Eric — passend zu Stil).
- Edge `oral-exam-voice-tts` und `oral-exam-voice-stt` — exakt Pattern `verwaltung-voice-tts/-stt`, Bridge-Helper extrahieren (kein Fork).
- UI Push-to-Talk + Auto-Playback nach Examiner-Turn.
- Silence-Timer 10s → Persona-Druck "Ich warte auf Ihre Antwort."
- 3 Quality-Gate-Fails im Voice → identische Abort-Logik.

Cut 4 wird **nicht** in dieser Iteration gebaut — nur Spalten + Persona-Voice-IDs werden in Cut 1 angelegt, damit kein zweites Migrations-Round-Trip nötig wird.

---

## Cut 5 — Reality-Smoke + Memory

- `tests/customer-reality/learner/09-oral-exam.spec.ts` erweitern: J09 erwartet jetzt strukturierten Session-Start + Persona-Bubble + Evaluation nach Submit + Debrief nach Finalize.
- `scripts/oral-exam-smoke.mjs`: Start → 3 Turns → Finalize, prüft Mastery-Delta written.
- Memory `mem://features/oral-exam/oral-trainer-v2.md` + Index-Update.

---

## Technische Details

- Keine neue AI-Provider-Abhängigkeit (Lovable AI Gateway, kein Key nötig).
- Evaluation per LLM JSON (deterministischer Prompt + keywords_hit als ground-truth Anker → reduziert Halluzination).
- Performance: Turn-Latenz Ziel <2.5s (Gemini Flash + parallel Evaluation/Persona-Reply).
- Sicherheit: alle Edge-Funktionen auth-gated, has_role-Check nur für admin-seed RPC, RLS auf sessions/turns strikt user_id-scoped.
- Kosten-Cap: max 30 Turns pro Session (hard cap im Engine), danach Auto-Finalize.

---

## Reihenfolge in dieser Iteration

Ich baue **Cut 1 + Cut 2 + Cut 3 + Cut 5** in einem Zug (Voice Cut 4 separat, nachdem Text-Pfad stabil ist und Reality-Smoke grün).

Bestätigen, dann starte ich mit Migration Cut 1.
