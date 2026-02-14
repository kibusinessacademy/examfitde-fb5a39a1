
-- ─────────────────────────────────────────────────────────────
-- Pipeline Gold Standard: Lease-Locks + Step-State-Machine
-- Tables: package_steps, package_leases
-- Enums: step_status, pipeline_mode
-- Column: course_packages.pipeline_mode
-- RPCs: acquire/renew/release lease, step start/done/fail/heartbeat
-- ─────────────────────────────────────────────────────────────

-- 1) Enums
DO $$ BEGIN
  CREATE TYPE public.step_status AS ENUM ('queued','running','done','failed','blocked','timeout','skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_mode AS ENUM ('factory','production');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) package_steps (SSOT for step state)
CREATE TABLE IF NOT EXISTS public.package_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  status public.step_status NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  timeout_seconds int NOT NULL DEFAULT 900,
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat_at timestamptz,
  runner_id text,
  last_error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(package_id, step_key)
);

CREATE INDEX IF NOT EXISTS package_steps_pkg_status_idx
  ON public.package_steps(package_id, status);

CREATE INDEX IF NOT EXISTS package_steps_running_idx
  ON public.package_steps(status, last_heartbeat_at)
  WHERE status = 'running';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_package_steps_touch ON public.package_steps;
CREATE TRIGGER trg_package_steps_touch
BEFORE UPDATE ON public.package_steps
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS for package_steps
ALTER TABLE public.package_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read package_steps"
  ON public.package_steps FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role manages package_steps"
  ON public.package_steps FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- 3) package_leases (time-bounded locks)
CREATE TABLE IF NOT EXISTS public.package_leases (
  package_id uuid PRIMARY KEY REFERENCES public.course_packages(id) ON DELETE CASCADE,
  runner_id text NOT NULL,
  lease_until timestamptz NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  renewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_leases_until_idx
  ON public.package_leases(lease_until);

-- RLS for package_leases
ALTER TABLE public.package_leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read package_leases"
  ON public.package_leases FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role manages package_leases"
  ON public.package_leases FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- 4) pipeline_mode on course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS pipeline_mode public.pipeline_mode NOT NULL DEFAULT 'factory';

-- ─────────────────────────────────────────────────────────────
-- RPCs: Lease Management
-- ─────────────────────────────────────────────────────────────

-- Acquire next package lease (strict-serial)
CREATE OR REPLACE FUNCTION public.acquire_next_package_lease(
  p_runner_id text,
  p_lease_seconds int DEFAULT 600
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_active_leases int;
BEGIN
  -- strict serial: if any unexpired lease exists, do not acquire
  SELECT count(*) INTO v_active_leases
  FROM public.package_leases
  WHERE lease_until > now();

  IF v_active_leases > 0 THEN
    RETURN NULL;
  END IF;

  -- pick next queued package (skip locked)
  WITH next AS (
    SELECT id
    FROM public.course_packages
    WHERE status = 'queued'
    ORDER BY queue_position ASC NULLS LAST, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  SELECT id INTO v_pkg_id FROM next;

  IF v_pkg_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- create lease
  INSERT INTO public.package_leases(package_id, runner_id, lease_until)
  VALUES (v_pkg_id, p_runner_id, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (package_id) DO UPDATE
    SET runner_id = EXCLUDED.runner_id,
        lease_until = EXCLUDED.lease_until,
        renewed_at = now();

  -- mark package as building
  UPDATE public.course_packages
  SET status = 'building',
      locked_at = now()
  WHERE id = v_pkg_id;

  RETURN v_pkg_id;
END;
$$;

-- Renew lease
CREATE OR REPLACE FUNCTION public.renew_package_lease(
  p_package_id uuid,
  p_runner_id text,
  p_lease_seconds int DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.package_leases
  SET lease_until = now() + make_interval(secs => p_lease_seconds),
      renewed_at = now()
  WHERE package_id = p_package_id
    AND runner_id = p_runner_id
    AND lease_until > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- Release lease
CREATE OR REPLACE FUNCTION public.release_package_lease(
  p_package_id uuid,
  p_runner_id text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.package_leases
  WHERE package_id = p_package_id
    AND runner_id = p_runner_id;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPCs: Step Operations
-- ─────────────────────────────────────────────────────────────

-- Step heartbeat
CREATE OR REPLACE FUNCTION public.step_heartbeat(
  p_package_id uuid,
  p_step_key text,
  p_runner_id text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET last_heartbeat_at = now(),
      runner_id = p_runner_id
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status = 'running';
$$;

-- Mark step running
CREATE OR REPLACE FUNCTION public.step_start(
  p_package_id uuid,
  p_step_key text,
  p_runner_id text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'running',
      attempts = attempts + 1,
      started_at = COALESCE(started_at, now()),
      last_heartbeat_at = now(),
      runner_id = p_runner_id,
      last_error = NULL
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('queued','failed','timeout','blocked');
$$;

-- Mark step done
CREATE OR REPLACE FUNCTION public.step_done(
  p_package_id uuid,
  p_step_key text,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'done',
      finished_at = now(),
      meta = meta || p_meta
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status = 'running';
$$;

-- Mark step failed
CREATE OR REPLACE FUNCTION public.step_fail(
  p_package_id uuid,
  p_step_key text,
  p_error text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET status = 'failed',
      finished_at = now(),
      last_error = left(p_error, 4000)
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status = 'running';
$$;

-- Expire timed-out steps (used by watchdog)
CREATE OR REPLACE FUNCTION public.expire_stale_steps()
RETURNS TABLE(package_id uuid, step_key text, runner_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.package_steps ps
  SET status = 'timeout',
      finished_at = now(),
      last_error = 'Watchdog: step exceeded timeout_seconds without heartbeat'
  FROM (
    SELECT ps2.id, ps2.package_id, ps2.step_key, ps2.runner_id
    FROM public.package_steps ps2
    WHERE ps2.status = 'running'
      AND ps2.last_heartbeat_at < now() - make_interval(secs => ps2.timeout_seconds)
  ) stale
  WHERE ps.id = stale.id
  RETURNING stale.package_id, stale.step_key, stale.runner_id;
$$;

-- Expire stale leases (used by watchdog)
CREATE OR REPLACE FUNCTION public.expire_stale_leases()
RETURNS TABLE(package_id uuid, runner_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.package_leases
  WHERE lease_until < now()
  RETURNING package_id, runner_id;
$$;

-- ─────────────────────────────────────────────────────────────
-- Harden EXECUTE: service_role only
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.acquire_next_package_lease(text,int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_package_lease(uuid,text,int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_package_lease(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.step_heartbeat(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.step_start(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.step_done(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.step_fail(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_steps() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_leases() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_next_package_lease(text,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_package_lease(uuid,text,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_package_lease(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.step_heartbeat(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.step_start(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.step_done(uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.step_fail(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_steps() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_leases() TO service_role;
