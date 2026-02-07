-- Storage-first Evidence Packs Enhancement
-- ==========================================

-- 1) Add size_bytes column if not exists
ALTER TABLE public.course_evidence_packs 
ADD COLUMN IF NOT EXISTS size_bytes bigint NULL;

-- 2) Create evidence-packs storage bucket (private, admin-only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-packs', 'evidence-packs', false)
ON CONFLICT (id) DO NOTHING;

-- 3) Storage policy: Only service role can write (via edge function)
-- Admin can read via signed URLs from edge function

-- 4) Registry function for edge function to call
CREATE OR REPLACE FUNCTION public.register_course_evidence_pack(
  p_course_id uuid,
  p_fingerprint_sha256 text,
  p_export_version text,
  p_storage_bucket text,
  p_storage_path text,
  p_size_bytes bigint DEFAULT NULL
)
RETURNS public.course_evidence_packs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_row public.course_evidence_packs;
  v_existing_id uuid;
BEGIN
  -- Auth guard
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden (admin only)';
  END IF;

  -- Get curriculum_id from course
  SELECT curriculum_id INTO v_curriculum_id
  FROM public.courses
  WHERE id = p_course_id;

  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'Course % has no curriculum_id (SSOT violation)', p_course_id;
  END IF;

  -- Check if fingerprint already exists (idempotent)
  SELECT id INTO v_existing_id
  FROM public.course_evidence_packs
  WHERE fingerprint_sha256 = p_fingerprint_sha256;

  IF v_existing_id IS NOT NULL THEN
    -- Return existing row
    SELECT * INTO v_row
    FROM public.course_evidence_packs
    WHERE id = v_existing_id;
    RETURN v_row;
  END IF;

  -- Insert new registry entry (storage-first: no inline pack)
  INSERT INTO public.course_evidence_packs (
    course_id, 
    curriculum_id, 
    generated_by,
    fingerprint_sha256, 
    export_version,
    storage_bucket, 
    storage_path, 
    size_bytes,
    pack -- NULL for storage-first
  )
  VALUES (
    p_course_id, 
    v_curriculum_id, 
    auth.uid(),
    p_fingerprint_sha256, 
    COALESCE(p_export_version, '1.0'),
    p_storage_bucket, 
    p_storage_path, 
    p_size_bytes,
    NULL
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 5) Function to get signed URL for stored pack (calls from frontend via edge function)
CREATE OR REPLACE FUNCTION public.get_evidence_pack_storage_info(p_pack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.course_evidence_packs;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden (admin only)';
  END IF;

  SELECT * INTO v_row
  FROM public.course_evidence_packs
  WHERE id = p_pack_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Evidence pack % not found', p_pack_id;
  END IF;

  RETURN jsonb_build_object(
    'pack_id', v_row.id,
    'course_id', v_row.course_id,
    'curriculum_id', v_row.curriculum_id,
    'generated_at', v_row.generated_at,
    'fingerprint', v_row.fingerprint_sha256,
    'export_version', v_row.export_version,
    'storage_bucket', v_row.storage_bucket,
    'storage_path', v_row.storage_path,
    'size_bytes', v_row.size_bytes,
    'is_immutable', v_row.is_immutable,
    'has_inline_pack', (v_row.pack IS NOT NULL)
  );
END;
$$;