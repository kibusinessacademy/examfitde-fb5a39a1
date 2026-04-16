-- ---------- 1. Publish-Guard auf View umstellen ----------
CREATE OR REPLACE FUNCTION public.fn_guard_publish_requires_release_ok()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class text;
  v_codes text[];
  v_allow_warn boolean := true;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    SELECT release_class, deficiency_codes
      INTO v_class, v_codes
    FROM public.v_package_release_classification
    WHERE package_id = NEW.id;

    IF v_class IS NULL THEN
      INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
      VALUES ('publish_guard_no_classification', 'package', ARRAY[NEW.id::text],
              jsonb_build_object('package_id', NEW.id, 'reason', 'not_in_release_view'));
      RETURN NEW;
    END IF;

    IF v_class = 'release_block' THEN
      INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
      VALUES ('publish_guard_blocked', 'package', ARRAY[NEW.id::text],
              jsonb_build_object('package_id', NEW.id, 'release_class', v_class, 'deficiency_codes', to_jsonb(v_codes)));
      RAISE EXCEPTION 'PUBLISH_BLOCKED: package % is release_block (codes: %)',
        NEW.id, array_to_string(v_codes, ',');
    END IF;

    IF v_class = 'release_warn' AND NOT v_allow_warn THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKED: package % is release_warn (codes: %)',
        NEW.id, array_to_string(v_codes, ',');
    END IF;

    INSERT INTO public.admin_actions (action, scope, affected_ids, payload)
    VALUES ('publish_guard_passed', 'package', ARRAY[NEW.id::text],
            jsonb_build_object('package_id', NEW.id, 'release_class', v_class, 'deficiency_codes', to_jsonb(v_codes)));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_publish_requires_artifacts ON public.course_packages;
DROP TRIGGER IF EXISTS trg_guard_publish_requires_release_ok ON public.course_packages;

CREATE TRIGGER trg_guard_publish_requires_release_ok
BEFORE UPDATE OF status ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_publish_requires_release_ok();

-- ---------- 2. Snapshot-Tabelle ----------
CREATE TABLE IF NOT EXISTS public.package_release_audit_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT current_date,
  package_id uuid NOT NULL,
  course_title text,
  track text,
  package_status text,
  release_class text NOT NULL,
  deficiency_codes text[] NOT NULL DEFAULT '{}',
  approved_questions bigint,
  exam_relevant_questions bigint,
  total_learning_fields bigint,
  covered_learning_fields bigint,
  tutor_indices bigint,
  oral_blueprints bigint,
  handbook_chapters bigint,
  minicheck_questions bigint,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, package_id)
);

CREATE INDEX IF NOT EXISTS idx_release_snapshots_date ON public.package_release_audit_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_release_snapshots_package ON public.package_release_audit_snapshots (package_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_release_snapshots_class ON public.package_release_audit_snapshots (release_class, snapshot_date DESC);

ALTER TABLE public.package_release_audit_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read release snapshots" ON public.package_release_audit_snapshots;
CREATE POLICY "Admins can read release snapshots"
ON public.package_release_audit_snapshots
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ---------- 3. Snapshot-Funktion ----------
CREATE OR REPLACE FUNCTION public.fn_snapshot_release_classification()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := current_date;
  v_inserted int;
  v_drift_count int := 0;
  v_drift jsonb;
BEGIN
  INSERT INTO public.package_release_audit_snapshots (
    snapshot_date, package_id, course_title, track, package_status,
    release_class, deficiency_codes,
    approved_questions, exam_relevant_questions,
    total_learning_fields, covered_learning_fields,
    tutor_indices, oral_blueprints, handbook_chapters, minicheck_questions,
    metrics
  )
  SELECT
    v_today, package_id, course_title, track::text, package_status,
    release_class, COALESCE(deficiency_codes, '{}'::text[]),
    approved_questions, exam_relevant_questions,
    total_learning_fields, covered_learning_fields,
    tutor_indices, oral_blueprints, handbook_chapters, minicheck_questions,
    jsonb_build_object('snapshot_at', now(), 'source_view', 'v_package_release_classification')
  FROM public.v_package_release_classification
  ON CONFLICT (snapshot_date, package_id) DO UPDATE
    SET release_class           = EXCLUDED.release_class,
        deficiency_codes        = EXCLUDED.deficiency_codes,
        approved_questions      = EXCLUDED.approved_questions,
        exam_relevant_questions = EXCLUDED.exam_relevant_questions,
        total_learning_fields   = EXCLUDED.total_learning_fields,
        covered_learning_fields = EXCLUDED.covered_learning_fields,
        tutor_indices           = EXCLUDED.tutor_indices,
        oral_blueprints         = EXCLUDED.oral_blueprints,
        handbook_chapters       = EXCLUDED.handbook_chapters,
        minicheck_questions     = EXCLUDED.minicheck_questions,
        package_status          = EXCLUDED.package_status,
        metrics                 = EXCLUDED.metrics;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  WITH yesterday AS (
    SELECT package_id, release_class, deficiency_codes
    FROM public.package_release_audit_snapshots
    WHERE snapshot_date = v_today - 1
  ),
  today AS (
    SELECT package_id, release_class, deficiency_codes
    FROM public.package_release_audit_snapshots
    WHERE snapshot_date = v_today
  ),
  drifts AS (
    SELECT t.package_id,
           y.release_class AS prev_class,
           t.release_class AS new_class,
           y.deficiency_codes AS prev_codes,
           t.deficiency_codes AS new_codes
    FROM today t
    LEFT JOIN yesterday y USING (package_id)
    WHERE y.release_class IS NOT NULL
      AND y.release_class IS DISTINCT FROM t.release_class
  )
  SELECT count(*), COALESCE(jsonb_agg(to_jsonb(d.*)), '[]'::jsonb)
    INTO v_drift_count, v_drift
  FROM drifts d;

  IF v_drift_count > 0 THEN
    INSERT INTO public.admin_actions (action, scope, payload)
    VALUES ('release_classification_drift_detected', 'system',
            jsonb_build_object('snapshot_date', v_today, 'drift_count', v_drift_count, 'drifts', v_drift));
  END IF;

  RETURN jsonb_build_object('ok', true, 'snapshot_date', v_today, 'rows_written', v_inserted, 'drift_count', v_drift_count);
END;
$$;

-- ---------- 4. Cron ----------
DO $$
BEGIN
  PERFORM cron.unschedule('snapshot-release-classification-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'snapshot-release-classification-daily',
  '15 3 * * *',
  $$ SELECT public.fn_snapshot_release_classification(); $$
);

SELECT public.fn_snapshot_release_classification();