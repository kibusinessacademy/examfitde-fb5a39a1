
-- Migration B: Entitlement SSOT (view-first)

DROP VIEW IF EXISTS public.v_my_active_entitlements CASCADE;
DROP VIEW IF EXISTS public.v_learner_entitlements_ssot CASCADE;

CREATE VIEW public.v_learner_entitlements_ssot AS
SELECT
  g.id                                            AS grant_id,
  COALESCE(o.buyer_user_id, g.user_id)            AS buyer_user_id,
  g.user_id                                       AS learner_user_id,
  g.product_id,
  g.curriculum_id,
  cp.id                                           AS package_id,
  g.order_id,
  g.source,
  g.source_ref,
  -- Konsolidierter Status: grant.status ist Primärsignal, ergänzt durch Entitlement-Existenz
  CASE
    WHEN g.status = 'refunded'                                      THEN 'revoked'
    WHEN g.status = 'failed'                                        THEN 'failed'
    WHEN g.status = 'active' AND e.id IS NOT NULL
      AND (e.valid_until IS NULL OR e.valid_until > now())          THEN 'active'
    WHEN g.status = 'active' AND e.id IS NULL                       THEN 'blocked'
    WHEN g.status = 'pending'                                       THEN 'pending'
    ELSE COALESCE(g.status, 'pending')
  END                                             AS status,
  jsonb_build_object(
    'has_learning_course', COALESCE(e.has_learning_course, false),
    'has_exam_trainer',    COALESCE(e.has_exam_trainer, false),
    'has_ai_tutor',        COALESCE(e.has_ai_tutor, false),
    'has_oral_trainer',    COALESCE(e.has_oral_trainer, false)
  )                                               AS access_scope,
  g.granted_at,
  g.activated_at,
  e.valid_until,
  CASE
    WHEN g.status = 'active' AND e.id IS NULL THEN 'entitlement_missing'
    WHEN g.status = 'active' AND e.valid_until IS NOT NULL AND e.valid_until <= now() THEN 'entitlement_expired'
    WHEN g.status = 'failed' THEN 'grant_failed'
    WHEN g.status = 'refunded' THEN 'refunded'
    ELSE NULL
  END                                             AS blocking_reason,
  g.created_at, g.updated_at
FROM public.learner_course_grants g
LEFT JOIN public.orders o ON o.id = g.order_id
LEFT JOIN public.course_packages cp
  ON cp.curriculum_id = g.curriculum_id AND cp.is_published = true AND cp.archived = false
LEFT JOIN public.entitlements e
  ON e.user_id = g.user_id AND e.curriculum_id = g.curriculum_id
  AND COALESCE(e.product_id, g.product_id) = g.product_id;

REVOKE ALL ON public.v_learner_entitlements_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_learner_entitlements_ssot TO service_role;

-- v_my_active_entitlements: authenticated-safe (filtered by auth.uid()) — Frontend API
CREATE VIEW public.v_my_active_entitlements
WITH (security_invoker = true) AS
SELECT
  grant_id,
  learner_user_id,
  product_id,
  curriculum_id,
  package_id,
  order_id,
  status,
  access_scope,
  granted_at,
  activated_at,
  valid_until
FROM public.v_learner_entitlements_ssot
WHERE status = 'active'
  AND learner_user_id = auth.uid();

REVOKE ALL ON public.v_my_active_entitlements FROM PUBLIC, anon;
GRANT SELECT ON public.v_my_active_entitlements TO authenticated;

-- Admin RPC für Cockpit-Listung
CREATE OR REPLACE FUNCTION public.admin_get_learner_entitlements(
  p_status_filter text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS SETOF public.v_learner_entitlements_ssot
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT *
  FROM public.v_learner_entitlements_ssot
  WHERE public.has_role(auth.uid(), 'admin')
    AND (p_status_filter IS NULL OR status = p_status_filter)
  ORDER BY updated_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_learner_entitlements(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_learner_entitlements(text, int) TO authenticated, service_role;

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
VALUES (
  'post_purchase_delivery_assurance_v1_migration_b',
  'system','success',
  'v_learner_entitlements_ssot + v_my_active_entitlements + admin RPC live',
  jsonb_build_object('migration','B','timestamp', now())
);
