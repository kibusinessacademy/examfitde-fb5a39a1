
-- 1) Auto-Approve-Trigger: Blueprints aus auto_seed werden direkt approved
CREATE OR REPLACE FUNCTION public.fn_auto_approve_seeded_blueprints()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nur drafts aus auto_seed direkt approven
  IF NEW.status::text = 'draft' 
     AND COALESCE(NEW.meta->>'source','') IN ('auto_seed','blueprint_fanout','seed_worker')
  THEN
    NEW.status := 'approved'::blueprint_status;
    NEW.approved_at := now();
    NEW.approved_by := 'b0dbd616-9b93-47c8-83c5-39290130a6ea'::uuid;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_approve_seeded_blueprints ON public.question_blueprints;
CREATE TRIGGER trg_auto_approve_seeded_blueprints
  BEFORE INSERT ON public.question_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_approve_seeded_blueprints();

-- 2) Reconciler-Funktion: findet Drift (0 approved trotz >0 draft) und heilt
CREATE OR REPLACE FUNCTION public.fn_reconcile_blueprint_approval_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := 'b0dbd616-9b93-47c8-83c5-39290130a6ea';
  v_drift_curricula uuid[];
  v_total_approved int := 0;
  v_curr uuid;
  v_n int;
BEGIN
  -- Curricula mit 0 approved aber >0 draft
  SELECT array_agg(curriculum_id) INTO v_drift_curricula
  FROM (
    SELECT curriculum_id,
           count(*) FILTER (WHERE status::text='approved') AS approved,
           count(*) FILTER (WHERE status::text='draft') AS draft
    FROM question_blueprints
    WHERE curriculum_id IS NOT NULL
    GROUP BY curriculum_id
    HAVING count(*) FILTER (WHERE status::text='approved') = 0
       AND count(*) FILTER (WHERE status::text='draft') > 0
  ) sub;

  IF v_drift_curricula IS NULL OR array_length(v_drift_curricula,1) = 0 THEN
    RETURN jsonb_build_object('drift_curricula', 0, 'approved', 0);
  END IF;

  FOREACH v_curr IN ARRAY v_drift_curricula LOOP
    UPDATE question_blueprints
    SET status='approved'::blueprint_status,
        approved_at=now(),
        approved_by=v_admin,
        updated_at=now()
    WHERE curriculum_id = v_curr AND status::text='draft';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total_approved := v_total_approved + v_n;
  END LOOP;

  INSERT INTO admin_actions (action, scope, payload, affected_ids, user_id)
  VALUES ('blueprint_approval_drift_auto_reconcile',
          'pipeline.exam_pool.bp_approval_drift',
          jsonb_build_object('drift_curricula', array_length(v_drift_curricula,1),
                             'total_approved', v_total_approved),
          v_drift_curricula, v_admin);

  RETURN jsonb_build_object(
    'drift_curricula', array_length(v_drift_curricula,1),
    'approved', v_total_approved,
    'curricula', v_drift_curricula
  );
END $$;

-- 3) Cron alle 5 Minuten
SELECT cron.unschedule('reconcile-blueprint-approval-drift')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='reconcile-blueprint-approval-drift');

SELECT cron.schedule(
  'reconcile-blueprint-approval-drift',
  '*/5 * * * *',
  $cron$ SELECT public.fn_reconcile_blueprint_approval_drift(); $cron$
);
