---
name: VISUAL.LEARNING.OS — Framework
description: Visueller Didaktik-Layer für ExamFit; Lern-, Prüfungs-, Tutor-, Oral-Exam-, Handbuch-Visuals als SSOT-Artefakte.
type: feature
---

# VISUAL.LEARNING.OS

Zentraler visueller Didaktik-Layer. Erzeugt, verwaltet und bewertet visuelle Artefakte
(Concept Map, Process Flow, Decision Tree, Comparison Matrix, Timeline, Cause-Effect,
Error Map, Dashboard, Oral Whiteboard) als SSOT-Objekte.

## Hard Rules
- Jedes Visual ist an `curriculum_id + competence_id` gebunden (SSOT).
- Frontend rendert **nur** `approved` / `published`. Keine Drafts.
- **Keine** fachliche Bewertungslogik im Frontend.
- AI Tutor darf Visuals erklären, **keine** neuen Fachinhalte erzeugen.
- Farbe trägt nie allein Bedeutung (WCAG 1.4.1) — Form + Icon + Label sind Pflicht.
- Pro Kompetenz drei Ebenen: Lernbild, Prüfungsbild, Fehlerbild.
- Pattern Registry entscheidet Artefakt-Typ, nicht Author-Bauchgefühl.

## Cut-Plan
- **Cut 1 (Foundation, jetzt):** Contracts, Grammar, Pattern Registry, Assessment Rubrics, Accessibility Guard. Code in `src/lib/visual-learning-os/`.
- Cut 2: Visual Artifact Factory (Curriculum + Blueprint → Artefakt, Review-Gate).
- Cut 3: Visual Question Engine + Aufgabentypen (MiniCheck, Prüfungstrainer).
- Cut 4: Tutor Visual Mode.
- Cut 5: Oral Exam Whiteboard.
- Cut 6: Prüfungshandbuch als Visual Atlas.

## Dateien Cut 1
- `contracts.ts` — Frozen Types (Version 1.0.0).
- `visual-grammar.ts` — Node/Edge/Misconception Grammar, erlaubte semantische Tokens.
- `visual-pattern-registry.ts` — `selectVisualPatternForCompetence()`.
- `visual-assessment.ts` — `DEFAULT_RUBRICS` + `validateRubric()`.
- `visual-accessibility.ts` — `assertVisualAccessibility()` Review-Guard.
