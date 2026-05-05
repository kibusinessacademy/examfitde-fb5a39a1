
-- ============================================================================
-- 1) AUTO-PROMOTE: course meets launch thresholds → set product visibility=public
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_auto_promote_ready_courses(_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_promoted int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
         OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  FOR v_row IN
    SELECT v.course_id, v.title, v.lessons_ready, v.minichecks_total,
           p.id AS product_id, p.visibility, p.slug
      FROM public.v_admin_course_pipeline_readiness v
      JOIN public.courses c ON c.id = v.course_id
      JOIN public.products p ON p.curriculum_id = c.curriculum_id AND p.status='active'
     WHERE v.course_status = 'published'
       AND v.lessons_ready  > 200
       AND v.minichecks_total > 10
       AND v.pending_jobs = 0
       AND v.failed_jobs  = 0
       AND p.visibility = 'private'
       AND EXISTS (SELECT 1 FROM public.product_prices pp
                    WHERE pp.product_id=p.id AND pp.active=true AND pp.stripe_price_id IS NOT NULL)
  LOOP
    IF _dry_run THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
        'product_id', v_row.product_id, 'would_promote', true);
      CONTINUE;
    END IF;

    UPDATE public.products SET visibility='public', updated_at=now() WHERE id=v_row.product_id;
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES ('launch_auto_promote','product', v_row.product_id, 'success',
            jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
                               'lessons_ready', v_row.lessons_ready,
                               'minichecks_total', v_row.minichecks_total,
                               'old_visibility','private','new_visibility','public',
                               'reason','meets_launch_thresholds'));
    v_promoted := v_promoted + 1;
    v_results := v_results || jsonb_build_object('course_id', v_row.course_id, 'title', v_row.title,
      'product_id', v_row.product_id, 'promoted', true);
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('launch_auto_promote_run','system','success',
          jsonb_build_object('promoted', v_promoted, 'dry_run', _dry_run, 'candidates', v_skipped));

  RETURN jsonb_build_object('ok', true, 'promoted', v_promoted, 'dry_run', _dry_run, 'results', v_results);
END $$;

REVOKE ALL ON FUNCTION public.admin_auto_promote_ready_courses(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auto_promote_ready_courses(boolean) TO service_role;

-- Hourly cron
SELECT cron.unschedule('auto-promote-ready-courses-hourly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname='auto-promote-ready-courses-hourly');
SELECT cron.schedule(
  'auto-promote-ready-courses-hourly', '13 * * * *',
  $$ SELECT public.admin_auto_promote_ready_courses(false); $$
);

-- ============================================================================
-- 2) LAUNCH QUEUE HEALTH ALERTS for cockpit
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_launch_queue_health_alerts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_relevant text[] := ARRAY[
    'lesson_generate_content','package_generate_lesson_minichecks',
    'package_validate_lesson_minichecks','council_recompute_course_ready',
    'package_generate_exam_pool','package_auto_publish'
  ];
  v_pending_old int; v_failed_24h int; v_stuck int;
  v_alerts jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT COUNT(*) INTO v_pending_old FROM public.job_queue
   WHERE status IN ('pending','queued') AND job_type=ANY(v_relevant)
     AND COALESCE(run_after, created_at) < now() - interval '30 minutes';

  SELECT COUNT(*) INTO v_failed_24h FROM public.job_queue
   WHERE status='failed' AND job_type=ANY(v_relevant)
     AND updated_at > now() - interval '24 hours';

  SELECT COUNT(*) INTO v_stuck FROM public.job_queue
   WHERE status='processing' AND job_type=ANY(v_relevant)
     AND COALESCE(started_at, updated_at) < now() - interval '20 minutes';

  IF v_pending_old > 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'id','launch_queue_pending_old','severity', CASE WHEN v_pending_old>50 THEN 'critical' ELSE 'high' END,
      'title','Launch-Queue: alte ausstehende Jobs',
      'detail', v_pending_old||' verkaufsrelevante Jobs >30min in pending/queued.',
      'action_label','Queue prüfen');
  END IF;
  IF v_failed_24h > 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'id','launch_queue_failed_24h','severity', CASE WHEN v_failed_24h>50 THEN 'critical' ELSE 'high' END,
      'title','Launch-Queue: Fehler letzten 24h',
      'detail', v_failed_24h||' fehlgeschlagene verkaufsrelevante Jobs in 24h.',
      'action_label','Failures öffnen');
  END IF;
  IF v_stuck > 0 THEN
    v_alerts := v_alerts || jsonb_build_object(
      'id','launch_queue_stuck','severity','critical',
      'title','Launch-Queue: festgefahrene Jobs',
      'detail', v_stuck||' Jobs in processing >20min.',
      'action_label','Reaper');
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'pending_older_30m', v_pending_old,
    'failed_24h', v_failed_24h,
    'stuck_processing', v_stuck,
    'is_healthy', (v_pending_old=0 AND v_failed_24h=0 AND v_stuck=0),
    'alerts', v_alerts
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_launch_queue_health_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_queue_health_alerts() TO authenticated, service_role;

