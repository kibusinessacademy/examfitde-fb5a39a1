/**
 * VISUAL.LEARNING.OS — Persistence Pure Helpers (Cut 7).
 *
 * Pure / deterministic. No DB, no HTTP, no Clock, no RNG, no IO.
 * Used by ServerFns to validate candidates and transitions before
 * touching the database.
 */
import type {
  PublishedVisualArtifact,
  VisualLearningArtifact,
} from "./contracts";
import { projectPublishedVisualArtifact } from "./visual-artifact-projection";
import type { VisualArtifactReviewResult } from "./visual-artifact-review";
import {
  isAllowedVloTransition,
  isVloPersistedStatus,
  vloPersistBlocker,
  vloPersistWarning,
  type VloPersistBlocker,
  type VloPersistedStatus,
  type VloPersistWarning,
} from "./persistence-policy";

export interface VisualArtifactPersistenceCandidate {
  artifact: VisualLearningArtifact;
  source_refs: string[];
  /** AI drafts must never be persisted above draft/needs_review. */
  is_ai_draft?: boolean;
}

export interface VisualArtifactPersistenceValidation {
  ok: boolean;
  blockers: VloPersistBlocker[];
  warnings: VloPersistWarning[];
}

export function validateVisualArtifactPersistenceCandidate(
  input: VisualArtifactPersistenceCandidate,
): VisualArtifactPersistenceValidation {
  const blockers: VloPersistBlocker[] = [];
  const warnings: VloPersistWarning[] = [];
  const a = input.artifact;

  if (!a.curriculum_id?.trim()) {
    blockers.push(
      vloPersistBlocker("VLO_PERSIST_MISSING_CURRICULUM_ID", "curriculum_id fehlt."),
    );
  }
  if (!a.competence_id?.trim()) {
    blockers.push(
      vloPersistBlocker("VLO_PERSIST_MISSING_COMPETENCE_ID", "competence_id fehlt."),
    );
  }
  if (!Array.isArray(input.source_refs) || input.source_refs.length === 0) {
    blockers.push(
      vloPersistBlocker(
        "VLO_PERSIST_SOURCE_REFS_MISSING",
        "Mindestens eine source_ref ist Pflicht.",
      ),
    );
  }
  if (!isVloPersistedStatus(a.status)) {
    blockers.push(
      vloPersistBlocker("VLO_PERSIST_INVALID_STATUS", `Status '${a.status}' ist unzulässig.`),
    );
  }

  // AI drafts may only persist as draft or needs_review.
  if (
    input.is_ai_draft &&
    a.status !== "draft" &&
    a.status !== "needs_review"
  ) {
    blockers.push(
      vloPersistBlocker(
        "VLO_PERSIST_UNREVIEWED_AI_DRAFT_FORBIDDEN",
        "AI-Drafts dürfen nur als draft oder needs_review persistiert werden.",
      ),
    );
  }

  if (!a.lesson_id) {
    warnings.push(
      vloPersistWarning("VLO_PERSIST_NO_LESSON_BINDING", "Kein lesson_id gebunden."),
    );
  }
  if (!a.blueprint_id) {
    warnings.push(
      vloPersistWarning("VLO_PERSIST_NO_BLUEPRINT_BINDING", "Kein blueprint_id gebunden."),
    );
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export interface VisualArtifactTransitionContext {
  /** Result of last review — required for needs_review → approved. */
  reviewResult?: VisualArtifactReviewResult;
  /** AI draft flag — disallows direct push to approved/published. */
  is_ai_draft?: boolean;
}

export interface VisualArtifactTransitionEvaluation {
  ok: boolean;
  blockers: VloPersistBlocker[];
  warnings: VloPersistWarning[];
}

export function evaluateVisualArtifactTransition(
  from: VloPersistedStatus,
  to: VloPersistedStatus,
  ctx: VisualArtifactTransitionContext = {},
): VisualArtifactTransitionEvaluation {
  const blockers: VloPersistBlocker[] = [];
  const warnings: VloPersistWarning[] = [];

  if (!isVloPersistedStatus(from) || !isVloPersistedStatus(to)) {
    blockers.push(
      vloPersistBlocker(
        "VLO_PERSIST_INVALID_STATUS",
        `Unbekannter Status: ${from} → ${to}.`,
      ),
    );
    return { ok: false, blockers, warnings };
  }

  if (!isAllowedVloTransition(from, to)) {
    blockers.push(
      vloPersistBlocker(
        "VLO_PERSIST_INVALID_TRANSITION",
        `Übergang ${from} → ${to} ist nicht erlaubt.`,
      ),
    );
  }

  // Direct publish path forbidden.
  if (
    to === "published" &&
    from !== "approved"
  ) {
    blockers.push(
      vloPersistBlocker(
        "VLO_PERSIST_DIRECT_PUBLISH_FORBIDDEN",
        "Publish nur aus status='approved' möglich.",
      ),
    );
  }

  // AI-Drafts dürfen niemals direkt approved/published werden.
  if (
    ctx.is_ai_draft &&
    (to === "approved" || to === "published")
  ) {
    blockers.push(
      vloPersistBlocker(
        "VLO_PERSIST_UNREVIEWED_AI_DRAFT_FORBIDDEN",
        "AI-Draft darf nicht direkt approved/published werden.",
      ),
    );
  }

  // Approval verlangt grünes Review.
  if (to === "approved") {
    const r = ctx.reviewResult;
    if (!r) {
      blockers.push(
        vloPersistBlocker(
          "VLO_PERSIST_REVIEW_REQUIRED",
          "Review-Ergebnis fehlt — Approve nicht möglich.",
        ),
      );
    } else if (r.status !== "approved" || r.blockers.length > 0) {
      blockers.push(
        vloPersistBlocker(
          "VLO_PERSIST_APPROVAL_REQUIRED",
          "Review nicht grün — Approve blockiert.",
        ),
      );
    } else if (r.warnings.length > 0) {
      warnings.push(
        vloPersistWarning(
          "VLO_PERSIST_REVIEW_WARNINGS_PRESENT",
          "Review hat Warnungen — Approve trotzdem möglich.",
        ),
      );
    }
  }

  if (from === "approved" && to !== "published" && to !== "archived") {
    // Defensive (already blocked by ALLOWED) — keep for clarity.
  }

  if (from === "approved" && to === "archived") {
    warnings.push(
      vloPersistWarning(
        "VLO_PERSIST_APPROVED_NOT_PUBLISHED",
        "Approved Artefakt wird archiviert, ohne veröffentlicht zu werden.",
      ),
    );
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export interface PreparedPersistenceRecord {
  curriculum_id: string;
  competence_id: string;
  lesson_id: string | null;
  blueprint_id: string | null;
  artifact_type: string;
  pattern: string;
  status: VloPersistedStatus;
  version: number;
  title: string;
  artifact_json: VisualLearningArtifact;
  review_json: VisualArtifactReviewResult | null;
  source_refs: string[];
}

export function prepareVisualArtifactForPersistence(
  artifact: VisualLearningArtifact,
  reviewResult: VisualArtifactReviewResult | null,
  source_refs: string[],
): PreparedPersistenceRecord {
  // Deterministic mapping. Pattern derived from artifact_type when not stored separately.
  return {
    curriculum_id: artifact.curriculum_id,
    competence_id: artifact.competence_id,
    lesson_id: artifact.lesson_id ?? null,
    blueprint_id: artifact.blueprint_id ?? null,
    artifact_type: artifact.artifact_type,
    pattern: artifact.artifact_type,
    status: artifact.status as VloPersistedStatus,
    version: artifact.version,
    title: artifact.title,
    artifact_json: artifact,
    review_json: reviewResult,
    source_refs: [...source_refs],
  };
}

export type PreparePublishedVisualProjectionResult =
  | { ok: true; artifact: PublishedVisualArtifact }
  | { ok: false; reason: "not_published" };

export function preparePublishedVisualProjection(
  artifact: VisualLearningArtifact,
): PreparePublishedVisualProjectionResult {
  if (artifact.status !== "published") {
    return { ok: false, reason: "not_published" };
  }
  const projected = projectPublishedVisualArtifact(artifact);
  if (!projected.ok) return { ok: false, reason: "not_published" };
  return { ok: true, artifact: projected.artifact };
}
