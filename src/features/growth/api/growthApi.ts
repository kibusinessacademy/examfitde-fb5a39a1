import { supabase } from "@/integrations/supabase/client";

export type GrowthContentJob = {
  id: string;
  package_id: string | null;
  curriculum_id: string | null;
  content_type: string;
  audience: string;
  platform: string;
  status: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SEOContentPage = {
  id: string;
  package_id: string | null;
  curriculum_id: string | null;
  page_type: string;
  target_audience: string | null;
  slug: string;
  title: string;
  meta_description: string | null;
  content_md: string | null;
  faq_json: Array<{ q: string; a: string }> | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function getGrowthContentJobs(status?: string) {
  const { data, error } = await supabase.rpc("get_admin_growth_content_jobs", {
    p_status: status ?? undefined as any,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as GrowthContentJob[];
}

export async function getSEOPages(status?: string) {
  const { data, error } = await supabase.rpc("get_admin_seo_pages", {
    p_status: status ?? undefined as any,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as SEOContentPage[];
}

export async function enqueueGrowthJobs(packageId: string, curriculumId: string) {
  const { data, error } = await supabase.rpc("enqueue_growth_content_jobs", {
    p_package_id: packageId,
    p_curriculum_id: curriculumId,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function seedSEOPages(packageId: string, curriculumId: string, baseSlug: string) {
  const { data, error } = await supabase.rpc("seed_seo_pages_for_package", {
    p_package_id: packageId,
    p_curriculum_id: curriculumId,
    p_base_slug: baseSlug,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function triggerGenerateGrowthContent(jobId?: string) {
  const { data, error } = await supabase.functions.invoke("generate-growth-content", {
    body: jobId ? { job_id: jobId } : {},
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function triggerGenerateSEOPage(pageId?: string) {
  const { data, error } = await supabase.functions.invoke("generate-seo-page", {
    body: pageId ? { page_id: pageId } : {},
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function captureLead(params: {
  email: string;
  curriculumId?: string;
  source: string;
  intent: string;
}) {
  const { data, error } = await supabase.functions.invoke("capture-lead", {
    body: {
      email: params.email,
      curriculum_id: params.curriculumId ?? null,
      source: params.source,
      intent: params.intent,
    },
  });
  if (error) throw new Error(error.message);
  return data;
}
