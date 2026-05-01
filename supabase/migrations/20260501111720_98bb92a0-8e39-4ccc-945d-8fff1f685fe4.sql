-- 1) Extend conversion_events event_type allowlist
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
    -- new (2026-05-01)
    'landing_view',
    'lead_gate_shown','lead_gate_start_diagnosis','lead_gate_skip_to_checkout',
    'quiz_result_viewed','result_cta_clicked'
  ]));

-- 2) Restore compat overload admin_step_reset_detailed(p_source, p_nudge_atomic)
CREATE OR REPLACE FUNCTION public.admin_step_reset_detailed(
  p_package_id uuid,
  p_step_keys text[],
  p_reason text,
  p_source text DEFAULT NULL,
  p_nudge_atomic boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_pre_nudge_result jsonb := NULL;
  v_post_nudge_result jsonb := NULL;
  v_pkg_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT status::text INTO v_pkg_status
  FROM public.course_packages
  WHERE id = p_package_id;

  IF COALESCE(p_nudge_atomic, false) AND v_pkg_status = 'queued' THEN
    BEGIN
      v_pre_nudge_result := public.admin_nudge_atomic_trigger(p_package_id, false);
    EXCEPTION WHEN OTHERS THEN
      v_pre_nudge_result := jsonb_build_object(
        'ok', false,
        'phase', 'pre_reset_promote_nudge',
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END IF;

  v_result := public.admin_step_reset_detailed(
    p_package_id       := p_package_id,
    p_step_keys        := p_step_keys,
    p_reason           := p_reason,
    p_operator         := COALESCE(p_source, 'compat_step_reset'),
    p_allow_regression := true,
    p_clear_exhaustion := true
  );

  IF COALESCE(p_nudge_atomic, false) THEN
    BEGIN
      v_post_nudge_result := public.admin_nudge_atomic_trigger(p_package_id, false);
    EXCEPTION WHEN OTHERS THEN
      v_post_nudge_result := jsonb_build_object(
        'ok', false,
        'phase', 'post_reset_nudge',
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END IF;

  RETURN v_result || jsonb_build_object(
    'compat_signature', true,
    'source', p_source,
    'nudge_atomic_requested', COALESCE(p_nudge_atomic, false),
    'pre_nudge_result', v_pre_nudge_result,
    'post_nudge_result', v_post_nudge_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_step_reset_detailed(uuid, text[], text, text, boolean) TO authenticated, service_role;

-- 3) Fix admin_list_permanent_fix_tasks: cp.canonical_title -> cp.title
CREATE OR REPLACE FUNCTION public.admin_list_permanent_fix_tasks(
  p_status_filter text[] DEFAULT ARRAY['open'::text, 'in_progress'::text],
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid, recommendation_id uuid, pattern_key text, cluster text,
  package_id uuid, package_title text, title text, description text,
  status text, priority text, notes text,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  completed_at timestamp with time zone, age_hours numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    t.id, t.recommendation_id, t.pattern_key, t.cluster, t.package_id,
    cp.title AS package_title,
    t.title, t.description, t.status, t.priority, t.notes,
    t.created_at, t.updated_at, t.completed_at,
    ROUND(EXTRACT(EPOCH FROM (now() - t.created_at))/3600.0, 1)::numeric AS age_hours
  FROM public.heal_permanent_fix_tasks t
  LEFT JOIN public.course_packages cp ON cp.id = t.package_id
  WHERE t.status = ANY(p_status_filter)
  ORDER BY
    CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    t.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END
$$;

NOTIFY pgrst, 'reload schema';