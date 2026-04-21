
-- ════════════════════════════════════════════════════════════════
-- P0a: Pre-Enqueue Guard pkg_status=building
-- ════════════════════════════════════════════════════════════════
-- Helper: list of job types that only make sense while package is building
CREATE OR REPLACE FUNCTION public.fn_job_type_requires_building(p_job_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_job_type IN (
    'package_generate_handbook',
    'package_generate_exam_pool',
    'package_validate_exam_pool',
    'package_generate_learning_content',
    'package_finalize_learning_content',
    'package_generate_lesson_minichecks',
    'package_enqueue_handbook_expand',
    'package_fanout_learning_content',
    'package_repair_exam_pool_quality',
    'package_repair_exam_pool_lf_coverage',
    'package_generate_blueprint_variants'
  );
$$;

-- ── Overload A: (p_job_type, p_package_id, p_priority, p_max_attempts, p_run_after, p_payload) ──
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_priority integer DEFAULT 0,
  p_max_attempts integer DEFAULT 25,
  p_run_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, created boolean, duplicate boolean, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_step_key text; v_existing record; v_new_id uuid;
  v_recent_completed_count int; v_step_status text; v_mapped_step text;
  v_active_count int; v_is_incremental_dispatcher boolean;
  v_fanout_cap int; v_zero_progress_threshold int;
  v_pkg_status text;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');
  v_is_incremental_dispatcher := p_job_type IN (
    'package_generate_learning_content','package_finalize_learning_content',
    'package_generate_handbook','package_generate_lesson_minichecks',
    'package_enqueue_handbook_expand','package_fanout_learning_content'
  );
  v_fanout_cap := CASE WHEN v_is_incremental_dispatcher THEN 5 ELSE 3 END;
  v_zero_progress_threshold := CASE WHEN v_is_incremental_dispatcher THEN 8 ELSE 3 END;

  -- ── P0a Guard: building-only jobtypes require pkg_status='building' ──
  if p_package_id is not null and public.fn_job_type_requires_building(p_job_type) then
    select cp.status into v_pkg_status from public.course_packages cp where cp.id = p_package_id;
    if v_pkg_status is null or v_pkg_status <> 'building' then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      return query select NULL::uuid, false, false, 'non_building_blocked'::text; return;
    end if;
  end if;

  select jq.id, jq.status into v_existing from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text,'') = coalesce(p_package_id::text,'')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending','queued','processing','running','batch_pending')
  order by jq.created_at desc limit 1;
  if found then
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('enqueue_dedupe','enqueue_job_if_absent','job',COALESCE(p_package_id::text,'null'),'rejected',
            'Duplicate active job for '||p_job_type,
            jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'step_key',v_step_key,'existing_id',v_existing.id,'existing_status',v_existing.status));
    return query select v_existing.id, false, true, 'duplicate_active'::text; return;
  end if;

  if p_package_id is not null then
    select count(*) into v_active_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status in ('pending','queued','processing','running','batch_pending');
    if v_active_count >= v_fanout_cap then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_fanout_cap','enqueue_job_if_absent','job',p_package_id::text,'rejected',
              'Fanout cap reached for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'active_count',v_active_count,'cap',v_fanout_cap));
      return query select NULL::uuid, false, false, 'fanout_capped'::text; return;
    end if;
  end if;

  if p_package_id is not null then
    select count(*) into v_recent_completed_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status='completed' and jq.updated_at > now() - interval '2 hours';
    if v_recent_completed_count >= v_zero_progress_threshold then
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      select ps.status::text into v_step_status from public.package_steps ps
      where ps.package_id = p_package_id and ps.step_key = v_mapped_step limit 1;
      if v_step_status is not null and v_step_status not in ('done','skipped') then
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('enqueue_zero_progress','enqueue_job_if_absent','job',p_package_id::text,'rejected',
                'Zero-progress block for '||p_job_type,
                jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'completed_2h',v_recent_completed_count,'threshold',v_zero_progress_threshold,'step_status',v_step_status));
        return query select NULL::uuid, false, false, 'zero_progress_blocked'::text; return;
      end if;
    end if;
  end if;

  insert into public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  values (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  returning job_queue.id into v_new_id;
  return query select v_new_id, true, false, 'pending'::text;
end;
$function$;

-- ── Overload B: (p_job_type, p_package_id, p_payload, p_priority, p_max_attempts, p_run_after) ──
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 100,
  p_max_attempts integer DEFAULT 5,
  p_run_after timestamp with time zone DEFAULT now()
)
RETURNS TABLE(job_id uuid, created boolean, deduped boolean, existing_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_step_key text;
  v_existing record;
  v_new_id uuid;
  v_recent_completed_count int;
  v_step_status text;
  v_mapped_step text;
  v_pkg_status text;
begin
  v_step_key := coalesce(p_payload->>'step_key', p_payload->>'step', p_payload->>'target_step', '');

  -- ── P0a Guard: building-only jobtypes require pkg_status='building' ──
  if p_package_id is not null and public.fn_job_type_requires_building(p_job_type) then
    select cp.status into v_pkg_status from public.course_packages cp where cp.id = p_package_id;
    if v_pkg_status is null or v_pkg_status <> 'building' then
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('enqueue_non_building_block','enqueue_job_if_absent_v2','job',p_package_id::text,'rejected',
              'Package not in building status for '||p_job_type,
              jsonb_build_object('job_type',p_job_type,'package_id',p_package_id,'pkg_status',v_pkg_status));
      return query select gen_random_uuid(), false, true, 'non_building_blocked'::text;
      return;
    end if;
  end if;

  select jq.id, jq.status into v_existing from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text, '') = coalesce(p_package_id::text, '')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending', 'queued', 'processing', 'running', 'batch_pending')
  order by jq.created_at desc limit 1;
  if found then
    return query select v_existing.id, false, true, v_existing.status;
    return;
  end if;

  if p_package_id is not null then
    select count(*) into v_recent_completed_count from public.job_queue jq
    where jq.job_type = p_job_type and jq.package_id = p_package_id
      and jq.status = 'completed' and jq.updated_at > now() - interval '2 hours';
    if v_recent_completed_count >= 3 then
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');
      select ps.status into v_step_status from public.package_steps ps
      where ps.package_id = p_package_id and ps.step_key = v_mapped_step limit 1;
      if v_step_status is not null and v_step_status not in ('done', 'skipped') then
        return query select gen_random_uuid(), false, true, 'zero_progress_blocked'::text;
        return;
      end if;
    end if;
  end if;

  insert into public.job_queue (job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at)
  values (p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after, p_payload, p_payload, now(), now())
  returning id into v_new_id;
  return query select v_new_id, true, false, 'pending'::text;
