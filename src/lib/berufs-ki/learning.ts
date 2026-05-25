/**
 * Berufs-KI Phase 5 — Learning Engine API.
 *
 * Cluster, Blueprint-Kandidaten, Submitter-Notifications, Submitter-Inbox.
 * Niemals autonome Production-Writes — alle Promotions admin-gated.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (supabase.rpc as any);

export interface ClusterRow {
  id: string;
  cluster_signature: string;
  category: string;
  beruf_slug: string | null;
  curriculum_id: string | null;
  submission_count: number;
  merge_confidence: number;
  status: "detected" | "reviewing" | "promoted" | "dismissed";
  output_section_refs: string[];
  common_patterns: { titles?: string[]; goals?: string[] };
  promoted_candidate_id: string | null;
  detected_at: string;
  updated_at: string;
}

export interface BlueprintCandidateRow {
  id: string;
  title: string;
  description: string;
  category: string;
  beruf_slug: string | null;
  curriculum_id: string | null;
  confidence_score: number;
  review_status: "proposed" | "approved" | "rejected" | "materialized";
  source_cluster_id: string | null;
  materialized_definition_id: string | null;
  suggested_output_schema: { sections?: string[] };
  adoption_metrics: Record<string, unknown>;
  quality_metrics: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SubmitterNotification {
  id: string;
  event_type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface MySubmissionRow {
  id: string;
  title: string;
  category: string;
  status: string;
  created_at: string;
  updated_at: string;
  promoted_definition_id: string | null;
}

// ---------- Admin ----------

export async function adminRecomputeClusters(minSize = 3) {
  const { data, error } = await rpc("admin_berufs_ki_recompute_clusters", { _min_size: minSize });
  if (error) throw error;
  return data as { ok: boolean; inserted: number; updated: number; min_size: number };
}

export async function adminListClusters(status?: string, limit = 50): Promise<ClusterRow[]> {
  const { data, error } = await rpc("admin_berufs_ki_list_clusters", {
    _status: status ?? null,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ClusterRow[];
}

export async function adminPromoteClusterToCandidate(
  clusterId: string,
  title: string,
  description: string,
) {
  const { data, error } = await rpc("admin_berufs_ki_promote_cluster_to_blueprint_candidate", {
    _cluster_id: clusterId,
    _title: title,
    _description: description,
  });
  if (error) throw error;
  return data as { ok: boolean; candidate_id: string; notified: number };
}

export async function adminListBlueprintCandidates(
  status?: string,
  limit = 50,
): Promise<BlueprintCandidateRow[]> {
  const { data, error } = await rpc("admin_berufs_ki_list_blueprint_candidates", {
    _status: status ?? null,
    _limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as BlueprintCandidateRow[];
}

export async function adminMaterializeBlueprintCandidate(args: {
  candidateId: string;
  slug: string;
  systemPrompt: string;
  userPromptTemplate: string;
  tier?: "free" | "pro" | "business";
}) {
  const { data, error } = await rpc("admin_berufs_ki_materialize_blueprint_candidate", {
    _candidate_id: args.candidateId,
    _slug: args.slug,
    _system_prompt: args.systemPrompt,
    _user_prompt_template: args.userPromptTemplate,
    _tier: args.tier ?? "pro",
  });
  if (error) throw error;
  return data as { ok: boolean; definition_id: string; slug: string };
}

// ---------- Learner / Submitter ----------

export async function learnerListMyNotifications(limit = 30): Promise<SubmitterNotification[]> {
  const { data, error } = await rpc("learner_berufs_ki_list_my_notifications", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as SubmitterNotification[];
}

export async function learnerMarkNotificationRead(id: string) {
  const { error } = await rpc("learner_berufs_ki_mark_notification_read", { _id: id });
  if (error) throw error;
}

export async function learnerListMySubmissions(limit = 30): Promise<MySubmissionRow[]> {
  const { data, error } = await rpc("learner_berufs_ki_list_my_submissions", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as MySubmissionRow[];
}
