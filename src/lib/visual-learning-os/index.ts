/**
 * VISUAL.LEARNING.OS — Foundation barrel (Cut 1).
 *
 * Visueller Didaktik-Layer für ExamFit. Erzeugt, verwaltet und bewertet
 * visuelle Lern- und Prüfungsartefakte auf Basis von Frozen Curriculum,
 * Kompetenzen, Lessons und Blueprints.
 *
 * Cut 1 (Foundation) liefert NUR Contracts, Grammar, Pattern Registry,
 * Assessment-Rubrics und Accessibility-Regeln. Keine UI, keine Factory,
 * keine Generierung. Diese folgen in Cut 2+.
 *
 * Hard rules:
 *  - Frontend rendert nur APPROVED/PUBLISHED Artefakte.
 *  - Keine fachliche Bewertungslogik im Frontend.
 *  - Farbe trägt NIE allein Bedeutung (WCAG).
 *  - Jedes Artifact ist SSOT-gebunden (curriculum_id + competence_id).
 */
export * from "./contracts";
export * from "./visual-grammar";
export * from "./visual-pattern-registry";
export * from "./visual-assessment";
export * from "./visual-accessibility";
