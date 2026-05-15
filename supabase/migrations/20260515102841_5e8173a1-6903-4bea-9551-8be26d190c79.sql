DROP FUNCTION IF EXISTS public.admin_get_pillar_candidates();

CREATE OR REPLACE FUNCTION public.get_published_pillar_page(p_curriculum_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text := public.fn_normalize_curriculum_slug(p_curriculum_slug);
  v_row record;
BEGIN
  SELECT scp.id, scp.curriculum_id, scp.title, scp.meta_description, scp.slug,
         scp.sections_json, scp.faq_json, scp.quality_score, scp.last_generated_at,
         scp.generation_model, scp.status, scp.page_type,
         c.title AS curriculum_title,
         public.fn_normalize_curriculum_slug(c.title) AS curriculum_slug
    INTO v_row
  FROM public.seo_content_pages scp
  JOIN public.curricula c ON c.id = scp.curriculum_id
  WHERE scp.page_type = 'pillar_page'
    AND scp.status = 'published'
    AND scp.quality_score >= 80
    AND (scp.slug = v_norm OR public.fn_normalize_curriculum_slug(c.title) = v_norm)
  ORDER BY scp.last_generated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(v_row);
END;
$function$;

CREATE FUNCTION public.admin_get_pillar_candidates()
RETURNS TABLE(
  curriculum_id uuid,
  curriculum_title text,
  curriculum_slug text,
  package_id uuid,
  package_key text,
  spoke_count bigint,
  has_pillar boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    WHERE scp.page_type = 'pillar_page' AND scp.status = 'published'
  )
  SELECT c.id, c.title,
         public.fn_normalize_curriculum_slug(c.title),
         cp.id, cp.package_key, s.cnt,
         (p.curriculum_id IS NOT NULL)
  FROM spokes s
  JOIN public.curricula c ON c.id = s.curriculum_id
  LEFT JOIN public.course_packages cp ON cp.curriculum_id = c.id AND cp.status = 'published'
  LEFT JOIN pillars p ON p.curriculum_id = s.curriculum_id
  WHERE s.cnt >= 3
  ORDER BY s.cnt DESC;
END;
$function$;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'pillar_foundation_v1_slug_ssot',
  'system',
  'ok',
  jsonb_build_object(
    'note', 'Pillar slug = fn_normalize_curriculum_slug(curricula.title); RPCs harmonisiert; trigger erlaubt competency_id NULL (verified)',
    'at', now()
  )
);