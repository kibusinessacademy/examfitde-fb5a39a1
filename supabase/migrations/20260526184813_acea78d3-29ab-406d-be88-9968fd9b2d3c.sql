CREATE OR REPLACE FUNCTION public.public_get_conversation_os_module(_route_slug text)
 RETURNS TABLE(module_key text, display_name text, tagline text, buyer_persona text, primary_outcome text, outcomes jsonb, trains jsonb, route_slug text, hero_eyebrow text, scenarios jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.module_key, m.display_name, m.tagline, m.buyer_persona,
    m.primary_outcome, m.outcomes, m.trains, m.route_slug, m.hero_eyebrow,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'scenario_key', s.scenario_key,
        'title', s.title,
        'short_pitch', s.short_pitch,
        'domain', s.domain,
        'difficulty', s.difficulty,
        'time_limit_minutes', s.time_limit_minutes,
        'persona', s.persona
      ) ORDER BY s.difficulty, s.title)
      FROM public.conversation_os_scenarios s
      WHERE s.vertical_module = m.module_key AND s.status = 'published'),
      '[]'::jsonb
    )
  FROM public.conversation_os_vertical_modules m
  WHERE m.route_slug = _route_slug AND m.is_active = true;
$function$;