-- ============================================================================
-- 3) THROTTLE log-flood for top-cluster heal-noise
--    Patch fn_heal_orphan_queued_steps and fn_materialize_ready_step_jobs
--    to log producer_blocked_package_progress at most once / package / hour.
--    Plus enqueue_source_missing_warn at most once / package / job_type / hour.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_should_log_blocked_skip(_package_id uuid, _producer text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.auto_heal_log
     WHERE action_type='producer_blocked_package_progress'
       AND target_id = _package_id::text
       AND COALESCE(metadata->>'producer','') = COALESCE(_producer,'')
       AND created_at > now() - interval '1 hour'
  );
$$;

-- Patch fn_heal_orphan_queued_steps: only log when throttle allows
CREATE OR REPLACE FUNCTION public.fn_heal_orphan_queued_steps(p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec RECORD;
  v_healed int := 0;
  v_skipped int := 0;
  v_pending int := 0;
  v_blocked int := 0;
  v_job_type text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.id AS step_id, cp.curriculum_id, cp.status::text AS pkg_status,
           COALESCE((ps.meta->>'last_enqueue_attempt')::timestamptz, 'epoch'::timestamptz) AS last_attempt
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'::step_status
      AND cp.status::text IN ('building','quality_gate_failed','blocked','planning','queued')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.payload->>'step_key' = ps.step_key
          AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
      )
    ORDER BY ps.updated_at ASC
    LIMIT p_limit
  LOOP
    IF public.fn_is_package_progress_blocked(v_rec.package_id) THEN
      v_blocked := v_blocked + 1;
      IF public.fn_should_log_blocked_skip(v_rec.package_id, 'fn_heal_orphan_queued_steps') THEN
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
        VALUES ('producer_blocked_package_progress','fn_heal_orphan_queued_steps','package',
                v_rec.package_id::text,'skipped',
                jsonb_build_object('producer','fn_heal_orphan_queued_steps',
                                   'reason','package_progress_blocked',
                                   'bronze_locked', public.fn_is_bronze_locked(v_rec.package_id),
                                   'step_key', v_rec.step_key,
                                   'throttled_window','1h'));
      END IF;
      CONTINUE;
    END IF;

    IF v_rec.last_attempt > now() - interval '5 minutes' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    SELECT sjm.job_types[1] INTO v_job_type
    FROM step_job_mapping sjm
    WHERE sjm.step_key = v_rec.step_key AND array_length(sjm.job_types, 1) > 0;
    IF v_job_type IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM step_dag_edges dag
      JOIN package_steps dep ON dep.package_id = v_rec.package_id AND dep.step_key = dag.depends_on
      WHERE dag.step_key = v_rec.step_key AND dep.status NOT IN ('done'::step_status,'skipped'::step_status)
    ) INTO v_has_unmet_deps;
    IF v_has_unmet_deps THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    BEGIN
      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, v_rec.package_id, 0, 3, now(),
        jsonb_build_object('package_id', v_rec.package_id,'curriculum_id', v_rec.curriculum_id,
          'step_key', v_rec.step_key,'enqueue_source','orphan_queued_heal'));
      IF v_enqueue_result.created THEN
        v_healed := v_healed + 1;
        UPDATE package_steps SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('last_enqueue_attempt', now())
         WHERE id = v_rec.step_id;
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('orphan_queued_heal','fn_heal_orphan_queued_steps','package_step',v_rec.package_id::text,'enqueued',
                'Healed orphan queued step '||v_rec.step_key,
                jsonb_build_object('package_id',v_rec.package_id,'step_key',v_rec.step_key,'job_type',v_job_type,'enqueue_source','orphan_queued_heal'));
      ELSE
        v_pending := v_pending + 1;
        UPDATE package_steps SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'last_enqueue_attempt', now(),
          'last_enqueue_reject_reason', COALESCE(v_enqueue_result.status,'enqueue_rejected'))
         WHERE id = v_rec.step_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES ('orphan_queued_heal_run','system',
    jsonb_build_object('healed',v_healed,'cooldown_skipped',v_pending,'skipped',v_skipped,'blocked',v_blocked,'limit',p_limit,'ran_at',now()));

  RETURN jsonb_build_object('ok',true,'healed',v_healed,'cooldown',v_pending,'skipped',v_skipped,'blocked',v_blocked);
