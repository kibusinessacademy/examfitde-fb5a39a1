
-- Phase 3 Sprint 1: Autopilot Settings, Decision Items, Risk Scores

-- 1) Autopilot Settings per Council
create table if not exists public.council_autopilot_settings (
  council_id text primary key,
  enabled boolean not null default false,
  allowed_actions jsonb not null default '[]'::jsonb,
  max_daily_actions int not null default 10,
  risk_threshold text not null default 'medium',
  requires_approval_above_risk text not null default 'high',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed defaults
insert into public.council_autopilot_settings (council_id, allowed_actions) values
  ('education', '["auto_improve","auto_validate"]'::jsonb),
  ('exam', '["generate_variants"]'::jsonb),
  ('marketing', '["content_draft","validate_content"]'::jsonb),
  ('product', '["quality_gate_check"]'::jsonb),
  ('tech', '["requeue_failed_jobs"]'::jsonb),
  ('legal', '["compliance_scan"]'::jsonb),
  ('analytics', '["kpi_aggregate"]'::jsonb),
  ('operations', '["budget_check"]'::jsonb)
on conflict (council_id) do nothing;

-- 2) Decision Items (cross-council prioritized queue)
create table if not exists public.decision_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  council_id text not null,
  source_type text not null default 'recommendation',
  source_id uuid,
  impact_score int not null default 50,
  risk_score int not null default 30,
  effort_score int not null default 30,
  priority_score int not null default 50,
  requires_approval boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_decision_items_status on public.decision_items (status);
create index if not exists idx_decision_items_priority on public.decision_items (priority_score desc);

-- 3) Risk Scores (computed periodically)
create table if not exists public.risk_scores (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  scope_id text not null,
  risk_type text not null,
  score int not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  unique (scope, scope_id, risk_type)
);

create index if not exists idx_risk_scores_scope on public.risk_scores (scope, scope_id);

-- updated_at triggers
create trigger trg_autopilot_settings_updated
before update on public.council_autopilot_settings
for each row execute function public.set_updated_at();

create trigger trg_decision_items_updated
before update on public.decision_items
for each row execute function public.set_updated_at();

-- RLS: admin-only
alter table public.council_autopilot_settings enable row level security;
alter table public.decision_items enable row level security;
alter table public.risk_scores enable row level security;

create policy "Admin only council_autopilot_settings"
on public.council_autopilot_settings for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin only decision_items"
on public.decision_items for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy "Admin only risk_scores"
on public.risk_scores for all
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));
