-- Bronze Manual-Approve Council-Step Heal v3 (race-frei)
-- Strategie: Step heilen + defer_log clearen → bestehender processing Job läuft beim
-- nächsten Worker-Cycle sauber durch (kein Re-Enqueue, keine Race-Condition).

-- ============================================================
-- 1) HOTFIX: Council-Step Heal für 10 Bronze-Pakete
-- ============================================================
DO $$
DECLARE
  v_pkg record;
  v_score numeric;
  v_council_meta jsonb;
  v_healed_count integer;
BEGIN
  FOR v_pkg IN
    SELECT id AS package_id, curriculum_id, title, feature_flags
    FROM course_packages
    WHERE feature_flags->'bronze'->>'final_state' = 'manual_approved'
  LOOP
    v_score := NULLIF(v_pkg.feature_flags->'bronze'->>'score','')::numeric;

    -- Governance-konforme Bronze-Meta (Score 75..84) oder PASS (Score >=85)
    IF v_score IS NOT NULL AND v_score < 85 THEN
      v_council_meta := jsonb_build_object(
        'ok', 'true',
        'executed', true,
        'verdict', 'REVIEW_REQUIRED',
        'badge', 'bronze',
        'score', v_score,
        'bronze_override', true,
        'bronze_override_at', now(),
        'bronze_override_reason', 'manual_approved_bronze_score_75_85'
      );
    ELSE
      v_council_meta := jsonb_build_object(
        'ok', 'true',
        'executed', true,
        'status', 'pass',
        'score', COALESCE(v_score, 85),
        'bronze_override', true,
        'bronze_override_at', now(),
        'bronze_override_reason', 'manual_approved_score_ge_85'
      );
    END IF;

    -- 1a) quality_council Step → done mit governance-konformer meta
    UPDATE package_steps
    SET status = 'done',
        finished_at = COALESCE(finished_at, now()),
        started_at = COALESCE(started_at, now()),
        meta = COALESCE(meta, '{}'::jsonb) || v_council_meta
              || jsonb_build_object('previous_status', status::text),
        updated_at = now()
    WHERE package_id = v_pkg.package_id
      AND step_key = 'quality_council'
      AND status::text IN ('skipped', 'queued', 'failed', 'pending_enqueue');
    GET DIAGNOSTICS v_healed_count = ROW_COUNT;

    -- 1b) council_defer_log clearen
    UPDATE council_defer_log
    SET cleared_at = now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cleared_reason', 'bronze_manual_approved_v3'
        )
    WHERE package_id = v_pkg.package_id
      AND cleared_at IS NULL;

    -- 1c) auto_publish Step failed/skipped → queued (für nächsten Worker-Cycle bereit)
    UPDATE package_steps
    SET status = 'queued',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'reset_by', 'bronze_manual_approve_hotfix_v3',
          'reset_at', now()
        ) - 'last_atomic_enqueue_at',
        updated_at = now()
    WHERE package_id = v_pkg.package_id
      AND step_key = 'auto_publish'
      AND status::text IN ('failed', 'skipped');

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
    VALUES (
      'bronze_council_step_heal_v3',
      'one_time_sql_bypass',
      'package',
      v_pkg.package_id,
      'success',
      jsonb_build_object(
        'package_id', v_pkg.package_id,
        'title', v_pkg.title,
        'score', v_score,
        'council_path', CASE WHEN v_score < 85 THEN 'BRONZE_REVIEW_REQUIRED' ELSE 'PASS' END,
        'council_steps_healed', v_healed_count,
        'note', 'existing processing job will retry council-consistency check on next worker cycle'
      )
    );
  END LOOP;
END $$;

