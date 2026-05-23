---
name: Learning Recovery Loop v1
description: Bei failed/partial MiniCheck zeigt der Result-Screen einen gezielten Wiederholungsweg (Kurz erklärt → Prüfungsfalle → Beispiel) mit CTA-Scroll zur passenden Lesson-Section. Fail-closed bei fehlendem Kontext, kein Auto-Unlock, keine neue Mastery-Logik.
type: feature
---

# Learning Recovery Loop v1

`LearningRecoveryLoop` (src/components/lesson/LearningRecoveryLoop.tsx) wird im
`MiniCheckPlayer`-Result-Screen direkt vor `MiniCheckTutorFeedback` gerendert,
**nur wenn `passed === false`** — passed-Path bleibt unverändert.

## Kontrakt

- **Mindestkontext (fail-closed):** `lessonId + curriculumId + competencyId`.
  Pure Helper `buildRecoveryRecommendation` ist exportiert und getestet.
- **Verdict-Mapping** identisch zu MiniCheck Tutor Feedback v1: `passed` /
  `partial` (`scorePercent > 0`) / `failed` (`scorePercent === 0`).
- **Fixe Empfehlung:** `RECOVERY_SECTIONS = ['shortExplanation', 'examPitfall', 'example']`
  in didaktischer Reihenfolge — keine berufs- oder fachspezifische Logik.
- **CTA „Jetzt gezielt wiederholen":** scrollt per `document.querySelector('[data-section="…"]')`
  zur ersten vorhandenen Lesson-Section. Anchors stammen aus dem bestehenden
  `LessonSections.tsx`-Renderer (`data-section`-Attribute) — kein neuer Anchor-Vertrag.
- **Test-Override:** `onRepeat(firstSection)`-Prop für deterministisches Testing.

## States

| Zustand | UI |
|---|---|
| `passed` | renders `null` |
| `failed`/`partial` + Kontext fehlt | Fail-closed Card *„Wiederholungsweg gerade nicht verfügbar — der Lesson-Kontext fehlt."* |
| `failed`/`partial` + Kontext ok | 3 Focus-Items + CTA *„Jetzt gezielt wiederholen"* |

`data-state` (`missing-context` / `ready`) und `data-verdict` (`partial` / `failed`)
liegen am Container für Tests und Telemetrie.

## Nicht-Ziele

- Keine neue Mastery-Logik, kein Touch an `update_lesson_outcome` oder
  `learning_progress`.
- Kein Auto-Unlock — Step-Wechsel/Guard-Logik unverändert.
- Keine freien Tutor-Prompts; Recovery liefert nur strukturierte Hinweise +
  Scroll-CTA. Tiefenarbeit übernimmt weiterhin `MiniCheckTutorFeedback`.
- Keine Empfehlung aus `wrong_qids` rückwärts in einzelne Fragen — Recovery v1
  arbeitet auf Lesson-Section-Ebene (Aggregat). v2-Idee: per-Frage→Section
  Mapping, sobald MiniCheck-Frage ↔ Section-Tag im Curriculum hinterlegt ist.

## Tests

`src/components/lesson/__tests__/LearningRecoveryLoop.test.tsx` — 12 Cases:
- Helper: passed / partial / failed / missing lessonId / missing curriculumId /
  missing competencyId (6).
- Component: passed renders null / fail-closed UI / 3 Focus-Items + CTA /
  CTA→onRepeat / CTA→`scrollIntoView` Default / Verdict-Label + Competency-Code (6).

## Integration

`MiniCheckPlayer.tsx` (Result-Screen):

```tsx
{!passed && (
  <LearningRecoveryLoop context={tutorContext} result={tutorResult} />
)}
<MiniCheckTutorFeedback context={tutorContext} result={tutorResult} />
```

Der existierende `tutorContext`/`tutorResult` wird wiederverwendet — keine neuen
Props an `MiniCheckPlayer`, keine Schema-Änderung.