END;
$function$;

-- Patch fn_materialize_ready_step_jobs analog
CREATE OR REPLACE FUNCTION public.fn_materialize_ready_step_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_zombies integer := 0;
  v_should_run boolean;
  v_blocked integer := 0;
  rec record;
BEGIN
  UPDATE job_queue SET started_at = NULL, locked_at = NULL, locked_by = NULL
   WHERE status = 'pending' AND started_at IS NOT NULL;
  GET DIAGNOSTICS v_zombies = ROW_COUNT;

  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, c.id as course_id, cp.track
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.curriculum_id = cp.curriculum_id
    WHERE cp.status = 'building' AND ps.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps dep ON dep.package_id = ps.package_id AND dep.step_key = dag.depends_on
        WHERE dag.step_key = ps.step_key AND dep.status NOT IN ('done', 'skipped'))
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status IN ('pending', 'processing'))
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status = 'completed' AND jq.completed_at > now() - interval '2 minutes')
  LOOP
    IF public.fn_is_package_progress_blocked(rec.package_id) THEN
      v_blocked := v_blocked + 1;
      IF public.fn_should_log_blocked_skip(rec.package_id, 'fn_materialize_ready_step_jobs') THEN
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
        VALUES ('producer_blocked_package_progress','fn_materialize_ready_step_jobs','package',
                rec.package_id::text,'skipped',
                jsonb_build_object('producer','fn_materialize_ready_step_jobs',
                                   'reason','package_progress_blocked',
                                   'bronze_locked', public.fn_is_bronze_locked(rec.package_id),
                                   'step_key', rec.step_key,
                                   'throttled_window','1h'));
      END IF;
      CONTINUE;
    END IF;

    v_should_run := true;
    IF rec.track IS NOT NULL THEN
      SELECT tsa.should_run INTO v_should_run FROM track_step_applicability tsa
       WHERE tsa.track = rec.track::product_track AND tsa.step_key = rec.step_key;
      IF v_should_run IS NULL THEN v_should_run := true; END IF;
    END IF;

    IF NOT v_should_run THEN
      UPDATE package_steps SET status='skipped', updated_at=now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'skip_reason','track_not_applicable','skipped_by','fn_materialize_ready_step_jobs','track', rec.track)
       WHERE package_id = rec.package_id AND step_key = rec.step_key AND status = 'queued';
      CONTINUE;
    END IF;

    INSERT INTO job_queue (job_type, package_id, payload, priority, status, created_at)
    VALUES ('package_' || rec.step_key, rec.package_id,
      jsonb_build_object('package_id', rec.package_id,'curriculum_id', rec.curriculum_id,
        'course_id', rec.course_id,'triggered_by','auto_materializer','enqueue_source','ready_materializer'),
      10, 'pending', now())
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Stricter throttle for enqueue_source_missing_warn (per package_id+job_type / hour)
CREATE OR REPLACE FUNCTION public.fn_should_log_enqueue_source_missing(
  p_job_type text, p_caller text DEFAULT NULL::text, p_sample_rate integer DEFAULT 100
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_recent_count integer;
BEGIN
  SELECT COUNT(*) INTO v_recent_count FROM auto_heal_log
   WHERE action_type='enqueue_source_missing_warn'
     AND created_at > now() - interval '1 hour'
     AND COALESCE(metadata->>'job_type','') = COALESCE(p_job_type,'')
     AND COALESCE(metadata->>'caller','') = COALESCE(p_caller,'');
  RETURN v_recent_count < 1;
END;
$function$;
