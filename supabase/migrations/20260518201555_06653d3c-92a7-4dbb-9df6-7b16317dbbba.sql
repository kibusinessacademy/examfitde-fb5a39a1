ALTER TABLE public.conversion_events
  DROP CONSTRAINT IF EXISTS conversion_events_event_type_v2_chk;

ALTER TABLE public.conversion_events
  ADD CONSTRAINT conversion_events_event_type_v2_chk
  CHECK (event_type = ANY (ARRAY[
    'hero_cta_click','pricing_view','checkout_start','checkout_complete','lead_magnet_download',
    'quiz_complete','paywall_view','cta_click','checkout_started','checkout_completed','dismissed',
    'pricing_hero_view','pricing_hero_primary_click','pricing_hero_secondary_click','optin_submit',
    'doi_confirmed','b2b_form_submit','course_open','exam_attempt','product_search','product_filter',
    'product_view','product_select','shop_view','lead_magnet_view','quiz_start','lead_capture',
    'lernplan_view','quiz_started','quiz_completed','lead_capture_submitted','lernplan_viewed',
    'bundle_cta_clicked','page_view','add_to_cart','quiz_cta_clicked','landing_view',
    'lead_gate_shown','lead_gate_start_diagnosis','lead_gate_skip_to_checkout','quiz_result_viewed',
    'result_cta_clicked','heatmap_click','heatmap_scroll_depth','cta_visible','cta_clicked',
    'package_published','post_purchase_landing_view','activation_started','first_learning_action',
    'activation_completed',
    'welcome_seen','minicheck_started','minicheck_completed','tutor_feedback_received','lernplan_started'
  ]::text[]));

