
-- =========================================================
-- 1. Market SSOT table (keyed on berufe, not certifications)
-- =========================================================
create table if not exists public.beruf_market_data (
  beruf_id uuid primary key references public.berufe(id) on delete cascade,
  occupation_name text not null,
  official_no int,
  
  -- raw signals from Masterliste
  azubi_count int not null default 0,
  demand_percentile numeric(6,2) not null default 0,
  fit_score numeric(6,2) not null default 0,
  gender_balance_score numeric(6,2) not null default 0,
  coverage_score numeric(6,2) not null default 0,
  
  -- normalized/model outputs
  market_score numeric(6,2) not null default 0,
  tier int not null default 4 check (tier between 1 and 4),
  priority_rank int,
  
  -- monetization model
  est_penetration_pct numeric(6,2) not null default 0,
  est_arpu_eur numeric(8,2) not null default 0,
  est_annual_revenue_eur numeric(12,2) not null default 0,
  
  -- audit
  source_year int,
  source_note text,
  match_quality text,
  is_manual_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_beruf_market_tier_score
  on public.beruf_market_data (tier asc, market_score desc);

create index if not exists idx_beruf_market_revenue
  on public.beruf_market_data (est_annual_revenue_eur desc);

create index if not exists idx_beruf_market_priority_rank
  on public.beruf_market_data (priority_rank asc);

drop trigger if exists trg_beruf_market_data_updated_at on public.beruf_market_data;
create trigger trg_beruf_market_data_updated_at
  before update on public.beruf_market_data
  for each row execute function public.set_updated_at();


-- =========================================================
-- 2. Priority view: joins berufe → market_data → curricula → courses → packages
-- =========================================================
create or replace view public.v_beruf_priority as
select
  b.id as beruf_id,
  b.bezeichnung_kurz,
  b.bibb_id,
  
  bmd.occupation_name,
  bmd.azubi_count,
  bmd.demand_percentile,
  bmd.market_score,
  bmd.tier,
  bmd.priority_rank,
  bmd.est_penetration_pct,
  bmd.est_arpu_eur,
  bmd.est_annual_revenue_eur,
  bmd.is_manual_override,
  bmd.updated_at as market_updated_at,
  
  case
    when bmd.tier = 1 then 5
    when bmd.tier = 2 then 6
    when bmd.tier = 3 then 8
    else 10
  end as suggested_package_priority

from public.berufe b
join public.beruf_market_data bmd
  on bmd.beruf_id = b.id;


-- =========================================================
-- 3. Admin view: package build priority with market context
-- =========================================================
create or replace view public.v_package_build_priority as
select
  cp.id as package_id,
  cp.title as package_title,
  cp.status,
  cp.track,
  cp.priority,
  coalesce(cp.priority, 100) as effective_priority,
  cp.build_progress,
  cp.updated_at,
  
  co.id as course_id,
  
  cur.beruf_id,
  vbp.bezeichnung_kurz,
  vbp.tier,
  vbp.market_score,
  vbp.priority_rank as market_priority_rank,
  vbp.est_annual_revenue_eur

from public.course_packages cp
join public.courses co on co.id = cp.course_id
left join public.curricula cur on cur.id = cp.curriculum_id
left join public.v_beruf_priority vbp on vbp.beruf_id = cur.beruf_id;


-- =========================================================
-- 4. Backfill seed rows for all berufe
-- =========================================================
insert into public.beruf_market_data (
  beruf_id,
  occupation_name,
  source_year,
  source_note
)
select
  b.id,
  b.bezeichnung_kurz,
  2026,
  'Initial backfill placeholder; enrich via master import'
from public.berufe b
where not exists (
  select 1 from public.beruf_market_data bmd
  where bmd.beruf_id = b.id
)
on conflict (beruf_id) do nothing;


-- =========================================================
-- 5. RLS: admin-only write, authenticated read
-- =========================================================
alter table public.beruf_market_data enable row level security;

create policy "Authenticated users can read market data"
  on public.beruf_market_data for select
  to authenticated
  using (true);

create policy "Service role can manage market data"
  on public.beruf_market_data for all
  to service_role
  using (true)
  with check (true);
