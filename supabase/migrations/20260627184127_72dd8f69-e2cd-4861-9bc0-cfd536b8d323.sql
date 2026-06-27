create table if not exists public.store_ops_batches (
  id uuid primary key default gen_random_uuid(),
  batch_label text,
  state text not null default 'draft',
  selected_action_types text[] not null default '{}',
  manifest_ids uuid[] not null default '{}',
  total integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  blocked integer not null default 0,
  skipped integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  planned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.store_ops_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.store_ops_batches(id) on delete cascade,
  manifest_id uuid not null,
  action_type text not null,
  status text not null,
  blockers jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now()
);

create index if not exists idx_store_ops_batch_items_batch on public.store_ops_batch_items(batch_id);

grant select on public.store_ops_batches to authenticated;
grant all on public.store_ops_batches to service_role;
grant select on public.store_ops_batch_items to authenticated;
grant all on public.store_ops_batch_items to service_role;

alter table public.store_ops_batches enable row level security;
alter table public.store_ops_batch_items enable row level security;

drop policy if exists "admin read store_ops_batches" on public.store_ops_batches;
create policy "admin read store_ops_batches"
  on public.store_ops_batches for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "admin read store_ops_batch_items" on public.store_ops_batch_items;
create policy "admin read store_ops_batch_items"
  on public.store_ops_batch_items for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create or replace function public.store_ops_batch_items_append_only()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return coalesce(NEW, OLD);
  end if;
  raise exception 'store_ops_batch_items is append-only';
end $$;

drop trigger if exists trg_store_ops_batch_items_no_update on public.store_ops_batch_items;
create trigger trg_store_ops_batch_items_no_update
  before update or delete on public.store_ops_batch_items
  for each row execute function public.store_ops_batch_items_append_only();