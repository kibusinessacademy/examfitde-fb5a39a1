---
name: Learning Lesson UX Copy & Structure v1
description: Lektion-Seite nutzerzentriert (LessonHero ableitet H1/Meta/Lernziele/Prüfungsrelevanz aus existierenden lesson.content + competency-Daten, kein Hardcoding); Stepper mit sichtbaren Labels+Status; CTA mit konkretem nächstem Schritt + inline Completed-Badge.
type: feature
---
SSOT-Quellen für die Learner-Sicht (kein Curriculum-Touch, keine Sondertexte pro Beruf):
- H1: `lessons.title` mit LF/K-Prefix entfernt (Regex `^LF\d+[-·.]?K?\d*:\s*`); Fallback `competencies.title`.
- Meta-Zeile: `courses.title` · `LFxx · Kompetenz Kxx` (aus `competencies.code`) · „Lektion N von M" · „Schritt N von M" (`STEP_ORDER`).
- Lernziele: nur wenn `lessons.content.objectives[]` ≥ 1 String.
- Prüfungsrelevanz: Label aus `lessons.exam_relevance_score` (≥70 Hoch / ≥40 Mittel / sonst Niedrig) + Themen aus `lessons.content.exam_triggers[]`.

Komponenten:
- `src/components/lesson/LessonHero.tsx` (neu) — alles oben Genannte.
- `src/components/lesson/StepIndicator.tsx` — visible Labels + per-step Status (Done/Aktiv/Gesperrt) statt nur Icons; renderTitle entfernt (jetzt im Hero).
- `src/components/lesson/LessonNavigation.tsx` — CTA „Weiter: <StepLabel> – <StepDescription>" + Completed-Badge auf gleicher Zeile; Vorherige/Markieren/Weiter klar getrennt.
- `src/components/lesson/LessonHeader.tsx` — Progress-Text „Lektion X von Y" (vorher „X/Y").
- `src/pages/LessonPlayer.tsx` — fetcht `competencies.code,title`, ergänzt `lessons.exam_relevance_score`, PageExplainer als unauffälliger Footer-Helper unter Navigation.

Tests: `src/components/lesson/__tests__/LessonHero.test.tsx` 7/7 (Title-Strip, Code-Mapping, optionale Lernziele, optionale Prüfungsrelevanz, Completed-Inline, Fallback auf Competency-Title).

Bewusst NICHT in v1: schemabasiertes Content-Sectioning (Definition/Merksatz/Beispiel/Gegenbeispiel/Prüfungsfalle als separate Karten) — `lessons.content.html` bleibt als Block bis Content-SSOT strukturiert ausgeliefert wird. AI-Tutor-Kontextualisierung folgt separat.
