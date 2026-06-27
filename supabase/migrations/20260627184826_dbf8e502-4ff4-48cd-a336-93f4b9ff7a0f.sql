create table if not exists public.store_ops_autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  state text not null default 'planned',
  risk_score integer not null default 0,
  risk_level text not null default 'low',
  safe_count integer not null default 0,
  manual_count integer not null default 0,
  blocked_count integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  estimated_runtime_seconds integer not null default 0,
  recommended_sequence text[] not null default '{}',
  next_manual_step text,
  warnings jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.store_ops_autopilot_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.store_ops_autopilot_runs(id) on delete cascade,
  manifest_id uuid,
  action_type text not null,
  status text not null,
  blockers jsonb not null default '[]'::jsonb,
  message text,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_store_ops_autopilot_actions_run on public.store_ops_autopilot_actions(run_id);

grant select on public.store_ops_autopilot_runs to authenticated;
grant all on public.store_ops_autopilot_runs to service_role;
grant select on public.store_ops_autopilot_actions to authenticated;
grant all on public.store_ops_autopilot_actions to service_role;

alter table public.store_ops_autopilot_runs enable row level security;
alter table public.store_ops_autopilot_actions enable row level security;

drop policy if exists "admin read store_ops_autopilot_runs" on public.store_ops_autopilot_runs;
create policy "admin read store_ops_autopilot_runs"
  on public.store_ops_autopilot_runs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "admin read store_ops_autopilot_actions" on public.store_ops_autopilot_actions;
create policy "admin read store_ops_autopilot_actions"
  on public.store_ops_autopilot_actions for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.store_ops_autopilot_actions_append_only()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return coalesce(NEW, OLD);
  end if;
  raise exception 'store_ops_autopilot_actions is append-only';
end $$;

drop trigger if exists trg_store_ops_autopilot_actions_no_update on public.store_ops_autopilot_actions;
create trigger trg_store_ops_autopilot_actions_no_update
  before update or delete on public.store_ops_autopilot_actions
  for each row execute function public.store_ops_autopilot_actions_append_only();