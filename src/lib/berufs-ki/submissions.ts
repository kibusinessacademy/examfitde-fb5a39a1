/**
 * Berufs-KI Phase 4 — Community Submissions API.
 */
import { supabase } from "@/integrations/supabase/client";
import type { WorkflowCategory } from "./types";

export type SubmissionStatus =
  | "draft"
  | "pending_precheck"
  | "pending_review"
  | "needs_changes"
  | "approved"
  | "approved_with_edits"
  | "merged"
  | "rejected"
  | "deprecated";

export interface SubmissionInput {
  title: string;
  goal: string;
  beruf_slug?: string | null;
  category: WorkflowCategory;
  curriculum_id?: string | null;
  proposed_inputs: { fields: Array<{ key: string; label: string; type: "text" | "textarea" | "select" }> };
  proposed_outputs: { sections: string[] };
  workflow_steps: string;
  risks?: string;
  proposed_competencies?: string[];
}

export interface Submission extends SubmissionInput {
  id: string;
  status: SubmissionStatus;
  precheck: Record<string, unknown> | null;
  duplicate_score: number | null;
  governance_score: number | null;
  quality_score: number | null;
  reviewer_notes: string | null;
  promoted_definition_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function createSubmission(input: SubmissionInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("not_authenticated");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = supabase.from("berufs_ki_workflow_submissions") as any;
  const { data, error } = await tbl
    .insert({ ...input, submitted_by: u.user.id, status: "pending_precheck" })
    .select("id")
    .single();
  if (error) throw error;
  // fire & forget precheck
  void supabase.functions.invoke("berufs-ki-precheck", { body: { submission_id: data.id } });
  return data.id;
}

export async function listMySubmissions(): Promise<Submission[]> {
  const { data, error } = await supabase
    .from("berufs_ki_workflow_submissions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Submission[];
}

export interface AdminSubmissionRow {
  id: string;
  title: string;
  goal: string;
  beruf_slug: string | null;
  category: WorkflowCategory;
  status: SubmissionStatus;
  duplicate_score: number | null;
  governance_score: number | null;
  quality_score: number | null;
  submitted_by: string;
  submitter_email: string | null;
  merge_candidate_count: number;
  created_at: string;
  updated_at: string;
}

export async function adminListSubmissions(status?: SubmissionStatus): Promise<AdminSubmissionRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("admin_berufs_ki_list_submissions", {
    p_status: status ?? null,
  });
  if (error) throw error;
  return (data ?? []) as AdminSubmissionRow[];
}

export async function adminReviewSubmission(
  submissionId: string,
  action: "request_changes" | "reject" | "merge" | "deprecate",
  notes?: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("admin_berufs_ki_review_submission", {
    p_submission_id: submissionId,
    p_action: action,
    p_notes: notes ?? null,
  });
  if (error) throw error;
}

export async function adminApproveSubmission(args: {
  submissionId: string;
  slug: string;
  systemPrompt: string;
  userPromptTemplate: string;
  tier?: "free" | "pro" | "business";
  withEdits?: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("admin_berufs_ki_approve_submission", {
    p_submission_id: args.submissionId,
    p_slug: args.slug,
    p_system_prompt: args.systemPrompt,
    p_user_prompt_template: args.userPromptTemplate,
    p_tier: args.tier ?? "free",
    p_with_edits: args.withEdits ?? false,
  });
  if (error) throw error;
  return data as string;
}

export async function adminCommunityIntelligence(windowDays = 30) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("admin_berufs_ki_community_intelligence", {
    p_window_days: windowDays,
  });
  if (error) throw error;
  return data as {
    submissions_total: number;
    pending_review: number;
    needs_changes: number;
    approved: number;
    rejected: number;
    top_categories: Array<{ category: string; count: number }>;
    top_berufe: Array<{ beruf_slug: string; count: number }>;
    avg_quality: number | null;
  };
}

export async function adminGetSubmission(id: string): Promise<Submission> {
  const { data, error } = await supabase
    .from("berufs_ki_workflow_submissions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as Submission;
}
