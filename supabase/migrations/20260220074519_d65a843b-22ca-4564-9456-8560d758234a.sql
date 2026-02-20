
create or replace view public.ops_building_without_job_or_lease as
with active_pkg as (
  select distinct payload->>'package_id' as package_id
  from public.job_queue
  where status in ('pending','processing')
    and payload ? 'package_id'
),
leased_pkg as (
  select distinct package_id::text as package_id
  from public.package_leases
  where lease_until > now()
)
select
  cp.id as package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.updated_at,
  cp.last_progress_at
from public.course_packages cp
left join active_pkg a on a.package_id = cp.id::text
left join leased_pkg l on l.package_id = cp.id::text
where cp.status = 'building'
  and a.package_id is null
  and l.package_id is null;
