import { supabase } from "@/integrations/supabase/client";

export type EvidencePackRow = {
  id: string;
  course_id: string;
  curriculum_id: string;
  generated_at: string;
  generated_by: string | null;
  fingerprint_sha256: string;
  export_version: string;
  storage_bucket: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  notes: string | null;
  has_inline_pack: boolean;
};

export type LatestPackRow = {
  course_id: string;
  course_title: string | null;
  curriculum_id: string;
  curriculum_title: string | null;
  latest_pack_id: string;
  generated_at: string;
  fingerprint_sha256: string;
  storage_bucket: string | null;
  storage_path: string | null;
  size_bytes: number | null;
  pack_count: number;
};

export async function listEvidencePacks(params: {
  courseId?: string;
  curriculumId?: string;
  limit?: number;
  offset?: number;
}): Promise<EvidencePackRow[]> {
  const { courseId, curriculumId, limit = 50, offset = 0 } = params;

  const { data, error } = await supabase.rpc("list_course_evidence_packs", {
    p_course_id: courseId ?? null,
    p_curriculum_id: curriculumId ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return (data ?? []) as EvidencePackRow[];
}

export async function listLatestEvidencePacks(limit = 50): Promise<LatestPackRow[]> {
  const { data, error } = await supabase.rpc("list_latest_evidence_packs", {
    p_limit: limit,
  });

  if (error) throw error;
  return (data ?? []) as LatestPackRow[];
}

export async function getSignedUrlForPack(packId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("get-evidence-pack-url", {
    body: { packId },
  });

  if (error) throw error;
  if (!data?.signed_url) {
    // Check if it's inline pack
    if (data?.has_inline_pack) {
      throw new Error("Pack is stored inline. Use RPC get_evidence_pack instead.");
    }
    throw new Error("No signed_url returned");
  }
  return data.signed_url as string;
}

export async function getInlinePack(packId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc("get_evidence_pack", {
    p_pack_id: packId,
  });

  if (error) throw error;
  return data;
}

export async function generateEvidencePack(
  courseId: string,
  options?: { includeQuestions?: boolean; includeH5p?: boolean }
): Promise<{
  ok: boolean;
  pack_id: string;
  fingerprint_sha256: string;
  signed_url?: string;
}> {
  const { data, error } = await supabase.functions.invoke("generate-evidence-pack", {
    body: {
      courseId,
      includeQuestions: options?.includeQuestions ?? false,
      includeH5p: options?.includeH5p ?? true,
    },
  });

  if (error) throw error;
  return data;
}
