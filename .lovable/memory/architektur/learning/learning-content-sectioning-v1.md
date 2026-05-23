---
name: Learning Content Sectioning v1
description: Lesson-Content rendert prüfungsnahe Lernkarten in fixer didaktischer Reihenfolge (Kurz erklärt → Merksatz → Beispiel → Gegenbeispiel → Prüfungsfalle → Mini-Selbstcheck) aus bestehendem lesson.content; rückwärtskompatibler html-Fallback; statisches Self-Check ohne AI.
type: feature
---
SSOT-Quelle für Sectioning (kein Curriculum-Touch, kein Schema-Bruch):
- Forward-compatible Shape: `lesson.content.sections.{short|takeaway|example|counter_example|exam_pitfall|self_check}`.
- Legacy-Keys auf Top-Level akzeptiert: `kurz_erklaert|merksatz|beispiel|gegenbeispiel|pruefungsfalle|self_check`.
- `self_check`: String oder `{question, answer?}`.
- Whitespace-only Werte werden als leer behandelt.

Komponenten:
- `src/components/lesson/sections/extractSections.ts` — pure extractor + `SECTION_ORDER` (fix didaktisch).
- `src/components/lesson/sections/LessonSections.tsx` — rendert Karten mit Icon/Label/Description, sanitizet via DOMPurify; Mobile-first; tokens-only.
- Self-Check: statische Reveal-Button (kein AI im Client). Fallback-Text wenn keine Antwort gepflegt: „Beantworte die Frage in Gedanken — oder im AI-Tutor."
- `LessonContent.tsx` text-Branch + text+MiniCheck-Combo nutzen `LessonSections` statt direktem prose-Block; legacy `content.html` bleibt als Fallback voll funktional.

Tests: `src/components/lesson/sections/__tests__/extractSections.test.ts` 8/8 (null/empty, html-fallback, sections-shape, legacy-keys, whitespace, self_check-string, fixed order, html+sections combo).

Bewusst NICHT in v1:
- Keine AI/Tutor-Generierung.
- Kein DB-Schema-Patch (Felder optional unter `content.sections.*`).
- Keine berufsspezifischen Hardcodings.
- Kein Bruch des Progress/Guard-Systems — Mini-Selbstcheck ist NICHT der formale MiniCheck-Step.

Nächste Cuts (per Roadmap): (2) Mini-Selbstcheck Persistierung in Lesson-Karte → (3) AI Tutor Context Surface v1 → (4) Tutor Feedback nach MiniCheck.
