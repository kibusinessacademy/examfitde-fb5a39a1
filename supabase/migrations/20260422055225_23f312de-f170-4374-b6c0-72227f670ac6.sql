-- ─────────────────────────────────────────────────────────────────────────
-- Self-Heal Loop v1 — Hotfix #2: Repair fn_auto_approve_seeded_blueprints
--
-- The trigger crashed with `record "new" has no field "meta"` because it
-- referenced NEW.meta on question_blueprints, which has no `meta` column.
-- Result: every direct INSERT into question_blueprints failed → 0 new
-- blueprints could be seeded by blueprint-seed-by-competency.
--
-- New behaviour: detect "seeded" drafts via deterministic columns that
-- DO exist (version >= '4.' AND created_by IS NULL AND status = 'draft'),
-- and auto-approve them. This is the same intent as before, without the
-- broken meta lookup.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_approve_seeded_blueprints()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Auto-approve drafts that look like seed/fanout output:
  --   * version starts with "4." (current Elite-format)
  --   * no explicit creator (i.e. produced by an edge function / worker)
  --   * status is still draft
  IF NEW.status::text = 'draft'
     AND COALESCE(NEW.version, '') LIKE '4.%'
     AND NEW.created_by IS NULL
  THEN
    NEW.status := 'approved'::blueprint_status;
    NEW.approved_at := now();
    NEW.approved_by := 'b0dbd616-9b93-47c8-83c5-39290130a6ea'::uuid;
  END IF;
  RETURN NEW;
END $function$;