-- 1) Sync-Trigger
CREATE OR REPLACE FUNCTION public.fn_sync_status_qc_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved'::public.question_status
     AND (NEW.qc_status IS DISTINCT FROM 'approved') THEN
    IF NEW.qc_status IS NULL OR NEW.qc_status IN ('tier1_passed','approved','pending','review') THEN
      NEW.qc_status := 'approved';
    END IF;
  END IF;

  IF NEW.qc_status = 'approved'
     AND (NEW.status IS DISTINCT FROM 'approved'::public.question_status) THEN
    IF NEW.status IS NULL
       OR NEW.status IN ('draft'::public.question_status, 'review'::public.question_status) THEN
      NEW.status := 'approved'::public.question_status;
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_status_qc_status ON public.exam_questions;
CREATE TRIGGER trg_sync_status_qc_status
BEFORE INSERT OR UPDATE OF status, qc_status ON public.exam_questions
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_status_qc_status();

-- 2) CHECK-Constraint (NOT VALID; Validate später wenn Drift=0)
ALTER TABLE public.exam_questions
  DROP CONSTRAINT IF EXISTS chk_exam_questions_status_qc_consistency;

ALTER TABLE public.exam_questions
  ADD CONSTRAINT chk_exam_questions_status_qc_consistency
  CHECK (
    NOT (status = 'approved'::public.question_status AND qc_status IS DISTINCT FROM 'approved')
    AND
    NOT (qc_status = 'approved' AND status IS DISTINCT FROM 'approved'::public.question_status)
  ) NOT VALID;

-- 3) Backfill mit Sub-Block je Row (kollisionssicher)
DO $$
DECLARE
  r record; v_synced int := 0; v_collisions int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.exam_questions
    WHERE status='approved'::public.question_status AND qc_status IS DISTINCT FROM 'approved'
  LOOP
    BEGIN
      UPDATE public.exam_questions SET qc_status='approved',
        reviewed_at = COALESCE(reviewed_at, now()) WHERE id = r.id;
      v_synced := v_synced + 1;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        UPDATE public.exam_questions
          SET status='rejected'::public.question_status, qc_status='dup_collision',
              reviewed_at = COALESCE(reviewed_at, now()) WHERE id = r.id;
        v_collisions := v_collisions + 1;
      EXCEPTION WHEN OTHERS THEN v_collisions := v_collisions + 1; END;
    END;
  END LOOP;

  FOR r IN
    SELECT id FROM public.exam_questions
    WHERE qc_status='approved' AND status IS DISTINCT FROM 'approved'::public.question_status
  LOOP
    BEGIN
      UPDATE public.exam_questions SET status='approved'::public.question_status,
        reviewed_at = COALESCE(reviewed_at, now()) WHERE id = r.id;
      v_synced := v_synced + 1;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        UPDATE public.exam_questions
          SET status='rejected'::public.question_status, qc_status='dup_collision',
              reviewed_at = COALESCE(reviewed_at, now()) WHERE id = r.id;
        v_collisions := v_collisions + 1;
      EXCEPTION WHEN OTHERS THEN v_collisions := v_collisions + 1; END;
    END;
  END LOOP;

  INSERT INTO public.admin_notifications (category, severity, title, body, metadata)
  VALUES (
    'sync_status_qc_backfill', 'info',
    'Backfill status/qc_status Sync',
    format('Backfill abgeschlossen — %s synced, %s als dup_collision/rejected geparkt', v_synced, v_collisions),
    jsonb_build_object('synced', v_synced, 'collisions', v_collisions, 'at', now())
  );
END $$;

-- 4) Validate wenn Drift=0
DO $$ DECLARE v_drift int;
BEGIN
  SELECT count(*) INTO v_drift FROM public.exam_questions
  WHERE (status='approved'::public.question_status AND qc_status IS DISTINCT FROM 'approved')
     OR (qc_status='approved' AND status IS DISTINCT FROM 'approved'::public.question_status);

  IF v_drift = 0 THEN
    EXECUTE 'ALTER TABLE public.exam_questions VALIDATE CONSTRAINT chk_exam_questions_status_qc_consistency';
  ELSE
    INSERT INTO public.admin_notifications (category, severity, title, body, metadata)
    VALUES ('sync_status_qc_backfill','high','Constraint nicht validiert',
            format('%s Drift-Rows verbleiben — CHECK constraint bleibt NOT VALID', v_drift),
            jsonb_build_object('remaining_drift', v_drift));
  END IF;
END $$;

-- 5) Selbsttest-Funktion
CREATE OR REPLACE FUNCTION public.fn_selftest_status_qc_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_drift_status_only int; v_drift_qc_only int;
  v_trigger_present boolean; v_constraint_present boolean; v_constraint_validated boolean;
  v_result jsonb;
BEGIN
  SELECT count(*) INTO v_drift_status_only FROM public.exam_questions
  WHERE status='approved'::public.question_status AND qc_status IS DISTINCT FROM 'approved';

  SELECT count(*) INTO v_drift_qc_only FROM public.exam_questions
  WHERE qc_status='approved' AND status IS DISTINCT FROM 'approved'::public.question_status;

  SELECT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname='trg_sync_status_qc_status'
      AND tgrelid='public.exam_questions'::regclass AND NOT tgisinternal)
  INTO v_trigger_present;

  SELECT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='chk_exam_questions_status_qc_consistency'
      AND conrelid='public.exam_questions'::regclass),
    COALESCE((SELECT convalidated FROM pg_constraint
      WHERE conname='chk_exam_questions_status_qc_consistency'
        AND conrelid='public.exam_questions'::regclass), false)
  INTO v_constraint_present, v_constraint_validated;

  v_result := jsonb_build_object(
    'ok', (v_drift_status_only=0 AND v_drift_qc_only=0 AND v_trigger_present AND v_constraint_present),
    'checked_at', now(),
    'drift_status_approved_qc_not_approved', v_drift_status_only,
    'drift_qc_approved_status_not_approved', v_drift_qc_only,
    'sync_trigger_present', v_trigger_present,
    'check_constraint_present', v_constraint_present,
    'check_constraint_validated', v_constraint_validated
  );

  INSERT INTO public.admin_notifications (category, severity, title, body, metadata)
  VALUES (
    'selftest_status_qc_sync',
    CASE WHEN (v_result->>'ok')::boolean THEN 'info' ELSE 'high' END,
    'Selftest: status/qc_status Sync',
    CASE WHEN (v_result->>'ok')::boolean
      THEN 'OK — keine Drift, Trigger + Constraint aktiv'
      ELSE format('FAIL — drift=%s/%s, trigger=%s, constraint=%s/%s',
                  v_drift_status_only, v_drift_qc_only, v_trigger_present,
                  v_constraint_present, v_constraint_validated)
    END,
    v_result
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_selftest_status_qc_sync() TO authenticated, service_role;

SELECT public.fn_selftest_status_qc_sync();