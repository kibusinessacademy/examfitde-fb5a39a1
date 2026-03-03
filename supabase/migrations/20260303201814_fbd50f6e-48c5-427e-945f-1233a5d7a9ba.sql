
-- ============================================================
-- Phase 2: Complete Bundle (RPC + Table + Triggers + Cron + View)
-- ============================================================

-- A) enqueue_blueprint_gap_jobs RPC
CREATE OR REPLACE FUNCTION public.enqueue_blueprint_gap_jobs(
  p_curriculum_id uuid,
  p_cap int DEFAULT 50,
  p_reason text DEFAULT 'gap_router'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap int := GREATEST(5, LEAST(COALESCE(p_cap, 50), 200));
  v_ins int := 0;
BEGIN
  WITH gaps AS (
    SELECT g.competency_id, g.gap_total, g.gap_recall, g.gap_application,
      g.gap_scenario, g.gap_transfer, g.gap_error_patterns, g.priority
    FROM public.get_blueprint_coverage_gaps(p_curriculum_id, 1) g
    ORDER BY g.priority DESC, g.gap_total DESC
    LIMIT v_cap
  ),
  ins AS (
    INSERT INTO public.job_queue (
      job_type, status, payload, priority, max_attempts, package_id, worker_pool
    )
    SELECT
      'blueprint_generate_variants', 'pending',
      jsonb_build_object(
        'curriculum_id', p_curriculum_id::text,
        'competency_id', g.competency_id::text,
        'gap_total', g.gap_total,
        'targets', jsonb_build_object(
          'recall', GREATEST(g.gap_recall, 0),
          'application', GREATEST(g.gap_application, 0),
          'scenario', GREATEST(g.gap_scenario, 0),
          'transfer', GREATEST(g.gap_transfer, 0),
          'error_patterns', GREATEST(g.gap_error_patterns, 0)
        ),
        'reason', p_reason
      ),
      80, 3, NULL, 'content'
    FROM gaps g
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_ins FROM ins;

  RETURN jsonb_build_object(
    'curriculum_id', p_curriculum_id, 'cap', v_cap,
    'enqueued', v_ins, 'reason', p_reason, 'ts', now()
  );
END;
$$;

-- B) blueprint_param_sets table
CREATE TABLE public.blueprint_param_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.question_blueprints(id) ON DELETE CASCADE,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_label text,
  weight integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blueprint_id, params)
);

ALTER TABLE public.blueprint_param_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage blueprint_param_sets"
  ON public.blueprint_param_sets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_bps_blueprint_active
  ON public.blueprint_param_sets (blueprint_id) WHERE is_active = true;

-- C) Density-gate trigger (hard gate on approve)
CREATE OR REPLACE FUNCTION public.trg_guard_canonical_density_on_approve()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_density int;
  v_max int;
  v_track text;
BEGIN
  IF NEW.status != 'approved' OR (OLD IS NOT NULL AND OLD.status = 'approved') THEN
    RETURN NEW;
  END IF;
  IF NEW.canonical_hash IS NULL OR NEW.blueprint_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(cp.track, 'AUSBILDUNG_VOLL') INTO v_track
  FROM public.course_packages cp WHERE cp.id = NEW.package_id LIMIT 1;

  v_max := CASE
    WHEN v_track = 'EXAM_FIRST' THEN 6
    WHEN v_track = 'ELITE' THEN 12
    ELSE 8
  END;

  SELECT COUNT(*) INTO v_density
  FROM public.exam_questions
  WHERE blueprint_id = NEW.blueprint_id AND canonical_hash = NEW.canonical_hash
    AND status = 'approved' AND id != NEW.id;

  IF v_density >= v_max THEN
    RAISE EXCEPTION 'CANONICAL_DENSITY_EXCEEDED: blueprint=% density=%/% hash=%',
      NEW.blueprint_id, v_density + 1, v_max, LEFT(NEW.canonical_hash, 12)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_canonical_density
  BEFORE INSERT OR UPDATE OF status ON public.exam_questions
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_canonical_density_on_approve();

-- D) Cross-blueprint collision gate on approve
CREATE OR REPLACE FUNCTION public.trg_guard_global_collision_on_approve()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_collider uuid;
BEGIN
  IF NEW.status != 'approved' OR (OLD IS NOT NULL AND OLD.status = 'approved') THEN
    RETURN NEW;
  END IF;
  IF NEW.global_canonical_hash IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_collider FROM public.exam_questions
  WHERE global_canonical_hash = NEW.global_canonical_hash
    AND status = 'approved' AND id != NEW.id
    AND blueprint_id IS DISTINCT FROM NEW.blueprint_id
  LIMIT 1;

  IF v_collider IS NOT NULL THEN
    RAISE EXCEPTION 'GLOBAL_CANONICAL_COLLISION: question=% collides with=% hash=%',
      NEW.id, v_collider, LEFT(NEW.global_canonical_hash, 12)
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_global_collision
  BEFORE INSERT OR UPDATE OF status ON public.exam_questions
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_global_collision_on_approve();

-- E) Nightly cron for gap-filling
SELECT cron.schedule(
  'nightly_blueprint_gap_fill',
  '45 2 * * *',
  $$
  WITH cids AS (
    SELECT DISTINCT curriculum_id FROM public.blueprint_targets
  ),
  results AS (
    SELECT c.curriculum_id,
      public.enqueue_blueprint_gap_jobs(c.curriculum_id, 30, 'cron_nightly_gap_fill') AS result
    FROM cids c
  )
  INSERT INTO public.system_cron_runs(job_name, result)
  SELECT 'nightly_blueprint_gap_fill', jsonb_build_object('curricula', jsonb_agg(r.result))
  FROM results r;
  $$
);

-- F) Param-set utilization view
CREATE OR REPLACE VIEW public.ops_param_set_utilization AS
SELECT
  qb.curriculum_id, bps.blueprint_id, qb.name AS blueprint_name,
  COUNT(bps.id) AS total_param_sets,
  COUNT(bps.id) FILTER (WHERE bps.is_active) AS active_param_sets,
  SUM(bps.used_count) AS total_uses,
  COUNT(bps.id) FILTER (WHERE bps.used_count = 0 AND bps.is_active) AS unused_sets,
  CASE WHEN COUNT(bps.id) FILTER (WHERE bps.is_active) > 0
    THEN ROUND(100.0 * COUNT(bps.id) FILTER (WHERE bps.used_count > 0)
      / COUNT(bps.id) FILTER (WHERE bps.is_active), 1)
    ELSE NULL END AS utilization_pct
FROM public.blueprint_param_sets bps
JOIN public.question_blueprints qb ON qb.id = bps.blueprint_id
GROUP BY qb.curriculum_id, bps.blueprint_id, qb.name;
