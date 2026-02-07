-- ===========================================
-- JOB FACTORY + WORKER RUNTIME GUARDS
-- ===========================================

-- 1. Fehlende Spalten hinzufügen
ALTER TABLE public.job_queue
ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 10,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
ADD COLUMN IF NOT EXISTS last_error TEXT,
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS locked_by TEXT;

-- 2. Updated_at Trigger
CREATE TRIGGER update_job_queue_updated_at
BEFORE UPDATE ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Index für Job-Claiming
CREATE INDEX IF NOT EXISTS idx_job_queue_claim 
ON public.job_queue(priority DESC, run_after ASC) 
WHERE status = 'pending' AND locked_at IS NULL;

-- ===========================================
-- 🏭 JOB FACTORY (einzige erlaubte Insert-Stelle)
-- ===========================================
CREATE OR REPLACE FUNCTION public.create_job(
  p_job_type TEXT,
  p_payload JSONB,
  p_priority INTEGER DEFAULT 10,
  p_run_after TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  -- 🔒 SSOT Guard: curriculum_id PFLICHT
  IF NOT (p_payload ? 'curriculum_id') THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: curriculum_id required for job_type %',
      p_job_type;
  END IF;

  -- 🔒 SSOT Guard: UUID-Format validieren
  BEGIN
    PERFORM (p_payload->>'curriculum_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: curriculum_id must be valid UUID, got: %',
      p_payload->>'curriculum_id';
  END;

  -- 🔒 SSOT Guard: Verbotene Felder
  IF p_payload ? 'slug'
     OR p_payload ? 'profession_slug'
     OR p_payload ? 'curriculum_slug'
     OR p_payload ? 'curriculumCode'
  THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: slug-based fields forbidden in job_type %',
      p_job_type;
  END IF;

  INSERT INTO public.job_queue (
    job_type,
    status,
    payload,
    priority,
    run_after
  )
  VALUES (
    p_job_type,
    'pending',
    p_payload,
    p_priority,
    p_run_after
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

-- ===========================================
-- 🔐 WORKER RUNTIME GUARD
-- ===========================================
CREATE OR REPLACE FUNCTION public.assert_job_payload(job JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  -- Payload muss existieren
  IF NOT (job ? 'payload') THEN
    RAISE EXCEPTION 'Job payload missing entirely';
  END IF;

  -- curriculum_id Pflicht
  IF NOT (job->'payload' ? 'curriculum_id') THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: job % missing curriculum_id',
      job->>'id';
  END IF;

  -- Verbotene Felder
  IF job->'payload' ? 'slug'
     OR job->'payload' ? 'profession_slug'
     OR job->'payload' ? 'curriculum_slug'
     OR job->'payload' ? 'curriculumCode'
  THEN
    RAISE EXCEPTION
      'SSOT VIOLATION: slug fields detected in job %',
      job->>'id';
  END IF;
END;
$$;

-- ===========================================
-- 🎯 CLAIM NEXT JOB (mit integriertem Guard)
-- ===========================================
CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_worker_id TEXT,
  p_job_types TEXT[] DEFAULT NULL,
  p_lock_timeout_minutes INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_job RECORD;
  v_job_json JSONB;
BEGIN
  -- Atomic claim mit FOR UPDATE SKIP LOCKED
  SELECT *
  INTO v_job
  FROM public.job_queue
  WHERE status = 'pending'
    AND run_after <= now()
    AND (locked_at IS NULL OR locked_at < now() - (p_lock_timeout_minutes || ' minutes')::INTERVAL)
    AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
  ORDER BY priority DESC, run_after ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job IS NULL THEN
    RETURN NULL;
  END IF;

  -- Job als JSON für Guard
  v_job_json := to_jsonb(v_job);

  -- 🔐 Runtime Guard ausführen
  BEGIN
    PERFORM public.assert_job_payload(v_job_json);
  EXCEPTION WHEN OTHERS THEN
    -- 🧯 Auto-Fail statt Retry-Loop
    UPDATE public.job_queue
    SET
      status = 'failed',
      last_error = SQLERRM,
      updated_at = now()
    WHERE id = v_job.id;
    
    -- NULL zurückgeben, Worker bekommt keinen Job
    RETURN NULL;
  END;

  -- Job claimen
  UPDATE public.job_queue
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    attempts = attempts + 1,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
  WHERE id = v_job.id;

  RETURN v_job_json;
END;
$$;

-- ===========================================
-- ✅ COMPLETE JOB
-- ===========================================
CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id UUID,
  p_result JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.job_queue
  SET
    status = 'completed',
    result = p_result,
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
  WHERE id = p_job_id;
END;
$$;

-- ===========================================
-- ❌ FAIL JOB
-- ===========================================
CREATE OR REPLACE FUNCTION public.fail_job(
  p_job_id UUID,
  p_error TEXT,
  p_allow_retry BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_job RECORD;
BEGIN
  SELECT * INTO v_job
  FROM public.job_queue
  WHERE id = p_job_id;

  IF v_job IS NULL THEN
    RETURN;
  END IF;

  IF p_allow_retry AND v_job.attempts < v_job.max_attempts THEN
    -- Retry erlaubt: zurück auf pending
    UPDATE public.job_queue
    SET
      status = 'pending',
      last_error = p_error,
      locked_at = NULL,
      locked_by = NULL,
      run_after = now() + ((v_job.attempts * 5) || ' minutes')::INTERVAL,
      updated_at = now()
    WHERE id = p_job_id;
  ELSE
    -- Kein Retry: endgültig failed
    UPDATE public.job_queue
    SET
      status = 'failed',
      last_error = p_error,
      locked_at = NULL,
      locked_by = NULL,
      completed_at = now(),
      updated_at = now()
    WHERE id = p_job_id;
  END IF;
END;
$$;