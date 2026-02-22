
-- =========================================================
-- FIX: Helper functions with SECURITY DEFINER + idempotent policies
-- (Tables already exist from prior migration)
-- =========================================================

-- Helper functions with SECURITY DEFINER (fix)
create or replace function public.is_org_member(p_user uuid, p_org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = p_user
      and m.organization_id = p_org
  );
$$;

create or replace function public.is_org_member_with_role(p_user uuid, p_org uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.user_id = p_user
      and m.organization_id = p_org
      and m.role::text = any(p_roles)
  );
$$;

-- =========================================================
-- Idempotent RLS policies (drop + recreate)
-- =========================================================

-- Organizations
drop policy if exists "org_select_members" on public.organizations;
create policy "org_select_members"
on public.organizations for select to authenticated
using (public.is_org_member(auth.uid(), id));

-- Members
drop policy if exists "org_members_select_members" on public.organization_members;
create policy "org_members_select_members"
on public.organization_members for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

-- Entities
drop policy if exists "org_entities_select_members" on public.organization_entities;
create policy "org_entities_select_members"
on public.organization_entities for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "org_entities_insert_privileged" on public.organization_entities;
create policy "org_entities_insert_privileged"
on public.organization_entities for insert to authenticated
with check (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','MANAGER']));

drop policy if exists "org_entities_update_privileged" on public.organization_entities;
create policy "org_entities_update_privileged"
on public.organization_entities for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','MANAGER']));

-- Entity defaults
drop policy if exists "org_entity_defaults_select_members" on public.org_entity_accounting_defaults;
create policy "org_entity_defaults_select_members"
on public.org_entity_accounting_defaults for select to authenticated
using (
  exists (
    select 1 from public.organization_entities e
    where e.id = entity_id
      and public.is_org_member(auth.uid(), e.organization_id)
  )
);

drop policy if exists "org_entity_defaults_insert_billing" on public.org_entity_accounting_defaults;
create policy "org_entity_defaults_insert_billing"
on public.org_entity_accounting_defaults for insert to authenticated
with check (
  exists (
    select 1 from public.organization_entities e
    where e.id = entity_id
      and public.is_org_member_with_role(auth.uid(), e.organization_id, array['OWNER','BILLING'])
  )
);

drop policy if exists "org_entity_defaults_update_billing" on public.org_entity_accounting_defaults;
create policy "org_entity_defaults_update_billing"
on public.org_entity_accounting_defaults for update to authenticated
using (
  exists (
    select 1 from public.organization_entities e
    where e.id = entity_id
      and public.is_org_member_with_role(auth.uid(), e.organization_id, array['OWNER','BILLING'])
  )
);

-- Learners
drop policy if exists "org_learners_select_members" on public.organization_learners;
create policy "org_learners_select_members"
on public.organization_learners for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

-- Seats (insert intentionally omitted – service role only)
drop policy if exists "org_seats_select_members" on public.organization_seats;
create policy "org_seats_select_members"
on public.organization_seats for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "org_seats_update_privileged" on public.organization_seats;
create policy "org_seats_update_privileged"
on public.organization_seats for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','MANAGER']));

-- Invoice coding
drop policy if exists "org_invoice_coding_select_billing" on public.org_invoice_coding;
create policy "org_invoice_coding_select_billing"
on public.org_invoice_coding for select to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']));

drop policy if exists "org_invoice_coding_insert_billing" on public.org_invoice_coding;
create policy "org_invoice_coding_insert_billing"
on public.org_invoice_coding for insert to authenticated
with check (
  public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING'])
  and auth.uid() = created_by
);

drop policy if exists "org_invoice_coding_update_billing" on public.org_invoice_coding;
create policy "org_invoice_coding_update_billing"
on public.org_invoice_coding for update to authenticated
using (public.is_org_member_with_role(auth.uid(), organization_id, array['OWNER','BILLING']));

-- Privacy gate
drop policy if exists "org_privacy_access_select_members" on public.org_privacy_access;
create policy "org_privacy_access_select_members"
on public.org_privacy_access for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "org_privacy_access_update_admin" on public.org_privacy_access;
create policy "org_privacy_access_update_admin"
on public.org_privacy_access for update to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- Report runs
drop policy if exists "org_report_runs_select_members" on public.org_report_runs;
create policy "org_report_runs_select_members"
on public.org_report_runs for select to authenticated
using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "org_report_runs_insert_members" on public.org_report_runs;
create policy "org_report_runs_insert_members"
on public.org_report_runs for insert to authenticated
with check (public.is_org_member(auth.uid(), organization_id) and auth.uid() = run_by);
