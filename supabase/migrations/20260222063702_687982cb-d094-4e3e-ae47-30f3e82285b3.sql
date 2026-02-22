
-- =========================================================
-- ExamFit Humor System (Witz des Tages)
-- SSOT: Learner liest NIE direkt Tabellen -> nur Edge Function (service role)
-- =========================================================

-- ---------- Enums ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'humor_status') then
    create type humor_status as enum ('draft','review','approved','frozen','rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'humor_type') then
    create type humor_type as enum ('wordplay','everyday_situation','exam_stress','self_irony','micro_tip');
  end if;
end $$;

-- ---------- Table: humor_items ----------
create table if not exists public.humor_items (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null,
  competence_id uuid null,
  lesson_id uuid null,
  humor_type humor_type not null default 'everyday_situation',
  text text not null check (char_length(text) between 30 and 240),
  status humor_status not null default 'draft',
  safety_score int not null default 0 check (safety_score between 0 and 100),
  safety_flags text[] not null default '{}'::text[],
  language text not null default 'de',
  tone text not null default 'business',
  modernity_level int not null default 55 check (modernity_level between 0 and 100),
  style_tags text[] not null default '{}'::text[],
  valid_from date null,
  valid_to date null,
  review_after date null,
  quality_score numeric not null default 0,
  last_shown_at timestamptz null,
  shown_count int not null default 0,
  created_by uuid null,
  created_via text not null default 'manual',
  source_prompt_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint humor_items_tone_check check (tone in ('business','casual'))
);

create index if not exists humor_items_cert_status_idx
  on public.humor_items (certification_id, status);

create index if not exists humor_items_validity_idx
  on public.humor_items (certification_id, status, tone, modernity_level);

create index if not exists humor_items_valid_dates_idx
  on public.humor_items (valid_from, valid_to);

create index if not exists humor_items_review_after_idx
  on public.humor_items (review_after);

-- updated_at trigger (reuse existing or create)
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_humor_items_updated_at on public.humor_items;
create trigger trg_humor_items_updated_at
before update on public.humor_items
for each row execute function public.set_updated_at();

-- ---------- Table: humor_feedback ----------
create table if not exists public.humor_feedback (
  id uuid primary key default gen_random_uuid(),
  humor_id uuid not null references public.humor_items(id) on delete cascade,
  user_id uuid not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (humor_id, user_id)
);

create index if not exists humor_feedback_humor_idx
  on public.humor_feedback (humor_id);

-- ---------- Table: humor_daily_pick ----------
create table if not exists public.humor_daily_pick (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  pick_key text not null,
  humor_id uuid not null references public.humor_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (day, pick_key)
);

create index if not exists humor_daily_pick_day_pickkey_idx
  on public.humor_daily_pick (day, pick_key);

-- ---------- Security: RLS ----------
alter table public.humor_items enable row level security;
alter table public.humor_feedback enable row level security;
alter table public.humor_daily_pick enable row level security;

-- humor_items: No direct learner access (service role only via edge function)
create policy "humor_items_admin_select"
on public.humor_items for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "humor_items_admin_insert"
on public.humor_items for insert to authenticated
with check (public.has_role(auth.uid(), 'admin'));

create policy "humor_items_admin_update"
on public.humor_items for update to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "humor_items_admin_delete"
on public.humor_items for delete to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- humor_daily_pick: No direct learner access
create policy "humor_daily_pick_admin_select"
on public.humor_daily_pick for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- humor_feedback: User only own feedback
create policy "humor_feedback_select_own"
on public.humor_feedback for select to authenticated
using (auth.uid() = user_id);

create policy "humor_feedback_insert_own"
on public.humor_feedback for insert to authenticated
with check (auth.uid() = user_id);

create policy "humor_feedback_update_own"
on public.humor_feedback for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
