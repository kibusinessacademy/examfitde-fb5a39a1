
-- =========================================================
-- 1. Score recalculation function
-- =========================================================
create or replace function public.recalculate_beruf_market_scores()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_azubi int;
begin
  select greatest(coalesce(max(azubi_count), 0), 1)
  into v_max_azubi
  from public.beruf_market_data;

  -- Update tier based on market_score (already computed in CSV import)
  -- and map tier → suggested priority for v_beruf_priority view
  update public.beruf_market_data bmd
  set
    tier = case
      when bmd.market_score >= 90 then 1
      when bmd.market_score >= 80 then 2
      when bmd.market_score >= 70 then 3
      else 4
    end,
    updated_at = now()
  where bmd.market_score > 0;
end;
$$;

-- =========================================================
-- 2. Match map for robust import
-- =========================================================
create table if not exists public.beruf_market_match_map (
  source_occupation_name text primary key,
  beruf_id uuid not null references public.berufe(id) on delete cascade,
  match_type text not null default 'manual',
  created_at timestamptz not null default now()
);

alter table public.beruf_market_match_map enable row level security;

create policy "Service role manages match map"
  on public.beruf_market_match_map for all
  to service_role
  using (true)
  with check (true);

-- =========================================================
-- 3. Normalize helper for fuzzy matching
-- =========================================================
create or replace function public.normalize_beruf_name(input text)
returns text
language sql
immutable
as $$
  select lower(trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(input, '\/-?(in|frau|mann|leute)$', '', 'i'),
        '\s*\(.*?\)\s*', '', 'g'
      ),
      '[-/]$', '', 'g'
    )
  ))
$$;
