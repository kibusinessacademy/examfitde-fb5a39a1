/**
 * Berufs-KI SSOT — Client API.
 *
 * Niemals AI-Calls aus dem Client — alles über Edge `berufs-ki-run`.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  AdminWorkflowSummary,
  WorkflowCategory,
  WorkflowDefinition,
  WorkflowRunResult,
} from "./types";

const SELECT_COLS =
  "id,slug,title,description,category,subcategory,curriculum_id,learning_field_id,competency_id,blueprint_id,competency_ids,target_roles,tier_required,input_schema,output_schema,model_recommendation,compliance_level,risk_level,is_active,version,workflow_class";

export interface ListFilter {
  category?: WorkflowCategory;
  curriculumId?: string | null;
}

export async function listWorkflows(filter: ListFilter = {}): Promise<WorkflowDefinition[]> {
  let q = supabase
    .from("berufs_ki_workflow_definitions")
    .select(SELECT_COLS)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("title", { ascending: true });

  if (filter.category) q = q.eq("category", filter.category);
  if (filter.curriculumId !== undefined) {
    q = filter.curriculumId === null ? q.is("curriculum_id", null) : q.eq("curriculum_id", filter.curriculumId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as WorkflowDefinition[];
}

export async function getWorkflowBySlug(slug: string): Promise<WorkflowDefinition | null> {
  const { data, error } = await supabase
    .from("berufs_ki_workflow_definitions")
    .select(SELECT_COLS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as WorkflowDefinition) ?? null;
}

export interface RunWorkflowOptions {
  beruf_slug?: string | null;
  source_run_id?: string | null;
  follow_up_of?: string | null;
}

export async function runWorkflow(
  slug: string,
  inputs: Record<string, unknown>,
  opts: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const { data, error } = await supabase.functions.invoke("berufs-ki-run", {
    body: {
      slug,
      inputs,
      beruf_slug: opts.beruf_slug ?? null,
      source_run_id: opts.source_run_id ?? null,
      follow_up_of: opts.follow_up_of ?? null,
    },
  });
  if (error) {
    const msg = (error as { message?: string }).message ?? "Berufs-KI Lauf fehlgeschlagen.";
    throw new Error(msg);
  }
  if ((data as { error?: string })?.error) {
    const e = data as { error: string; message?: string; reason?: string };
    const err = new Error(e.message ?? e.error);
    (err as Error & { code?: string; reason?: string }).code = e.error;
    (err as Error & { code?: string; reason?: string }).reason = e.reason;
    throw err;
  }
  return data as WorkflowRunResult;
}

export async function recordRunFeedback(
  runId: string,
  rating: -1 | 0 | 1,
  feedback?: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("berufs_ki_record_feedback", {
    p_run_id: runId,
    p_rating: rating,
    p_feedback: feedback ?? null,
  });
  if (error) throw error;
}

export async function adminGetQualityDashboard(windowHours = 168) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("admin_berufs_ki_quality_dashboard", {
    p_window_hours: windowHours,
  });
  if (error) throw error;
  return (data ?? []) as import("./types").AdminQualityRow[];
}

// =================== Admin =====================

export async function adminListWorkflows(): Promise<AdminWorkflowSummary[]> {
  const { data, error } = await supabase.rpc("admin_berufs_ki_list_workflows");
  if (error) throw error;
  return (data ?? []) as unknown as AdminWorkflowSummary[];
}

export interface AdminWorkflowUpsert {
  id?: string;
  slug: string;
  title: string;
  description: string;
  category: WorkflowCategory;
  subcategory?: string | null;
  curriculum_id?: string | null;
  learning_field_id?: string | null;
  competency_id?: string | null;
  blueprint_id?: string | null;
  target_roles?: string[];
  tier_required: "free" | "pro" | "business";
  risk_level?: "low" | "medium" | "high";
  compliance_level?: "standard" | "sensitive" | "regulated";
  model_recommendation?: string;
  system_prompt: string;
  user_prompt_template: string;
  input_schema: { fields: Array<Record<string, unknown>> };
  output_schema?: { sections: string[] };
  is_active?: boolean;
}

export async function adminUpsertWorkflow(payload: AdminWorkflowUpsert) {
  const { id, ...rest } = payload;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = supabase.from("berufs_ki_workflow_definitions") as any;
  if (id) {
    const { error } = await tbl.update(rest).eq("id", id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await tbl.insert(rest).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function adminToggleWorkflow(id: string, is_active: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = supabase.from("berufs_ki_workflow_definitions") as any;
  const { error } = await tbl.update({ is_active }).eq("id", id);
  if (error) throw error;
}


export async function adminGetWorkflowFull(id: string) {
  const { data, error } = await supabase
    .from("berufs_ki_workflow_definitions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}
