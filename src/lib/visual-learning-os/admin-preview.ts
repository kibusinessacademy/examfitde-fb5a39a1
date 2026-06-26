/**
 * VISUAL.LEARNING.OS — Admin Preview Helper (Cut 3).
 *
 * Erlaubt es, ein VisualLearningArtifact (auch im Status `draft`/`review`)
 * für eine Admin-only Review-UI zu projizieren. Markiert das Ergebnis klar
 * als nicht publishable — die Frontend-sichere Published-Projektion läuft
 * weiterhin ausschließlich über `projectPublishedVisualArtifact()`.
 *
 * Pure: kein DB/HTTP/Clock/RNG/IO.
 */
import type { VisualLearningArtifact } from "./contracts";

export interface AdminPreviewArtifact {
  preview_mode: "admin_review_only";
  publishable: false;
  artifact: VisualLearningArtifact;
}

export type AdminPreviewResult =
  | { ok: true; preview: AdminPreviewArtifact }
  | { ok: false; reason: "missing_artifact" };

/**
 * Erzeugt eine Admin-Preview-Verpackung. Akzeptiert alle Lifecycle-Stati,
 * ist aber explizit `publishable: false`. Für Lernenden-Frontend NICHT geeignet.
 */
export function createAdminPreviewArtifact(
  artifact: VisualLearningArtifact | null | undefined,
): AdminPreviewResult {
  if (!artifact) return { ok: false, reason: "missing_artifact" };
  return {
    ok: true,
    preview: {
      preview_mode: "admin_review_only",
      publishable: false,
      artifact,
    },
  };
}

export function isAdminPreviewArtifact(
  value: unknown,
): value is AdminPreviewArtifact {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AdminPreviewArtifact>;
  return v.preview_mode === "admin_review_only" && v.publishable === false;
}
