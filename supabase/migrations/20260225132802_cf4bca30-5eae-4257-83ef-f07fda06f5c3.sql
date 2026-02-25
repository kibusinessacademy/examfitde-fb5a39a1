
-- Harden RPC: filter out malformed package_ids
CREATE OR REPLACE FUNCTION public.heavy_processing_per_package(
  p_heavy_types text[]
)
RETURNS TABLE(package_id text, processing_count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jq.payload->>'package_id' AS package_id,
    count(*)::int AS processing_count
  FROM job_queue jq
  WHERE jq.status = 'processing'
    AND jq.job_type = ANY(p_heavy_types)
    AND jq.payload->>'package_id' IS NOT NULL
    AND jq.payload->>'package_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY 1;
$$;

-- Also fix search_path on the other RPC
CREATE OR REPLACE FUNCTION public.count_questions_by_lf(
  p_curriculum_id uuid,
  p_lf_ids uuid[]
)
RETURNS TABLE(learning_field_id uuid, q_count int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT eq.learning_field_id, count(*)::int AS q_count
  FROM exam_questions eq
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.learning_field_id = ANY(p_lf_ids)
  GROUP BY eq.learning_field_id;
$$;