end;
$function$;

-- ════════════════════════════════════════════════════════════════
-- P0b: Stop auto_healed_meta_reset on non-building packages
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_auto_heal_hard_fail_repair_exhausted()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_healed int := 0; v_skipped int := 0;
  v_step record; v_q_count int; v_curriculum_id uuid;
  v_pkg_status text;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key, ps.status, cp.status AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.step_key = 'validate_exam_pool'
      AND cp.is_published = false
      AND ps.status NOT IN ('done','skipped')
      AND (
        ps.last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
        OR ps.meta->'reason_codes' ? 'HARD_FAIL_REPAIR_EXHAUSTED'
        OR ps.meta->>'guard_state' = 'hard_stalled'
        OR (ps.meta->>'consecutive_no_progress')::int >= 10
      )
  LOOP
    -- ── P0b Guard: only auto-heal when pkg is actively building ──
    IF v_step.pkg_status <> 'building' THEN
      v_skipped := v_skipped + 1;
      UPDATE package_steps
      SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'skip_reason','package_not_building_blocked',
            'auto_heal_skipped_at', now()::text,
            'pkg_status_at_skip', v_step.pkg_status
          ),
          updated_at = now()
      WHERE id = v_step.id;

      INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
      VALUES ('auto_heal_skipped_non_building','validate_exam_pool',
        jsonb_build_object('package_id',v_step.package_id,'pkg_status',v_step.pkg_status,'reason','P0b_guard'),
        ARRAY[v_step.package_id::text], now());
      CONTINUE;
    END IF;

    SELECT cp.curriculum_id INTO v_curriculum_id FROM course_packages cp WHERE cp.id = v_step.package_id;

    SELECT COUNT(*) INTO v_q_count
    FROM exam_questions eq
    JOIN curricula c ON c.certification_id = eq.certification_id
    JOIN course_packages cp2 ON cp2.curriculum_id = c.id
    WHERE cp2.id = v_step.package_id AND eq.qc_status IN ('approved','tier1_passed');

    UPDATE package_steps
    SET status = 'queued',
        last_error = format('AUTO_HEALED:meta_aware_reset_q=%s', v_q_count),
        meta = COALESCE(meta,'{}'::jsonb) - 'reason_codes'
          || jsonb_build_object('guard_state','recovering','consecutive_no_progress',0,
               'stall_reason_code','AUTO_HEALED_META_RESET',
               'auto_healed_at', now()::text,
               'auto_healed_q_count', v_q_count),
        updated_at = now()
    WHERE id = v_step.id;

    UPDATE job_queue SET status='cancelled', completed_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cancel_reason','auto_healed_meta_reset')
    WHERE package_id = v_step.package_id
      AND job_type = 'package_validate_exam_pool'
      AND status IN ('pending','queued','processing');

    INSERT INTO job_queue (package_id, job_type, status, priority, payload, created_at, lane)
    VALUES (v_step.package_id,'package_validate_exam_pool','pending',5,
      jsonb_build_object('source','auto_heal_meta_aware','q_count',v_q_count,
        'curriculum_id',v_curriculum_id,'is_repair',true),
      now(),'recovery');

    v_healed := v_healed + 1;

    INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
    VALUES ('auto_heal_repair_exhausted_meta_aware','validate_exam_pool',
      jsonb_build_object('package_id',v_step.package_id,'q_count',v_q_count,'trigger','meta_aware_v2'),
      ARRAY[v_step.package_id::text], now());
  END LOOP;

  RETURN jsonb_build_object('healed',v_healed,'skipped',v_skipped,
    'type','hard_fail_repair_exhausted_v2_meta_aware_p0b');
END;
$function$;
