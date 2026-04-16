
CREATE TABLE IF NOT EXISTS public.runner_tick_telemetry (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  worker_id TEXT NOT NULL,
  claimed_count INTEGER NOT NULL DEFAULT 0,
  kept_count INTEGER NOT NULL DEFAULT 0,
  per_type_deferred INTEGER NOT NULL DEFAULT 0,
  heavy_budget_deferred INTEGER NOT NULL DEFAULT 0,
  estimated_seconds INTEGER NOT NULL DEFAULT 0,
  budget_seconds INTEGER NOT NULL DEFAULT 85,
  type_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_runner_tick_telemetry_created_at
  ON public.runner_tick_telemetry (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runner_tick_telemetry_overflow
  ON public.runner_tick_telemetry (created_at DESC)
  WHERE heavy_budget_deferred > 0 OR per_type_deferred > 0;

ALTER TABLE public.runner_tick_telemetry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_runner_tick_telemetry" ON public.runner_tick_telemetry;
CREATE POLICY "service_role_all_runner_tick_telemetry"
  ON public.runner_tick_telemetry FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admins_select_runner_tick_telemetry" ON public.runner_tick_telemetry;
CREATE POLICY "admins_select_runner_tick_telemetry"
  ON public.runner_tick_telemetry FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP VIEW IF EXISTS public.v_runner_tick_overflow_health CASCADE;
CREATE VIEW public.v_runner_tick_overflow_health AS
WITH window24h AS (
  SELECT * FROM public.runner_tick_telemetry
  WHERE created_at > now() - interval '24 hours'
),
by_hour AS (
  SELECT
    date_trunc('hour', created_at) AS hour_bucket,
    COUNT(*) AS ticks,
    SUM(claimed_count) AS total_claimed,
    SUM(kept_count) AS total_kept,
    SUM(per_type_deferred) AS total_per_type_deferred,
    SUM(heavy_budget_deferred) AS total_heavy_budget_deferred,
    AVG(estimated_seconds)::numeric(10,2) AS avg_estimated_sec,
    MAX(estimated_seconds) AS max_estimated_sec,
    MAX(budget_seconds) AS budget_sec,
    COUNT(*) FILTER (WHERE estimated_seconds >= (budget_seconds * 0.8)::int) AS ticks_near_budget,
    COUNT(*) FILTER (WHERE heavy_budget_deferred > 0) AS ticks_with_heavy_defer
  FROM window24h
  GROUP BY 1
)
SELECT
  hour_bucket,
  ticks,
  total_claimed,
  total_kept,
  total_per_type_deferred,
  total_heavy_budget_deferred,
  avg_estimated_sec,
  max_estimated_sec,
  budget_sec,
  ticks_near_budget,
  ticks_with_heavy_defer,
  CASE
    WHEN ticks = 0 THEN 'no_data'
    WHEN ticks_with_heavy_defer >= GREATEST(3, (ticks * 0.5)::int) THEN 'chronic_overflow'
    WHEN ticks_with_heavy_defer > 0 THEN 'over_budget_deferring'
    WHEN ticks_near_budget > 0 THEN 'near_budget'
    ELSE 'healthy'
  END AS health_class
FROM by_hour
ORDER BY hour_bucket DESC;

DROP VIEW IF EXISTS public.v_runner_tick_overflow_alerts CASCADE;
CREATE VIEW public.v_runner_tick_overflow_alerts AS
WITH recent AS (
  SELECT * FROM public.runner_tick_telemetry
  WHERE created_at > now() - interval '60 minutes'
),
worker_overflow AS (
  SELECT worker_id, COUNT(*) AS overflow_ticks
  FROM recent
  WHERE heavy_budget_deferred > 0
  GROUP BY worker_id
),
hot AS (
  SELECT COALESCE(jsonb_object_agg(worker_id, overflow_ticks), '{}'::jsonb) AS hot_workers
  FROM worker_overflow
),
agg AS (
  SELECT
    COUNT(*) AS ticks_60min,
    COUNT(*) FILTER (WHERE heavy_budget_deferred > 0) AS overflow_ticks,
    COUNT(*) FILTER (WHERE per_type_deferred > 0) AS per_type_ticks,
    SUM(heavy_budget_deferred) AS jobs_deferred_heavy,
    SUM(per_type_deferred) AS jobs_deferred_per_type,
    MAX(estimated_seconds) AS peak_estimated_sec,
    MAX(budget_seconds) AS budget_sec
  FROM recent
)
SELECT
  now() AS observed_at,
  agg.ticks_60min,
  agg.overflow_ticks,
  agg.per_type_ticks,
  agg.jobs_deferred_heavy,
  agg.jobs_deferred_per_type,
  agg.peak_estimated_sec,
  agg.budget_sec,
  hot.hot_workers,
  CASE
    WHEN agg.ticks_60min = 0 THEN 'no_data'
    WHEN agg.overflow_ticks >= 5 THEN 'P1_chronic_overflow'
    WHEN agg.overflow_ticks >= 2 THEN 'P2_repeated_overflow'
    WHEN agg.overflow_ticks >= 1 OR agg.per_type_ticks >= 3 THEN 'P3_isolated_pressure'
    ELSE 'ok'
  END AS alert_level
FROM agg, hot;

GRANT SELECT ON public.v_runner_tick_overflow_health TO authenticated;
GRANT SELECT ON public.v_runner_tick_overflow_alerts TO authenticated;
