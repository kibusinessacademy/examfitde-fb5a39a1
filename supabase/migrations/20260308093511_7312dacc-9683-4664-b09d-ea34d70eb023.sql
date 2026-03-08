
-- Worker Auto-Scaling policies
CREATE TABLE IF NOT EXISTS public.worker_scaling_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE,
  worker_key text NOT NULL,
  min_workers integer NOT NULL DEFAULT 1,
  max_workers integer NOT NULL DEFAULT 10,
  scale_up_pending_threshold integer NOT NULL DEFAULT 50,
  scale_down_pending_threshold integer NOT NULL DEFAULT 5,
  scale_up_cooldown_seconds integer NOT NULL DEFAULT 120,
  scale_down_cooldown_seconds integer NOT NULL DEFAULT 300,
  is_enabled boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.worker_scaling_policies ENABLE ROW LEVEL SECURITY;

-- Provider Routing policies
CREATE TABLE IF NOT EXISTS public.llm_provider_routing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key text NOT NULL UNIQUE,
  workload_key text NOT NULL,
  provider_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  fallback_mode text NOT NULL DEFAULT 'ordered',
  is_enabled boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_provider_routing_policies ENABLE ROW LEVEL SECURITY;

-- RPC: get_worker_scaling_recommendations
CREATE OR REPLACE FUNCTION public.get_worker_scaling_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
BEGIN
  WITH worker_stats AS (
    SELECT
      p.policy_key,
      p.worker_key,
      p.min_workers,
      p.max_workers,
      p.scale_up_pending_threshold,
      p.scale_down_pending_threshold,
      coalesce((r.meta->>'current_workers')::int, p.min_workers) as current_workers,
      CASE
        WHEN p.worker_key = 'content-runner' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type IN ('lesson_generate_content','lesson_generate_competency_bundle')
        )
        WHEN p.worker_key = 'pipeline-runner' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'package_%'
        )
        WHEN p.worker_key = 'campaign-asset-worker' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'campaign_%'
        )
        WHEN p.worker_key = 'distribution-worker' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'distribution_%'
        )
        WHEN p.worker_key = 'optimization-executor' THEN (
          SELECT count(*) FROM public.job_queue
          WHERE status IN ('pending','queued')
            AND job_type LIKE 'optimization_%'
        )
        ELSE 0
      END as pending_jobs
    FROM public.worker_scaling_policies p
    LEFT JOIN public.system_runner_registry r
      ON r.runner_key = p.worker_key
    WHERE p.is_enabled = true
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'policy_key', ws.policy_key,
      'worker_key', ws.worker_key,
      'current_workers', ws.current_workers,
      'pending_jobs', ws.pending_jobs,
      'recommended_workers',
      CASE
        WHEN ws.pending_jobs >= ws.scale_up_pending_threshold
          THEN LEAST(ws.max_workers, ws.current_workers + 1)
        WHEN ws.pending_jobs <= ws.scale_down_pending_threshold
          THEN GREATEST(ws.min_workers, ws.current_workers - 1)
        ELSE ws.current_workers
      END
    )
  )
  INTO v_rows
  FROM worker_stats ws;

  RETURN coalesce(v_rows, '[]'::jsonb);
END;
$$;

-- RPC: resolve_available_llm_route
CREATE OR REPLACE FUNCTION public.resolve_available_llm_route(
  p_workload_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy jsonb;
  v_entry jsonb;
  v_provider text;
  v_model text;
  v_until timestamptz;
BEGIN
  SELECT provider_chain
  INTO v_policy
  FROM public.llm_provider_routing_policies
  WHERE workload_key = p_workload_key
    AND is_enabled = true
  LIMIT 1;

  IF v_policy IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'no_policy'
    );
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_policy)
  LOOP
    v_provider := v_entry->>'provider';
    v_model := v_entry->>'model';

    SELECT c.until_at
    INTO v_until
    FROM public.llm_provider_cooldowns c
    WHERE c.provider = v_provider
      AND c.model = v_model
      AND c.until_at > now()
    ORDER BY c.until_at DESC
    LIMIT 1;

    IF v_until IS NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'provider', v_provider,
        'model', v_model,
        'reason', 'healthy_route'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'all_candidates_on_cooldown'
  );
END;
$$;

-- View: provider routing health
CREATE OR REPLACE VIEW public.v_provider_routing_health AS
SELECT
  p.workload_key,
  e->>'provider' as provider,
  e->>'model' as model,
  EXISTS (
    SELECT 1
    FROM public.llm_provider_cooldowns c
    WHERE c.provider = e->>'provider'
      AND c.model = e->>'model'
      AND c.until_at > now()
  ) as on_cooldown
FROM public.llm_provider_routing_policies p,
LATERAL jsonb_array_elements(p.provider_chain) e
WHERE p.is_enabled = true;
