
-- Performance indexes for get_building_metrics / ops_building_without_job_or_lease
create index if not exists job_queue_status_idx
  on public.job_queue(status);

create index if not exists job_queue_payload_package_id_idx
  on public.job_queue ((payload->>'package_id'));

create index if not exists package_leases_lease_until_idx
  on public.package_leases(lease_until);

create index if not exists package_leases_package_id_idx
  on public.package_leases(package_id);

-- RPC security: only authenticated users
revoke all on function public.get_building_metrics() from public;
grant execute on function public.get_building_metrics() to authenticated;

-- Early-warning view: building set < 15 min ago without lease
create or replace view public.ops_recent_building_without_lease
with (security_invoker = on) as
select
  cp.id as package_id,
  cp.title,
  cp.updated_at,
  cp.last_progress_at
from public.course_packages cp
left join public.package_leases pl
  on pl.package_id = cp.id and pl.lease_until > now()
where cp.status = 'building'
  and pl.package_id is null
  and cp.updated_at > now() - interval '15 minutes';
