
-- =========================================
-- Course Studio v2 - Oral / Tutor / Handbook (minimal)
-- Teil 2/2
-- =========================================

-- ORAL EXAM
create table if not exists public.oral_exam_blueprints (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null,
  certification_id uuid,
  competency_id uuid,
  title text not null,
  scenario text not null,
  lead_questions text[] not null default '{}'::text[],
  followups text[] not null default '{}'::text[],
  rubric jsonb not null default '{}'::jsonb,
  status text not null default 'approved',
  created_at timestamptz not null default now()
);

create index if not exists idx_oral_exam_blueprints_curriculum
  on public.oral_exam_blueprints(curriculum_id);

create table if not exists public.oral_exam_sessionsets (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.course_packages(id) on delete cascade,
  title text not null,
  blueprint_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

-- AI TUTOR POLICIES + INDEX
create table if not exists public.ai_tutor_policies (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null,
  policy jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_tutor_policies_curriculum
  on public.ai_tutor_policies(curriculum_id);

create table if not exists public.ai_tutor_context_index (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.course_packages(id) on delete cascade,
  index_version int not null default 1,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- HANDBOOK
create table if not exists public.handbook_chapters (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_handbook_chapters_curriculum
  on public.handbook_chapters(curriculum_id);

create table if not exists public.handbook_sections (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.handbook_chapters(id) on delete cascade,
  title text not null,
  content_md text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- RLS: deny-by-default
alter table public.oral_exam_blueprints enable row level security;
alter table public.oral_exam_sessionsets enable row level security;
alter table public.ai_tutor_policies enable row level security;
alter table public.ai_tutor_context_index enable row level security;
alter table public.handbook_chapters enable row level security;
alter table public.handbook_sections enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='oral_exam_blueprints') then
    create policy "deny_all_oral_exam_blueprints" on public.oral_exam_blueprints
      for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename='oral_exam_sessionsets') then
    create policy "deny_all_oral_exam_sessionsets" on public.oral_exam_sessionsets
      for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_tutor_policies') then
    create policy "deny_all_ai_tutor_policies" on public.ai_tutor_policies
      for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_tutor_context_index') then
    create policy "deny_all_ai_tutor_context_index" on public.ai_tutor_context_index
      for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename='handbook_chapters') then
    create policy "deny_all_handbook_chapters" on public.handbook_chapters
      for all to anon, authenticated using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename='handbook_sections') then
    create policy "deny_all_handbook_sections" on public.handbook_sections
      for all to anon, authenticated using (false) with check (false);
  end if;
end $$;