CREATE OR REPLACE FUNCTION public.learner_get_welcome_context(_order_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_grant record; v_pkg record; v_curr record;
BEGIN
  IF v_user IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','unauthenticated'); END IF;

  IF _order_id IS NOT NULL THEN
    SELECT g.* INTO v_grant FROM learner_course_grants g
    WHERE g.user_id=v_user AND g.status='active' AND (g.metadata->>'order_id')=_order_id::text
    ORDER BY g.granted_at DESC LIMIT 1;
  END IF;

  IF v_grant.id IS NULL THEN
    SELECT g.* INTO v_grant FROM learner_course_grants g
    WHERE g.user_id=v_user AND g.status='active'
    ORDER BY g.granted_at DESC LIMIT 1;
  END IF;

  IF v_grant.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','no_active_grant'); END IF;

  SELECT cp.id, cp.package_key, cp.title, cp.curriculum_id, cp.certification_id, cp.track INTO v_pkg
  FROM course_packages cp
  WHERE cp.id = COALESCE(
    (v_grant.metadata->>'package_id')::uuid,
    (SELECT id FROM course_packages WHERE curriculum_id=v_grant.curriculum_id AND status='published' ORDER BY published_at DESC NULLS LAST LIMIT 1)
  );

  SELECT c.id, c.title, c.slug INTO v_curr FROM curricula c WHERE c.id=v_grant.curriculum_id;

  RETURN jsonb_build_object(
    'ok', true,
    'grant', jsonb_build_object('id',v_grant.id,'granted_at',v_grant.granted_at,'curriculum_id',v_grant.curriculum_id,'package_id',v_pkg.id,'valid_until',v_grant.valid_until),
    'package', jsonb_build_object('id',v_pkg.id,'key',v_pkg.package_key,'title',v_pkg.title,'track',v_pkg.track),
    'curriculum', jsonb_build_object('id',v_curr.id,'title',v_curr.title,'slug',v_curr.slug),
    'next_step', jsonb_build_object('kind','diagnostic_minicheck','route','/exam-trainer?curriculum='||v_grant.curriculum_id::text||'&mode=diagnostic&from=welcome')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.learner_get_welcome_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.learner_get_welcome_context(uuid) TO authenticated, service_role;

-- Drop+recreate view (column-ordering shift requires drop)
DROP VIEW IF EXISTS public.v_post_purchase_activation_ssot CASCADE;

CREATE VIEW public.v_post_purchase_activation_ssot AS
WITH grants AS (
  SELECT g.id AS grant_id, g.user_id, g.curriculum_id,
    (g.metadata->>'package_id')::uuid AS package_id,
    g.granted_at AS paid_at,
    cp.package_key, cp.title AS package_title,
    NULL::text AS persona, cp.track
  FROM learner_course_grants g
  LEFT JOIN course_packages cp ON cp.id = COALESCE(
    (g.metadata->>'package_id')::uuid,
    (SELECT id FROM course_packages WHERE curriculum_id=g.curriculum_id AND status='published' ORDER BY published_at DESC NULLS LAST LIMIT 1)
  )
  WHERE g.status='active'
),
events AS (
  SELECT user_id,
    MIN(CASE WHEN event_type='post_purchase_landing_view' THEN created_at END) AS welcome_seen_at,
    MIN(CASE WHEN event_type='activation_started'          THEN created_at END) AS activation_started_at,
    MIN(CASE WHEN event_type='minicheck_started'           THEN created_at END) AS first_minicheck_started_at,
    MIN(CASE WHEN event_type='minicheck_completed'         THEN created_at END) AS first_minicheck_completed_at,
    MIN(CASE WHEN event_type='tutor_feedback_received'     THEN created_at END) AS first_tutor_feedback_at,
    MIN(CASE WHEN event_type='lernplan_started'            THEN created_at END) AS lernplan_started_at
  FROM conversion_events
  WHERE user_id IS NOT NULL
    AND event_type IN ('post_purchase_landing_view','activation_started','minicheck_started','minicheck_completed','tutor_feedback_received','lernplan_started')
  GROUP BY user_id
),
first_login AS (SELECT id AS user_id, last_sign_in_at FROM auth.users),
first_q AS (
  SELECT user_id, MIN(ts) AS first_question_at FROM (
    SELECT user_id, answered_at AS ts FROM minicheck_attempts WHERE user_id IS NOT NULL AND answered_at IS NOT NULL
    UNION ALL
    SELECT user_id, started_at AS ts FROM exam_attempts WHERE user_id IS NOT NULL AND started_at IS NOT NULL
  ) q GROUP BY user_id
),
first_lesson AS (
  SELECT user_id, MIN(created_at) AS first_lesson_done_at
  FROM lesson_outcomes WHERE status IN ('completed','passed','mastered')
  GROUP BY user_id
),
first_exam AS (
  SELECT user_id, MIN(started_at) AS first_exam_started_at
  FROM exam_sessions WHERE user_id IS NOT NULL AND started_at IS NOT NULL
  GROUP BY user_id
)
SELECT
  g.grant_id, g.user_id, g.curriculum_id, g.package_id, g.package_key, g.package_title,
  g.persona, g.track, g.paid_at,
  fl.last_sign_in_at AS first_login_at,
  e.welcome_seen_at, e.activation_started_at,
  e.first_minicheck_started_at, e.first_minicheck_completed_at,
  e.first_tutor_feedback_at, e.lernplan_started_at,
  fq.first_question_at, fles.first_lesson_done_at, fex.first_exam_started_at,
  EXTRACT(EPOCH FROM (LEAST(e.first_minicheck_completed_at, e.first_tutor_feedback_at) - g.paid_at))::bigint AS time_to_first_value_completed_sec,
  EXTRACT(EPOCH FROM (fq.first_question_at - g.paid_at))::bigint                AS time_to_first_question_sec,
  EXTRACT(EPOCH FROM (fl.last_sign_in_at - g.paid_at))::bigint                  AS time_to_login_sec,
  EXTRACT(EPOCH FROM (e.welcome_seen_at - g.paid_at))::bigint                   AS time_to_welcome_seen_sec,
  EXTRACT(EPOCH FROM (e.first_minicheck_completed_at - g.paid_at))::bigint      AS time_to_minicheck_completed_sec,
  EXTRACT(EPOCH FROM (e.first_tutor_feedback_at - g.paid_at))::bigint           AS time_to_tutor_feedback_sec,
  CASE
    WHEN e.lernplan_started_at IS NOT NULL THEN 'lernplan_started'
    WHEN e.first_tutor_feedback_at IS NOT NULL THEN 'tutor_feedback'
    WHEN e.first_minicheck_completed_at IS NOT NULL THEN 'minicheck_completed'
    WHEN e.first_minicheck_started_at IS NOT NULL THEN 'minicheck_started'
    WHEN fex.first_exam_started_at IS NOT NULL THEN 'exam_started'
    WHEN fles.first_lesson_done_at IS NOT NULL THEN 'first_lesson_done'
    WHEN fq.first_question_at IS NOT NULL THEN 'first_question'
    WHEN e.welcome_seen_at IS NOT NULL THEN 'welcome_seen'
    WHEN fl.last_sign_in_at IS NOT NULL AND fl.last_sign_in_at >= g.paid_at THEN 'first_login'
    ELSE 'paid'
  END AS funnel_stage_reached
FROM grants g
LEFT JOIN events       e    ON e.user_id    = g.user_id
LEFT JOIN first_login  fl   ON fl.user_id   = g.user_id
LEFT JOIN first_q      fq   ON fq.user_id   = g.user_id
LEFT JOIN first_lesson fles ON fles.user_id = g.user_id
LEFT JOIN first_exam   fex  ON fex.user_id  = g.user_id;

REVOKE ALL ON public.v_post_purchase_activation_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_post_purchase_activation_ssot TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_post_purchase_activation_summary(_window_hours int DEFAULT 720)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - make_interval(hours => _window_hours);
  v_total int; v_summary jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT count(*) INTO v_total FROM public.v_post_purchase_activation_ssot WHERE paid_at >= v_cutoff;

  WITH win AS (SELECT * FROM public.v_post_purchase_activation_ssot WHERE paid_at >= v_cutoff)
  SELECT jsonb_build_object(
    'window_hours', _window_hours,
    'total_buyers', v_total,
    'funnel', jsonb_build_object(
      'paid', v_total,
      'welcome_seen',        (SELECT count(*) FROM win WHERE welcome_seen_at IS NOT NULL),
      'minicheck_started',   (SELECT count(*) FROM win WHERE first_minicheck_started_at IS NOT NULL),
      'minicheck_completed', (SELECT count(*) FROM win WHERE first_minicheck_completed_at IS NOT NULL),
      'tutor_feedback',      (SELECT count(*) FROM win WHERE first_tutor_feedback_at IS NOT NULL),
      'lernplan_started',    (SELECT count(*) FROM win WHERE lernplan_started_at IS NOT NULL)
    ),
    'ttfv_completed_sec', jsonb_build_object(
      'p50', (SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY time_to_first_value_completed_sec) FROM win WHERE time_to_first_value_completed_sec IS NOT NULL),
      'p90', (SELECT percentile_cont(0.90) WITHIN GROUP (ORDER BY time_to_first_value_completed_sec) FROM win WHERE time_to_first_value_completed_sec IS NOT NULL),
      'p95', (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY time_to_first_value_completed_sec) FROM win WHERE time_to_first_value_completed_sec IS NOT NULL)
    ),
    'completion_rate_pct',     CASE WHEN v_total>0 THEN ROUND(100.0*(SELECT count(*) FROM win WHERE first_minicheck_completed_at IS NOT NULL)/v_total,1) ELSE 0 END,
    'tutor_feedback_rate_pct', CASE WHEN v_total>0 THEN ROUND(100.0*(SELECT count(*) FROM win WHERE first_tutor_feedback_at IS NOT NULL)/v_total,1) ELSE 0 END,
    'lernplan_rate_pct',       CASE WHEN v_total>0 THEN ROUND(100.0*(SELECT count(*) FROM win WHERE lernplan_started_at IS NOT NULL)/v_total,1) ELSE 0 END,
    'dropoffs', jsonb_build_object(
      'welcome_to_minicheck_started_pct',
        CASE WHEN (SELECT count(*) FROM win WHERE welcome_seen_at IS NOT NULL)>0 THEN
          ROUND(100.0*(SELECT count(*) FROM win WHERE first_minicheck_started_at IS NOT NULL)/NULLIF((SELECT count(*) FROM win WHERE welcome_seen_at IS NOT NULL),0),1)
        ELSE NULL END,
      'started_to_completed_pct',
        CASE WHEN (SELECT count(*) FROM win WHERE first_minicheck_started_at IS NOT NULL)>0 THEN
          ROUND(100.0*(SELECT count(*) FROM win WHERE first_minicheck_completed_at IS NOT NULL)/NULLIF((SELECT count(*) FROM win WHERE first_minicheck_started_at IS NOT NULL),0),1)
        ELSE NULL END,
      'completed_to_tutor_pct',
        CASE WHEN (SELECT count(*) FROM win WHERE first_minicheck_completed_at IS NOT NULL)>0 THEN
          ROUND(100.0*(SELECT count(*) FROM win WHERE first_tutor_feedback_at IS NOT NULL)/NULLIF((SELECT count(*) FROM win WHERE first_minicheck_completed_at IS NOT NULL),0),1)
        ELSE NULL END,
      'tutor_to_lernplan_pct',
        CASE WHEN (SELECT count(*) FROM win WHERE first_tutor_feedback_at IS NOT NULL)>0 THEN
          ROUND(100.0*(SELECT count(*) FROM win WHERE lernplan_started_at IS NOT NULL)/NULLIF((SELECT count(*) FROM win WHERE first_tutor_feedback_at IS NOT NULL),0),1)
        ELSE NULL END
    )
  ) INTO v_summary;

  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_purchase_activation_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_post_purchase_activation_summary(int) TO authenticated, service_role;