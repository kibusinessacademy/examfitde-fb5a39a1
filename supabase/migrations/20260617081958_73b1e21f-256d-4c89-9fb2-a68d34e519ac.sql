
-- =============================================================
-- Phase 1: Cron Repair Pack — 3 broken jobs (~1.500 fails/day)
-- =============================================================

-- ---------- (1.1) materialize-ready-step-jobs: statement timeout ----------
-- Root cause: fn_should_log_blocked_skip scans auto_heal_log without a
-- supporting index for action_type='producer_blocked_package_progress'.
-- Add a partial index that exactly matches the dedupe lookup.
CREATE INDEX IF NOT EXISTS idx_auto_heal_log_producer_blocked_dedupe
  ON public.auto_heal_log (target_id, created_at DESC)
  WHERE action_type = 'producer_blocked_package_progress';

-- ---------- (1.2) admin_heal_dag_blocked_jobs: "forbidden" from cron ----------
-- pg_cron runs as `postgres` (or supabase_admin) without auth.uid().
-- Allow privileged DB sessions to bypass the JWT check; keep app-side admin gate.
CREATE OR REPLACE FUNCTION public.admin_heal_dag_blocked_jobs(
  p_package_id uuid DEFAULT NULL::uuid,
  p_dry_run boolean DEFAULT false,
  p_max_packages integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_cron boolean := session_user IN ('postgres','supabase_admin','service_role')
                    OR current_setting('request.jwt.claim.role', true) = 'service_role';
  v_run_id uuid := gen_random_uuid();
  v_actions jsonb := '[]'::jsonb;
  v_re_enqueued int := 0; v_steps_requeued int := 0; v_skipped int := 0;
  r record;
BEGIN
  -- Allow privileged DB sessions (cron/edge) OR authenticated admin
  IF NOT v_is_cron AND (v_uid IS NULL OR NOT has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.transition_source',
    'admin_dag_heal:'||COALESCE(v_uid::text, 'cron'), true);

  FOR r IN
    SELECT DISTINCT ON (package_id, parent_step_key)
           package_id, package_title, step_key, parent_step_key,
           parent_step_status, parent_active_jobs, block_reason, bronze_locked
    FROM v_dag_blocked_jobs
    WHERE parent_step_key IS NOT NULL
      AND block_reason IN ('parent_failed','parent_queued_no_job','parent_step_missing','parent_done_drift')
      AND (p_package_id IS NULL OR package_id = p_package_id)
    ORDER BY package_id, parent_step_key
    LIMIT p_max_packages * 5
  LOOP
    IF p_dry_run THEN
      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id, 'parent_step', r.parent_step_key,
        'reason', r.block_reason, 'action', 'would_heal');
      CONTINUE;
    END IF;

    IF r.parent_step_status = 'failed' THEN
      UPDATE package_steps
         SET status = 'queued', last_error = NULL,
             meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
               'dag_heal_reset_at', now(), 'dag_heal_run_id', v_run_id)
       WHERE package_id = r.package_id AND step_key = r.parent_step_key;
      v_steps_requeued := v_steps_requeued + 1;
    END IF;

    IF r.parent_active_jobs = 0 THEN
      INSERT INTO job_queue (job_type, package_id, status, run_after, payload, meta)
      VALUES (
        'package_' || r.parent_step_key, r.package_id, 'pending', now(),
        jsonb_build_object('package_id', r.package_id,
                           'bronze_lock_override', true,
                           'enqueue_source', 'dag_blocked_auto_heal'),
        jsonb_build_object('enqueue_source', 'dag_blocked_auto_heal',
                           'dag_heal_run_id', v_run_id,
                           'block_reason', r.block_reason,
                           'bronze_locked', COALESCE(r.bronze_locked, false))
      );
      v_re_enqueued := v_re_enqueued + 1;
      v_actions := v_actions || jsonb_build_object(
        'package_id', r.package_id, 'parent_step', r.parent_step_key,
        'reason', r.block_reason, 'action', 'parent_re_enqueued');
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'dag_blocked_auto_heal',
    CASE WHEN p_package_id IS NULL THEN 'system' ELSE 'package' END,
    p_package_id::text,
    CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    jsonb_build_object('run_id', v_run_id,
                       'parents_re_enqueued', v_re_enqueued,
                       'steps_requeued', v_steps_requeued,
                       'skipped_parent_active', v_skipped,
                       'invoked_by', CASE WHEN v_is_cron THEN 'cron' ELSE 'admin' END,
                       'actions', v_actions));

  RETURN jsonb_build_object('run_id', v_run_id, 'dry_run', p_dry_run,
                            'parents_re_enqueued', v_re_enqueued,
                            'steps_requeued', v_steps_requeued,
                            'skipped_parent_active', v_skipped,
                            'actions', v_actions);
