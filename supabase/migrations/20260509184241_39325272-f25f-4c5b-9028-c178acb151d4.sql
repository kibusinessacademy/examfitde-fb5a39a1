CREATE OR REPLACE FUNCTION public.fn_enqueue_competency_fill_for_gap_packages(p_max_per_run integer DEFAULT 25, p_cooldown_minutes integer DEFAULT 30)
 RETURNS TABLE(package_id uuid, action text, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pkg record;
  v_action text;
  v_reason text;
  v_recent_job_at timestamptz;
begin
  for v_pkg in
    select 
      g.package_id,
      g.coverage_pct,
      g.track_min_pct,
      g.gap_pp,
      cp.status as pkg_status,
      cp.blocked_reason,
      cp.curriculum_id
    from public.v_package_coverage_gap g
    join public.course_packages cp on cp.id = g.package_id
    where g.gap_severity = 'gap_blocking_publish'
      and (
        cp.status in ('building','queued')
        or (cp.status = 'blocked' and cp.blocked_reason in ('content_gap','quality_no_progress_3x'))
      )
      and cp.curriculum_id is not null
    order by g.gap_pp desc
    limit p_max_per_run
  loop
    select max(created_at) into v_recent_job_at
    from public.job_queue
    where job_type = 'package_repair_exam_pool_competency_coverage'
      and (payload->>'package_id')::uuid = v_pkg.package_id
      and created_at > now() - (p_cooldown_minutes || ' minutes')::interval;

    if v_recent_job_at is not null then
      package_id := v_pkg.package_id;
      action := 'skipped';
      reason := 'cooldown_active';
      return next;
      continue;
    end if;

    if v_pkg.pkg_status = 'blocked' then
      update public.course_packages
      set status = 'building',
          blocked_reason = null,
          blocked_at = null,
          updated_at = now()
      where id = v_pkg.package_id;

      insert into public.system_heal_log (heal_type, package_id, details)
      values (
        'auto_unblock_for_competency_fill',
        v_pkg.package_id,
        jsonb_build_object(
          'previous_blocked_reason', v_pkg.blocked_reason,
          'coverage_pct', v_pkg.coverage_pct,
          'track_min_pct', v_pkg.track_min_pct
        )
      );

      v_action := 'unblocked_and_enqueued';
    elsif v_pkg.pkg_status = 'queued' then
      v_action := 'enqueued_from_queued';
    else
      v_action := 'enqueued';
    end if;

    perform public.enqueue_job_if_absent(
      'package_repair_exam_pool_competency_coverage'::text,
      v_pkg.package_id,
      60::integer,
      3::integer,
      now(),
      jsonb_build_object(
        'package_id', v_pkg.package_id,
        'curriculum_id', v_pkg.curriculum_id,
        'reason', 'coverage_gap_blocking_publish',
        'coverage_pct', v_pkg.coverage_pct,
        'track_min_pct', v_pkg.track_min_pct,
        'gap_pp', v_pkg.gap_pp,
        'enqueued_by', 'fn_enqueue_competency_fill_for_gap_packages',
        'bronze_lock_override', true,
        'enqueue_source', 'producer_coverage_gap_v2'
      )
    );

    v_reason := format('coverage=%s%% < min=%s%% (gap=%s pp)',
                       round(v_pkg.coverage_pct::numeric,1),
                       round(v_pkg.track_min_pct::numeric,1),
                       round(v_pkg.gap_pp::numeric,1));

    package_id := v_pkg.package_id;
    action := v_action;
    reason := v_reason;
    return next;
  end loop;

  insert into public.auto_heal_log (action_type, target_type, result_status, metadata)
  values (
    'producer_coverage_gap_v2_run',
    'system',
    'ok',
    jsonb_build_object('max_per_run', p_max_per_run, 'cooldown_minutes', p_cooldown_minutes, 'ran_at', now())
  );
end;
$function$;