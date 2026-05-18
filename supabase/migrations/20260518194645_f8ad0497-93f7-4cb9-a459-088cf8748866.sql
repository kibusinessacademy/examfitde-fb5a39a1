
ALTER TABLE public.conversion_events
  DROP CONSTRAINT IF EXISTS conversion_events_event_type_v2_chk;

ALTER TABLE public.conversion_events
  ADD CONSTRAINT conversion_events_event_type_v2_chk
  CHECK (event_type = ANY (ARRAY[
    'hero_cta_click','pricing_view','checkout_start','checkout_complete',
    'lead_magnet_download','quiz_complete','paywall_view','cta_click',
    'checkout_started','checkout_completed','dismissed',
    'pricing_hero_view','pricing_hero_primary_click','pricing_hero_secondary_click',
    'optin_submit','doi_confirmed','b2b_form_submit','course_open','exam_attempt',
    'product_search','product_filter','product_view','product_select','shop_view',
    'lead_magnet_view','quiz_start','lead_capture','lernplan_view',
    'quiz_started','quiz_completed','lead_capture_submitted','lernplan_viewed',
    'bundle_cta_clicked','page_view','add_to_cart','quiz_cta_clicked',
    'landing_view','lead_gate_shown','lead_gate_start_diagnosis','lead_gate_skip_to_checkout',
    'quiz_result_viewed','result_cta_clicked',
    'heatmap_click','heatmap_scroll_depth','cta_visible','cta_clicked','package_published',
    'post_purchase_landing_view','activation_started','first_learning_action','activation_completed'
  ]));

CREATE OR REPLACE VIEW public.v_post_purchase_activation_ssot AS
WITH base AS (
  SELECT
    g.id                AS grant_id,
    g.user_id,
    g.curriculum_id,
    g.product_id,
    g.order_id,
    g.granted_at        AS paid_at,
    g.activated_at,
    g.onboarding_status,
    g.status            AS grant_status,
    g.metadata          AS grant_metadata,
    o.created_at        AS order_created_at,
    o.delivery_confirmed_at,
    cp.track,
    cp.id               AS package_id,
    cp.title            AS package_title,
    g.metadata->>'persona' AS persona_hint
  FROM public.learner_course_grants g
  LEFT JOIN public.orders o            ON o.id = g.order_id
  LEFT JOIN public.course_packages cp  ON cp.curriculum_id = g.curriculum_id AND cp.is_published = true
),
persona_from_ev AS (
  SELECT b.grant_id,
         (
           SELECT ce.metadata->>'persona'
           FROM public.conversion_events ce
           WHERE ce.user_id = b.user_id
             AND ce.metadata ? 'persona'
             AND ce.created_at <= b.paid_at + interval '1 day'
           ORDER BY ce.created_at DESC
           LIMIT 1
         ) AS persona
  FROM base b
),
first_login AS (
  SELECT b.grant_id,
         (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = b.user_id) AS first_login_at
  FROM base b
),
first_session AS (
  SELECT b.grant_id,
         (
           SELECT MIN(t) FROM (
             SELECT MIN(ce.created_at) AS t
             FROM public.conversion_events ce
             WHERE ce.user_id = b.user_id
               AND ce.event_type IN ('post_purchase_landing_view','activation_started','course_open')
               AND ce.created_at >= b.paid_at
             UNION ALL
             SELECT MIN(ats.created_at)
             FROM public.ai_tutor_sessions ats
             WHERE ats.user_id = b.user_id
               AND ats.created_at >= b.paid_at
             UNION ALL
             SELECT MIN(es.started_at)
             FROM public.exam_sessions es
             WHERE es.user_id = b.user_id
               AND es.curriculum_id = b.curriculum_id
               AND es.started_at >= b.paid_at
           ) s
         ) AS first_session_at
  FROM base b
),
first_question AS (
  SELECT b.grant_id,
         (
           SELECT MIN(t) FROM (
             SELECT MIN(ma.answered_at) AS t
             FROM public.minicheck_attempts ma
             WHERE ma.user_id = b.user_id
               AND ma.answered_at >= b.paid_at
             UNION ALL
             SELECT MIN(ea.started_at)
             FROM public.exam_attempts ea
             WHERE ea.user_id = b.user_id
               AND ea.curriculum_id = b.curriculum_id
               AND ea.started_at >= b.paid_at
           ) s
         ) AS first_question_at
  FROM base b
),
first_lesson AS (
  SELECT b.grant_id,
         (
           SELECT MIN(lo.completed_at)
           FROM public.lesson_outcomes lo
           WHERE lo.user_id = b.user_id
             AND lo.completed_at >= b.paid_at
             AND lo.status IN ('completed','passed','mastered')
         ) AS first_lesson_done_at
  FROM base b
),
first_exam AS (
  SELECT b.grant_id,
         (
           SELECT MIN(es.started_at)
           FROM public.exam_sessions es
           WHERE es.user_id = b.user_id
             AND es.curriculum_id = b.curriculum_id
             AND es.started_at >= b.paid_at
         ) AS first_exam_started_at
  FROM base b
)
SELECT
  b.grant_id,
  b.user_id,
  b.curriculum_id,
  b.package_id,
  b.package_title,
  b.product_id,
  b.order_id,
  COALESCE(pe.persona, b.persona_hint) AS persona,
  b.track,
  b.grant_status,
  b.onboarding_status,
  b.paid_at,
  b.activated_at,
  fl.first_login_at,
  fs.first_session_at,
  fq.first_question_at,
  flo.first_lesson_done_at,
  fe.first_exam_started_at,
  EXTRACT(EPOCH FROM (fl.first_login_at  - b.paid_at))::int AS time_to_first_login_sec,
  EXTRACT(EPOCH FROM (fs.first_session_at - b.paid_at))::int AS time_to_first_session_sec,
  EXTRACT(EPOCH FROM (fq.first_question_at - b.paid_at))::int AS time_to_first_value_sec,
  EXTRACT(EPOCH FROM (flo.first_lesson_done_at - b.paid_at))::int AS time_to_first_lesson_sec,
  EXTRACT(EPOCH FROM (fe.first_exam_started_at - b.paid_at))::int AS time_to_first_exam_sec,
  CASE
    WHEN fe.first_exam_started_at IS NOT NULL THEN 'first_exam_started'
    WHEN flo.first_lesson_done_at IS NOT NULL THEN 'first_lesson_done'
    WHEN fq.first_question_at   IS NOT NULL THEN 'first_question_answered'
    WHEN fs.first_session_at    IS NOT NULL THEN 'first_session_start'
    WHEN fl.first_login_at      IS NOT NULL THEN 'first_login'
    ELSE 'paid'
  END AS funnel_stage_reached
