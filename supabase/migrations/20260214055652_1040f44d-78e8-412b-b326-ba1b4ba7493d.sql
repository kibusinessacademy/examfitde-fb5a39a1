
-- WIP=2: Add active_package_ids array to pipeline_lock
ALTER TABLE public.pipeline_lock
  ADD COLUMN IF NOT EXISTS active_package_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS max_active_packages integer DEFAULT 2;

-- RPC: Try to claim a pipeline slot (WIP=N)
CREATE OR REPLACE FUNCTION public.try_claim_pipeline_slot(
  p_package_id uuid,
  p_locked_by text DEFAULT 'package-queue-next'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_max int;
BEGIN
  SELECT active_package_ids, max_active_packages
  INTO v_ids, v_max
  FROM pipeline_lock
  WHERE id = 1
  FOR UPDATE;

  IF p_package_id = ANY(v_ids) THEN
    RETURN true;
  END IF;

  IF array_length(v_ids, 1) IS NOT NULL AND array_length(v_ids, 1) >= v_max THEN
    RETURN false;
  END IF;

  UPDATE pipeline_lock
  SET active_package_ids = array_append(COALESCE(v_ids, '{}'::uuid[]), p_package_id),
      locked_by = p_locked_by,
      heartbeat_at = now()
  WHERE id = 1;

  RETURN true;
END;
$$;

-- RPC: Release a pipeline slot
CREATE OR REPLACE FUNCTION public.release_pipeline_slot(
  p_package_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pipeline_lock
  SET active_package_ids = array_remove(COALESCE(active_package_ids, '{}'::uuid[]), p_package_id),
      heartbeat_at = now()
  WHERE id = 1;
  
  UPDATE pipeline_lock
  SET active_package_id = NULL, locked_at = NULL
  WHERE id = 1 AND active_package_id = p_package_id;
END;
$$;

-- RPC: Get all active pipeline packages
CREATE OR REPLACE FUNCTION public.get_active_pipeline_packages()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(active_package_ids, '{}'::uuid[])
  FROM pipeline_lock
  WHERE id = 1;
$$;

-- Add unique constraint on llm_budget.month for upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_llm_budget_month ON public.llm_budget (month);
