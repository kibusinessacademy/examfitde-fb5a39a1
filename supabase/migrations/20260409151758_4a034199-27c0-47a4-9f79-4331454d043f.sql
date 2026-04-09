
-- ============================================================
-- DROP DEPRECATED: organization_members (final)
-- ============================================================
-- Pre-verified: 0 views, 0 functions, 0 policies reference this table.
-- All production paths use org_memberships since 2026-04-09.

DROP VIEW IF EXISTS public.v_org_members_bridge CASCADE;
DROP TABLE IF EXISTS public.organization_members CASCADE;