FROM base b
LEFT JOIN persona_from_ev pe ON pe.grant_id = b.grant_id
LEFT JOIN first_login    fl  ON fl.grant_id  = b.grant_id
LEFT JOIN first_session  fs  ON fs.grant_id  = b.grant_id
LEFT JOIN first_question fq  ON fq.grant_id  = b.grant_id
LEFT JOIN first_lesson   flo ON flo.grant_id = b.grant_id
LEFT JOIN first_exam     fe  ON fe.grant_id  = b.grant_id;

REVOKE ALL ON public.v_post_purchase_activation_ssot FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_post_purchase_activation_ssot TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_post_purchase_activation_summary(
  _window_hours int DEFAULT 720
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _from timestamptz := _now - make_interval(hours => COALESCE(_window_hours, 720));
  _funnel jsonb;
  _ttfv jsonb;
  _by_track jsonb;
  _by_persona jsonb;
  _total int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH src AS (
    SELECT * FROM public.v_post_purchase_activation_ssot
    WHERE paid_at >= _from
  ),
  agg AS (
    SELECT
      COUNT(*) AS total_paid,
      COUNT(first_login_at)         AS reached_first_login,
      COUNT(first_session_at)       AS reached_first_session,
      COUNT(first_question_at)      AS reached_first_question,
      COUNT(first_lesson_done_at)   AS reached_first_lesson,
      COUNT(first_exam_started_at)  AS reached_first_exam,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY time_to_first_value_sec) AS ttfv_p50,
      PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY time_to_first_value_sec) AS ttfv_p90,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY time_to_first_value_sec) AS ttfv_p95,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY time_to_first_login_sec)   AS login_p50,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY time_to_first_session_sec) AS session_p50,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY time_to_first_lesson_sec)  AS lesson_p50,
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY time_to_first_exam_sec)    AS exam_p50
    FROM src
  )
  SELECT
    jsonb_build_object(
      'paid',               a.total_paid,
      'first_login',        a.reached_first_login,
      'first_session',      a.reached_first_session,
      'first_question',     a.reached_first_question,
      'first_lesson_done',  a.reached_first_lesson,
      'first_exam_started', a.reached_first_exam
    ),
    jsonb_build_object(
      'ttfv_p50_sec',    ROUND(a.ttfv_p50)::int,
      'ttfv_p90_sec',    ROUND(a.ttfv_p90)::int,
      'ttfv_p95_sec',    ROUND(a.ttfv_p95)::int,
      'login_p50_sec',   ROUND(a.login_p50)::int,
      'session_p50_sec', ROUND(a.session_p50)::int,
      'lesson_p50_sec',  ROUND(a.lesson_p50)::int,
      'exam_p50_sec',    ROUND(a.exam_p50)::int
    ),
    a.total_paid
  INTO _funnel, _ttfv, _total FROM agg a;

  SELECT COALESCE(jsonb_agg(t.*), '[]'::jsonb) INTO _by_track FROM (
    SELECT
      COALESCE(track,'unknown') AS track,
      COUNT(*)                  AS paid,
      COUNT(first_question_at)  AS first_value,
      COUNT(first_exam_started_at) AS first_exam,
      ROUND(100.0 * COUNT(first_question_at)::numeric / NULLIF(COUNT(*),0), 1) AS first_value_pct
    FROM public.v_post_purchase_activation_ssot
    WHERE paid_at >= _from
    GROUP BY 1
    ORDER BY paid DESC
  ) t;

  SELECT COALESCE(jsonb_agg(t.*), '[]'::jsonb) INTO _by_persona FROM (
    SELECT
      COALESCE(persona,'unknown') AS persona,
      COUNT(*)                  AS paid,
      COUNT(first_question_at)  AS first_value,
      ROUND(100.0 * COUNT(first_question_at)::numeric / NULLIF(COUNT(*),0), 1) AS first_value_pct
    FROM public.v_post_purchase_activation_ssot
    WHERE paid_at >= _from
    GROUP BY 1
    ORDER BY paid DESC
  ) t;

  RETURN jsonb_build_object(
    'window_hours', _window_hours,
    'generated_at', _now,
    'total_paid',   _total,
    'funnel',       _funnel,
    'time_to',      _ttfv,
    'by_track',     _by_track,
    'by_persona',   _by_persona
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_post_purchase_activation_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_post_purchase_activation_summary(int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
