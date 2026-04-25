-- 1) Sync-Trigger ergänzen: rejected ⇒ qc_status nachziehen
CREATE OR REPLACE FUNCTION public.fn_sync_status_qc_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Forward: status='approved' -> qc_status='approved'
  IF NEW.status = 'approved'::public.question_status
     AND (NEW.qc_status IS DISTINCT FROM 'approved') THEN
    IF NEW.qc_status IS NULL OR NEW.qc_status IN ('tier1_passed','approved','pending','review') THEN
      NEW.qc_status := 'approved';
    END IF;
  END IF;

  -- Reverse: qc_status='approved' -> status='approved' (nur aus draft/review/NULL)
  IF NEW.qc_status = 'approved'
     AND (NEW.status IS DISTINCT FROM 'approved'::public.question_status) THEN
    IF NEW.status IS NULL
       OR NEW.status IN ('draft'::public.question_status, 'review'::public.question_status) THEN
      NEW.status := 'approved'::public.question_status;
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    ELSIF NEW.status = 'rejected'::public.question_status THEN
      -- Konflikt: explizit abgelehnt, qc fälschlich approved -> qc senken
      NEW.qc_status := 'rejected';
    END IF;
  END IF;

  -- Forward: status='rejected' -> qc_status NICHT 'approved'
  IF NEW.status = 'rejected'::public.question_status AND NEW.qc_status = 'approved' THEN
    NEW.qc_status := 'rejected';
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Verbleibende 389 Rows reparieren (status=rejected & qc_status=approved -> qc_status=rejected)
UPDATE public.exam_questions
SET qc_status='rejected'
WHERE status='rejected'::public.question_status AND qc_status='approved';

-- 3) Constraint validieren wenn Drift=0
DO $$ DECLARE v_drift int;
BEGIN
  SELECT count(*) INTO v_drift FROM public.exam_questions
  WHERE (status='approved'::public.question_status AND qc_status IS DISTINCT FROM 'approved')
     OR (qc_status='approved' AND status IS DISTINCT FROM 'approved'::public.question_status);

  IF v_drift = 0 THEN
    EXECUTE 'ALTER TABLE public.exam_questions VALIDATE CONSTRAINT chk_exam_questions_status_qc_consistency';
  END IF;
END $$;

-- 4) Finaler Selbsttest
SELECT public.fn_selftest_status_qc_sync();