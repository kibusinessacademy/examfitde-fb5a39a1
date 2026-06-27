/**
 * VISUAL.LEARNING.OS — Persistence & Approval Policy (Cut 7).
 *
 * Frozen Forbidden Behaviors für DB-Persistenz und Lifecycle. Pure SSOT.
 * Keine DB-/HTTP-/IO-Logik. Wird sowohl von Pure-Helpers als auch von
 * ServerFns referenziert.
 */

export const VLO_PERSISTED_STATUS = [
  "draft",
  "needs_review",
  "approved",
  "published",
  "archived",
] as const;
export type VloPersistedStatus = (typeof VLO_PERSISTED_STATUS)[number];

export const VLO_PERSIST_BLOCKER_CODES = [
  "VLO_PERSIST_MISSING_CURRICULUM_ID",
  "VLO_PERSIST_MISSING_COMPETENCE_ID",
  "VLO_PERSIST_INVALID_STATUS",
  "VLO_PERSIST_INVALID_TRANSITION",
  "VLO_PERSIST_REVIEW_REQUIRED",
  "VLO_PERSIST_APPROVAL_REQUIRED",
  "VLO_PERSIST_DIRECT_PUBLISH_FORBIDDEN",
  "VLO_PERSIST_LEARNER_DRAFT_READ_FORBIDDEN",
  "VLO_PERSIST_CLIENT_TABLE_READ_FORBIDDEN",
  "VLO_PERSIST_UNREVIEWED_AI_DRAFT_FORBIDDEN",
  "VLO_PERSIST_SOURCE_REFS_MISSING",
  "VLO_PERSIST_AUDIT_EVENT_REQUIRED",
] as const;
export type VloPersistBlockerCode = (typeof VLO_PERSIST_BLOCKER_CODES)[number];

export const VLO_PERSIST_WARNING_CODES = [
  "VLO_PERSIST_APPROVED_NOT_PUBLISHED",
  "VLO_PERSIST_NO_LESSON_BINDING",
  "VLO_PERSIST_NO_BLUEPRINT_BINDING",
  "VLO_PERSIST_REVIEW_WARNINGS_PRESENT",
  "VLO_PERSIST_OLDER_VERSION_EXISTS",
] as const;
export type VloPersistWarningCode = (typeof VLO_PERSIST_WARNING_CODES)[number];

export interface VloPersistBlocker {
  code: VloPersistBlockerCode;
  detail: string;
}
export interface VloPersistWarning {
  code: VloPersistWarningCode;
  detail: string;
}

/** Allowed FSM transitions — explicit, finite. */
const ALLOWED: Record<VloPersistedStatus, VloPersistedStatus[]> = {
  draft: ["needs_review", "archived"],
  needs_review: ["draft", "approved", "archived"],
  approved: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

export const FROZEN_VLO_PERSISTENCE_POLICY = Object.freeze({
  status: VLO_PERSISTED_STATUS,
  transitions: Object.freeze(
    Object.fromEntries(
      Object.entries(ALLOWED).map(([k, v]) => [k, Object.freeze([...v])]),
    ),
  ) as Readonly<Record<VloPersistedStatus, readonly VloPersistedStatus[]>>,
  forbidden_behaviors: Object.freeze([
    "Direct write to visual_learning_artifacts from client.",
    "Auto-publish without explicit admin action.",
    "Auto-approve without successful review gate.",
    "Learner read of draft/needs_review/approved.",
    "Persist AI draft as approved or published.",
    "Persist artifact without curriculum_id and competence_id.",
    "Persist artifact without source_refs.",
    "Status transition outside the FSM.",
    "Status transition without audit event.",
    "Service-role keys in client bundles.",
  ]),
});

export function isVloPersistedStatus(s: string): s is VloPersistedStatus {
  return (VLO_PERSISTED_STATUS as readonly string[]).includes(s);
}

export function isAllowedVloTransition(
  from: VloPersistedStatus,
  to: VloPersistedStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function vloPersistBlocker(
  code: VloPersistBlockerCode,
  detail: string,
): VloPersistBlocker {
  return { code, detail };
}

export function vloPersistWarning(
  code: VloPersistWarningCode,
  detail: string,
): VloPersistWarning {
  return { code, detail };
}
