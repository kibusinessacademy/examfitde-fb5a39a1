
-- Fix: Add search_path to get_quality_public_summary (resolves "Function Search Path Mutable" linter warning)
CREATE OR REPLACE FUNCTION public.get_quality_public_summary(p_certification_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'score', pqs.score,
    'badge', pqs.badge,
    'score_version', pqs.score_version,
    'updated_at', pqs.updated_at,
    'summary', pqs.public_summary
  )
  FROM public.package_quality_scores pqs
  JOIN public.course_packages cp ON cp.id = pqs.package_id
  WHERE cp.certification_id = p_certification_id
    AND cp.status = 'published'
  ORDER BY pqs.updated_at DESC
  LIMIT 1;
$function$;
