/**
 * Berufs-KI SSOT — Client API.
 *
 * Niemals AI-Calls aus dem Client — alles über Edge `berufs-ki-run`.
 */
import { supabase } from "@/integrations/supabase/client";
import type { WorkflowCategory, WorkflowDefinition, WorkflowRunResult } from "./types";

export interface ListFilter {
  category?: WorkflowCategory;
  curriculumId?: string | null;
}

export async function listWorkflows(filter: ListFilter = {}): Promise<WorkflowDefinition[]> {
  let q = supabase
    .from("berufs_ki_workflow_definitions")
    .select(
      "id,slug,title,description,category,subcategory,curriculum_id,learning_field_id,competency_ids,target_roles,tier_required,input_schema,output_schema,model_recommendation,compliance_level,risk_level,is_active,version",
    )
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
    .select(
      "id,slug,title,description,category,subcategory,curriculum_id,learning_field_id,competency_ids,target_roles,tier_required,input_schema,output_schema,model_recommendation,compliance_level,risk_level,is_active,version",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as WorkflowDefinition) ?? null;
}

export async function runWorkflow(
  slug: string,
  inputs: Record<string, unknown>,
  beruf_slug?: string | null,
): Promise<WorkflowRunResult> {
  const { data, error } = await supabase.functions.invoke("berufs-ki-run", {
    body: { slug, inputs, beruf_slug: beruf_slug ?? null },
  });
  if (error) {
    // FunctionsHttpError carries body in context — surface message.
    const msg = (error as { message?: string }).message ?? "Berufs-KI Lauf fehlgeschlagen.";
    throw new Error(msg);
  }
  if ((data as { error?: string })?.error) {
    const e = data as { error: string; message?: string };
    throw new Error(e.message ?? e.error);
  }
  return data as WorkflowRunResult;
}
