
-- ============================================================
-- 1. ADMIN JOB BOOST RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_admin_boost_job(
  p_job_id UUID,
  p_admin_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'manual_boost'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
BEGIN
  SELECT id, job_type, status, priority, package_id, run_after
  INTO v_job
  FROM job_queue
  WHERE id = p_job_id;

  IF v_job IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job not found');
  END IF;

  IF v_job.status NOT IN ('pending', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Job is not pending or failed, current status: ' || v_job.status);
  END IF;

  -- Boost: priority 0 (highest), clear run_after, reset to pending if failed
  UPDATE job_queue
  SET priority = 0,
      run_after = NULL,
      status = 'pending',
      attempts = CASE WHEN status = 'failed' THEN GREATEST(attempts - 1, 0) ELSE attempts END,
      updated_at = now()
  WHERE id = p_job_id;

  -- Audit
  INSERT INTO admin_actions (action, payload, scope, user_id)
  VALUES (
    'admin_boost_job',
    jsonb_build_object(
      'job_id', p_job_id,
      'job_type', v_job.job_type,
      'package_id', v_job.package_id,
      'previous_priority', v_job.priority,
      'previous_status', v_job.status,
      'reason', p_reason
    ),
    'admin',
    p_admin_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'job_type', v_job.job_type,
    'new_priority', 0,
    'new_status', 'pending'
  );
END;
$$;

-- ============================================================
-- 2. SHUTTLE DB HARDENING
-- ============================================================

-- 2a. CHECK constraints
ALTER TABLE shuttle_sessions
  DROP CONSTRAINT IF EXISTS chk_shuttle_session_status,
  ADD CONSTRAINT chk_shuttle_session_status 
    CHECK (status IN ('active', 'completed', 'abandoned'));

ALTER TABLE shuttle_sessions
  DROP CONSTRAINT IF EXISTS chk_shuttle_session_mode,
  ADD CONSTRAINT chk_shuttle_session_mode 
    CHECK (mode IN ('adaptive', 'random', 'weakness', 'speed', 'exam_lite'));

ALTER TABLE shuttle_events
  DROP CONSTRAINT IF EXISTS chk_shuttle_event_type,
  ADD CONSTRAINT chk_shuttle_event_type 
    CHECK (event_type IN (
      'question_served', 'question_answered', 'feedback_opened',
      'next_question_requested', 'session_completed', 'session_abandoned'
    ));

-- 2b. Add updated_at where missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shuttle_sessions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE shuttle_sessions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shuttle_question_state' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE shuttle_question_state ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shuttle_user_stats' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE shuttle_user_stats ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shuttle_events' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE shuttle_events ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END;
$$;

-- 2c. Auto-update triggers for updated_at
CREATE OR REPLACE FUNCTION public.fn_shuttle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_shuttle_sessions_updated_at ON shuttle_sessions;
CREATE TRIGGER trg_shuttle_sessions_updated_at
  BEFORE UPDATE ON shuttle_sessions
  FOR EACH ROW EXECUTE FUNCTION fn_shuttle_updated_at();

DROP TRIGGER IF EXISTS trg_shuttle_qstate_updated_at ON shuttle_question_state;
CREATE TRIGGER trg_shuttle_qstate_updated_at
  BEFORE UPDATE ON shuttle_question_state
  FOR EACH ROW EXECUTE FUNCTION fn_shuttle_updated_at();

DROP TRIGGER IF EXISTS trg_shuttle_user_stats_updated_at ON shuttle_user_stats;
CREATE TRIGGER trg_shuttle_user_stats_updated_at
  BEFORE UPDATE ON shuttle_user_stats
  FOR EACH ROW EXECUTE FUNCTION fn_shuttle_updated_at();

-- 2d. Add id column to shuttle_question_state if missing (for individual row addressing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shuttle_question_state' AND column_name = 'id'
  ) THEN
    ALTER TABLE shuttle_question_state ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
  END IF;
END;
$$;

-- 2e. Rename selected_option_indexes -> selected_option_ids for future-proof format
-- Keep old column name as-is since RPCs reference it, but add alias view later

-- ============================================================
-- 3. RLS HARDENING: Add INSERT policies (only SELECT exists)
-- ============================================================
CREATE POLICY "shuttle_sessions_insert_own" ON shuttle_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "shuttle_sessions_update_own" ON shuttle_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "shuttle_events_insert_own" ON shuttle_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "shuttle_qstate_insert_own" ON shuttle_question_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "shuttle_qstate_update_own" ON shuttle_question_state
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "shuttle_user_stats_insert_own" ON shuttle_user_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "shuttle_user_stats_update_own" ON shuttle_user_stats
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- 4. CLEANUP DUPLICATE INDEXES
-- ============================================================
DROP INDEX IF EXISTS idx_shuttle_qstate_curriculum;
DROP INDEX IF EXISTS idx_shuttle_sessions_user_status;
