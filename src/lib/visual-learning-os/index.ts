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
