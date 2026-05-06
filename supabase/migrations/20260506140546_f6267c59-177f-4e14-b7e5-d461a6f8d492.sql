
-- Idempotency-Index (best-effort)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='entitlements_user_curriculum_type_uniq'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='entitlements' AND column_name='user_id'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX entitlements_user_curriculum_type_uniq
        ON public.entitlements(user_id, curriculum_id, entitlement_type);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'idx skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- 1) Unblock zombie packages with approved questions
CREATE OR REPLACE FUNCTION public.admin_unblock_zombie_with_approved_questions(
  p_caller_id uuid DEFAULT NULL,
  p_dry_run   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_unblocked int := 0; v_skipped int := 0;
  v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  FOR r IN
    SELECT cp.id AS package_id, cp.status AS prev_status, cp.blocked_reason AS prev_blocked_reason,
           COUNT(eq.id) FILTER (WHERE eq.status = 'approved') AS approved_count
    FROM public.course_packages cp
    LEFT JOIN public.exam_questions eq ON eq.curriculum_id = cp.curriculum_id
    WHERE cp.blocked_reason = 'auto_heal_zombie'
    GROUP BY cp.id, cp.status, cp.blocked_reason
    HAVING COUNT(eq.id) FILTER (WHERE eq.status = 'approved') >= 50
  LOOP
    IF p_dry_run THEN v_skipped := v_skipped + 1;
    ELSE
      UPDATE public.course_packages
      SET blocked_reason = NULL,
          status = CASE WHEN status IN ('blocked','queued') THEN 'building' ELSE status END,
          updated_at = now()
      WHERE id = r.package_id;
      v_unblocked := v_unblocked + 1;
    END IF;
    v_rows := v_rows || jsonb_build_object(
      'package_id', r.package_id, 'previous_status', r.prev_status,
      'previous_blocked_reason', r.prev_blocked_reason,
      'approved_question_count', r.approved_count,
      'publish_transition_reason', 'zombie_with_approved_questions_unblock',
      'healed_by', v_caller, 'dry_run', p_dry_run
    );
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, meta)
  VALUES ('system_audit_unblock_zombie','system',
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'unblocked',v_unblocked,'skipped',v_skipped,'rows',v_rows));
  RETURN jsonb_build_object('unblocked',v_unblocked,'skipped',v_skipped,'dry_run',p_dry_run,'rows',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unblock_zombie_with_approved_questions(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_unblock_zombie_with_approved_questions(uuid, boolean) TO authenticated, service_role;

-- 2) Repair grant→entitlement drift
CREATE OR REPLACE FUNCTION public.admin_repair_grant_entitlement_drift(
  p_caller_id uuid DEFAULT NULL,
  p_dry_run   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_repaired int := 0; v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  FOR r IN
    SELECT g.user_id, g.curriculum_id, g.valid_until
    FROM public.learner_course_grants g
    WHERE g.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = g.user_id AND e.curriculum_id = g.curriculum_id
      )
    LIMIT 200
  LOOP
    IF NOT p_dry_run THEN
      INSERT INTO public.entitlements(
        user_id, curriculum_id, entitlement_type, source, status,
        has_lessons, has_minichecks, has_exam_pool, has_oral_exam,
        valid_until, granted_at)
      VALUES (r.user_id, r.curriculum_id, 'course_access', 'web', 'active',
              true, true, true, true,
              COALESCE(r.valid_until, now() + interval '12 months'), now())
      ON CONFLICT (user_id, curriculum_id, entitlement_type) DO NOTHING;
      v_repaired := v_repaired + 1;
    END IF;
    v_rows := v_rows || jsonb_build_object('user_id',r.user_id,'curriculum_id',r.curriculum_id,'dry_run',p_dry_run);
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, meta)
  VALUES ('system_audit_repair_entitlement_drift','system',
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'repaired',v_repaired,'rows',v_rows));
  RETURN jsonb_build_object('repaired',v_repaired,'dry_run',p_dry_run,'rows',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_repair_grant_entitlement_drift(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_grant_entitlement_drift(uuid, boolean) TO authenticated, service_role;

-- 3) Repair paid orders without grant
CREATE OR REPLACE FUNCTION public.admin_repair_paid_orders_without_grant(
  p_caller_id uuid DEFAULT NULL,
  p_dry_run   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
  v_repaired int := 0; v_rows jsonb := '[]'::jsonb; r record;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  FOR r IN
    SELECT o.id AS order_id, COALESCE(o.learner_user_id, o.buyer_user_id) AS uid
    FROM public.orders o
    WHERE o.status = 'paid'
      AND COALESCE(o.learner_user_id, o.buyer_user_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi
        JOIN public.products p ON p.id = oi.product_id
        JOIN public.learner_course_grants g
          ON g.user_id = COALESCE(o.learner_user_id, o.buyer_user_id)
         AND g.curriculum_id = p.curriculum_id
        WHERE oi.order_id = o.id
      )
      AND COALESCE(o.learner_user_id, o.buyer_user_id) NOT IN (
        SELECT id FROM auth.users WHERE email LIKE '%@examfit-smoke.local'
      )
    LIMIT 50
  LOOP
    IF NOT p_dry_run THEN
      BEGIN
        PERFORM public.process_order_paid_fulfillment(r.order_id);
        v_repaired := v_repaired + 1;
      EXCEPTION WHEN others THEN
        v_rows := v_rows || jsonb_build_object('order_id',r.order_id,'error',SQLERRM);
        CONTINUE;
      END;
    END IF;
    v_rows := v_rows || jsonb_build_object('order_id',r.order_id,'user_id',r.uid,'dry_run',p_dry_run);
  END LOOP;
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, meta)
  VALUES ('system_audit_repair_paid_no_grant','system',
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('caller_id',v_caller,'repaired',v_repaired,'rows',v_rows));
  RETURN jsonb_build_object('repaired',v_repaired,'dry_run',p_dry_run,'rows',v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_repair_paid_orders_without_grant(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_repair_paid_orders_without_grant(uuid, boolean) TO authenticated, service_role;

-- 4) Executive KPI view
CREATE OR REPLACE VIEW public.v_system_audit_executive AS
WITH
zombie_with_questions AS (
  SELECT COUNT(*)::int AS n FROM public.course_packages cp
  WHERE cp.blocked_reason = 'auto_heal_zombie'
    AND (SELECT COUNT(*) FROM public.exam_questions eq
         WHERE eq.curriculum_id = cp.curriculum_id AND eq.status = 'approved') >= 50
),
grant_entitlement_drift AS (
  SELECT COUNT(*)::int AS n FROM public.learner_course_grants g
  WHERE g.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.entitlements e
                    WHERE e.user_id = g.user_id AND e.curriculum_id = g.curriculum_id)
),
paid_no_grant AS (
  SELECT COUNT(*)::int AS n FROM public.orders o
  WHERE o.status = 'paid'
    AND COALESCE(o.learner_user_id, o.buyer_user_id) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      JOIN public.learner_course_grants g
        ON g.user_id = COALESCE(o.learner_user_id, o.buyer_user_id) AND g.curriculum_id = p.curriculum_id
      WHERE oi.order_id = o.id
    )
    AND COALESCE(o.learner_user_id, o.buyer_user_id) NOT IN (
      SELECT id FROM auth.users WHERE email LIKE '%@examfit-smoke.local'
    )
),
sellable_published AS (
  SELECT COUNT(*)::int AS n FROM public.course_packages cp
  WHERE cp.status = 'published'
    AND EXISTS (SELECT 1 FROM public.products p
                JOIN public.product_prices pr ON pr.product_id = p.id AND pr.active
                WHERE p.curriculum_id = cp.curriculum_id AND pr.stripe_price_id IS NOT NULL)
)
SELECT
  (SELECT n FROM zombie_with_questions)   AS zombie_with_approved_questions,
  (SELECT n FROM grant_entitlement_drift) AS grant_entitlement_drift,
  (SELECT n FROM paid_no_grant)           AS paid_orders_without_grant,
  (SELECT n FROM sellable_published)      AS sellable_published_packages,
  now()                                    AS computed_at;

REVOKE ALL ON public.v_system_audit_executive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_system_audit_executive TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_system_audit_executive()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid(); v_row record;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT * INTO v_row FROM public.v_system_audit_executive;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_system_audit_executive() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_system_audit_executive() TO authenticated, service_role;
