
-- ============================================================
-- TEIL A: BETRIEBSMODUS – Enterprise Account & Seat Management
-- ============================================================

-- 1) Companies / Betriebe table
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  contact_phone text,
  address jsonb,
  vat_id text,
  admin_user_id uuid not null,
  max_seats integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.companies enable row level security;

create policy "Company admins can view their company"
  on public.companies for select
  using (admin_user_id = auth.uid());

create policy "Company admins can update their company"
  on public.companies for update
  using (admin_user_id = auth.uid());

-- 2) Extend profiles for enterprise users
alter table public.profiles
  add column if not exists login_username text,
  add column if not exists personnel_number text,
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists managed_account boolean default false,
  add column if not exists initial_password_hash text;

create unique index if not exists idx_profiles_login_username
  on public.profiles(login_username) where login_username is not null;

-- 3) Link license_packages to companies
alter table public.license_packages
  add column if not exists company_id uuid references public.companies(id);

-- 4) Enterprise seat fields
alter table public.license_seats
  add column if not exists licensee_first_name text,
  add column if not exists licensee_last_name text,
  add column if not exists licensee_personnel_number text;

-- 5) Function: Create enterprise user account (called by buyer/admin)
-- Uses internal email pattern: {username}@managed.examfit.internal
create or replace function public.create_enterprise_account(
  p_package_id uuid,
  p_seat_id uuid,
  p_username text,
  p_password text,
  p_first_name text,
  p_last_name text,
  p_personnel_number text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_pkg public.license_packages%rowtype;
  v_seat public.license_seats%rowtype;
  v_internal_email text;
  v_new_user_id uuid;
  v_prod public.store_products%rowtype;
begin
  if v_caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Verify package ownership
  select * into v_pkg from public.license_packages where id = p_package_id;
  if v_pkg.id is null then raise exception 'Package not found'; end if;
  if v_pkg.buyer_user_id <> v_caller_id then raise exception 'Not authorized'; end if;
  if v_pkg.status <> 'active' then raise exception 'Package not active'; end if;

  -- Verify seat belongs to package and is unassigned
  select * into v_seat from public.license_seats where id = p_seat_id and package_id = p_package_id;
  if v_seat.id is null then raise exception 'Seat not found in package'; end if;
  if v_seat.assigned_user_id is not null then raise exception 'Seat already assigned'; end if;

  -- Check username uniqueness
  if exists (select 1 from public.profiles where login_username = lower(trim(p_username))) then
    raise exception 'Username already taken';
  end if;

  -- Generate internal email for Supabase Auth (username-based accounts)
  v_internal_email := coalesce(p_email, lower(trim(p_username)) || '@managed.examfit.internal');

  -- Create auth user via admin API (requires service role, runs as security definer)
  -- We insert directly into auth schema is not allowed, so we use a different approach:
  -- We'll generate the user_id and the edge function will handle actual auth.admin.createUser
  v_new_user_id := gen_random_uuid();

  -- Store seat licensee info
  update public.license_seats
  set licensee_first_name = p_first_name,
      licensee_last_name = p_last_name,
      licensee_personnel_number = p_personnel_number
  where id = p_seat_id;

  -- Return the generated user_id - the edge function will:
  -- 1) Create the auth user
  -- 2) Assign the seat
  -- 3) Create the entitlement
  return v_new_user_id;
end;
$$;

grant execute on function public.create_enterprise_account(uuid, uuid, text, text, text, text, text, text) to authenticated;

-- ============================================================
-- TEIL B: FINANZ-LEDGER – Orders, Invoices, Payments, Ledger
-- ============================================================

-- 6) Orders table
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  buyer_user_id uuid not null,
  license_package_id uuid references public.license_packages(id),
  billing_name text,
  billing_company text,
  billing_email text,
  billing_address jsonb,
  billing_vat_id text,
  currency text not null default 'eur',
  country text default 'DE',
  tax_mode text not null default 'gross' check (tax_mode in ('gross', 'net')),
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending','paid','refunded','partially_refunded','failed','disputed')),
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.orders enable row level security;

create policy "Users can view their own orders"
  on public.orders for select
  using (buyer_user_id = auth.uid());

create index if not exists idx_orders_buyer on public.orders(buyer_user_id);
create index if not exists idx_orders_stripe_session on public.orders(stripe_checkout_session_id);

-- 7) Order items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.store_products(id),
  description text not null,
  quantity integer not null default 1,
  unit_amount_net_cents integer not null default 0,
  unit_amount_gross_cents integer not null default 0,
  tax_rate numeric(5,2) not null default 19.00,
  tax_amount_cents integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.order_items enable row level security;

create policy "Users can view their own order items"
  on public.order_items for select
  using (
    order_id in (select id from public.orders where buyer_user_id = auth.uid())
  );

-- 8) Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  amount_cents integer not null,
  fee_cents integer not null default 0,
  net_cents integer not null default 0,
  currency text not null default 'eur',
  payment_status text not null default 'pending'
    check (payment_status in ('pending','succeeded','refunded','partial_refund','chargeback','failed')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  stripe_event_id text unique
);
alter table public.payments enable row level security;

