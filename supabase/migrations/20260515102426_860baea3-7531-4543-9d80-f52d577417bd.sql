
-- 1) Job-Type Registrierung (Canonical Identity Contract Pflicht)
INSERT INTO public.ops_job_type_registry (job_type, lane, requires_package_id, is_governance, job_name)
VALUES ('seo_pillar_page_generate', 'control', false, false, 'seo_pillar_page_generate')
ON CONFLICT (job_type) DO NOTHING;

-- 2) Public Lookup-RPC: liefert nur veröffentlichte Pillar mit Score >= 80
CREATE OR REPLACE FUNCTION public.get_published_pillar_page(p_curriculum_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT scp.id,
         scp.curriculum_id,
         scp.title,
         scp.meta_description,
         scp.slug,
         scp.sections_json,
         scp.faq_json,
         scp.quality_score,
         scp.last_generated_at,
         scp.generation_model,
         scp.status,
         scp.page_type
    INTO v_row
  FROM public.seo_content_pages scp
  WHERE scp.page_type = 'pillar_page'
    AND scp.status = 'published'
    AND scp.quality_score >= 80
    AND scp.slug = lower(p_curriculum_slug)
  ORDER BY scp.last_generated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_published_pillar_page(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_pillar_page(text) TO anon, authenticated, service_role;

-- 3) Admin-RPC: Pillar-Kandidaten (published Curricula mit >=3 published Intent-Spokes)
CREATE OR REPLACE FUNCTION public.admin_get_pillar_candidates()
RETURNS TABLE (
  curriculum_id uuid,
  curriculum_title text,
  package_key text,
  spoke_count bigint,
  has_pillar boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;

  RETURN QUERY
  WITH spokes AS (
    SELECT scp.curriculum_id, COUNT(*)::bigint AS cnt
    FROM public.seo_content_pages scp
    WHERE scp.page_type = 'intent_page'
      AND scp.status = 'published'
      AND scp.quality_score >= 80
    GROUP BY scp.curriculum_id
  ),
  pillars AS (
    SELECT DISTINCT scp.curriculum_id
    FROM public.seo_content_pages scp
    WHERE scp.page_type = 'pillar_page'
      AND scp.status = 'published'
  )
  SELECT
    c.id,
    c.title,
    cp.package_key,
    s.cnt,
    (p.curriculum_id IS NOT NULL) AS has_pillar
  FROM spokes s
  JOIN public.curricula c ON c.id = s.curriculum_id
  LEFT JOIN public.course_packages cp ON cp.curriculum_id = c.id AND cp.status = 'published'
  LEFT JOIN pillars p ON p.curriculum_id = s.curriculum_id
  WHERE s.cnt >= 3
  ORDER BY s.cnt DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_pillar_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pillar_candidates() TO service_role;

-- 4) Pflicht-Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'pillar_foundation_v1_migrated',
  'system',
  'ok',
  jsonb_build_object(
    'migration', 'pillar_foundation_v1',
    'job_type_registered', 'seo_pillar_page_generate',
    'rpcs_created', jsonb_build_array('get_published_pillar_page', 'admin_get_pillar_candidates'),
    'rollback_hint', 'DROP FUNCTION admin_get_pillar_candidates(); DROP FUNCTION get_published_pillar_page(text); DELETE FROM ops_job_type_registry WHERE job_type=''seo_pillar_page_generate'';'
  )
);
