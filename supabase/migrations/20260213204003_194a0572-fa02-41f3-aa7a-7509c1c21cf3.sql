
-- ═══════════════════════════════════════════════════
-- Pipeline Lock: Singleton table for WIP-limit = 1
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pipeline_lock (
  id int PRIMARY KEY DEFAULT 1,
  active_package_id uuid NULL REFERENCES public.course_packages(id),
  locked_at timestamptz NULL,
  locked_by text NULL,
  heartbeat_at timestamptz NULL,
  mode text NOT NULL DEFAULT 'single',
  max_active int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed singleton row
INSERT INTO public.pipeline_lock (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS: admin-only read, functions use service_role
ALTER TABLE public.pipeline_lock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pipeline lock readable by all authenticated" ON public.pipeline_lock
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════
-- RPC: try_claim_pipeline_lock
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.try_claim_pipeline_lock(p_package_id uuid, p_locked_by text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active uuid;
BEGIN
  SELECT active_package_id INTO v_active
  FROM public.pipeline_lock
  WHERE id = 1
  FOR UPDATE;

  IF v_active IS NULL THEN
    UPDATE public.pipeline_lock
      SET active_package_id = p_package_id,
          locked_at = now(),
          heartbeat_at = now(),
          locked_by = p_locked_by,
          updated_at = now()
    WHERE id = 1;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════
-- RPC: release_pipeline_lock
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.release_pipeline_lock(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_lock
     SET active_package_id = NULL,
         locked_at = NULL,
         heartbeat_at = NULL,
         locked_by = NULL,
         updated_at = now()
   WHERE id = 1
     AND active_package_id = p_package_id;
END;
$$;

-- ═══════════════════════════════════════════════════
-- RPC: heartbeat_pipeline_lock
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.heartbeat_pipeline_lock(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_lock
     SET heartbeat_at = now(),
         updated_at = now()
   WHERE id = 1
     AND active_package_id = p_package_id;
END;
$$;

-- ═══════════════════════════════════════════════════
-- RPC: cleanup_stale_pipeline_lock (called by cron)
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cleanup_stale_pipeline_lock()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pkg uuid;
BEGIN
  SELECT active_package_id INTO v_pkg
  FROM public.pipeline_lock
  WHERE id = 1
    AND active_package_id IS NOT NULL
    AND heartbeat_at < now() - interval '10 minutes';

  IF v_pkg IS NOT NULL THEN
    UPDATE public.pipeline_lock
      SET active_package_id = NULL, locked_at = NULL, heartbeat_at = NULL,
          locked_by = NULL, updated_at = now()
    WHERE id = 1;

    UPDATE public.course_packages
      SET status = 'failed',
          updated_at = now()
    WHERE id = v_pkg;

    INSERT INTO public.admin_notifications (title, body, category, severity, metadata)
    VALUES (
      '⏰ Pipeline Lock Timeout: ' || left(v_pkg::text, 8),
      'Heartbeat >10min veraltet. Lock freigegeben, Paket auf failed gesetzt.',
      'ops', 'error',
      jsonb_build_object('package_id', v_pkg, 'reason', 'stale_lock_timeout')
    );
  END IF;
END;
$$;
