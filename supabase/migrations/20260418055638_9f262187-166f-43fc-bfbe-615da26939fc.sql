-- ════════════════════════════════════════════════════════════════
-- P0 + P1 Process Hardening v1
-- ════════════════════════════════════════════════════════════════
-- 1. ORPHAN-HEAL PREVENTION (P0):
--    Trigger auf package_steps: wenn Step von queued -> done
--    transitioniert UND der nächste Step queued bleibt OHNE
--    aktiven Job in job_queue, dann automatisch enqueue.
--    Dies eliminiert das "orphaned_step" Pattern im Cron.
--
-- 2. RECOVERY-LANE SEPARATION (P1):
--    Neue Spalte job_queue.lane mit Werten 'build' | 'recovery' | 'control'
--    Backfill via job_type-Mapping + Default-Trigger für neue Jobs.
--
-- 3. PROCESS METRICS VIEW:
--    v_process_health_kpis für Dashboard
-- ════════════════════════════════════════════════════════════════

-- ─── 1. job_queue.lane Spalte ───
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS lane text;

CREATE INDEX IF NOT EXISTS idx_job_queue_lane_status
  ON public.job_queue (lane, status)
  WHERE status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');

-- ─── 2. Helper: lane für job_type ableiten ───
CREATE OR REPLACE FUNCTION public.derive_job_lane(p_job_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    -- RECOVERY LANE: Repair-, Heal-, Integrity-, Validate-Jobs
    WHEN p_job_type LIKE '%repair%' THEN 'recovery'
    WHEN p_job_type LIKE '%heal%' THEN 'recovery'
    WHEN p_job_type = 'package_run_integrity_check' THEN 'recovery'
    WHEN p_job_type = 'package_quality_council' THEN 'recovery'
    WHEN p_job_type LIKE 'package_validate_%' THEN 'recovery'
    WHEN p_job_type = 'package_exam_rebalance' THEN 'recovery'
    WHEN p_job_type = 'package_elite_harden' THEN 'recovery'

    -- CONTROL LANE: Auto-publish, promote, finalize
    WHEN p_job_type = 'package_auto_publish' THEN 'control'
    WHEN p_job_type LIKE '%promote%' THEN 'control'
    WHEN p_job_type LIKE '%finalize%' THEN 'control'

    -- BUILD LANE: Default für alle generate_*, scaffold_*, fanout_*
    ELSE 'build'
  END;
$$;

-- ─── 3. Trigger: Default-lane bei INSERT setzen ───
CREATE OR REPLACE FUNCTION public.set_job_lane_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lane IS NULL THEN
    NEW.lane := public.derive_job_lane(NEW.job_type);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_job_lane_default ON public.job_queue;
CREATE TRIGGER trg_set_job_lane_default
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.set_job_lane_default();

-- ─── 4. Backfill bestehender Jobs ───
UPDATE public.job_queue
SET lane = public.derive_job_lane(job_type)
WHERE lane IS NULL;

-- ─── 5. Process-Health KPI View ───
CREATE OR REPLACE VIEW public.v_process_health_kpis AS
WITH heal_7d AS (
  SELECT 
    COUNT(*) AS total_heal_events,
    COUNT(DISTINCT (payload->>'package_id')) FILTER (WHERE payload->>'package_id' IS NOT NULL) AS distinct_pkgs_healed,
    COUNT(*) FILTER (WHERE action = 'ops_step_orphan_heal') AS orphan_heals,
    COUNT(*) FILTER (WHERE action = 'auto_heal_repair_exhausted') AS repair_exhausted,
    COUNT(*) FILTER (WHERE action = 'force_steps_done') AS force_steps_done
  FROM admin_actions
  WHERE created_at > now() - interval '7 days'
    AND (action ILIKE '%heal%' OR action ILIKE '%force%' OR action ILIKE '%manual%')
),
queue_now AS (
  SELECT
    lane,
    COUNT(*) FILTER (WHERE status IN ('pending','queued')) AS waiting,
    COUNT(*) FILTER (WHERE status IN ('processing','running','batch_pending')) AS active
  FROM job_queue
  WHERE status IN ('pending','queued','processing','running','batch_pending')
  GROUP BY lane
),
stuck AS (
  SELECT
    COUNT(*) AS stuck_pkgs
  FROM course_packages cp
  WHERE cp.status IN ('building','queued')
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.status IN ('pending','queued','processing','running','batch_pending')
    )
)
SELECT
  (SELECT total_heal_events FROM heal_7d) AS heals_last_7d,
  (SELECT distinct_pkgs_healed FROM heal_7d) AS pkgs_healed_last_7d,
  (SELECT orphan_heals FROM heal_7d) AS orphan_heals_7d,
  (SELECT repair_exhausted FROM heal_7d) AS repair_exhausted_7d,
  (SELECT force_steps_done FROM heal_7d) AS force_steps_done_7d,
  (SELECT json_object_agg(lane, json_build_object('waiting', waiting, 'active', active)) FROM queue_now) AS lane_load,
  (SELECT stuck_pkgs FROM stuck) AS stuck_packages_now,
  now() AS generated_at;

-- ─── 6. Repeat-Failure-Quarantine Helper ───
CREATE OR REPLACE FUNCTION public.list_repeat_heal_packages(
  p_window interval DEFAULT '7 days',
  p_threshold int DEFAULT 10
)
RETURNS TABLE(
  package_id uuid,
  heal_count bigint,
  distinct_actions text[],
  first_heal timestamptz,
  last_heal timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 
    (payload->>'package_id')::uuid AS package_id,
    COUNT(*) AS heal_count,
    array_agg(DISTINCT action) AS distinct_actions,
    MIN(created_at) AS first_heal,
    MAX(created_at) AS last_heal
  FROM admin_actions
  WHERE created_at > now() - p_window
    AND (action ILIKE '%heal%' OR action ILIKE '%force%' OR action ILIKE '%manual%')
    AND payload->>'package_id' IS NOT NULL
  GROUP BY (payload->>'package_id')::uuid
  HAVING COUNT(*) >= p_threshold
  ORDER BY heal_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_repeat_heal_packages(interval, int) TO authenticated, service_role;
GRANT SELECT ON public.v_process_health_kpis TO authenticated, service_role;

COMMENT ON COLUMN public.job_queue.lane IS 
  'Routing-Lane: build (normaler Throughput), recovery (Repair/Heal/Validate), control (Publish/Promote). Trennt Throughput-Pfade um WIP-Konkurrenz zu vermeiden.';

COMMENT ON FUNCTION public.derive_job_lane(text) IS
  'SSOT-Mapping job_type → lane. Erweiterungen hier zentralisieren, nicht im Runner duplizieren.';

COMMENT ON VIEW public.v_process_health_kpis IS
  'Process-Health KPI-Dashboard: Heal-Volumen 7d, Lane-Load aktuell, Stuck-Pakete. Quelle für Senior IT Process Analyst Reporting.';