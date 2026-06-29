
-- CUT C0: STEP_DONE_OUTPUT_MISSING.ROOT_CAUSE.1 (read-only forensic SSOT)

-- 1) Snapshot table for repeatable forensic runs
CREATE TABLE IF NOT EXISTS public.step_done_output_missing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  step_key text NOT NULL,
  package_id uuid NOT NULL,
  step_id uuid NOT NULL,
  job_id uuid,
  finalized_by text,
  finalization_source text,
  root_cause_code text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  finished_at timestamptz,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sdom_snap_run ON public.step_done_output_missing_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_sdom_snap_pkg ON public.step_done_output_missing_snapshots(package_id);
CREATE INDEX IF NOT EXISTS idx_sdom_snap_root_cause ON public.step_done_output_missing_snapshots(root_cause_code);
CREATE INDEX IF NOT EXISTS idx_sdom_snap_captured ON public.step_done_output_missing_snapshots(captured_at DESC);

GRANT SELECT ON public.step_done_output_missing_snapshots TO authenticated;
GRANT ALL    ON public.step_done_output_missing_snapshots TO service_role;

ALTER TABLE public.step_done_output_missing_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read SDOM snapshots"
  ON public.step_done_output_missing_snapshots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages SDOM snapshots"
  ON public.step_done_output_missing_snapshots FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2) Read-only view: current STEP_DONE_OUTPUT_MISSING population with root-cause classification.
--    Initially scoped to generate_blueprint_variants (the only step with a known persistence
--    contract: meta.ok=true ⇔ ∃ blueprint_variants row). Extensible via UNION later.
CREATE OR REPLACE VIEW public.v_step_done_output_missing AS
WITH gbv AS (
  SELECT
    ps.id          AS step_id,
    ps.package_id,
    ps.job_id,
    ps.finished_at,
    ps.attempts,
    ps.last_error,
    ps.meta,
    NULLIF(ps.meta->>'finalized_by','')        AS finalized_by,
    NULLIF(ps.meta->>'finalization_source','') AS finalization_source,
    (ps.meta->'previous_errors')::text         AS prev_errors_txt,
    ps.meta->>'note'                           AS meta_note
  FROM public.package_steps ps
  WHERE ps.step_key = 'generate_blueprint_variants'
    AND ps.status   = 'done'::step_status
    AND NOT EXISTS (
      SELECT 1
      FROM public.blueprint_variants bv
      JOIN public.question_blueprints qb ON qb.id = bv.blueprint_id
      WHERE qb.package_id = ps.package_id
    )
)
SELECT
  'generate_blueprint_variants'::text AS step_key,
  step_id, package_id, job_id, finished_at,
  finalized_by, finalization_source,
  CASE
    WHEN finalized_by = 'verifier-reconciler'
         AND finalization_source = 'standalone_reconciler'
      THEN 'R1_RECONCILER_FALSE_DONE'
    WHEN finalized_by = 'stuck-scan'
      OR meta_note    = 'zombie finalization'
      THEN 'R2_STUCK_SCAN_ZOMBIE'
    WHEN finalized_by = 'admin_finalize_materialized_blueprint_variant_steps'
      THEN 'R3_ADMIN_HEAL_NO_VERIFY'
    WHEN finalized_by = 'pipeline-runner'
      THEN 'R4_RUNNER_META_HEURISTIC'
    WHEN finalized_by IS NULL AND finalization_source IS NULL
      THEN 'R5_UNKNOWN_LEGACY'
    ELSE 'R6_OTHER'
  END AS root_cause_code,
  jsonb_build_object(
    'attempts', attempts,
    'had_markstepdone_mismatch',  prev_errors_txt ILIKE '%MISMATCH%',
    'had_trigger_rollback',       prev_errors_txt ILIKE '%rolled back by a trigger%',
    'had_causality_blocked',      prev_errors_txt ILIKE '%CAUSALITY_BLOCKED%',
    'meta_ok',                    (meta->>'ok')::boolean,
    'finalization_reason',        meta->>'finalization_reason',
    'verifier_reason',            meta->>'verifier_reason',
    'last_error',                 last_error,
    'meta_note',                  meta_note
  ) AS evidence
FROM gbv;

GRANT SELECT ON public.v_step_done_output_missing TO authenticated;
GRANT SELECT ON public.v_step_done_output_missing TO service_role;

-- 3) Capture-RPC (admin-only). Persists the current view contents under a fresh run_id
--    and returns the run summary. READ-ONLY w.r.t. pipeline state.
CREATE OR REPLACE FUNCTION public.capture_step_done_output_missing_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_count  int;
  v_breakdown jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_setting('request.jwt.claims', true) IS NULL THEN
    -- block client invocations without admin; allow service_role (no JWT claims)
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  INSERT INTO public.step_done_output_missing_snapshots
    (run_id, step_key, package_id, step_id, job_id,
     finalized_by, finalization_source, root_cause_code, evidence, finished_at)
  SELECT v_run_id, step_key, package_id, step_id, job_id,
         finalized_by, finalization_source, root_cause_code, evidence, finished_at
  FROM public.v_step_done_output_missing;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  SELECT jsonb_object_agg(root_cause_code, n)
    INTO v_breakdown
  FROM (
    SELECT root_cause_code, COUNT(*) AS n
    FROM public.step_done_output_missing_snapshots
    WHERE run_id = v_run_id
    GROUP BY root_cause_code
  ) s;

  PERFORM public.fn_emit_audit(
    'step_done_output_missing.snapshot.captured',
    jsonb_build_object('run_id', v_run_id, 'count', v_count, 'breakdown', v_breakdown)
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'count', v_count,
    'breakdown', COALESCE(v_breakdown, '{}'::jsonb),
    'captured_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.capture_step_done_output_missing_snapshot() FROM public;
GRANT EXECUTE ON FUNCTION public.capture_step_done_output_missing_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.capture_step_done_output_missing_snapshot() TO service_role;
