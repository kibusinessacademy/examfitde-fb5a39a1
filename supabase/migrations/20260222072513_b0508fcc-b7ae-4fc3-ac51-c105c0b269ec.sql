
-- =========================================================
-- ORG CONSOLE – Step 1: Enums + Tables + Triggers + Indexes
-- =========================================================

-- ---------- Enums ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'org_member_role') then
    create type org_member_role as enum ('OWNER','BILLING','MANAGER','REPORT_VIEWER');
  end if;
  if not exists (select 1 from pg_type where typname = 'seat_status') then
    create type seat_status as enum ('INVITED','ACTIVE','SUSPENDED','EXPIRED','REVOKED');
  end if;
  if not exists (select 1 from pg_type where typname = 'report_scope') then
    create type report_scope as enum ('ANONYMIZED','PSEUDONYMIZED','IDENTIFIED');
  end if;
  if not exists (select 1 from pg_type where typname = 'org_access_status') then
    create type org_access_status as enum ('NONE','REQUESTED','APPROVED','DENIED','EXPIRED');
  end if;
end $$;

-- ---------- organizations ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_type text not null default 'COMPANY',
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  default_report_scope report_scope not null default 'ANONYMIZED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_type_check check (org_type in ('COMPANY','SCHOOL','IHK','HWK','OTHER'))
);
drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();

-- ---------- organization_members ----------
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  role org_member_role not null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists organization_members_org_idx on public.organization_members (organization_id);
create index if not exists organization_members_user_idx on public.organization_members (user_id);

-- ---------- organization_entities ----------
create table if not exists public.organization_entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_code text not null,
  legal_name text not null,
  display_name text not null,
  vat_id text null,
  billing_email text null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_code)
);
drop trigger if exists trg_organization_entities_updated_at on public.organization_entities;
create trigger trg_organization_entities_updated_at before update on public.organization_entities for each row execute function public.set_updated_at();
create index if not exists organization_entities_org_idx on public.organization_entities (organization_id);
do $$ begin
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='organization_entities_one_default_per_org') then
    execute 'create unique index organization_entities_one_default_per_org on public.organization_entities (organization_id) where is_default = true';
  end if;
end $$;

-- ---------- org_entity_accounting_defaults ----------
create table if not exists public.org_entity_accounting_defaults (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.organization_entities(id) on delete cascade,
  default_cost_center text null,
  default_cost_object text null,
  default_gl_account text null,
  default_project_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_id)
);
drop trigger if exists trg_org_entity_accounting_defaults_updated_at on public.org_entity_accounting_defaults;
create trigger trg_org_entity_accounting_defaults_updated_at before update on public.org_entity_accounting_defaults for each row execute function public.set_updated_at();

-- ---------- organization_learners ----------
create table if not exists public.organization_learners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid null references public.organization_entities(id) on delete set null,
  learner_user_id uuid not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  unique (organization_id, learner_user_id)
);
create index if not exists organization_learners_org_idx on public.organization_learners (organization_id);
create index if not exists organization_learners_learner_idx on public.organization_learners (learner_user_id);
create index if not exists organization_learners_entity_idx on public.organization_learners (entity_id);

-- ---------- organization_seats ----------
create table if not exists public.organization_seats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid null references public.organization_entities(id) on delete set null,
  learner_user_id uuid not null,
  product_id uuid null,
  certification_id uuid null,
  seat_status seat_status not null default 'INVITED',
  start_at date null,
  end_at date null,
  auto_renew boolean not null default false,
  source_order_id uuid null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, learner_user_id, product_id)
);
drop trigger if exists trg_organization_seats_updated_at on public.organization_seats;
create trigger trg_organization_seats_updated_at before update on public.organization_seats for each row execute function public.set_updated_at();
create index if not exists organization_seats_org_status_idx on public.organization_seats (organization_id, seat_status);
create index if not exists organization_seats_endat_idx on public.organization_seats (end_at);
create index if not exists organization_seats_entity_idx on public.organization_seats (entity_id);

