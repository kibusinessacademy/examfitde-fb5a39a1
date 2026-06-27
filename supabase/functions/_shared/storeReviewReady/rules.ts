/**
 * REVIEW.READY.GATE.OS.1 — Deterministic Scoring Weights
 */
export const SCORE_WEIGHTS: Record<string, number> = {
  manifest: 15,
  listing: 15,
  screenshots: 10,
  build: 20,
  smoke: 10,
  guards: 10,
  tests: 10,
  governance: 5,
  known_limitations: 5,
};

export const TOTAL_SCORE = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0); // 100

export const REQUIRED_SCREENSHOTS_PER_PLATFORM = 3;

export const PLATFORMS: ReadonlyArray<"android" | "ios"> = ["android", "ios"];
