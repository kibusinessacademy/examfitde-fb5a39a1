
-- ============================================================
-- 1. Drop stale overload of claim_pending_jobs_v4
-- ============================================================
DROP FUNCTION IF EXISTS public.claim_pending_jobs_v4(text, integer, integer, text);

-- ============================================================
-- 2. Replace claim_pending_jobs_v4 with prereq-aware + fairness version
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.job_type,
           (jq.payload->>'package_id')::uuid AS pkg_id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
      -- ── Prereq-aware filter ──
      -- For package_* jobs, check that all DAG predecessors are done/skipped
      AND (
        -- Non-package jobs or jobs without package_id: always claimable
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        -- Package jobs: all DAG predecessors must be terminal
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status NOT IN ('done', 'skipped')
        )
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    -- Fetch more than p_limit to allow fairness filtering
    LIMIT p_limit * 4
  ),
  -- ── Per-package fairness cap: max 3 per package per tick ──
  fair AS (
    SELECT c.id
    FROM (
      SELECT id, pkg_id,
             row_number() OVER (PARTITION BY pkg_id ORDER BY (SELECT NULL)) AS rn
      FROM candidates
    ) c
    WHERE c.rn <= 3
    ORDER BY (SELECT NULL)
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status = 'processing',
      started_at = now(),
      locked_by = p_worker_id,
      locked_at = now()
  FROM fair f
  WHERE q.id = f.id
  RETURNING q.*;
END;
$$;

-- ============================================================
-- 3. Postcondition guard trigger: prevent hollow done
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_guard_hollow_done()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_critical_steps text[] := ARRAY[
    'generate_learning_content',
    'generate_exam_pool',
    'generate_handbook',
    'generate_lesson_minichecks',
    'generate_oral_exam',
    'build_ai_tutor_index'
  ];
BEGIN
  -- Only fire on transition TO done
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    -- Only for critical materializing steps
    IF NEW.step_key = ANY(v_critical_steps) THEN
      -- Allow if postcondition was explicitly verified or regression allowed
      IF COALESCE((NEW.meta->>'postcondition_verified')::boolean, false) THEN
        RETURN NEW;
      END IF;
      IF COALESCE((NEW.meta->>'allow_regression')::boolean, false) THEN
        RETURN NEW;
      END IF;
      -- Allow if exception_approved
      IF COALESCE(NEW.exception_approved, false) THEN
        RETURN NEW;
      END IF;
      -- Block hollow done
      RAISE EXCEPTION 'HOLLOW_DONE_BLOCKED: step "%" cannot transition to done without postcondition_verified=true in meta. Set meta.postcondition_verified or meta.allow_regression to bypass.', NEW.step_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists, then create
DROP TRIGGER IF EXISTS trg_guard_hollow_done ON public.package_steps;
CREATE TRIGGER trg_guard_hollow_done
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_hollow_done();

-- Notify PostgREST to pick up changes
NOTIFY pgrst, 'reload schema';
