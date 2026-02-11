
-- Course Production Forecasts: Soll/Ist tracking per course
CREATE TABLE public.course_production_forecasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  
  -- SOLL (forecast)
  forecast_total_jobs INTEGER NOT NULL DEFAULT 0,
  forecast_content_jobs INTEGER NOT NULL DEFAULT 0,
  forecast_pipeline_jobs INTEGER NOT NULL DEFAULT 0,
  forecast_cost_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  forecast_cost_content_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  forecast_cost_pipeline_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  forecast_duration_hours NUMERIC(6,1) NOT NULL DEFAULT 0,
  forecast_start_at TIMESTAMPTZ,
  forecast_end_at TIMESTAMPTZ,
  
  -- IST (actuals)
  actual_jobs_completed INTEGER NOT NULL DEFAULT 0,
  actual_jobs_failed INTEGER NOT NULL DEFAULT 0,
  actual_jobs_pending INTEGER NOT NULL DEFAULT 0,
  actual_cost_eur NUMERIC(10,2) NOT NULL DEFAULT 0,
  actual_started_at TIMESTAMPTZ,
  actual_completed_at TIMESTAMPTZ,
  actual_duration_hours NUMERIC(6,1),
  
  -- Metadata
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','failed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(course_id)
);

ALTER TABLE public.course_production_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_forecast_all" ON public.course_production_forecasts
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_forecasts_updated_at
  BEFORE UPDATE ON public.course_production_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC to refresh actuals from job_queue
CREATE OR REPLACE FUNCTION public.refresh_course_forecast_actuals()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE course_production_forecasts f SET
    actual_jobs_completed = sub.completed,
    actual_jobs_failed = sub.failed,
    actual_jobs_pending = sub.pending,
    actual_started_at = sub.first_started,
    actual_completed_at = CASE WHEN sub.pending = 0 AND sub.completed > 0 THEN sub.last_completed ELSE NULL END,
    actual_duration_hours = CASE 
      WHEN sub.pending = 0 AND sub.completed > 0 AND sub.first_started IS NOT NULL 
      THEN ROUND(EXTRACT(EPOCH FROM (sub.last_completed - sub.first_started)) / 3600.0, 1)
      ELSE NULL 
    END,
    status = CASE
      WHEN sub.pending = 0 AND sub.failed = 0 AND sub.completed > 0 THEN 'completed'
      WHEN sub.pending = 0 AND sub.failed > 0 THEN 'failed'
      WHEN sub.completed > 0 OR sub.pending > 0 THEN 'in_progress'
      ELSE 'planned'
    END,
    updated_at = now()
  FROM (
    SELECT 
      j.payload->>'course_id' as cid,
      COUNT(*) FILTER (WHERE j.status = 'completed') as completed,
      COUNT(*) FILTER (WHERE j.status = 'failed') as failed,
      COUNT(*) FILTER (WHERE j.status IN ('pending','processing')) as pending,
      MIN(j.started_at) as first_started,
      MAX(j.completed_at) as last_completed
    FROM job_queue j
    WHERE j.payload->>'course_id' IS NOT NULL
    GROUP BY j.payload->>'course_id'
  ) sub
  WHERE f.course_id::text = sub.cid;
END;
$$;