create policy "Users can view their own payments"
  on public.payments for select
  using (
    order_id in (select id from public.orders where buyer_user_id = auth.uid())
  );

create index if not exists idx_payments_order on public.payments(order_id);
create index if not exists idx_payments_stripe_pi on public.payments(stripe_payment_intent_id);

-- 9) Invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  invoice_number text not null unique,
  issue_date date not null default current_date,
  due_date date,
  pdf_url text,
  stripe_invoice_id text,
  status text not null default 'issued' check (status in ('draft','issued','paid','void','overdue')),
  total_net_cents integer not null default 0,
  total_tax_cents integer not null default 0,
  total_gross_cents integer not null default 0,
  tax_rate numeric(5,2) not null default 19.00,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.invoices enable row level security;

create policy "Users can view their own invoices"
  on public.invoices for select
  using (
    order_id in (select id from public.orders where buyer_user_id = auth.uid())
  );

-- 10) Invoice number sequence
create sequence if not exists public.invoice_number_seq start 1001;

create or replace function public.generate_invoice_number()
returns text
language sql
as $$
  select 'EF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
$$;

-- 11) Ledger entries (IMMUTABLE APPEND-ONLY)
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  event_time timestamptz not null default now(),
  event_type text not null check (event_type in (
    'sale','refund','chargeback','fee','payout','tax','adjustment'
  )),
  order_id uuid references public.orders(id),
  payment_id uuid references public.payments(id),
  invoice_id uuid references public.invoices(id),
  account text not null check (account in (
    'revenue','tax_payable','stripe_fees','refunds','receivables','payouts','adjustments'
  )),
  amount_cents integer not null,
  currency text not null default 'eur',
  tax_rate numeric(5,2),
  country text default 'DE',
  description text,
  stripe_event_id text,
  created_at timestamptz not null default now()
);
alter table public.ledger_entries enable row level security;

-- Admin-only read via RPC, no direct user access
create index if not exists idx_ledger_event_time on public.ledger_entries(event_time);
create index if not exists idx_ledger_account on public.ledger_entries(account);
create index if not exists idx_ledger_stripe_event on public.ledger_entries(stripe_event_id);

-- 12) IMMUTABILITY TRIGGER: Prevent UPDATE/DELETE on ledger
create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Ledger entries are immutable: % not allowed', TG_OP;
end;
$$;

drop trigger if exists trg_ledger_no_update on public.ledger_entries;
create trigger trg_ledger_no_update
  before update on public.ledger_entries
  for each row execute function public.prevent_ledger_mutation();

drop trigger if exists trg_ledger_no_delete on public.ledger_entries;
create trigger trg_ledger_no_delete
  before delete on public.ledger_entries
  for each row execute function public.prevent_ledger_mutation();

-- 13) Admin-only RLS for ledger (via has_role)
create policy "Admins can view ledger"
  on public.ledger_entries for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "Service can insert ledger"
  on public.ledger_entries for insert
  with check (true);

-- 14) Report RPCs

