-- =========================================================================
-- Launch Readiness SSOT — Sellable courses, dashboard, queue health,
-- trainer availability, and a test-only audited grant RPC.
-- =========================================================================

-- 1. v_public_sellable_courses — single source of truth for what is sellable
CREATE OR REPLACE VIEW public.v_public_sellable_courses AS
WITH course_metrics AS (
  SELECT
    c.id              AS course_id,
    c.title           AS course_title,
    c.curriculum_id,
    c.published_at,
    COUNT(DISTINCT m.id)::int AS modules,
    COUNT(DISTINCT l.id)::int AS lessons,
    COUNT(DISTINCT l.id) FILTER (
      WHERE l.generation_status = 'completed' OR l.status = 'ready'
    )::int AS lessons_ready
  FROM public.courses c
  LEFT JOIN public.modules m ON m.course_id = c.id
  LEFT JOIN public.lessons l ON l.module_id = m.id
  WHERE c.status = 'published'
  GROUP BY c.id, c.title, c.curriculum_id, c.published_at
),
priced_products AS (
  SELECT
    p.id               AS product_id,
    p.title            AS product_title,
    p.slug             AS product_slug,
    p.curriculum_id,
    p.status           AS product_status,
    p.visibility       AS product_visibility,
    MIN(pp.amount_cents) AS min_price_cents,
    MAX(pp.currency)     AS currency,
    bool_or(pp.stripe_price_id IS NOT NULL) AS has_stripe_price
  FROM public.products p
  JOIN public.product_prices pp ON pp.product_id = p.id AND pp.active = true
  WHERE p.status = 'active'
    AND p.visibility = 'public'
    AND p.curriculum_id IS NOT NULL
  GROUP BY p.id, p.title, p.slug, p.curriculum_id, p.status, p.visibility
)
SELECT
  cm.course_id,
  cm.course_title,
  cm.curriculum_id,
  cm.modules,
  cm.lessons,
  cm.lessons_ready,
  cm.published_at,
  pp.product_id,
  pp.product_title,
  pp.product_slug,
  pp.min_price_cents,
  pp.currency,
  pp.has_stripe_price,
  (cm.modules > 0
   AND cm.lessons > 0
   AND cm.lessons_ready > 0
   AND pp.product_id IS NOT NULL
   AND pp.product_slug IS NOT NULL) AS is_sellable
FROM course_metrics cm
JOIN priced_products pp ON pp.curriculum_id = cm.curriculum_id;

REVOKE ALL ON public.v_public_sellable_courses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_public_sellable_courses TO service_role;

