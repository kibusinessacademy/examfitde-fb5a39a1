CREATE OR REPLACE FUNCTION public.fn_growth_classify_next_best_fix(
  p_artifact jsonb,
  p_subscore text
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_reason text;
  v_verdict text;
  v_missing jsonb;
  v_cta_assets int;
  v_visible int;
  v_click int;
BEGIN
  IF p_artifact IS NULL THEN
    RETURN jsonb_build_object('action', NULL, 'reason', 'no_artifact', 'verdict', NULL);
  END IF;
  v_verdict := p_artifact->>'verdict';

  IF p_subscore = 'funnel_events' THEN
    v_missing := COALESCE(p_artifact->'missing', '[]'::jsonb);
    IF v_missing ? 'checkout_started' OR v_missing ? 'checkout_complete' THEN
      v_action := 'verify_checkout_event_wiring'; v_reason := 'missing_checkout_events';
    ELSIF v_missing ? 'lead_capture_submitted' OR v_missing ? 'quiz_started' THEN
      v_action := 'verify_lead_form_wiring'; v_reason := 'missing_lead_form_events';
    ELSIF v_missing ? 'cta_visible' OR v_missing ? 'landing_view' THEN
      v_action := 'check_landing_page_cta_render'; v_reason := 'missing_landing_or_cta_visible';
    ELSE
      v_action := NULL; v_reason := 'all_events_present';
    END IF;
  ELSIF p_subscore = 'cta' THEN
    v_cta_assets := COALESCE((p_artifact->'campaign_assets'->>'cta_assets')::int, 0);
    v_visible    := COALESCE((p_artifact->'cta_events_30d'->>'visible')::int, 0);
    v_click      := COALESCE((p_artifact->'cta_events_30d'->>'click')::int, 0);
    IF v_cta_assets = 0 THEN
      v_action := 'check_landing_page_cta_render'; v_reason := 'no_cta_assets_published';
    ELSIF v_visible > 0 AND v_click = 0 THEN
      v_action := 'review_cta_copy_for_engagement'; v_reason := 'cta_visible_but_no_clicks';
    ELSIF v_visible = 0 THEN
      v_action := 'check_landing_page_cta_render'; v_reason := 'cta_assets_present_but_no_impressions';
    ELSE
      v_action := 'review_cta_copy_for_engagement'; v_reason := 'cta_engagement_below_threshold';
    END IF;
  ELSE
    v_action := NULL; v_reason := 'unsupported_subscore';
  END IF;

  RETURN jsonb_build_object('action', v_action, 'reason', v_reason, 'verdict', v_verdict);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_growth_classify_next_best_fix(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_growth_classify_next_best_fix(jsonb, text) TO service_role;

CREATE OR REPLACE VIEW public.v_growth_next_best_fix AS
WITH latest AS (
  SELECT DISTINCT ON (package_id, subscore)
    id, package_id, subscore, status, artifact_ref, created_at, completed_at
  FROM public.growth_repair_runs
  WHERE subscore IN ('cta', 'funnel_events')
  ORDER BY package_id, subscore, created_at DESC
),
classified AS (
  SELECT l.*, public.fn_growth_classify_next_best_fix(l.artifact_ref, l.subscore) AS classification
  FROM latest l
)
SELECT
  c.id AS run_id, c.package_id, cp.title AS package_title, cp.package_key,
  c.subscore, c.status,
  c.classification->>'verdict' AS verdict,
  c.classification->>'action'  AS recommended_action,
  c.classification->>'reason'  AS reason_code,
  c.artifact_ref, c.created_at, c.completed_at,
  CASE c.classification->>'verdict'
    WHEN 'red' THEN 1 WHEN 'yellow' THEN 2 WHEN 'green' THEN 3 ELSE 9
  END AS severity_rank
FROM classified c
LEFT JOIN public.course_packages cp ON cp.id = c.package_id;

REVOKE ALL ON public.v_growth_next_best_fix FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_growth_next_best_fix TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_growth_next_best_fix(p_limit int DEFAULT 50)
RETURNS TABLE (
  run_id uuid, package_id uuid, package_title text, package_key text,
  subscore text, status text, verdict text, recommended_action text,
  reason_code text, artifact_ref jsonb, created_at timestamptz,
  completed_at timestamptz, severity_rank int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT v.run_id, v.package_id, v.package_title, v.package_key,
         v.subscore, v.status, v.verdict, v.recommended_action,
         v.reason_code, v.artifact_ref, v.created_at, v.completed_at, v.severity_rank
  FROM public.v_growth_next_best_fix v
  WHERE v.recommended_action IS NOT NULL
  ORDER BY v.severity_rank ASC, v.created_at DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_growth_next_best_fix(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_next_best_fix(int) TO authenticated;

-- Regression: fail-closed gate has produced ≥1 post_score_unavailable rollback
DO $$ DECLARE v_cnt int; BEGIN
  SELECT count(*) INTO v_cnt FROM public.growth_repair_runs
  WHERE status='rolled_back' AND rollback_info->'reasons' ? 'post_score_unavailable';
  IF v_cnt < 1 THEN RAISE EXCEPTION 'welle_5_3 regression FAILED: no fail-closed rollback'; END IF;
END $$;

-- Classifier smoke: all 4 canonical actions reachable
DO $$ DECLARE v jsonb; BEGIN
  v := public.fn_growth_classify_next_best_fix(jsonb_build_object('verdict','red','missing',jsonb_build_array('checkout_started')),'funnel_events');
  IF v->>'action' <> 'verify_checkout_event_wiring' THEN RAISE EXCEPTION 'cls checkout: %',v; END IF;
  v := public.fn_growth_classify_next_best_fix(jsonb_build_object('verdict','red','missing',jsonb_build_array('lead_capture_submitted')),'funnel_events');
  IF v->>'action' <> 'verify_lead_form_wiring' THEN RAISE EXCEPTION 'cls lead: %',v; END IF;
  v := public.fn_growth_classify_next_best_fix(jsonb_build_object('verdict','red','missing',jsonb_build_array('cta_visible')),'funnel_events');
  IF v->>'action' <> 'check_landing_page_cta_render' THEN RAISE EXCEPTION 'cls landing: %',v; END IF;
  v := public.fn_growth_classify_next_best_fix(jsonb_build_object('verdict','red','campaign_assets',jsonb_build_object('cta_assets',5),'cta_events_30d',jsonb_build_object('visible',100,'click',0)),'cta');
  IF v->>'action' <> 'review_cta_copy_for_engagement' THEN RAISE EXCEPTION 'cls copy: %',v; END IF;
END $$;

INSERT INTO public.auto_heal_log (action_type, result_status, target_type, metadata)
VALUES (
  'welle_5_3_audit_to_action_deployed','completed','system',
  jsonb_build_object(
    'wave','5.3',
    'classifier','fn_growth_classify_next_best_fix',
    'view','v_growth_next_best_fix',
    'rpc','admin_get_growth_next_best_fix',
    'actions', jsonb_build_array(
      'check_landing_page_cta_render','review_cta_copy_for_engagement',
      'verify_checkout_event_wiring','verify_lead_form_wiring'
    )
  )
);