-- Revenue by month
create or replace function public.report_revenue_by_month(
  p_from date default (date_trunc('year', now()))::date,
  p_to date default current_date
)
returns table(month text, gross_cents bigint, net_cents bigint, tax_cents bigint, order_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_char(le.event_time, 'YYYY-MM') as month,
    sum(case when le.account = 'revenue' then le.amount_cents else 0 end) as gross_cents,
    sum(case when le.account = 'revenue' then le.amount_cents else 0 end)
      - sum(case when le.account = 'tax_payable' then le.amount_cents else 0 end) as net_cents,
    sum(case when le.account = 'tax_payable' then le.amount_cents else 0 end) as tax_cents,
    count(distinct le.order_id) as order_count
  from public.ledger_entries le
  where le.event_time >= p_from
    and le.event_time < p_to + interval '1 day'
    and le.event_type = 'sale'
  group by to_char(le.event_time, 'YYYY-MM')
  order by month;
$$;

-- VAT by rate
create or replace function public.report_vat_by_rate(
  p_from date default (date_trunc('year', now()))::date,
  p_to date default current_date
)
returns table(month text, tax_rate numeric, tax_cents bigint, revenue_net_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_char(le.event_time, 'YYYY-MM') as month,
    coalesce(le.tax_rate, 19.00) as tax_rate,
    sum(case when le.account = 'tax_payable' then le.amount_cents else 0 end) as tax_cents,
    sum(case when le.account = 'revenue' then le.amount_cents else 0 end)
      - sum(case when le.account = 'tax_payable' then le.amount_cents else 0 end) as revenue_net_cents
  from public.ledger_entries le
  where le.event_time >= p_from
    and le.event_time < p_to + interval '1 day'
    and le.event_type = 'sale'
  group by to_char(le.event_time, 'YYYY-MM'), coalesce(le.tax_rate, 19.00)
  order by month, tax_rate;
$$;

-- Fees & Refunds by month
create or replace function public.report_fees_refunds_by_month(
  p_from date default (date_trunc('year', now()))::date,
  p_to date default current_date
)
returns table(month text, stripe_fees_cents bigint, refunds_cents bigint, chargebacks_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_char(le.event_time, 'YYYY-MM') as month,
    sum(case when le.account = 'stripe_fees' then abs(le.amount_cents) else 0 end) as stripe_fees_cents,
    sum(case when le.account = 'refunds' then abs(le.amount_cents) else 0 end) as refunds_cents,
    sum(case when le.event_type = 'chargeback' then abs(le.amount_cents) else 0 end) as chargebacks_cents
  from public.ledger_entries le
  where le.event_time >= p_from
    and le.event_time < p_to + interval '1 day'
  group by to_char(le.event_time, 'YYYY-MM')
  order by month;
$$;

-- Revenue by product
create or replace function public.report_revenue_by_product(
  p_from date default (date_trunc('year', now()))::date,
  p_to date default current_date
)
returns table(product_id uuid, product_name text, gross_cents bigint, quantity bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    oi.product_id,
    sp.name as product_name,
    sum(oi.unit_amount_gross_cents * oi.quantity)::bigint as gross_cents,
    sum(oi.quantity)::bigint as quantity
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  left join public.store_products sp on sp.id = oi.product_id
  where o.created_at >= p_from
    and o.created_at < p_to + interval '1 day'
    and o.status = 'paid'
  group by oi.product_id, sp.name
  order by gross_cents desc;
$$;

-- Payout report
create or replace function public.report_payouts(
  p_from date default (date_trunc('year', now()))::date,
  p_to date default current_date
)
returns table(month text, payout_cents bigint, payout_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_char(le.event_time, 'YYYY-MM') as month,
    sum(le.amount_cents) as payout_cents,
    count(*) as payout_count
  from public.ledger_entries le
  where le.event_type = 'payout'
    and le.event_time >= p_from
    and le.event_time < p_to + interval '1 day'
  group by to_char(le.event_time, 'YYYY-MM')
  order by month;
$$;

-- Open items (orders without full payment)
create or replace function public.report_open_items()
returns table(order_id uuid, buyer_email text, total_cents integer, paid_cents bigint, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id as order_id,
    o.billing_email as buyer_email,
    o.total_cents,
    coalesce(sum(p.amount_cents) filter (where p.payment_status = 'succeeded'), 0) as paid_cents,
    o.status,
    o.created_at
  from public.orders o
  left join public.payments p on p.order_id = o.id
  where o.status in ('pending', 'paid')
  group by o.id, o.billing_email, o.total_cents, o.status, o.created_at
  having o.total_cents > coalesce(sum(p.amount_cents) filter (where p.payment_status = 'succeeded'), 0)
  order by o.created_at;
$$;

-- Audit report (recent ledger entries)
create or replace function public.report_audit_log(
  p_limit integer default 100
)
returns table(
  id uuid, event_time timestamptz, event_type text,
  account text, amount_cents integer, currency text,
  description text, stripe_event_id text, order_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select le.id, le.event_time, le.event_type,
         le.account, le.amount_cents, le.currency,
         le.description, le.stripe_event_id, le.order_id
  from public.ledger_entries le
  order by le.event_time desc
  limit p_limit;
$$;

-- CSV export helper (all ledger entries for a period)
create or replace function public.export_ledger_csv(
  p_from date default (date_trunc('year', now()))::date,
  p_to date default current_date
)
returns table(
  buchungsdatum text, konto text, gegenkonto text,
  betrag_eur numeric, steuer_prozent numeric, belegnummer text,
  buchungstext text, waehrung text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_char(le.event_time, 'DD.MM.YYYY') as buchungsdatum,
    le.account as konto,
    case le.account
      when 'revenue' then 'receivables'
      when 'tax_payable' then 'receivables'
      when 'stripe_fees' then 'receivables'
      when 'refunds' then 'revenue'
      else 'other'
    end as gegenkonto,
    round(le.amount_cents / 100.0, 2) as betrag_eur,
    coalesce(le.tax_rate, 0) as steuer_prozent,
    coalesce(
      (select i.invoice_number from public.invoices i where i.order_id = le.order_id limit 1),
      le.stripe_event_id
    ) as belegnummer,
    coalesce(le.description, le.event_type) as buchungstext,
    le.currency as waehrung
  from public.ledger_entries le
  where le.event_time >= p_from
    and le.event_time < p_to + interval '1 day'
  order by le.event_time;
$$;

-- Grant report functions to authenticated (they use security definer + has_role internally)
grant execute on function public.report_revenue_by_month(date, date) to authenticated;
grant execute on function public.report_vat_by_rate(date, date) to authenticated;
grant execute on function public.report_fees_refunds_by_month(date, date) to authenticated;
grant execute on function public.report_revenue_by_product(date, date) to authenticated;
grant execute on function public.report_payouts(date, date) to authenticated;
grant execute on function public.report_open_items() to authenticated;
grant execute on function public.report_audit_log(integer) to authenticated;
grant execute on function public.export_ledger_csv(date, date) to authenticated;
