
-- FIX 1: Council-Approval Reconcile Function
CREATE OR REPLACE FUNCTION public.reconcile_council_approval(p_package_id uuid DEFAULT NULL)
RETURNS TABLE(
  out_package_id uuid,
  out_action text,
  out_sessions_total int,
  out_sessions_approved int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_total int;
  v_approved int;
  v_non_terminal int;
BEGIN
  FOR r IN
    SELECT cp.id AS pkg_id
    FROM course_packages cp
    WHERE cp.council_approved = false
      AND (p_package_id IS NULL OR cp.id = p_package_id)
      AND EXISTS (SELECT 1 FROM council_sessions cs WHERE cs.package_id = cp.id)
  LOOP
    SELECT count(*) INTO v_total
    FROM council_sessions cs WHERE cs.package_id = r.pkg_id;

    SELECT count(*) INTO v_approved
    FROM council_sessions cs
    WHERE cs.package_id = r.pkg_id
      AND cs.status = 'completed' AND cs.decision = 'approve';

    SELECT count(*) INTO v_non_terminal
    FROM council_sessions cs
    WHERE cs.package_id = r.pkg_id
      AND cs.status NOT IN ('completed', 'cancelled', 'skipped');

    IF v_non_terminal = 0 AND v_approved = v_total AND v_total > 0 THEN
      UPDATE course_packages
      SET council_approved = true, council_approved_at = now(), updated_at = now()
      WHERE id = r.pkg_id AND council_approved = false;

      UPDATE package_steps ps
      SET status = 'done', finished_at = now(), last_error = null,
          meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
            'reconciled_by', 'reconcile_council_approval',
            'reconciled_at', now()::text
          )
      WHERE ps.package_id = r.pkg_id AND ps.step_key = 'quality_council' AND ps.status <> 'done';

      out_package_id := r.pkg_id;
      out_action := 'approved';
      out_sessions_total := v_total;
      out_sessions_approved := v_approved;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- FIX 2: Auto-trigger on council_sessions
CREATE OR REPLACE FUNCTION public.trg_materialize_council_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total int;
  v_approved int;
  v_non_terminal int;
BEGIN
  IF NEW.status NOT IN ('completed', 'cancelled', 'skipped') THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_non_terminal
  FROM council_sessions cs
  WHERE cs.package_id = NEW.package_id
    AND cs.status NOT IN ('completed', 'cancelled', 'skipped');

  IF v_non_terminal > 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE cs.status = 'completed' AND cs.decision = 'approve')
  INTO v_total, v_approved
  FROM council_sessions cs
  WHERE cs.package_id = NEW.package_id;

  IF v_approved = v_total AND v_total > 0 THEN
    UPDATE course_packages
    SET council_approved = true, council_approved_at = now(), updated_at = now()
    WHERE id = NEW.package_id AND council_approved = false;

    UPDATE package_steps ps
    SET status = 'done', finished_at = now(), last_error = null,
        meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
          'auto_materialized', true, 'materialized_at', now()::text
        )
    WHERE ps.package_id = NEW.package_id AND ps.step_key = 'quality_council' AND ps.status <> 'done';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_council_session_materialize_approval ON council_sessions;
CREATE TRIGGER trg_council_session_materialize_approval
  AFTER UPDATE ON council_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trg_materialize_council_approval();

-- FIX 3: Run reconcile NOW
SELECT * FROM reconcile_council_approval();

NOTIFY pgrst, 'reload schema';
