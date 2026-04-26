-- 1) Extend allowed actions
ALTER TABLE public.blueprint_audit_log
  DROP CONSTRAINT IF EXISTS blueprint_audit_log_action_check;

ALTER TABLE public.blueprint_audit_log
  ADD CONSTRAINT blueprint_audit_log_action_check
  CHECK (action = ANY (ARRAY[
    'created'::text, 'updated'::text, 'approved'::text,
    'deprecated'::text, 'reactivated'::text, 'wave_revoked'::text,
    'variant_generated'::text
  ]));

-- 2) Auto-audit trigger for status transitions
CREATE OR REPLACE FUNCTION public.fn_audit_blueprint_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_wave   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'deprecated' THEN
      v_action := 'deprecated';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'deprecated' THEN
      v_action := 'deprecated';
    ELSIF OLD.status = 'deprecated' AND NEW.status = 'approved' THEN
      v_action := 'reactivated';
    ELSIF NEW.status = 'approved' THEN
      v_action := 'approved';
    ELSE
      v_action := 'updated';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  v_wave := CASE
    WHEN COALESCE(NEW.change_reason, '') ILIKE '%REVIVED_2026-04-26%' THEN 'WAVE15A_REVIVAL'
    WHEN COALESCE(NEW.change_reason, '') ILIKE 'WAVE15A%' THEN 'WAVE15A'
    WHEN COALESCE(NEW.change_reason, '') ILIKE 'MANUAL_HEAL%' THEN 'MANUAL_HEAL'
    WHEN COALESCE(NEW.change_reason, '') ILIKE 'ROLLBACK_%' THEN 'ROLLBACK'
    ELSE 'AD_HOC'
  END;

  INSERT INTO public.blueprint_audit_log
    (blueprint_id, action, change_reason, changes, performed_by)
  VALUES (
    NEW.id,
    v_action,
    NEW.change_reason,
    jsonb_build_object(
      'wave', v_wave,
      'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
      'new_status', NEW.status,
      'curriculum_id', NEW.curriculum_id,
      'competency_id', NEW.competency_id
    ),
    NEW.approved_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_blueprint_status_change ON public.question_blueprints;
CREATE TRIGGER trg_audit_blueprint_status_change
  AFTER INSERT OR UPDATE OF status ON public.question_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_blueprint_status_change();

-- 3) Backfill historic WAVE15A deprecations + revivals (idempotent)
INSERT INTO public.blueprint_audit_log
  (blueprint_id, action, change_reason, changes, performed_by, performed_at)
SELECT
  qb.id,
  'deprecated'::text,
  qb.change_reason,
  jsonb_build_object('wave', 'WAVE15A', 'backfill', true,
                     'curriculum_id', qb.curriculum_id),
  NULL::uuid,
  COALESCE(qb.deprecated_at, now())
FROM public.question_blueprints qb
WHERE qb.change_reason ILIKE 'WAVE15A%'
  AND NOT EXISTS (
    SELECT 1 FROM public.blueprint_audit_log al
    WHERE al.blueprint_id = qb.id AND al.action = 'deprecated'
  );

INSERT INTO public.blueprint_audit_log
  (blueprint_id, action, change_reason, changes, performed_by, performed_at)
SELECT
  qb.id,
  'reactivated'::text,
  qb.change_reason,
  jsonb_build_object('wave', 'WAVE15A_REVIVAL', 'backfill', true,
                     'curriculum_id', qb.curriculum_id),
  qb.approved_by,
  COALESCE(qb.approved_at, now())
FROM public.question_blueprints qb
WHERE qb.change_reason ILIKE '%REVIVED_2026-04-26%'
  AND qb.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM public.blueprint_audit_log al
    WHERE al.blueprint_id = qb.id AND al.action = 'reactivated'
  );

-- 4) Per-package audit view
CREATE OR REPLACE VIEW public.v_blueprint_audit_per_package AS
SELECT
  cp.id   AS package_id,
  cp.title AS package_title,
  qb.curriculum_id,
  al.id   AS audit_id,
  al.blueprint_id,
  al.action,
  COALESCE(al.changes->>'wave', 'AD_HOC') AS wave,
  al.change_reason,
  al.performed_by,
  al.performed_at,
  qb.competency_id,
  qb.status AS current_status
FROM public.blueprint_audit_log al
JOIN public.question_blueprints qb ON qb.id = al.blueprint_id
JOIN public.course_packages cp ON cp.curriculum_id = qb.curriculum_id
WHERE al.action IN ('deprecated', 'reactivated', 'wave_revoked', 'approved');

COMMENT ON VIEW public.v_blueprint_audit_per_package IS
  'Per-package projection of blueprint deprecation / reactivation events for admin review UI.';