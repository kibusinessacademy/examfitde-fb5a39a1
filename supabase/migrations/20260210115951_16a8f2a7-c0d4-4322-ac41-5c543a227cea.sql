
-- Phase 2: Council Governance Tables
-- council_states, council_automations, council_recommendations, council_events

create table if not exists public.council_states (
  council_id text primary key,
  is_paused boolean not null default false,
  kill_switch boolean not null default false,
  status text not null default 'ok',
  last_snapshot jsonb,
  last_snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.council_automations (
  id uuid primary key default gen_random_uuid(),
  council_id text not null,
  automation_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (council_id, automation_key)
);

create table if not exists public.council_recommendations (
  id uuid primary key default gen_random_uuid(),
  council_id text not null,
  title text not null,
  details text,
  impact text not null default 'medium',
  risk text not null default 'low',
  entity_type text,
  entity_id uuid,
  status text not null default 'open',
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.council_events (
  id uuid primary key default gen_random_uuid(),
  council_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz not null default now()
);

-- updated_at triggers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_council_states_updated
before update on public.council_states
for each row execute function public.set_updated_at();

create trigger trg_council_automations_updated
before update on public.council_automations
for each row execute function public.set_updated_at();

create trigger trg_council_recommendations_updated
before update on public.council_recommendations
for each row execute function public.set_updated_at();

-- Seed default council states
insert into public.council_states (council_id) values
  ('education'), ('exam'), ('marketing'), ('product'), ('tech'), ('legal'), ('analytics'), ('operations')
on conflict (council_id) do nothing;

-- Seed default automations
insert into public.council_automations (council_id, automation_key, enabled) values
  ('education', 'auto_improve', true),
  ('education', 'auto_validate', true),
  ('tech', 'job_maintenance', true),
  ('operations', 'budget_guard', true)
on conflict (council_id, automation_key) do nothing;

-- RLS: admin-only
alter table public.council_states enable row level security;
alter table public.council_automations enable row level security;
alter table public.council_recommendations enable row level security;
alter table public.council_events enable row level security;

create policy "Admin only council_states"
on public.council_states for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin only council_automations"
on public.council_automations for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin only council_recommendations"
on public.council_recommendations for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin only council_events"
on public.council_events for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));
