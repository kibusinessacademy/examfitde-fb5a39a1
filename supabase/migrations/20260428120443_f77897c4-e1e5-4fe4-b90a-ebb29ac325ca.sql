ALTER TABLE public.org_memberships DROP CONSTRAINT IF EXISTS chk_membership_role;
ALTER TABLE public.organizations  DROP CONSTRAINT IF EXISTS org_type_check;