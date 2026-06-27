/**
 * REVIEW.READY.GATE.OS.1 — State labels (UI helper, still pure)
 */
import type { ReviewState } from "./contracts";

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  draft: "Entwurf",
  missing_assets: "Assets fehlen",
  building: "Build offen",
  build_failed: "Build fehlgeschlagen",
  qa_required: "QA erforderlich",
  review_ready: "Review Ready",
  blocked: "Blockiert",
  released: "Released",
};

export const REVIEW_STATE_TONE: Record<ReviewState, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  missing_assets: "secondary",
  building: "secondary",
  build_failed: "destructive",
  qa_required: "secondary",
  review_ready: "default",
  blocked: "destructive",
  released: "default",
};
