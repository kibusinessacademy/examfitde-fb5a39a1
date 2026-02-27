
-- ============================================================
-- Runner Hardening: ops_worker_heartbeats + watchdog helpers
-- ============================================================

-- 1) Heartbeat table for runner health monitoring
CREATE TABLE public.ops_worker_heartbeats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_name TEXT NOT NULL,
  worker_version TEXT NOT NULL DEFAULT 'v1',
  instance_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  boot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE (worker_name, instance_id)
);

-- Enable RLS (service-role only)
ALTER TABLE public.ops_worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- No public/anon/authenticated access — only service_role
-- (RLS with no policies = deny all for non-service-role)

-- Index for watchdog queries
CREATE INDEX idx_heartbeats_worker_seen 
  ON public.ops_worker_heartbeats (worker_name, last_seen_at DESC);

-- 2) RPC: upsert heartbeat (service_role only)
CREATE OR REPLACE FUNCTION public.upsert_worker_heartbeat(
  p_worker_name TEXT,
  p_instance_id TEXT,
  p_version TEXT DEFAULT 'v1',
  p_processed_count INTEGER DEFAULT 0,
  p_last_error TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO ops_worker_heartbeats (worker_name, instance_id, worker_version, last_seen_at, processed_count, last_error, metadata)
  VALUES (p_worker_name, p_instance_id, p_version, now(), p_processed_count, p_last_error, p_metadata)
  ON CONFLICT (worker_name, instance_id)
  DO UPDATE SET
    last_seen_at = now(),
    worker_version = p_version,
    processed_count = ops_worker_heartbeats.processed_count + p_processed_count,
    last_error = p_last_error,
    metadata = p_metadata;
END;
$$;

-- Lock down RPC to service_role only
REVOKE EXECUTE ON FUNCTION public.upsert_worker_heartbeat FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_worker_heartbeat TO service_role;

-- 3) RPC: check worker health (for watchdog / CI health check)
CREATE OR REPLACE FUNCTION public.check_worker_health(
  p_worker_name TEXT DEFAULT NULL,
  p_stale_minutes INTEGER DEFAULT 3
) RETURNS TABLE(
  worker_name TEXT,
  instance_id TEXT,
  worker_version TEXT,
  last_seen_at TIMESTAMPTZ,
  is_healthy BOOLEAN,
  minutes_since_seen NUMERIC,
  processed_count INTEGER,
  last_error TEXT
)
LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.worker_name,
    h.instance_id,
    h.worker_version,
    h.last_seen_at,
    (h.last_seen_at > now() - (p_stale_minutes || ' minutes')::interval) AS is_healthy,
    ROUND(EXTRACT(EPOCH FROM (now() - h.last_seen_at)) / 60, 1) AS minutes_since_seen,
    h.processed_count,
    h.last_error
  FROM ops_worker_heartbeats h
  WHERE (p_worker_name IS NULL OR h.worker_name = p_worker_name)
  ORDER BY h.last_seen_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_worker_health FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_worker_health TO service_role;
