
CREATE OR REPLACE FUNCTION public.enqueue_job_if_absent(
  p_job_type text,
  p_package_id uuid DEFAULT NULL::uuid,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 100,
  p_max_attempts integer DEFAULT 5,
  p_run_after timestamp with time zone DEFAULT now()
)
RETURNS TABLE(job_id uuid, created boolean, deduped boolean, existing_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_step_key text;
  v_existing record;
  v_new_id uuid;
  v_recent_completed_count int;
  v_step_status text;
  v_mapped_step text;
begin
  v_step_key := coalesce(
    p_payload->>'step_key',
    p_payload->>'step',
    p_payload->>'target_step',
    ''
  );

  -- ── Guard 1: Dedupe against active jobs ──
  select jq.id, jq.status
  into v_existing
  from public.job_queue jq
  where jq.job_type = p_job_type
    and coalesce(jq.package_id::text, '') = coalesce(p_package_id::text, '')
    and coalesce(jq.meta->>'step_key', jq.meta->>'step', jq.meta->>'target_step', '') = v_step_key
    and jq.status in ('pending', 'queued', 'processing', 'running', 'batch_pending')
  order by jq.created_at desc
  limit 1;

  if found then
    return query select v_existing.id, false, true, v_existing.status;
    return;
  end if;

  -- ── Guard 2: Zero-Progress-Guard ──
  -- Block re-enqueue if ≥3 completed jobs in last 2h but step is still not done.
  -- This catches the pattern: job completes → produces nothing → step stays queued → re-enqueue.
  if p_package_id is not null then
    -- Count recent completed jobs of same type for this package
    select count(*) into v_recent_completed_count
    from public.job_queue jq
    where jq.job_type = p_job_type
      and jq.package_id = p_package_id
      and jq.status = 'completed'
      and jq.updated_at > now() - interval '2 hours';

    if v_recent_completed_count >= 3 then
      -- Derive step_key from job_type (strip 'package_' prefix)
      v_mapped_step := regexp_replace(p_job_type, '^package_', '');

      -- Check if the step is still not done
      select ps.status into v_step_status
      from public.package_steps ps
      where ps.package_id = p_package_id
        and ps.step_key = v_mapped_step
      limit 1;

      -- Block only if step exists and is NOT done/skipped
      if v_step_status is not null
         and v_step_status not in ('done', 'skipped') then
        -- Return blocked signal instead of creating job
        return query select gen_random_uuid(), false, true, 'zero_progress_blocked'::text;
        return;
      end if;
    end if;
  end if;

  -- ── Create job ──
  insert into public.job_queue (
    job_type, package_id, status, priority, max_attempts, run_after, payload, meta, created_at, updated_at
  ) values (
    p_job_type, p_package_id, 'pending', p_priority, p_max_attempts, p_run_after,
    p_payload, p_payload, now(), now()
  )
  returning id into v_new_id;

  return query select v_new_id, true, false, 'pending'::text;
end;
$function$;
