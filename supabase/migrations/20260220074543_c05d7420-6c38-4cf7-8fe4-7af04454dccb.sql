
-- RPC to get accurate building metrics based on jobs/leases (not just status field)
create or replace function public.get_building_metrics()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'active_by_jobs', (
      select count(distinct payload->>'package_id')
      from public.job_queue
      where status in ('pending','processing')
        and payload ? 'package_id'
    ),
    'active_by_leases', (
      select count(distinct package_id)
      from public.package_leases
      where lease_until > now()
    ),
    'status_building', (
      select count(*)
      from public.course_packages
      where status = 'building'
    ),
    'zombies', (
      select count(*)
      from public.ops_building_without_job_or_lease
    )
  );
$$;
