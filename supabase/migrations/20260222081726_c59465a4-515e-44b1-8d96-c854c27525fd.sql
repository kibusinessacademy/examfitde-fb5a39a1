
-- =========================================================
-- billing_accounts: SSOT-Anker zwischen Organization und Stripe/Payment
-- Ermöglicht mehrere Billing-Accounts pro Holding
-- =========================================================

-- ---------- billing_accounts ----------
create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_id uuid null references public.organization_entities(id) on delete set null,

  label text not null default 'Haupt-Konto',
  stripe_customer_id text null,
  billing_email text null,
  billing_name text null,
  vat_id text null,
  currency text not null default 'EUR',
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, stripe_customer_id)
);

drop trigger if exists trg_billing_accounts_updated_at on public.billing_accounts;
create trigger trg_billing_accounts_updated_at
before update on public.billing_accounts
for each row execute function public.set_updated_at();

create index if not exists billing_accounts_org_idx on public.billing_accounts (organization_id);
create index if not exists billing_accounts_stripe_idx on public.billing_accounts (stripe_customer_id);

-- Only one default per org
do $$ begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='billing_accounts_one_default_per_org'
  ) then
    execute 'create unique index billing_accounts_one_default_per_org
             on public.billing_accounts (organization_id)
             where is_default = true';
  end if;
end $$;

-- ---------- Link invoices to billing_accounts (optional FK on invoices) ----------
-- Add billing_account_id to invoices if the column doesn't exist yet
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'billing_account_id'
  ) then
    alter table public.invoices add column billing_account_id uuid null references public.billing_accounts(id) on delete set null;
    create index invoices_billing_account_idx on public.invoices (billing_account_id);
  end if;
end $$;

-- ---------- Link orders to billing_accounts (optional FK on orders) ----------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'billing_account_id'
  ) then
    alter table public.orders add column billing_account_id uuid null references public.billing_accounts(id) on delete set null;
    create index orders_billing_account_idx on public.orders (billing_account_id);
  end if;
end $$;

-- =========================================================
-- RLS
-- =========================================================
alter table public.billing_accounts enable row level security;

-- Select: org members can view
drop policy if exists "billing_accounts_select_members" on public.billing_accounts;
create policy "billing_accounts_select_members"
on public.billing_accounts for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

-- Insert: OWNER/BILLING only
drop policy if exists "billing_accounts_insert_privileged" on public.billing_accounts;
create policy "billing_accounts_insert_privileged"
on public.billing_accounts for insert to authenticated
with check (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']));

-- Update: OWNER/BILLING only
drop policy if exists "billing_accounts_update_privileged" on public.billing_accounts;
create policy "billing_accounts_update_privileged"
on public.billing_accounts for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']));
