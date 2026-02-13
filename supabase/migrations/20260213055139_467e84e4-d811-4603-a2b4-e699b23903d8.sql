
-- Extend course_packages with production tracking
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS current_step integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_status_json jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS stuck_reason text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cp_status_queue ON public.course_packages (status, queue_position);
CREATE INDEX IF NOT EXISTS idx_cp_status_progress ON public.course_packages (status, last_progress_at);

-- KPI daily rollup
CREATE TABLE IF NOT EXISTS public.kpi_daily_rollup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL UNIQUE,
  packages_completed integer DEFAULT 0, packages_started integer DEFAULT 0,
  avg_build_minutes numeric DEFAULT 0,
  jobs_completed integer DEFAULT 0, jobs_failed integer DEFAULT 0, jobs_retried integer DEFAULT 0,
  cost_total_eur numeric DEFAULT 0, cost_openai_eur numeric DEFAULT 0,
  cost_anthropic_eur numeric DEFAULT 0, cost_google_eur numeric DEFAULT 0,
  top_error_code text, backlog_jobs integer DEFAULT 0, eta_hours numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.kpi_daily_rollup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_rollup_admin" ON public.kpi_daily_rollup FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Admin actions log
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, action text NOT NULL, payload jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_actions_read" ON public.admin_actions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Helper RPCs
CREATE OR REPLACE FUNCTION public.get_active_package_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM course_packages WHERE status = 'building';
$$;

CREATE OR REPLACE FUNCTION public.pick_next_package_to_start(max_active integer DEFAULT 4)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE active_count integer; next_id uuid;
BEGIN
  SELECT count(*) INTO active_count FROM course_packages WHERE status = 'building';
  IF active_count >= max_active THEN RETURN NULL; END IF;
  SELECT id INTO next_id FROM course_packages
  WHERE status IN ('queued','planning') AND queue_position IS NOT NULL AND council_approved = true
  ORDER BY (COALESCE(priority,0) + FLOOR(EXTRACT(EPOCH FROM (now()-created_at))/43200))::integer DESC, queue_position ASC, created_at ASC
  LIMIT 1;
  RETURN next_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_package_status(p_id uuid, p_status text, p_meta jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE course_packages SET status=p_status, updated_at=now(), last_progress_at=now(),
    stuck_reason=CASE WHEN p_status IN ('failed','blocked') THEN p_meta->>'reason' ELSE NULL END,
    started_at=CASE WHEN p_status='building' AND started_at IS NULL THEN now() ELSE started_at END
  WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.update_package_progress(p_id uuid, p_step integer, p_step_status jsonb, p_progress_at timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE course_packages SET current_step=p_step, step_status_json=p_step_status,
    last_progress_at=p_progress_at, stuck_reason=NULL, updated_at=now() WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_package_stuck(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE course_packages SET stuck_reason=p_reason, updated_at=now() WHERE id=p_id; END; $$;

CREATE OR REPLACE FUNCTION public.auto_retry_stuck_package(p_package_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE retried integer;
BEGIN
  UPDATE job_queue SET status='pending', scheduled_at=now()+interval '30 seconds',
    locked_at=NULL, locked_by=NULL, updated_at=now()
  WHERE status='failed' AND (payload->>'package_id')::uuid=p_package_id
    AND (last_error_code IN ('RATE_LIMIT','TIMEOUT') OR last_error ILIKE '%rate limit%' OR last_error ILIKE '%timeout%')
    AND attempts < 20;
  GET DIAGNOSTICS retried = ROW_COUNT;
  IF retried > 0 THEN UPDATE course_packages SET stuck_reason=NULL, updated_at=now() WHERE id=p_package_id; END IF;
  RETURN retried;
END; $$;

CREATE OR REPLACE FUNCTION public.get_production_kpis()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'active_packages', (SELECT count(*) FROM course_packages WHERE status='building'),
    'queued_packages', (SELECT count(*) FROM course_packages WHERE status IN ('queued','planning') AND queue_position IS NOT NULL),
    'published_packages', (SELECT count(*) FROM course_packages WHERE status='published'),
    'failed_packages', (SELECT count(*) FROM course_packages WHERE status='failed'),
    'stuck_packages', (SELECT count(*) FROM course_packages WHERE stuck_reason IS NOT NULL AND status='building'),
    'pending_jobs', (SELECT count(*) FROM job_queue WHERE status='pending'),
    'processing_jobs', (SELECT count(*) FROM job_queue WHERE status='processing'),
    'failed_jobs_24h', (SELECT count(*) FROM job_queue WHERE status='failed' AND created_at > now()-interval '24 hours'),
    'completed_jobs_24h', (SELECT count(*) FROM job_queue WHERE status='completed' AND completed_at > now()-interval '24 hours'),
    'rate_limited_jobs', (SELECT count(*) FROM job_queue WHERE status='failed' AND last_error_code='RATE_LIMIT'),
    'top_errors', (SELECT coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) FROM (SELECT last_error_code AS code, count(*) AS cnt FROM job_queue WHERE status='failed' AND last_error_code IS NOT NULL GROUP BY last_error_code ORDER BY cnt DESC LIMIT 5) t),
    'provider_load', (SELECT coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) FROM (SELECT provider, count(*) AS running FROM job_queue WHERE status='processing' AND provider IS NOT NULL GROUP BY provider) t),
    'budget', (SELECT row_to_json(b) FROM (SELECT budget_eur, spent_eur, hard_stop, max_active_packages FROM llm_budget LIMIT 1) b),
    'rate_limits', (SELECT coalesce(jsonb_agg(row_to_json(r)),'[]'::jsonb) FROM llm_rate_limits r),
    'cost_today', (SELECT coalesce(sum(cost_eur),0) FROM ai_usage_log WHERE created_at > date_trunc('day',now())),
    'cost_7d', (SELECT coalesce(sum(cost_eur),0) FROM ai_usage_log WHERE created_at > now()-interval '7 days'),
    'throughput_1h', (SELECT count(*) FROM job_queue WHERE status='completed' AND completed_at > now()-interval '1 hour')
  ) INTO result;
  RETURN result;
END; $$;
