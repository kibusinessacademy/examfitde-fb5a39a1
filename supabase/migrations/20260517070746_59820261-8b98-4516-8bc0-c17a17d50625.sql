CREATE OR REPLACE FUNCTION public.track_conversion_event_v2(
  p_event_type text, p_metadata jsonb DEFAULT '{}'::jsonb,
  p_anonymous_id text DEFAULT NULL, p_session_id text DEFAULT NULL,
  p_page_path text DEFAULT NULL, p_curriculum_id uuid DEFAULT NULL,
  p_intent text DEFAULT NULL, p_contact_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid; v_user uuid := auth.uid();
BEGIN
  IF p_event_type NOT IN (
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','optin_submit','doi_confirmed',
    'b2b_form_submit','course_open','exam_attempt',
    'page_view','landing_view','add_to_cart',
    'lead_magnet_view','quiz_started','quiz_completed',
    'lead_capture_submitted','lernplan_viewed','bundle_cta_clicked','quiz_cta_clicked',
    'quiz_start','lead_capture','lernplan_view'
  ) THEN RAISE EXCEPTION 'invalid event_type: %', p_event_type; END IF;
  INSERT INTO public.conversion_events(user_id,anonymous_id,session_id,page_path,event_type,metadata,curriculum_id,intent,contact_id)
  VALUES (v_user,p_anonymous_id,p_session_id,p_page_path,p_event_type,COALESCE(p_metadata,'{}'::jsonb),p_curriculum_id,p_intent,p_contact_id)
  RETURNING id INTO v_id; RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.track_conversion_event_v2(
  p_event_type text, p_metadata jsonb DEFAULT '{}'::jsonb,
  p_anonymous_id text DEFAULT NULL, p_session_id text DEFAULT NULL,
  p_page_path text DEFAULT NULL, p_curriculum_id uuid DEFAULT NULL,
  p_intent text DEFAULT NULL, p_contact_id uuid DEFAULT NULL,
  p_package_id uuid DEFAULT NULL, p_persona text DEFAULT NULL, p_source_page text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid; v_user uuid := auth.uid(); v_meta jsonb;
BEGIN
  IF p_event_type NOT IN (
    'hero_cta_click','pricing_view','checkout_start','checkout_started','checkout_complete',
    'lead_magnet_download','quiz_complete','optin_submit','doi_confirmed',
    'b2b_form_submit','course_open','exam_attempt',
    'page_view','landing_view','add_to_cart',
    'lead_magnet_view','quiz_started','quiz_completed',
    'lead_capture_submitted','lernplan_viewed','bundle_cta_clicked','quiz_cta_clicked',
    'cta_visible','cta_clicked','heatmap_click','heatmap_scroll_depth',
    'quiz_start','lead_capture','lernplan_view'
  ) THEN RAISE EXCEPTION 'invalid event_type: %', p_event_type; END IF;
  v_meta := COALESCE(p_metadata,'{}'::jsonb);
  IF p_package_id IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('package_id', p_package_id::text); END IF;
  IF p_persona IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('persona', p_persona); END IF;
  IF p_source_page IS NOT NULL THEN v_meta := v_meta || jsonb_build_object('source_page', p_source_page); END IF;
  INSERT INTO public.conversion_events(user_id,anonymous_id,session_id,page_path,event_type,metadata,curriculum_id,intent,contact_id)
  VALUES (v_user,p_anonymous_id,p_session_id,COALESCE(p_page_path,p_source_page),p_event_type,v_meta,p_curriculum_id,p_intent,p_contact_id)
  RETURNING id INTO v_id; RETURN v_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.track_conversion_event_v2(text,jsonb,text,text,text,uuid,text,uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_conversion_event_v2(text,jsonb,text,text,text,uuid,text,uuid,uuid,text,text) TO anon, authenticated;

-- Smoke: 11-arg overload eindeutig erzwingen
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT public.track_conversion_event_v2(
    'landing_view'::text, '{"smoke":true}'::jsonb,
    'smoke-anon'::text, 'smoke-session'::text, '/smoke'::text,
    NULL::uuid, NULL::text, NULL::uuid,
    NULL::uuid, NULL::text, NULL::text
  ) INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'landing_view smoke failed'; END IF;
  DELETE FROM public.conversion_events WHERE id = v_id;
END $$;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES ('event_enum_extended','system','success',
  jsonb_build_object('migration','landing_view_enum','added_event','landing_view'));