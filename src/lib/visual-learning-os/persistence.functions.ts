/**
 * VISUAL.LEARNING.OS — ServerFn Client Wrapper (Cut 7).
 *
 * Admin-only client wrapper around the `visual-learning-artifacts` edge
 * function. NEVER reads/writes the visual_learning_artifacts table from
 * the browser directly — every call goes through the edge function which
 * enforces has_role(uid, 'admin').
 */
import { supabase } from "@/integrations/supabase/client";
import type { PreparedPersistenceRecord } from "@/lib/visual-learning-os/persistence";
import type { VisualArtifactReviewResult } from "@/lib/visual-learning-os/visual-artifact-review";

const FN = "visual-learning-artifacts";

async function invoke<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, {
    body: { action, ...body },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export interface AdminArtifactRow {
  id: string;
  curriculum_id: string;
  competence_id: string;
  lesson_id: string | null;
  blueprint_id: string | null;
  artifact_type: string;
  status: "draft" | "needs_review" | "approved" | "published" | "archived";
  version: number;
  title: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface AdminArtifactDetail extends AdminArtifactRow {
  pattern: string;
  artifact_json: any;
  review_json: any | null;
  source_refs: string[];
  reviewed_at: string | null;
  archived_at: string | null;
}

export interface AdminArtifactEvent {
  id: string;
  artifact_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  event_json: Record<string, unknown>;
  created_at: string;
}

export interface AdminListFilters {
  status?: AdminArtifactRow["status"];
  curriculum_id?: string;
  competence_id?: string;
  lesson_id?: string;
  blueprint_id?: string;
  limit?: number;
}

export function listVisualLearningArtifactsForAdmin(filters: AdminListFilters = {}) {
  return invoke<{ artifacts: AdminArtifactRow[] }>("list", filters as any);
}

export function getVisualLearningArtifactForAdmin(id: string) {
  return invoke<{ artifact: AdminArtifactDetail; events: AdminArtifactEvent[] }>("get", { id });
}

export function createVisualLearningArtifactDraft(
  record: PreparedPersistenceRecord,
  options: { is_ai_draft?: boolean } = {},
) {
  return invoke<{ artifact: AdminArtifactDetail }>("createDraft", {
    record,
    is_ai_draft: options.is_ai_draft ?? false,
  });
}

export function submitVisualLearningArtifactForReview(id: string) {
  return invoke<{ artifact: AdminArtifactDetail }>("submitForReview", { id });
}

export function approveVisualLearningArtifact(
  id: string,
  review_json: VisualArtifactReviewResult,
) {
  return invoke<{ artifact: AdminArtifactDetail }>("approve", { id, review_json });
}

export function publishVisualLearningArtifact(id: string) {
  return invoke<{ artifact: AdminArtifactDetail }>("publish", { id });
}

export function archiveVisualLearningArtifact(id: string) {
  return invoke<{ artifact: AdminArtifactDetail }>("archive", { id });
}

export interface LearnerLessonContext {
  curriculum_id: string;
  competence_id: string;
  lesson_id?: string;
}

export function listPublishedVisualArtifactsForLesson(ctx: LearnerLessonContext) {
  return invoke<{ artifacts: any[] }>("listPublishedForLesson", ctx as any);
}