-- ============================================================
-- 2) PERMANENT FIX: RPC erweitern (race-frei)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_bronze_manual_approve_for_publish(
  p_package_id uuid,
  p_reason text DEFAULT 'admin_manual_review'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_curr uuid;
  v_score numeric;
  v_badge text;
  v_pricing_ready boolean;
  v_active_publish_id uuid;
  v_status_promoted boolean := false;
  v_council_healed integer := 0;
  v_council_meta jsonb;
  v_new_flags jsonb;
  v_job_id uuid;
BEGIN
  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'access_denied: admin or service_role required';
  END IF;

  SELECT id, status, feature_flags, integrity_passed, council_approved, curriculum_id
    INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found: %', p_package_id;
  END IF;

  v_curr := v_pkg.curriculum_id;

  IF NOT public.fn_is_bronze_locked(p_package_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_BRONZE_LOCKED');
  END IF;

  v_score := NULLIF(v_pkg.feature_flags->'bronze'->>'score','')::numeric;
  v_badge := v_pkg.feature_flags->'bronze'->>'badge';
  IF v_score IS NULL OR v_score < 75 OR v_score >= 85 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SCORE_OUT_OF_BRONZE_WINDOW', 'score', v_score);
  END IF;

  IF NOT COALESCE(v_pkg.integrity_passed, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INTEGRITY_NOT_PASSED');
  END IF;

  v_pricing_ready := COALESCE((public.fn_package_pricing_ready(p_package_id)->>'ready')::boolean, false);
  IF NOT v_pricing_ready THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PRICING_NOT_READY');
  END IF;

  -- Status-Promotion
  IF v_pkg.status = 'queued' THEN
    UPDATE public.course_packages
    SET status = 'building',
        feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
          'admin_force_building_reason', 'bronze_manual_approve_status_promotion',
          'admin_force_building_at', now(),
          'admin_force_building_by', v_uid
        ),
        updated_at = now()
    WHERE id = p_package_id;
    v_status_promoted := true;
  END IF;

  -- ★ Council-Step Heal mit governance-konformer Meta
  v_council_meta := jsonb_build_object(
    'ok', 'true',
    'executed', true,
    'verdict', 'REVIEW_REQUIRED',
    'badge', 'bronze',
    'score', v_score,
    'bronze_override', true,
    'bronze_override_at', now(),
    'bronze_override_by', v_uid,
    'bronze_override_reason', p_reason
  );

  WITH upd AS (
    UPDATE public.package_steps
    SET status = 'done',
        finished_at = COALESCE(finished_at, now()),
        started_at = COALESCE(started_at, now()),
        meta = COALESCE(meta, '{}'::jsonb) || v_council_meta
              || jsonb_build_object('previous_status', status::text),
        updated_at = now()
    WHERE package_id = p_package_id
      AND step_key = 'quality_council'
      AND status::text IN ('skipped', 'queued', 'failed', 'pending_enqueue')
    RETURNING 1
  )
  SELECT count(*)::int INTO v_council_healed FROM upd;

  -- council_defer_log clearen
  UPDATE public.council_defer_log
  SET cleared_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'cleared_reason', 'bronze_manual_approved',
        'cleared_by', v_uid
      )
  WHERE package_id = p_package_id
    AND cleared_at IS NULL;

  -- Bronze-Block aktualisieren
  v_new_flags := COALESCE(v_pkg.feature_flags, '{}'::jsonb) || jsonb_build_object(
    'bronze',
    COALESCE(v_pkg.feature_flags->'bronze', '{}'::jsonb) || jsonb_build_object(
      'final_state', 'manual_approved',
      'requires_review', false,
      'repair_active', false,
      'manual_approved_at', now(),
      'manual_approved_by', v_uid,
      'manual_approved_reason', p_reason,
      'council_step_healed_count', v_council_healed
    )
  );

  UPDATE public.course_packages
  SET feature_flags = v_new_flags, updated_at = now()
  WHERE id = p_package_id;

  -- Wenn bereits aktiver Job existiert: nutzen, nicht neu enqueuen (race-frei)
  SELECT id INTO v_active_publish_id
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND job_type = 'package_auto_publish'
    AND status IN ('pending','processing')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_active_publish_id IS NULL THEN
    -- Kein aktiver Job → frischen einqueuen
    INSERT INTO public.job_queue (package_id, job_type, status, priority, payload, meta, created_at)
    VALUES (
      p_package_id, 'package_auto_publish', 'pending', 5,
      jsonb_build_object(
        'bronze_lock_override', true,
        'manual_approved_by', v_uid,
        'reason', p_reason,
        'enqueue_source', 'bronze_manual_approve',
        'package_id', p_package_id,
        'curriculum_id', v_curr,
        'step_key', 'auto_publish'
      ),
      jsonb_build_object('enqueue_source', 'bronze_manual_approve', 'step_key', 'auto_publish'),
      now()
    )
    RETURNING id INTO v_job_id;
  ELSE
    v_job_id := v_active_publish_id;
  END IF;

  INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail)
  VALUES (
    'bronze_manual_approved_for_publish', 'admin_rpc', 'package', p_package_id, 'success',
    jsonb_build_object(
      'package_id', p_package_id, 'curriculum_id', v_curr,
      'approved_by', v_uid, 'reason', p_reason,
      'score', v_score, 'badge', v_badge,
      'job_id', v_job_id, 'status_promoted', v_status_promoted,
      'council_step_healed_count', v_council_healed,
      'reused_existing_job', v_active_publish_id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'job_id', v_job_id,
    'score', v_score,
    'badge', v_badge,
    'final_state', 'manual_approved',
    'status_promoted', v_status_promoted,
    'council_step_healed_count', v_council_healed,
    'reused_existing_job', v_active_publish_id IS NOT NULL
  );
END;
$function$;