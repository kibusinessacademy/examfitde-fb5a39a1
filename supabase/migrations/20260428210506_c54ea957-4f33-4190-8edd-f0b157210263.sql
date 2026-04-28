CREATE OR REPLACE FUNCTION public.track_conversion_event_v2(
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_anonymous_id text DEFAULT NULL::text,
  p_session_id text DEFAULT NULL::text,
  p_page_path text DEFAULT NULL::text,
  p_curriculum_id uuid DEFAULT NULL::uuid,
  p_intent text DEFAULT NULL::text,
  p_contact_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_user uuid := auth.uid();
BEGIN
  IF p_event_type NOT IN (
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','optin_submit','doi_confirmed',
    'b2b_form_submit','course_open','exam_attempt',
    'page_view','add_to_cart',
    -- Quiz / Lead-Magnet Funnel SSOT v2
    'lead_magnet_view','quiz_started','quiz_completed',
    'lead_capture_submitted','lernplan_viewed','bundle_cta_clicked',
    'quiz_cta_clicked',
    -- Legacy aliases still accepted
    'quiz_start','lead_capture','lernplan_view'
  ) THEN
    RAISE EXCEPTION 'invalid event_type: %', p_event_type;
  END IF;

  INSERT INTO public.conversion_events(
    user_id, anonymous_id, session_id, page_path, event_type,
    metadata, curriculum_id, intent, contact_id
  ) VALUES (
    v_user, p_anonymous_id, p_session_id, p_page_path, p_event_type,
    COALESCE(p_metadata,'{}'::jsonb), p_curriculum_id, p_intent, p_contact_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;