-- Evidence Packs Listing RPCs for Admin UI

-- 1) List all evidence packs with optional filters (admin-only)
CREATE OR REPLACE FUNCTION public.list_course_evidence_packs(
  p_course_id uuid DEFAULT NULL,
  p_curriculum_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  course_id uuid,
  curriculum_id uuid,
  generated_at timestamptz,
  generated_by uuid,
  fingerprint_sha256 text,
  export_version text,
  storage_bucket text,
  storage_path text,
  size_bytes bigint,
  notes text,
  has_inline_pack boolean
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    ep.id,
    ep.course_id,
    ep.curriculum_id,
    ep.generated_at,
    ep.generated_by,
    ep.fingerprint_sha256,
    ep.export_version,
    ep.storage_bucket,
    ep.storage_path,
    ep.size_bytes,
    ep.notes,
    (ep.pack IS NOT NULL) AS has_inline_pack
  FROM public.course_evidence_packs ep
  WHERE (p_course_id IS NULL OR ep.course_id = p_course_id)
    AND (p_curriculum_id IS NULL OR ep.curriculum_id = p_curriculum_id)
    AND has_role(auth.uid(), 'admin')
  ORDER BY ep.generated_at DESC
  LIMIT GREATEST(1, p_limit)
  OFFSET GREATEST(0, p_offset);
$$;

-- 2) Get latest pack per course (for quick overview)
CREATE OR REPLACE FUNCTION public.list_latest_evidence_packs(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  course_id uuid,
  course_title text,
  curriculum_id uuid,
  curriculum_title text,
  latest_pack_id uuid,
  generated_at timestamptz,
  fingerprint_sha256 text,
  storage_bucket text,
  storage_path text,
  size_bytes bigint,
  pack_count bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH ranked AS (
    SELECT
      ep.*,
      ROW_NUMBER() OVER (PARTITION BY ep.course_id ORDER BY ep.generated_at DESC) AS rn,
      COUNT(*) OVER (PARTITION BY ep.course_id) AS pack_count
    FROM public.course_evidence_packs ep
    WHERE has_role(auth.uid(), 'admin')
  )
  SELECT
    r.course_id,
    c.title AS course_title,
    r.curriculum_id,
    cu.title AS curriculum_title,
    r.id AS latest_pack_id,
    r.generated_at,
    r.fingerprint_sha256,
    r.storage_bucket,
    r.storage_path,
    r.size_bytes,
    r.pack_count
  FROM ranked r
  LEFT JOIN public.courses c ON c.id = r.course_id
  LEFT JOIN public.curricula cu ON cu.id = r.curriculum_id
  WHERE r.rn = 1
  ORDER BY r.generated_at DESC
  LIMIT GREATEST(1, p_limit);
$$;