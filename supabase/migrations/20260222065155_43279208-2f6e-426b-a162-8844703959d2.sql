
-- =========================================================
-- ExamFit Ticketsystem (SSOT) – Content Issue + Feature Requests
-- Table: user_tickets (separate from existing support_tickets)
-- =========================================================

-- ---------- Enums ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'user_ticket_type') then
    create type user_ticket_type as enum ('CONTENT_ISSUE','FEATURE_REQUEST');
  end if;

  if not exists (select 1 from pg_type where typname = 'user_ticket_status') then
    create type user_ticket_status as enum ('OPEN','TRIAGE','IN_PROGRESS','RESOLVED','REJECTED','DUPLICATE');
  end if;

  if not exists (select 1 from pg_type where typname = 'user_ticket_priority') then
    create type user_ticket_priority as enum ('LOW','MEDIUM','HIGH','CRITICAL');
  end if;
end $$;

-- ---------- Table: user_tickets ----------
create table if not exists public.user_tickets (
  id uuid primary key default gen_random_uuid(),

  type user_ticket_type not null,
  status user_ticket_status not null default 'OPEN',
  priority user_ticket_priority not null default 'MEDIUM',

  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  certification_id uuid null,
  package_id uuid null,
  curriculum_id uuid null,
  competence_id uuid null,
  lesson_id uuid null,
  question_id uuid null,
  blueprint_id uuid null,
  page_path text null,
  source text not null default 'learner',

  title text not null check (char_length(title) between 4 and 120),
  message text not null check (char_length(message) between 10 and 2000),

  attachment_urls text[] not null default '{}'::text[],

  assigned_to uuid null,
  admin_notes text null,

  fingerprint text null
);

-- indexes
create index if not exists user_tickets_status_idx on public.user_tickets (status, created_at desc);
create index if not exists user_tickets_created_by_idx on public.user_tickets (created_by, created_at desc);
create index if not exists user_tickets_type_idx on public.user_tickets (type, created_at desc);
create index if not exists user_tickets_context_idx on public.user_tickets (certification_id, lesson_id, question_id);

-- updated_at trigger
drop trigger if exists trg_user_tickets_updated_at on public.user_tickets;
create trigger trg_user_tickets_updated_at
before update on public.user_tickets
for each row execute function public.set_updated_at();

-- ---------- Security: RLS ----------
alter table public.user_tickets enable row level security;

-- Learner can insert own tickets
create policy "user_tickets_insert_own"
on public.user_tickets
for insert
to authenticated
with check (auth.uid() = created_by);

-- Learner can read own tickets
create policy "user_tickets_select_own"
on public.user_tickets
for select
to authenticated
using (auth.uid() = created_by);

-- Admin can read all tickets
create policy "user_tickets_select_admin"
on public.user_tickets
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- Admin can update tickets
create policy "user_tickets_update_admin"
on public.user_tickets
for update
to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- Admin can delete tickets
create policy "user_tickets_delete_admin"
on public.user_tickets
for delete
to authenticated
using (public.has_role(auth.uid(), 'admin'));
