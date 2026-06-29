/**
 * VISUAL.LEARNING.OS — Public Barrel.
 *
 * Cut 1: Contracts, Grammar, Pattern Registry, Assessment, Accessibility.
 * Cut 2: Policy, Factory, Review-Gate, Frontend-Safe Projection.
 *
 * Hard rules: SSOT-bound, no DB/HTTP/LLM in this module, no frontend domain logic.
 */
export * from "./contracts";
export * from "./visual-grammar";
export * from "./visual-pattern-registry";
export * from "./visual-assessment";
export * from "./visual-accessibility";

// Cut 2
export * from "./visual-artifact-policy";
export * from "./visual-artifact-factory";
export * from "./visual-artifact-review";
export * from "./visual-artifact-projection";

// Cut 3
export * from "./admin-preview";

// Cut 4 — Lesson Integration
export * from "./lesson-visual-policy";
export * from "./lesson-visual-block";
export * from "./fixtures";

// Cut 5 — MiniCheck Visual Feedback
export * from "./minicheck-visual-policy";
export * from "./minicheck-visual-feedback";

// Cut 6 — AI-assisted Visual Drafting (hinter Review-Gate)
export * from "./ai-draft-policy";
export * from "./ai-draft-contracts";
export * from "./ai-draft-request";
export * from "./ai-output-normalizer";
export * from "./ai-draft-pipeline";

// Cut 7 — Persistence & Admin Approval Workflow
export * from "./persistence-policy";
export * from "./persistence";

// Cut 8 — Visual Mastery Signals
export * from "./mastery-signal-policy";
export * from "./mastery-signals";



