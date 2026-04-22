-- ─────────────────────────────────────────────────────────────────────────
-- Self-Heal Loop v1 — Hotfix #3: Allow placeholder templates on FRESH INSERT
--
-- Bug: fn_auto_approve_seeded_blueprints (BEFORE INSERT) flips fresh
-- seed-output drafts to status='approved'. The next BEFORE INSERT trigger
-- fn_guard_blueprint_placeholder_soft sees status='approved' and treats
-- this as "promotion". Because seed templates legitimately contain
-- {placeholder} tokens (used by the fan-out variant engine downstream),
-- the soft-guard then sets status='deprecated'.
-- Net effect: every freshly seeded blueprint is born deprecated → the
-- targeted-fill self-heal loop cannot recover coverage.
--
-- Fix: skip the placeholder→deprecate logic on INSERT. Placeholders are
-- only deprecated when a row is being UPDATEd from draft → approved/active
-- (real promotion), not when it's being created as already-approved by
-- the seed auto-approval trigger.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_blueprint_placeholder_soft()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_placeholder boolean := false;
  v_status text;
BEGIN
  v_status := COALESCE(NEW.status::text, 'draft');

  -- Draft-Templates dürfen Platzhalter enthalten (Variantenfähigkeit).
  IF v_status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Fresh INSERTs werden vom Auto-Approve-Trigger direkt auf 'approved'
  -- gehoben. Diese sind KEINE echte Promotion — Placeholder sind hier
  -- legitim und werden vom downstream Variant-Fan-out aufgelöst.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Echte Promotion (UPDATE draft → approved/active): Placeholder = Bug.
  IF NEW.question_template ~ '\{[A-Za-z_][A-Za-z0-9_]*\}' THEN
    v_has_placeholder := true;
  END IF;

  IF v_has_placeholder THEN
    NEW.status := 'deprecated';
    NEW.deprecated_at := COALESCE(NEW.deprecated_at, now());
    NEW.change_reason := COALESCE(
      NEW.change_reason,
      'AUTO_DEPRECATED_PLACEHOLDER_ON_PROMOTE: unresolved placeholders in non-draft template'
    );
  END IF;

  RETURN NEW;
END;
$function$;