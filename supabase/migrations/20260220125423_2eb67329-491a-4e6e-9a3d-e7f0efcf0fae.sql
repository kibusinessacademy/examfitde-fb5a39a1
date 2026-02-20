
CREATE OR REPLACE FUNCTION public.get_building_metrics()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  select jsonb_build_object(
    'active_by_jobs', (
      -- Only count 'processing' as truly active, NOT 'pending'
      select count(distinct payload->>'package_id')
      from public.job_queue
      where status = 'processing'
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