-- Public read RPC (anon ok — only sellable rows surface)
CREATE OR REPLACE FUNCTION public.public_sellable_courses()
RETURNS TABLE (
  course_id uuid, course_title text, curriculum_id uuid,
  product_id uuid, product_slug text, min_price_cents int, currency text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT course_id, course_title, curriculum_id,
         product_id, product_slug, min_price_cents, currency
  FROM public.v_public_sellable_courses
  WHERE is_sellable = true;
$$;
REVOKE ALL ON FUNCTION public.public_sellable_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_sellable_courses() TO anon, authenticated, service_role;

-- 2. admin_get_launch_queue_health
CREATE OR REPLACE FUNCTION public.admin_get_launch_queue_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_relevant text[] := ARRAY[
    'lesson_generate_content',
    'package_generate_lesson_minichecks',
    'package_validate_lesson_minichecks',
    'council_recompute_course_ready',
    'package_generate_exam_pool',
    'package_auto_publish'
  ];
  v_stuck int; v_failed_24h int; v_pending_old int;
  v_by_type jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_stuck
    FROM public.job_queue
   WHERE status = 'processing'
     AND job_type = ANY(v_relevant)
     AND COALESCE(started_at, updated_at) < now() - interval '20 minutes';

  SELECT COUNT(*) INTO v_failed_24h
    FROM public.job_queue
   WHERE status = 'failed'
     AND job_type = ANY(v_relevant)
     AND updated_at > now() - interval '24 hours';

  SELECT COUNT(*) INTO v_pending_old
    FROM public.job_queue
   WHERE status IN ('pending','queued')
     AND job_type = ANY(v_relevant)
     AND COALESCE(run_after, created_at) < now() - interval '30 minutes';

  SELECT jsonb_agg(t) INTO v_by_type FROM (
    SELECT job_type, status, COUNT(*) AS cnt
      FROM public.job_queue
     WHERE job_type = ANY(v_relevant)
       AND status IN ('pending','queued','processing','failed')
     GROUP BY job_type, status
     ORDER BY job_type, status
  ) t;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'stuck_processing', v_stuck,
    'failed_24h', v_failed_24h,
    'pending_older_30m', v_pending_old,
    'by_type', COALESCE(v_by_type, '[]'::jsonb),
    'is_healthy', (v_stuck = 0 AND v_failed_24h < 50 AND v_pending_old < 100)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_get_launch_queue_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_queue_health() TO authenticated, service_role;

-- 3. public_trainer_available_curricula
CREATE OR REPLACE FUNCTION public.public_trainer_available_curricula(_min_questions int DEFAULT 5)
RETURNS TABLE (
  curriculum_id uuid,
  approved_questions bigint,
  is_available boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT eq.curriculum_id,
         COUNT(*) AS approved_questions,
         (COUNT(*) >= GREATEST(_min_questions, 1)) AS is_available
    FROM public.exam_questions eq
   WHERE eq.status = 'approved'
     AND eq.curriculum_id IS NOT NULL
   GROUP BY eq.curriculum_id;
$$;
REVOKE ALL ON FUNCTION public.public_trainer_available_curricula(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_trainer_available_curricula(int) TO anon, authenticated, service_role;

-- 4. admin_create_test_purchase_grant — service-role/admin only, audited
CREATE OR REPLACE FUNCTION public.admin_create_test_purchase_grant(
  _course_id uuid, _user_email text, _reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_curriculum uuid;
  v_product uuid;
  v_grant_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
         OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(length(trim(_reason)), 0) < 5 THEN
    RAISE EXCEPTION 'reason required (>=5 chars)';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = _user_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;

  SELECT curriculum_id INTO v_curriculum
    FROM public.v_public_sellable_courses
   WHERE course_id = _course_id AND is_sellable = true
   LIMIT 1;
  IF v_curriculum IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_sellable');
  END IF;

  SELECT product_id INTO v_product
    FROM public.v_public_sellable_courses
   WHERE course_id = _course_id LIMIT 1;

  v_grant_id := public.grant_learner_course_access(
    v_user_id, v_curriculum, v_product, 'test_grant', NULL,
    jsonb_build_object('reason', _reason, 'created_by', auth.uid(), 'kind', 'admin_test_grant')
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('admin_test_purchase_grant', 'course', _course_id, 'success', _reason,
          jsonb_build_object('user_id', v_user_id, 'curriculum_id', v_curriculum,
                             'product_id', v_product, 'grant_id', v_grant_id));

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant_id, 'user_id', v_user_id);
END $$;
REVOKE ALL ON FUNCTION public.admin_create_test_purchase_grant(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_test_purchase_grant(uuid,text,text) TO authenticated, service_role;

-- 5. admin_get_launch_readiness_dashboard — overall traffic light
CREATE OR REPLACE FUNCTION public.admin_get_launch_readiness_dashboard()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empty int;
  v_sellable int;
  v_l2 jsonb;
  v_queue jsonb;
  v_blocked_24h int;
  v_bypassed_24h int;
  v_pricing_ready int;
  v_trainer_curricula int;
  v_can_soft boolean;
  v_can_public boolean;
  v_checks jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_empty FROM public.admin_get_empty_published_courses();
  SELECT COUNT(*) INTO v_sellable FROM public.v_public_sellable_courses WHERE is_sellable = true;
  v_l2 := public.admin_get_l2_enforce_readiness();
  v_queue := public.admin_get_launch_queue_health();

  SELECT COUNT(*) INTO v_blocked_24h FROM public.auto_heal_log
   WHERE action_type = 'course_publish_readiness_blocked'
     AND created_at > now() - interval '24 hours';
  SELECT COUNT(*) INTO v_bypassed_24h FROM public.auto_heal_log
   WHERE action_type = 'course_publish_readiness_bypassed'
     AND created_at > now() - interval '24 hours';

  SELECT COUNT(DISTINCT product_id) INTO v_pricing_ready
    FROM public.v_public_sellable_courses WHERE is_sellable = true AND has_stripe_price = true;
  SELECT COUNT(*) INTO v_trainer_curricula
    FROM public.public_trainer_available_curricula(5) WHERE is_available;

  -- Build checks array
  v_checks := jsonb_build_array(
    jsonb_build_object(
      'key','empty_courses','label','Learner Empty Courses',
      'status', CASE WHEN v_empty=0 THEN 'green' WHEN v_empty<10 THEN 'yellow' ELSE 'red' END,
      'blocker_count', v_empty, 'primary_blocker',
      CASE WHEN v_empty=0 THEN NULL ELSE v_empty::text || ' empty published' END,
      'recommended_action', CASE WHEN v_empty>0 THEN 'Run empty-courses cleanup runner' ELSE NULL END,
      'link','/admin/ops/publish-blockers'),
    jsonb_build_object(
      'key','pipeline_l2','label','Course Pipeline Readiness L2',
      'status', CASE WHEN (v_l2->>'safe_to_enforce')::boolean THEN 'green'
                     WHEN (v_l2->>'l2_warned_24h')::int < 20 THEN 'yellow' ELSE 'red' END,
      'blocker_count', COALESCE((v_l2->>'l2_warned_24h')::int, 0),
      'primary_blocker', NULLIF(v_l2->>'top_blocker',''),
      'recommended_action','Check pipeline readiness card',
      'link','/admin/ops/publish-blockers'),
    jsonb_build_object(
      'key','sellable','label','Sellable Courses',
      'status', CASE WHEN v_sellable>0 THEN 'green' ELSE 'red' END,
      'blocker_count', CASE WHEN v_sellable=0 THEN 1 ELSE 0 END,
      'primary_blocker', CASE WHEN v_sellable=0 THEN 'no sellable course' ELSE NULL END,
      'recommended_action', CASE WHEN v_sellable=0 THEN 'Configure product + active price for ready courses' ELSE NULL END,
      'link','/admin/cockpit'),
    jsonb_build_object(
      'key','pricing','label','Stripe / Pricing Readiness',
      'status', CASE WHEN v_pricing_ready>=v_sellable AND v_sellable>0 THEN 'green'
                     WHEN v_pricing_ready>0 THEN 'yellow' ELSE 'red' END,
      'blocker_count', GREATEST(v_sellable - v_pricing_ready, 0),
      'primary_blocker', CASE WHEN v_pricing_ready<v_sellable THEN 'missing stripe_price_id' ELSE NULL END,
      'recommended_action', CASE WHEN v_pricing_ready<v_sellable THEN 'Sync stripe prices' ELSE NULL END,
      'link','/admin/cockpit'),
    jsonb_build_object(
      'key','queue_health','label','Queue Health',
      'status', CASE WHEN (v_queue->>'is_healthy')::boolean THEN 'green'
                     WHEN (v_queue->>'stuck_processing')::int=0 THEN 'yellow' ELSE 'red' END,
      'blocker_count', COALESCE((v_queue->>'stuck_processing')::int,0)
                     + COALESCE((v_queue->>'failed_24h')::int,0),
      'primary_blocker', CASE WHEN (v_queue->>'stuck_processing')::int>0 THEN 'stuck processing jobs'
                              WHEN (v_queue->>'failed_24h')::int>50 THEN 'high failure rate' ELSE NULL END,
      'recommended_action','Inspect queue cockpit',
      'link','/admin/queue'),
    jsonb_build_object(
      'key','trainer','label','Trainer Availability',
      'status', CASE WHEN v_trainer_curricula>0 THEN 'green' ELSE 'red' END,
      'blocker_count', CASE WHEN v_trainer_curricula=0 THEN 1 ELSE 0 END,
      'primary_blocker', CASE WHEN v_trainer_curricula=0 THEN 'no curriculum has approved questions' ELSE NULL END,
      'recommended_action', NULL,
      'link','/admin/cockpit'),
    jsonb_build_object(
      'key','blocked_publish','label','Blocked Publish Attempts (24h)',
      'status', CASE WHEN v_blocked_24h=0 THEN 'green' WHEN v_blocked_24h<5 THEN 'yellow' ELSE 'red' END,
      'blocker_count', v_blocked_24h,
      'primary_blocker', NULL,
      'recommended_action', CASE WHEN v_blocked_24h>0 THEN 'Review blocked attempts' ELSE NULL END,
      'link','/admin/ops/publish-blockers')
  );

  v_can_soft := (v_sellable > 0 AND v_pricing_ready > 0
                 AND (v_queue->>'stuck_processing')::int = 0);
  v_can_public := (v_can_soft
                   AND v_empty = 0
                   AND (v_l2->>'safe_to_enforce')::boolean = true
                   AND v_pricing_ready >= v_sellable
                   AND v_trainer_curricula > 0
                   AND (v_queue->>'is_healthy')::boolean = true);

  RETURN jsonb_build_object(
    'generated_at', now(),
    'overall_status', CASE WHEN v_can_public THEN 'green'
                           WHEN v_can_soft THEN 'yellow' ELSE 'red' END,
    'can_soft_launch', v_can_soft,
    'can_public_launch', v_can_public,
    'sellable_courses', v_sellable,
    'empty_published', v_empty,
    'l2_safe_to_enforce', COALESCE((v_l2->>'safe_to_enforce')::boolean, false),
    'l2_enforce_recommended', COALESCE((v_l2->>'safe_to_enforce')::boolean, false)
                              AND v_empty = 0 AND v_bypassed_24h = 0,
    'checks', v_checks
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_get_launch_readiness_dashboard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_readiness_dashboard() TO authenticated, service_role;
