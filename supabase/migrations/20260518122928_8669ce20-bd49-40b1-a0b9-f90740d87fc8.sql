-- Defensive fix: fn_seo_thin_content_guard tolerates non-array internal_links
CREATE OR REPLACE FUNCTION public.fn_seo_thin_content_guard(p_curriculum_id uuid, p_competency_id uuid, p_intent_template text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp record;
  v_curr record;
  v_lf record;
  v_reasons text[] := ARRAY[]::text[];
  v_risk text := 'low';
  v_faq_count int := 0;
  v_internal_links int := 0;
  v_body_words int := 0;
  v_sibling_count int := 0;
  v_skel jsonb;
  v_pkg_published boolean;
  v_hard_blocker boolean := false;
  v_page record;
  v_links jsonb;
BEGIN
  SELECT id, title, description, learning_field_id, sort_order
    INTO v_comp FROM competencies WHERE id = p_competency_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'risk','high', 'has_hard_blocker', true,
      'reasons', to_jsonb(ARRAY['competency_not_found']));
  END IF;

  SELECT id, title INTO v_curr FROM curricula WHERE id = p_curriculum_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'risk','high', 'has_hard_blocker', true,
      'reasons', to_jsonb(ARRAY['curriculum_not_found']));
  END IF;

  v_pkg_published := public.fn_curriculum_has_published_package(p_curriculum_id);
  IF NOT v_pkg_published THEN
    v_reasons := array_append(v_reasons, 'package_not_published');
    v_hard_blocker := true;
  END IF;

  SELECT id, title, curriculum_id INTO v_lf
    FROM learning_fields WHERE id = v_comp.learning_field_id;

  IF v_lf.id IS NULL OR v_lf.curriculum_id IS NULL OR v_lf.curriculum_id <> p_curriculum_id THEN
    v_reasons := array_append(v_reasons, 'competency_not_in_curriculum');
  END IF;

  IF coalesce(length(v_comp.description), 0) < 80 THEN
    v_reasons := array_append(v_reasons, 'competency_description_too_small');
  END IF;
  IF coalesce(length(v_comp.title), 0) < 6 THEN
    v_reasons := array_append(v_reasons, 'competency_title_too_short');
  END IF;

  SELECT count(*) INTO v_sibling_count
    FROM competencies c2 WHERE c2.learning_field_id = v_comp.learning_field_id;
  IF v_sibling_count < 2 THEN
    v_reasons := array_append(v_reasons, 'learning_field_too_thin');
  END IF;

  -- DEFENSIVE: load page row, then count links by jsonb_typeof
  SELECT faq_json, sections_json INTO v_page
  FROM seo_content_pages
  WHERE competency_id = p_competency_id
    AND intent_template = p_intent_template
    AND persona_type = 'azubi'
  LIMIT 1;

  IF FOUND THEN
    -- FAQ count
    IF jsonb_typeof(v_page.faq_json) = 'array' THEN
      v_faq_count := jsonb_array_length(v_page.faq_json);
    ELSE
      v_faq_count := 0;
    END IF;

    -- Internal links: array → length; object → siblings array length + named link keys
    v_links := v_page.sections_json->'internal_links';
    IF jsonb_typeof(v_links) = 'array' THEN
      v_internal_links := jsonb_array_length(v_links);
    ELSIF jsonb_typeof(v_links) = 'object' THEN
      -- Count named links (hub/quiz/tutor/trainer) + siblings array entries
      v_internal_links :=
        (CASE WHEN v_links ? 'hub'     THEN 1 ELSE 0 END) +
        (CASE WHEN v_links ? 'quiz'    THEN 1 ELSE 0 END) +
        (CASE WHEN v_links ? 'tutor'   THEN 1 ELSE 0 END) +
        (CASE WHEN v_links ? 'trainer' THEN 1 ELSE 0 END) +
        (CASE WHEN jsonb_typeof(v_links->'siblings') = 'array'
              THEN jsonb_array_length(v_links->'siblings')
              ELSE 0 END);
    ELSE
      v_internal_links := 0;
    END IF;

    v_body_words := (coalesce(length(coalesce(v_page.sections_json->>'intro','')) +
                              length(coalesce(v_page.sections_json->>'pain_points','')) +
                              length(coalesce(v_page.sections_json->>'expert_tip','')), 0)) / 6;
  END IF;

  IF v_faq_count = 0 AND v_internal_links = 0 THEN
    BEGIN
      v_skel := public.fn_seo_build_ssot_skeleton(p_curriculum_id, p_competency_id, p_intent_template, 'azubi');
      IF jsonb_typeof(v_skel->'faq') = 'array' THEN
        v_faq_count := jsonb_array_length(v_skel->'faq');
      END IF;
      IF jsonb_typeof(v_skel->'internal_links') = 'array' THEN
        v_internal_links := jsonb_array_length(v_skel->'internal_links');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  IF v_faq_count < 3 THEN
    v_reasons := array_append(v_reasons, 'faq_too_few');
  END IF;
  IF v_internal_links < 4 THEN
    v_reasons := array_append(v_reasons, 'internal_links_too_few');
  END IF;

  IF v_hard_blocker THEN
    v_risk := 'high';
  ELSIF cardinality(v_reasons) >= 3 THEN
    v_risk := 'high';
  ELSIF cardinality(v_reasons) >= 1 THEN
    v_risk := 'medium';
  ELSE
    v_risk := 'low';
  END IF;

  RETURN jsonb_build_object(
    'ok', cardinality(v_reasons) = 0,
    'risk', v_risk,
    'has_hard_blocker', v_hard_blocker,
    'reasons', to_jsonb(v_reasons),
    'metrics', jsonb_build_object(
      'faq_count', v_faq_count,
      'internal_links', v_internal_links,
      'body_words', v_body_words,
      'sibling_count', v_sibling_count,
      'desc_length', coalesce(length(v_comp.description), 0)
    )
  );
END;
$function$;

-- Smoke: must not raise on object-style internal_links
DO $$
DECLARE r jsonb;
BEGIN
  SELECT public.fn_seo_thin_content_guard(
    '0e2605f4-20f8-44c8-b224-4b97a3511add'::uuid,
    '572a9aa3-fcd7-4380-adb4-37495d74c846'::uuid,
    'intent_durchfallquote'
  ) INTO r;
  IF r IS NULL OR r->>'risk' IS NULL THEN
    RAISE EXCEPTION 'Smoke failed: guard returned NULL or no risk';
  END IF;
  RAISE NOTICE 'Smoke OK: %', r;
END $$;