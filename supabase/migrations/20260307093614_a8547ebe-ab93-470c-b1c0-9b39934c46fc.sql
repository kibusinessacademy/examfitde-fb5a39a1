
-- SSOT RPCs for job inflight counting (replaces fragile JSON-path filters)

create or replace function public.count_package_inflight_jobs(p_package_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::int
  from public.job_queue jq
  where jq.status in ('queued', 'pending', 'processing')
    and jq.package_id = p_package_id;
$$;

create or replace function public.count_global_inflight_lesson_jobs()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::int
  from public.job_queue jq
  where jq.status in ('queued', 'pending', 'processing')
    and jq.job_type = 'lesson_generate_content';
$$;

create or replace function public.count_leased_building_packages()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::int
  from public.course_packages cp
  where cp.status = 'building'
    and exists (
      select 1
      from public.package_leases pl
      where pl.package_id = cp.id
        and pl.lease_until > now()
    );
$$;