END $function$;

-- ---------- (1.3) fn_emit_b2b_renewal_intents: schema drift ----------
-- auto_heal_log.payload no longer exists; the canonical column is `metadata`.
CREATE OR REPLACE FUNCTION public.fn_emit_b2b_renewal_intents(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
  v_skipped int := 0;
  v_today date := current_date;
  rec record;
  v_intent text;
  v_kind text;
  v_dedupe text;
BEGIN
  FOR rec IN
    SELECT l.id AS license_id, l.org_id, l.product_id, l.ends_at,
           l.seat_count, l.seats_used,
           CASE
             WHEN l.ends_at::date - v_today BETWEEN 0 AND 2 THEN 'org_seat_expiring_1d'
             WHEN l.ends_at::date - v_today BETWEEN 6 AND 8 THEN 'org_seat_expiring_7d'
             WHEN l.ends_at::date - v_today BETWEEN 13 AND 15 THEN 'org_seat_expiring_14d'
             WHEN l.ends_at::date - v_today BETWEEN 28 AND 32 THEN 'org_seat_expiring_30d'
             ELSE NULL
           END AS stage,
           m.user_id
    FROM public.org_licenses l
    JOIN public.org_memberships m
      ON m.org_id = l.org_id
     AND m.status = 'active'
     AND m.role IN ('owner','admin')
    WHERE l.status = 'active'
      AND l.ends_at IS NOT NULL
      AND COALESCE(l.cancel_at_period_end, false) = false
  LOOP
    CONTINUE WHEN rec.stage IS NULL;

    v_intent := rec.stage;
    v_kind := CASE WHEN rec.stage = 'org_seat_expiring_1d'
                   THEN 'org_seat_expiring_critical'
                   ELSE 'org_seat_expiring' END;
    v_dedupe := v_intent || ':' || rec.license_id::text || ':' || rec.user_id::text || ':' || v_today::text;

    IF p_dry_run THEN
      v_inserted := v_inserted + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.notification_jobs
        (user_id, curriculum_id, kind, channel, state, dedupe_key, payload, scheduled_for, expires_at)
      VALUES
        (rec.user_id, NULL, v_kind, 'push', 'pending', v_dedupe,
         jsonb_build_object(
           'intent_key', v_intent,
           'org_id', rec.org_id,
           'license_id', rec.license_id,
           'product_id', rec.product_id,
           'ends_at', rec.ends_at,
           'seat_count', rec.seat_count,
           'seats_used', rec.seats_used,
           'source', 'b2b_renewal_producer'
         ),
         now(),
         rec.ends_at + interval '7 days');
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  -- Canonical column: metadata (was: payload — drifted)
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('b2b_renewal_intent_producer', 'system',
          CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
          jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'dry_run', p_dry_run));

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'dry_run', p_dry_run);
END;
$function$;

-- ---------- Audit trail ----------
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'cron_repair_pack_phase1',
  'system',
  'cron_consolidation_2026_06_17',
  'success',
  jsonb_build_object(
    'fixes', jsonb_build_array(
      'fn_should_log_blocked_skip:index_added',
      'admin_heal_dag_blocked_jobs:cron_bypass',
      'fn_emit_b2b_renewal_intents:schema_drift_payload_to_metadata'
    ),
    'expected_impact', 'eliminate ~1500 cron failures/day',
    'phase', 'cron_consolidation.bundle_repair.1'
  )
);
