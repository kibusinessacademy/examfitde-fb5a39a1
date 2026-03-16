
-- Atomic Recovery + Re-Entry RPC
create or replace function public.recover_and_reenter_package(
  p_package_id uuid,
  p_reason text,
  p_trigger_source text default 'auto_heal',
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg public.course_packages%rowtype;
  v_now timestamptz := now();
  v_active_jobs int := 0;
  v_blocked_steps int := 0;
  v_processing_steps int := 0;
  v_requeueable_steps int := 0;
  v_escalation_breaker boolean := false;
  v_reset_steps int := 0;
  v_reentered boolean := false;
  v_eligible boolean := false;
  v_final_status text;
  v_result jsonb;
begin
  -- 1) Lock package row
  select * into v_pkg from public.course_packages where id = p_package_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'package_id', p_package_id, 'error', 'PACKAGE_NOT_FOUND');
  end if;

  -- 2) Read guards
  select count(*) into v_active_jobs
  from public.job_queue jq
  where jq.package_id = p_package_id
    and jq.status in ('pending', 'queued', 'processing', 'running', 'batch_pending');

  select count(*) into v_blocked_steps
  from public.package_steps ps
  where ps.package_id = p_package_id and ps.status = 'blocked';

  select count(*) into v_processing_steps
  from public.package_steps ps
  where ps.package_id = p_package_id and ps.status = 'processing';

  select exists (
    select 1 from public.package_steps ps
    where ps.package_id = p_package_id
      and ps.step_key = 'validate_exam_pool'
      and coalesce(ps.last_error, '') ilike '%Escalation Breaker%'
  ) into v_escalation_breaker;

  -- 3) Hard stop: active jobs
  if v_active_jobs > 0 then
    insert into public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    values ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: active jobs exist', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'active_jobs', v_active_jobs, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    return jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status, 'reason', 'ACTIVE_JOBS_EXIST');
  end if;

  -- Hard stop: processing steps
  if v_processing_steps > 0 then
    insert into public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    values ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: processing steps exist', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'processing_steps', v_processing_steps, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    return jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', v_pkg.status, 'reason', 'PROCESSING_STEPS_EXIST');
  end if;

  -- Hard stop: escalation breaker
  if v_escalation_breaker then
    insert into public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
    values ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text, 'skipped', 'Skipped: escalation breaker present', v_now,
      jsonb_build_object('package_status', v_pkg.status, 'escalation_breaker', true, 'reason', p_reason, 'actor_user_id', p_actor_user_id));
    return jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', 0, 'eligible_for_reentry', false, 'reentered', false, 'final_status', 'blocked', 'reason', 'ESCALATION_BREAKER_PRESENT');
  end if;

  -- 4) Reset eligible steps to queued
  update public.package_steps ps
  set status = 'queued', updated_at = v_now, started_at = null, completed_at = null,
      last_error = left(coalesce(ps.last_error, '') || ' | reset:' || p_reason, 1000),
      meta = coalesce(ps.meta, '{}'::jsonb) || jsonb_build_object('recovered_at', v_now, 'recovery_reason', p_reason, 'recovery_trigger_source', p_trigger_source)
  where ps.package_id = p_package_id
    and ps.status in ('failed', 'blocked', 'skipped');
  get diagnostics v_reset_steps = row_count;

  -- 5) Recompute eligibility
  select count(*) into v_requeueable_steps
  from public.package_steps ps
  where ps.package_id = p_package_id and ps.status = 'queued';

  v_eligible := (v_requeueable_steps > 0);

  -- 6) Atomic re-entry
  if v_eligible then
    update public.course_packages set status = 'building', updated_at = v_now where id = p_package_id;
    v_reentered := true;
    v_final_status := 'building';
  else
    v_final_status := v_pkg.status;
  end if;

  -- 7) Audit log
  insert into public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, created_at, metadata)
  values ('recover_and_reenter_package', p_trigger_source, 'course_package', p_package_id::text,
    case when v_reentered then 'success' else 'skipped' end,
    case when v_reentered then 'Recovered and re-entered into building'
         when v_reset_steps > 0 then 'Reset steps but not eligible for re-entry'
         else 'No steps to reset' end,
    v_now,
    jsonb_build_object(
      'package_status_before', v_pkg.status, 'package_status_after', v_final_status,
      'reset_steps', v_reset_steps, 'eligible_for_reentry', v_eligible, 'reentered', v_reentered,
      'active_jobs', v_active_jobs, 'blocked_steps', v_blocked_steps, 'processing_steps', v_processing_steps,
      'requeueable_steps_after', v_requeueable_steps, 'escalation_breaker', v_escalation_breaker,
      'reason', p_reason, 'actor_user_id', p_actor_user_id));

  return jsonb_build_object('ok', true, 'package_id', p_package_id, 'reset_steps', v_reset_steps,
    'eligible_for_reentry', v_eligible, 'reentered', v_reentered, 'final_status', v_final_status, 'reason', p_reason);
end;
$$;

comment on function public.recover_and_reenter_package(uuid, text, text, uuid) is
  'Atomically resets failed/blocked/skipped steps and re-enters package into building when eligible. Single recovery path to prevent re-entry misses.';

-- Monitoring view for re-entry misses
create or replace view public.v_ops_reentry_misses as
select
  cp.id as package_id,
  cp.title,
  cp.status,
  cp.updated_at,
  count(*) as open_steps
from public.course_packages cp
join public.package_steps ps on ps.package_id = cp.id
where cp.status = 'queued'
  and ps.status = 'queued'
  and not exists (
    select 1 from public.job_queue jq
    where jq.package_id = cp.id
      and jq.status in ('pending', 'queued', 'processing', 'running', 'batch_pending')
  )
  and not exists (
    select 1 from public.package_steps ps2
    where ps2.package_id = cp.id and ps2.status = 'blocked'
  )
group by cp.id, cp.title, cp.status, cp.updated_at;

comment on view public.v_ops_reentry_misses is
  'Detects packages stuck in queued with open steps but no active jobs — indicates a recovery that forgot re-entry.';
