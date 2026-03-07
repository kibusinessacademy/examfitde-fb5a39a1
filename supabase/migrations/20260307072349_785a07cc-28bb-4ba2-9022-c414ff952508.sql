
-- Drop old RPC and replace with tier-aware version
DROP FUNCTION IF EXISTS public.reprioritize_queued_exam_first(integer, integer);

CREATE OR REPLACE FUNCTION public.reprioritize_queued_market_tier(
  p_batch_size integer DEFAULT 20,
  p_new_priority integer DEFAULT 8
)
RETURNS TABLE(package_id uuid, old_priority integer, applied_priority integer, beruf_tier integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      cp.id,
      cp.priority AS old_prio,
      COALESCE(vbp.tier, 4) AS b_tier
    FROM public.course_packages cp
    LEFT JOIN public.courses c ON c.id = cp.course_id
    LEFT JOIN public.curricula cu ON cu.id = c.curriculum_id
    LEFT JOIN public.v_beruf_priority vbp ON vbp.beruf_id = cu.beruf_id
    WHERE cp.status = 'queued'
      AND cp.priority > 10
    ORDER BY COALESCE(vbp.tier, 4) ASC, cp.created_at ASC
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE public.course_packages cp
    SET priority = p_new_priority,
        updated_at = now()
    FROM ranked r
    WHERE cp.id = r.id
    RETURNING cp.id, r.old_prio, cp.priority, r.b_tier
  )
  SELECT u.id AS package_id, u.old_prio AS old_priority, u.priority AS applied_priority, u.b_tier AS beruf_tier
  FROM updated u;
END;
$$;
