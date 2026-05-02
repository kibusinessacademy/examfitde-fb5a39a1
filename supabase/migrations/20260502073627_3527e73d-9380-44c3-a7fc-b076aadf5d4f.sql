-- Pattern X12: Enqueue-Dedup Burst-Window Guard
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_priority integer DEFAULT 0,
  p_max_attempts integer DEFAULT 25,
  p_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id uuid, created boolean, duplicate boolean, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_step_key text; v_existing record; v_new_id uuid;
  v_recent_completed_count int; v_step_status text; v_mapped_step text;
  v_active_count int; v_is_incremental_dispatcher boolean;
  v_fanout_cap int; v_zero_progress_threshold int;
  v_pkg_status text;
  v_enqueue_source text;
  v_enforce_source_at timestamptz := '2026-05-09 00:00:00+00'::timestamptz;
  v_qtype record;
  v_recent_any record;
  v_lock_key bigint;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');
  v_enqueue_source := coalesce(p_payload->>'enqueue_source','');

  IF v_enqueue_source = '' THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES (
      CASE WHEN now() >= v_enforce_source_at THEN 'enqueue_source_missing_blocked'
           ELSE 'enqueue_source_missing_warn' END,
      'enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),
      CASE WHEN now() >= v_enforce_source_at THEN 'rejected' ELSE 'warn' END,
      'Missing enqueue_source tag in payload for '||p_job_type,
      jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,
                         'phase', CASE WHEN now() >= v_enforce_source_at THEN 'enforce' ELSE 'warn' END));
    IF now() >= v_enforce_source_at THEN
      RETURN QUERY SELECT NULL::uuid, false, false, 'enqueue_source_missing'::text; RETURN;
    END IF;
  END IF;

  SELECT * INTO v_qtype FROM public.job_type_quarantine
   WHERE job_type = p_job_type AND cleared_at IS NULL AND blocked_until > now() LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id,
                                     result_status, result_detail, metadata)
    VALUES ('enqueue_blocked_job_type_quarantined','enqueue_job_if_absent','job',
            COALESCE(p_package_id::text,'null'),'rejected',
            format('Job-Type %s quarantined until %s', p_job_type, v_qtype.blocked_until),
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,
                               'enqueue_source',v_enqueue_source,
                               'blocked_until',v_qtype.blocked_until,'reason',v_qtype.reason));
    RETURN QUERY SELECT NULL::uuid, false, false, 'job_type_quarantined'::text; RETURN;
  END IF;

  IF public.fn_step_already_terminal(p_job_type, p_package_id) THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_phantom_blocked','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Step already done/skipped for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',replace(p_job_type,'package_','')));
    RETURN QUERY SELECT NULL::uuid, false, false, 'phantom_blocked'::text; RETURN;
  END IF;

  IF p_package_id IS NOT NULL AND public.fn_job_type_requires_building(p_job_type) THEN
    SELECT cp.status INTO v_pkg_status FROM public.course_packages cp WHERE cp.id = p_package_id;
    IF v_pkg_status IS NULL OR v_pkg_status <> 'building' THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      RETURN QUERY SELECT NULL::uuid, false, false, 'non_building_blocked'::text; RETURN;
    END IF;
  END IF;

  -- ── Pattern X12: Burst-Race Guard via advisory_xact_lock ──
  IF p_package_id IS NOT NULL THEN
    v_lock_key := hashtextextended(p_job_type || '|' || p_package_id::text || '|' || v_step_key, 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);
  END IF;

  -- ── Pattern X12: 30s Cooldown-Window ──
  IF p_package_id IS NOT NULL THEN
    SELECT jq.id, jq.status, jq.updated_at, jq.last_error_code
      INTO v_recent_any
      FROM public.job_queue jq
     WHERE jq.job_type = p_job_type
       AND jq.package_id = p_package_id
       AND coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
       AND jq.updated_at > now() - interval '30 seconds'
     ORDER BY jq.updated_at DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_dedup_cooldown_x12','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              format('Cooldown 30s active — last job %s status=%s @ %s', v_recent_any.id, v_recent_any.status, v_recent_any.updated_at),
              jsonb_build_object('pattern','X12','job_type',p_job_type,'package_id',p_package_id,
                                 'step_key',v_step_key,'enqueue_source',v_enqueue_source,
                                 'last_job_id',v_recent_any.id,'last_status',v_recent_any.status,
                                 'last_updated_at',v_recent_any.updated_at,
                                 'last_error_code',v_recent_any.last_error_code,
                                 'age_ms', extract(epoch from (now() - v_recent_any.updated_at))*1000));
      RETURN QUERY SELECT v_recent_any.id, false, true, 'cooldown_dedup'::text; RETURN;
    END IF;
  END IF;

  v_is_incremental_dispatcher := p_job_type IN (
    'package_generate_learning_content','package_finalize_learning_content',
    'package_generate_handbook','package_generate_lesson_minichecks',
    'package_enqueue_handbook_expand','package_fanout_learning_content'
  );
  v_fanout_cap := CASE WHEN v_is_incremental_dispatcher THEN 5 ELSE 3 END;
  v_zero_progress_threshold := CASE WHEN v_is_incremental_dispatcher THEN 8 ELSE 3 END;

  SELECT jq.id, jq.status INTO v_existing FROM public.job_queue jq
  WHERE jq.job_type = p_job_type
    AND coalesce(jq.package_id::text,'') = coalesce(p_package_id::text,'')
    AND coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    AND jq.status in ('pending','queued','processing','running','batch_pending')
  ORDER BY jq.created_at DESC LIMIT 1;
  IF found THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_dedupe','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Duplicate active job for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,'existing_id',v_existing.id,'existing_status',v_existing.status,'enqueue_source',v_enqueue_source));
    RETURN QUERY SELECT v_existing.id, false, true, 'duplicate_active'::text; RETURN;
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT count(*) INTO v_active_count FROM public.job_queue jq
    WHERE jq.job_type = p_job_type AND jq.package_id = p_package_id
      AND jq.status in ('pending','queued','processing','running','batch_pending');
    IF v_active_count >= v_fanout_cap THEN
      INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_fanout_cap','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Fanout cap reached for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'active_count',v_active_count,'cap',v_fanout_cap,'enqueue_source',v_enqueue_source));
      RETURN QUERY SELECT NULL::uuid, false, false, 'fanout_capped'::text; RETURN;
    END IF;
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT count(*) INTO v_recent_completed_count FROM public.job_queue jq
    WHERE jq.job_type = p_job_type AND jq.package_id = p_package_id
      AND jq.status='completed' AND jq.updated_at > now() - interval '2 hours';
    IF v_recent_completed_count >= v_zero_progress_threshold THEN
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      SELECT ps.status::text INTO v_step_status FROM public.package_steps ps
      WHERE ps.package_id = p_package_id AND ps.step_key = v_mapped_step LIMIT 1;
      IF v_step_status IS NOT NULL AND v_step_status NOT IN ('done','skipped') THEN
        INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('enqueue_zero_progress','enqueue_job_if_absent','job',p_package_id::text,'rejected',
                'Zero-progress block for '||p_job_type,
                jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'completed_2h',v_recent_completed_count,'threshold',v_zero_progress_threshold,'step_status',v_step_status,'enqueue_source',v_enqueue_source));
        RETURN QUERY SELECT NULL::uuid, false, false, 'zero_progress_blocked'::text; RETURN;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  VALUES (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  RETURNING job_queue.id INTO v_new_id;
  RETURN QUERY SELECT v_new_id, true, false, 'pending'::text;
END;
$function$;

-- Heilung Gießereimechaniker
WITH cancelled_jobs AS (
  UPDATE public.job_queue
     SET status = 'cancelled',
         updated_at = now(),
         last_error_code = 'PATTERN_X12_QC_LOOP_HEAL',
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'cancel_reason','PATTERN_X12_HEAL: quality_council loop terminated by manual heal',
           'cancelled_at', now())
   WHERE package_id = 'd1047bc8-6342-4f4c-9241-91f34bbf8abe'
     AND job_type IN ('package_quality_council','package_auto_publish')
     AND status IN ('pending','queued','failed','processing','running','batch_pending')
   RETURNING id, job_type, status
), step_reset AS (
  UPDATE public.package_steps
     SET status = 'queued',
         attempts = 0,
         updated_at = now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'pattern_x12_reset_at', now(),
           'pattern_x12_reset_reason','manual heal — quality_council loop terminated, fresh enqueue under X12 guard')
   WHERE package_id = 'd1047bc8-6342-4f4c-9241-91f34bbf8abe'
     AND step_key IN ('quality_council','auto_publish')
   RETURNING step_key, status
), audit AS (
  INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  SELECT 'pattern_x12_manual_heal','migration','package','d1047bc8-6342-4f4c-9241-91f34bbf8abe','success',
         'Gießereimechaniker quality_council loop terminated, steps reset to queued',
         jsonb_build_object('pattern','X12','package_id','d1047bc8-6342-4f4c-9241-91f34bbf8abe',
                            'cancelled_jobs',(SELECT jsonb_agg(row_to_json(c)) FROM cancelled_jobs c),
                            'reset_steps',(SELECT jsonb_agg(row_to_json(s)) FROM step_reset s))
  RETURNING 1
)
SELECT 1;