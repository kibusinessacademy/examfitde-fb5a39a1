CREATE TABLE IF NOT EXISTS public.edge_function_registry (
  name text PRIMARY KEY,
  bytes integer NOT NULL DEFAULT 0,
  loc integer NOT NULL DEFAULT 0,
  notes text,
  manually_tagged_cluster text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.edge_function_registry TO authenticated;
GRANT ALL ON public.edge_function_registry TO service_role;
ALTER TABLE public.edge_function_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read edge_function_registry" ON public.edge_function_registry;
CREATE POLICY "Admins read edge_function_registry" ON public.edge_function_registry
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE VIEW public.v_admin_edge_fn_health AS
WITH cron_fns AS (
  SELECT (regexp_match(command, 'functions/v1/([a-zA-Z0-9_-]+)'))[1] AS fn,
         schedule, jobname
  FROM cron.job WHERE active AND command ~ 'functions/v1/'
),
cron_agg AS (
  SELECT fn, array_agg(DISTINCT schedule) AS schedules, count(*) AS cron_count
  FROM cron_fns WHERE fn IS NOT NULL GROUP BY fn
)
SELECT r.name, r.bytes, r.loc, r.manually_tagged_cluster, r.updated_at,
       (ca.fn IS NOT NULL) AS has_cron,
       ca.schedules AS cron_schedules,
       COALESCE(ca.cron_count,0) AS cron_count,
       CASE WHEN r.bytes > 50000 THEN 'huge'
            WHEN r.bytes > 30000 THEN 'large'
            ELSE 'normal' END AS size_class,
       CASE WHEN ca.fn IS NULL THEN 'cold-tail' ELSE 'hot-path' END AS path_class
FROM public.edge_function_registry r
LEFT JOIN cron_agg ca ON ca.fn = r.name;

GRANT SELECT ON public.v_admin_edge_fn_health TO authenticated;