-- ---------- org_invoice_coding ----------
create table if not exists public.org_invoice_coding (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid null references public.organization_entities(id) on delete set null,
  invoice_id uuid not null,
  cost_center text null,
  cost_object text null,
  gl_account text null,
  project_code text null,
  internal_ref text null,
  notes text null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_id)
);
drop trigger if exists trg_org_invoice_coding_updated_at on public.org_invoice_coding;
create trigger trg_org_invoice_coding_updated_at before update on public.org_invoice_coding for each row execute function public.set_updated_at();
create index if not exists org_invoice_coding_org_idx on public.org_invoice_coding (organization_id);
create index if not exists org_invoice_coding_entity_idx on public.org_invoice_coding (entity_id);

-- ---------- org_privacy_access ----------
create table if not exists public.org_privacy_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status org_access_status not null default 'NONE',
  scope report_scope not null default 'ANONYMIZED',
  approved_until timestamptz null,
  requested_by uuid null,
  requested_at timestamptz null,
  approved_by uuid null,
  approved_at timestamptz null,
  admin_notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);
drop trigger if exists trg_org_privacy_access_updated_at on public.org_privacy_access;
create trigger trg_org_privacy_access_updated_at before update on public.org_privacy_access for each row execute function public.set_updated_at();

-- ---------- org_report_runs ----------
create table if not exists public.org_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_by uuid not null,
  report_key text not null,
  scope report_scope not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists org_report_runs_org_idx on public.org_report_runs (organization_id, created_at desc);

-- =========================================================
-- Helper functions (AFTER tables exist)
-- =========================================================
create or replace function public.is_org_member(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.user_id = p_user and m.organization_id = p_org
  );
$$;

create or replace function public.is_org_member_with_role(p_user uuid, p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.user_id = p_user
      and m.organization_id = p_org
      and m.role::text = any(p_roles)
  );
$$;

-- =========================================================
-- RLS
-- =========================================================
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_entities enable row level security;
alter table public.org_entity_accounting_defaults enable row level security;
alter table public.organization_learners enable row level security;
alter table public.organization_seats enable row level security;
alter table public.org_invoice_coding enable row level security;
alter table public.org_privacy_access enable row level security;
alter table public.org_report_runs enable row level security;

create policy "org_select_members" on public.organizations for select to authenticated
using (public.is_org_member(auth.uid(), id));

create policy "org_members_select_members" on public.organization_members for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

create policy "org_entities_select_members" on public.organization_entities for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));
create policy "org_entities_insert_privileged" on public.organization_entities for insert to authenticated
with check (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','MANAGER']));
create policy "org_entities_update_privileged" on public.organization_entities for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','MANAGER']));

create policy "org_entity_defaults_select_members" on public.org_entity_accounting_defaults for select to authenticated
using (exists (select 1 from public.organization_entities e where e.id = entity_id and public.is_org_member(auth.uid(), e.organization_id)));
create policy "org_entity_defaults_insert_billing" on public.org_entity_accounting_defaults for insert to authenticated
with check (exists (select 1 from public.organization_entities e where e.id = entity_id and public.is_org_member_with_role(auth.uid(), e.organization_id, array['OWNER','BILLING'])));
create policy "org_entity_defaults_update_billing" on public.org_entity_accounting_defaults for update to authenticated
using (exists (select 1 from public.organization_entities e where e.id = entity_id and public.is_org_member_with_role(auth.uid(), e.organization_id, array['OWNER','BILLING'])));

create policy "org_learners_select_members" on public.organization_learners for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

create policy "org_seats_select_members" on public.organization_seats for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));
create policy "org_seats_update_privileged" on public.organization_seats for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','MANAGER']));

create policy "org_invoice_coding_select_billing" on public.org_invoice_coding for select to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']));
create policy "org_invoice_coding_insert_billing" on public.org_invoice_coding for insert to authenticated
with check (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']) and auth.uid() = created_by);
create policy "org_invoice_coding_update_billing" on public.org_invoice_coding for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']));

create policy "org_privacy_access_select_members" on public.org_privacy_access for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));
create policy "org_privacy_access_update_admin" on public.org_privacy_access for update to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "org_report_runs_select_members" on public.org_report_runs for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));
create policy "org_report_runs_insert_members" on public.org_report_runs for insert to authenticated
with check (public.is_org_member(auth.uid(), organization_id) and auth.uid() = run_by);
