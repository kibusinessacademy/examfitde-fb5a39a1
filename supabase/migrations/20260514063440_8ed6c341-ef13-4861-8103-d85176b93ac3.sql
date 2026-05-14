CREATE OR REPLACE FUNCTION public.get_published_intent_page(
  p_curriculum_slug text,
  p_intent_slug text,
  p_competency_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_intent_key text;
  v_composed_slug text;
  v_row record;
BEGIN
  -- Auto-prefix intent_ if caller passed clean slug (durchfallquote -> intent_durchfallquote)
  IF p_intent_slug LIKE 'intent_%' THEN
    v_intent_key := p_intent_slug;
  ELSE
    v_intent_key := 'intent_' || p_intent_slug;
  END IF;

  v_composed_slug := lower(p_curriculum_slug) || '/' || v_intent_key || '/' || lower(p_competency_slug);

  SELECT scp.id,
         scp.curriculum_id,
         scp.competency_id,
         scp.intent_template,
         scp.persona_type,
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
  WHERE scp.page_type = 'intent_page'
    AND scp.status = 'published'
    AND scp.quality_score >= 80
    AND scp.slug = v_composed_slug
  ORDER BY scp.last_generated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_published_intent_page(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_intent_page(text, text, text) TO anon, authenticated, service_role;