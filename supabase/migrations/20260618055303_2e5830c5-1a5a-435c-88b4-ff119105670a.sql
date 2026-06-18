create table if not exists public.storage_attack_policies (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  synthetic_prefix text not null default '__storage_audit__',
  allowed_buckets text[] not null default '{}'::text[],
  excluded_buckets text[] not null default '{}'::text[],
  max_objects_per_bucket int not null default 2,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

grant select on public.storage_attack_policies to authenticated;
grant all on public.storage_attack_policies to service_role;

alter table public.storage_attack_policies enable row level security;

drop policy if exists "admin read attack policies" on public.storage_attack_policies;
create policy "admin read attack policies"
  on public.storage_attack_policies for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "admin write attack policies" on public.storage_attack_policies;
create policy "admin write attack policies"
  on public.storage_attack_policies for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

insert into public.storage_attack_policies (enabled, notes)
select false, 'Phase 1 kill-switch — admin must enable explicitly before attack runs'
where not exists (select 1 from public.storage_attack_policies);

alter table public.storage_audit_runs
  add column if not exists run_kind text not null default 'inventory';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'storage_audit_runs_run_kind_check'
  ) then
    alter table public.storage_audit_runs
      add constraint storage_audit_runs_run_kind_check
      check (run_kind in ('inventory','attack'));
  end if;
end $$;

alter table public.storage_attack_run_results
  add column if not exists synthetic_tenant text,
  add column if not exists target_path text,
  add column if not exists severity text default 'medium',
  add column if not exists content_class text default 'unknown';

update public.storage_attack_run_results set result = 'not_applicable' where result is null;
update public.storage_attack_run_results set severity = 'medium' where severity is null;

alter table public.storage_attack_run_results
  drop constraint if exists storage_attack_run_results_result_check;
alter table public.storage_attack_run_results
  add constraint storage_attack_run_results_result_check
  check (result in ('pass','leak','error','not_applicable','skipped'));

alter table public.storage_attack_run_results
  drop constraint if exists storage_attack_run_results_severity_check;
alter table public.storage_attack_run_results
  add constraint storage_attack_run_results_severity_check
  check (severity in ('info','low','medium','high','critical'));

create or replace view public.v_admin_storage_attack_kpis as
select
  (select count(*) from public.storage_audit_runs where run_kind = 'attack') as total_attack_runs,
  (select count(*) from public.storage_attack_run_results) as total_attack_results,
  (select count(*) from public.storage_attack_run_results where result = 'leak') as total_leaks,
  (select count(*) from public.storage_attack_run_results where result = 'leak' and severity in ('high','critical')) as critical_leaks,
  (select count(distinct bucket_id) from public.storage_attack_run_results where result = 'leak') as buckets_with_leaks,
  (select max(started_at) from public.storage_audit_runs where run_kind = 'attack') as last_attack_run_at;

grant select on public.v_admin_storage_attack_kpis to authenticated;

create or replace function public.admin_storage_attack_enqueue()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_enabled boolean;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'forbidden';
  end if;

  select enabled into v_enabled from public.storage_attack_policies limit 1;
  if v_enabled is not true then
    raise exception 'attack simulation disabled - set storage_attack_policies.enabled=true first';
  end if;

  insert into public.storage_audit_runs (triggered_by, source, status, run_kind)
  values (auth.uid(), 'admin_ui_attack', 'queued', 'attack')
  returning id into v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.admin_storage_attack_enqueue() from public;
grant execute on function public.admin_storage_attack_enqueue() to authenticated;