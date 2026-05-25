/**
 * Berufs-KI Dokumenten-Agent — Client API.
 * Niemals AI-Calls vom Client — alles via Edge `berufs-ki-document-run`.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DocProfile, DocRunResult, DocTemplate } from "./types";

const TPL_COLS =
  "id,slug,title,description,document_type,category,profession_id,required_inputs,optional_inputs,output_sections,compliance_rules,risk_level,review_required,tier_required,model_recommendation,is_active,version";

export async function listTemplates(): Promise<DocTemplate[]> {
  const { data, error } = await supabase
    .from("document_agent_templates")
    .select(TPL_COLS)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as DocTemplate[];
}

export async function getTemplateBySlug(slug: string): Promise<DocTemplate | null> {
  const { data, error } = await supabase
    .from("document_agent_templates")
    .select(TPL_COLS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as DocTemplate) ?? null;
}

export async function listMyProfiles(): Promise<DocProfile[]> {
  const { data, error } = await supabase
    .from("document_agent_profiles")
    .select("*")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DocProfile[];
}

export interface UpsertProfileInput {
  id?: string;
  company_name: string;
  legal_name?: string;
  address?: string;
  contact_email?: string;
  phone?: string;
  website?: string;
  logo_url?: string;
  default_sender_name?: string;
  default_sender_role?: string;
  default_signature?: string;
  tone_of_voice?: string;
  brand_colors?: Record<string, string>;
  organization_id?: string | null;
}

export async function upsertMyProfile(input: UpsertProfileInput): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) throw new Error("not authenticated");
  const payload = {
    user_id: input.organization_id ? null : uid,
    organization_id: input.organization_id ?? null,
    company_name: input.company_name,
    legal_name: input.legal_name ?? null,
    address: input.address ?? null,
    contact_email: input.contact_email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    logo_url: input.logo_url ?? null,
    default_sender_name: input.default_sender_name ?? null,
    default_sender_role: input.default_sender_role ?? null,
    default_signature: input.default_signature ?? null,
    tone_of_voice: input.tone_of_voice ?? "professionell",
    brand_colors: input.brand_colors ?? {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = supabase.from("document_agent_profiles") as any;
  if (input.id) {
    const { error } = await tbl.update(payload).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await tbl.insert(payload).select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export interface RunDocOptions {
  profile_id?: string | null;
  organization_id?: string | null;
  profession_id?: string | null;
}

export async function runDocument(
  templateSlug: string,
  inputs: Record<string, string>,
  opts: RunDocOptions = {},
): Promise<DocRunResult> {
  const { data, error } = await supabase.functions.invoke("berufs-ki-document-run", {
    body: {
      template_slug: templateSlug,
      inputs,
      profile_id: opts.profile_id ?? null,
      organization_id: opts.organization_id ?? null,
      profession_id: opts.profession_id ?? null,
    },
  });
  if (error) throw new Error((error as { message?: string }).message ?? "Dokumenten-Agent fehlgeschlagen.");
  if ((data as { error?: string })?.error) {
    const e = data as { error: string; reason?: string; missing?: unknown };
    const err = new Error(e.reason ?? e.error) as Error & { code?: string; missing?: unknown };
    err.code = e.error;
    err.missing = e.missing;
    throw err;
  }
  return data as DocRunResult;
}

export async function listMyRuns(limit = 30) {
  const { data, error } = await supabase
    .from("document_agent_runs")
    .select("id,template_id,status,review_required,quality_score,model_used,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ──────── Admin ────────
export async function adminListTemplates() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("admin_doc_agent_list_templates");
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string; slug: string; title: string; document_type: string; category: string;
    risk_level: string; tier_required: string; review_required: boolean;
    is_active: boolean; version: number; runs_total: number; last_run_at: string | null;
    updated_at: string;
  }>;
}

// ──────── Phase 2: Export ────────
export interface ExportResult {
  ok: true;
  export_id: string;
  export_hash: string;
  format: "pdf" | "docx";
  byte_size: number;
  signed_url: string | null;
  storage_path: string;
  filename: string;
}

export async function exportRun(runId: string, format: "pdf" | "docx"): Promise<ExportResult> {
  const { data, error } = await supabase.functions.invoke("berufs-ki-document-export", {
    body: { run_id: runId, format },
  });
  if (error) throw new Error((error as { message?: string }).message ?? "Export fehlgeschlagen.");
  const d = data as { error?: string; message?: string } & ExportResult;
  if (d.error) throw new Error(d.message ?? d.error);
  return d;
}

export async function listMyExports(runId?: string) {
  let q = supabase
    .from("document_agent_exports")
    .select("id,run_id,export_format,export_hash,storage_path,byte_size,review_required,layout_template,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (runId) q = q.eq("run_id", runId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

