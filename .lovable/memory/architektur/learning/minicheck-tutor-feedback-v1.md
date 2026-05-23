---
name: MiniCheck Tutor Feedback v1
description: Prüfungsnaher Tutor-Coach nach MiniCheck — 4 fixe Actions, fail-closed bei fehlendem Kontext, strukturierter [minicheck_context]-Tag ohne Spoiler.
type: feature
---

# MiniCheck Tutor Feedback v1

`MiniCheckTutorFeedback` (src/components/lesson/MiniCheckTutorFeedback.tsx) wird auf dem Result-Screen
des `MiniCheckPlayer` direkt unter der Score-Karte gerendert und macht den AI-Tutor zum echten
Prüfungs-Coach.

## Kontrakt

- **Mindestkontext (fail-closed):** `lessonId + curriculumId + competencyId`. Pure Helper
  `hasSufficientFeedbackContext` ist exportiert + getestet.
- Bei unvollständigem Kontext nur die Refusal-Phrase *„Dazu habe ich in dieser Lektion noch keine
  geprüfte Grundlage."* — keine Actions, kein `sendMessage`.
- Frontend sendet **nur 4 fixe Templates** + maschinenlesbares
  `[minicheck_context: lesson_id=… competency_id=… step=… score_percent=… correct=N/M verdict=passed|partial|failed wrong_qids=…]`-Tag.
- Tag enthält **nur IDs/Metriken** — keine Frage- oder Antworttexte (Anti-Spoiler, Strict-RAG bleibt
  serverseitige Single-Source-of-Truth).
- Tutor läuft im `AI_MODES.LEARNING`-Modus, Default-Role `FEEDBACK`, Role wird per Action gesetzt.
- `useAITutor` schickt curriculumId/competencyId/lessonId/lessonStep + miniCheckScore an `ai-tutor`
  Edge — Server-Gating via `tutor_access_check` und Strict-RAG bleiben unverändert.

## 4 Actions

1. `explain_errors` → FEEDBACK *(disabled wenn keine Fehler — `data-disabled-reason="no_wrong_answers"`)*
2. `competency_context` → EXPLAINER
3. `exam_pitfall` → COACH *(disabled wenn keine Fehler)*
4. `what_to_repeat` → COACH

## Verdict-Mapping

- `passed` — `passed === true`
- `partial` — nicht bestanden, aber `scorePercent > 0`
- `failed` — `scorePercent === 0`

## Pipeline

`MiniCheckPlayer.finishAnswer` reichert `QuestionResult` jetzt um `questionText`, `selectedText`,
`correctText` an, damit der Result-Screen `wrongItems` aufbauen kann. Tutor-Box bekommt
`tutorContext` (Kompetenz-Code/-Titel, Step, IDs) und `tutorResult` (passed, scorePercent, correct,
total, wrongItems).

`LessonContent` reicht neue Props (`curriculumId`, `competencyCode`, `competencyTitle`, `stepKey`)
an alle drei `MiniCheckPlayer`-Instanzen. `LessonPlayer` füllt sie aus `course.curriculum_id` und
dem bestehenden Competency-Fetch.

## Nicht-Ziele

- Keine Änderung an Progress, Mastery, Unlock-Guard.
- Keine neuen Tabellen/RPCs/Edge-Functions.
- Keine freien Eingabefelder im Frontend.
- Keine Frage-/Antworttexte im Tag — Server lädt Inhalte SSOT aus DB.

## Tests

`src/components/lesson/__tests__/MiniCheckTutorFeedback.test.tsx` — 13 Cases:
- Helper-Wahrheitstabelle (4)
- `buildMiniCheckContextTag` für passed / partial / failed inkl. `wrong_qids` (4)
- Fail-closed UI ohne Actions (1)
- 4 Action-Chips, error-only Actions auf passed disabled mit `data-disabled-reason` (1)
- error-only Actions auf partial enabled (1)
- Prompt-Payload enthält strukturierten `[minicheck_context: …]`-Tag inkl. wrong_qids (1)
- Kein `sendMessage` ohne Kontext (1)
