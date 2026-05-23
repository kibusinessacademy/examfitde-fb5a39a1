---
name: AI Tutor Context Surface v1
description: Kontextgebundene Tutor-Hilfe direkt in der Lesson — 5 fixe Actions, fail-closed bei fehlendem Kontext, keine freien Frontend-Prompts.
type: feature
---

# AI Tutor Context Surface v1

`LessonTutorBox` (src/components/lesson/LessonTutorBox.tsx) integriert den AI-Tutor als kompakte, einklappbare Karte direkt im LessonPlayer (zwischen Content-Card und Navigation).

## Kontrakt

- **Mindestkontext (fail-closed):** `lessonId + curriculumId + competencyId`. Pure helper `hasSufficientTutorContext` ist exportiert + getestet.
- Bei unvollständigem Kontext zeigt die Box ausschließlich die Refusal-Phrase: *„Dazu habe ich in dieser Lektion noch keine geprüfte Grundlage."* Keine Action-Chips, kein `sendMessage`.
- Frontend sendet **nur fixe Templates** (5 Actions) + maschinenlesbares `[lesson_context: lesson_id=… competency_id=… step=… section=…]`-Tag. Keine freien Eingabefelder.
- Tutor läuft im `AI_MODES.LEARNING`-Modus, Role wird per Action gesetzt (`EXPLAINER` / `COACH` / `EXAMINER`).
- `useAITutor` schickt curriculumId/competencyId/lessonId/lessonStep an `ai-tutor` Edge — Server-Gating via `tutor_access_check` und Strict-RAG bleibt unverändert.

## Actions

1. `explain_simpler` → EXPLAINER
2. `exam_example` → COACH
3. `exam_pitfall` → COACH
4. `quiz_me` → EXAMINER
5. `why_relevant` → EXPLAINER

## Nicht-Ziele

- Keine Änderung an Progress, Mastery, Unlock-Guard.
- Keine neuen Tabellen/RPCs/Edge-Functions.
- Keine MiniCheck-Feedback-Logik (folgt in v2).
- Floating `TutorPanel` bleibt für Practice/Exam erhalten — nur LessonPlayer nutzt jetzt die Inline-Box.

## Tests

`src/components/lesson/__tests__/LessonTutorBox.test.tsx` — 9 Cases:
- Helper-Wahrheitstabelle (5)
- Fail-closed-UI ohne Actions
- 5 Action-Chips bei vollständigem Kontext
- Kontext-Payload (`lesson_id=`, `competency_id=`, `step=`) im gesendeten Prompt
- Kein `sendMessage`-Call ohne Kontext
