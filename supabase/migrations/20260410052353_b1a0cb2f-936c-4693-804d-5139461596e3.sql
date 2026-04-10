
-- ============================================================
-- Ops Forensic Report System
-- ============================================================

-- 1. Core tables
CREATE TABLE public.ops_forensic_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL,
  report_type text NOT NULL DEFAULT 'stalled_package',
  status text NOT NULL DEFAULT 'open',
  summary text NOT NULL DEFAULT '',
  root_cause_class text,
  root_cause_confidence numeric NOT NULL DEFAULT 0,
  symptom_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  causal_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  impacted_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  impacted_jobs jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  governance_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  healability text NOT NULL DEFAULT 'unknown',
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_heal_allowed boolean NOT NULL DEFAULT false,
  execution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_forensic_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES ops_forensic_reports(id) ON DELETE CASCADE,
  finding_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  code text NOT NULL,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_forensic_reports_package ON ops_forensic_reports(package_id);
CREATE INDEX idx_forensic_reports_status ON ops_forensic_reports(status);
CREATE INDEX idx_forensic_reports_root_cause ON ops_forensic_reports(root_cause_class);
CREATE INDEX idx_forensic_findings_report ON ops_forensic_findings(report_id);

-- RLS
ALTER TABLE ops_forensic_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_forensic_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage forensic reports" ON ops_forensic_reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage forensic findings" ON ops_forensic_findings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. Updated_at trigger
CREATE TRIGGER update_forensic_reports_updated_at
  BEFORE UPDATE ON ops_forensic_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Core RPC: Generate forensic report
CREATE OR REPLACE FUNCTION public.fn_generate_package_forensic_report(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_report_id uuid;
  v_root_cause text;
  v_confidence numeric;
  v_healability text;
  v_auto_heal boolean;
  v_summary text;
  v_report_type text;
  v_causal_chain jsonb := '[]'::jsonb;
  v_recommended jsonb := '[]'::jsonb;
  v_steps jsonb;
  v_jobs jsonb;
  v_artifact_state jsonb := '{}'::jsonb;
  v_symptom jsonb := '{}'::jsonb;
  v_governance jsonb := '{}'::jsonb;
  v_stuck_step record;
  v_has_stale_jobs boolean := false;
  v_has_missing_artifact boolean := false;
  v_stale_job_count int := 0;
  v_processing_no_heartbeat int := 0;
BEGIN
  -- Load package
  SELECT cp.id, cp.status, cp.track, cp.gate_class, cp.blocked_reason,
         cp.curriculum_id, cp.certification_id, c.title, c.slug
  INTO v_pkg
  FROM course_packages cp
  JOIN certifications c ON c.id = cp.certification_id
  WHERE cp.id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Package not found');
  END IF;

  -- Supersede old open reports
  UPDATE ops_forensic_reports
  SET status = 'superseded', updated_at = now()
  WHERE package_id = p_package_id AND status = 'open';

  -- Collect steps
  SELECT jsonb_agg(jsonb_build_object(
    'step_key', ps.step_key, 'status', ps.status,
    'started_at', ps.started_at, 'attempts', ps.attempts,
    'meta', ps.meta
  ) ORDER BY ps.step_key)
  INTO v_steps
  FROM package_steps ps WHERE ps.package_id = p_package_id;

  -- Collect active/recent jobs
  SELECT jsonb_agg(jsonb_build_object(
    'id', jq.id, 'job_type', jq.job_type, 'status', jq.status,
    'attempts', jq.attempts, 'locked_by', jq.locked_by,
    'last_error', jq.last_error, 'created_at', jq.created_at,
    'updated_at', jq.updated_at,
    'hours_stale', extract(epoch from now() - jq.updated_at)/3600
  ) ORDER BY jq.updated_at DESC)
  INTO v_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.status IN ('pending','processing','queued','failed')
  LIMIT 30;

  -- Detect stale processing jobs
  SELECT count(*) INTO v_stale_job_count
  FROM job_queue
  WHERE package_id = p_package_id
    AND status = 'processing'
    AND updated_at < now() - interval '30 minutes';

  SELECT count(*) INTO v_processing_no_heartbeat
  FROM job_queue
  WHERE package_id = p_package_id
    AND status = 'processing'
    AND locked_by IS NOT NULL
    AND updated_at < now() - interval '1 hour';

  v_has_stale_jobs := v_stale_job_count > 0;

  -- Build symptom snapshot
  v_symptom := jsonb_build_object(
    'package_status', v_pkg.status,
    'track', v_pkg.track,
    'gate_class', v_pkg.gate_class,
    'blocked_reason', v_pkg.blocked_reason,
    'stale_processing_jobs', v_stale_job_count,
    'processing_no_heartbeat', v_processing_no_heartbeat
  );

  -- Check for stuck steps (non-terminal steps with no active jobs)
  FOR v_stuck_step IN
    SELECT ps.step_key, ps.status
    FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.status NOT IN ('done','skipped')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = p_package_id
          AND jq.status IN ('pending','processing','queued')
          AND jq.job_type LIKE '%' || ps.step_key || '%'
      )
  LOOP
    -- Step is stuck without any active job
    NULL;
  END LOOP;

  -- Governance state
  v_governance := jsonb_build_object(
    'gate_class', v_pkg.gate_class,
    'blocked_reason', v_pkg.blocked_reason,
    'package_status', v_pkg.status
  );

  -- ══════════════════════════════════════════════════
  -- ROOT CAUSE CLASSIFICATION
  -- ══════════════════════════════════════════════════
  v_root_cause := 'UNKNOWN_NEEDS_MANUAL_REVIEW';
  v_confidence := 0.3;
  v_healability := 'unknown';
  v_auto_heal := false;
  v_report_type := 'stalled_package';

  -- Rule 1: Stale lock / false active
  IF v_has_stale_jobs THEN
    v_root_cause := 'STALE_LOCK_FALSE_ACTIVE';
    v_confidence := 0.9;
    v_healability := 'auto_healable';
    v_auto_heal := true;
    v_report_type := 'false_liveness';
    v_summary := format('Package %s has %s stale processing jobs with dead runners', v_pkg.title, v_stale_job_count);
    v_causal_chain := v_causal_chain || jsonb_build_object(
      'type', 'root_cause', 'code', 'STALE_LOCK_FALSE_ACTIVE',
      'evidence', jsonb_build_object('stale_count', v_stale_job_count)
    );
    v_recommended := v_recommended || jsonb_build_object(
      'action_code', 'RECLAIM_STALE_JOB',
      'description', 'Reset stale processing jobs to pending',
      'safety_level', 'safe', 'auto_allowed', true
    );

  -- Rule 2: Governance block
  ELSIF v_pkg.status = 'blocked' AND v_pkg.blocked_reason IS NOT NULL THEN
    v_root_cause := 'GOVERNANCE_BLOCK';
    v_confidence := 0.95;
    v_healability := 'manual_review';
    v_auto_heal := false;
    v_report_type := 'governance_conflict';
    v_summary := format('Package %s is blocked: %s', v_pkg.title, v_pkg.blocked_reason);
    v_causal_chain := v_causal_chain || jsonb_build_object(
      'type', 'root_cause', 'code', 'GOVERNANCE_BLOCK',
      'evidence', jsonb_build_object('reason', v_pkg.blocked_reason)
    );
    v_recommended := v_recommended || jsonb_build_object(
      'action_code', 'REVIEW_GOVERNANCE_STATE',
      'description', 'Manual review of block reason required',
      'safety_level', 'requires_review', 'auto_allowed', false
    );

  -- Rule 3: Quality gate block
  ELSIF v_pkg.gate_class = 'terminal' THEN
    v_root_cause := 'QUALITY_GATE_BLOCK';
    v_confidence := 0.9;
    v_healability := 'hard_blocked';
    v_auto_heal := false;
    v_report_type := 'governance_conflict';
    v_summary := format('Package %s has terminal quality gate failure', v_pkg.title);

  -- Rule 4: Building but no active jobs (true stall)
  ELSIF v_pkg.status = 'building' AND (v_jobs IS NULL OR jsonb_array_length(COALESCE(v_jobs, '[]'::jsonb)) = 0) THEN
    v_root_cause := 'FALSE_FINALIZATION';
    v_confidence := 0.7;
    v_healability := 'auto_healable';
    v_auto_heal := true;
    v_report_type := 'stalled_package';
    v_summary := format('Package %s is building but has no active jobs', v_pkg.title);
    v_recommended := v_recommended || jsonb_build_object(
      'action_code', 'REQUEUE_NEXT_STEP',
      'description', 'Re-enqueue the next pending step',
      'safety_level', 'safe', 'auto_allowed', true
    );

  ELSE
    v_summary := format('Package %s requires manual investigation (status=%s, jobs=%s)',
      v_pkg.title, v_pkg.status, jsonb_array_length(COALESCE(v_jobs, '[]'::jsonb)));
  END IF;

  -- Insert report
  INSERT INTO ops_forensic_reports (
    package_id, report_type, summary, root_cause_class, root_cause_confidence,
    symptom_snapshot, causal_chain, impacted_steps, impacted_jobs,
    artifact_state, governance_state, healability, recommended_actions,
    auto_heal_allowed
  ) VALUES (
    p_package_id, v_report_type, v_summary, v_root_cause, v_confidence,
    v_symptom, v_causal_chain, COALESCE(v_steps, '[]'::jsonb), COALESCE(v_jobs, '[]'::jsonb),
    v_artifact_state, v_governance, v_healability, v_recommended,
    v_auto_heal
  ) RETURNING id INTO v_report_id;

  -- Insert root cause finding
  INSERT INTO ops_forensic_findings (report_id, finding_type, severity, code, title, details)
  VALUES (v_report_id, 'root_cause',
    CASE WHEN v_healability = 'hard_blocked' THEN 'critical'
         WHEN v_healability = 'manual_review' THEN 'warning'
         ELSE 'info' END,
    v_root_cause,
    v_summary,
    jsonb_build_object('confidence', v_confidence, 'healability', v_healability)
  );

  -- Insert stale job findings
  IF v_has_stale_jobs THEN
    INSERT INTO ops_forensic_findings (report_id, finding_type, severity, code, title, details)
    VALUES (v_report_id, 'supporting_evidence', 'warning', 'STALE_PROCESSING_DETECTED',
      format('%s jobs stuck in processing > 30min', v_stale_job_count),
      jsonb_build_object('count', v_stale_job_count, 'no_heartbeat', v_processing_no_heartbeat)
    );
  END IF;

  RETURN jsonb_build_object(
    'report_id', v_report_id,
    'root_cause', v_root_cause,
    'confidence', v_confidence,
    'healability', v_healability,
    'auto_heal_allowed', v_auto_heal,
    'summary', v_summary,
    'recommended_actions', v_recommended
  );
END;
$$;

-- 4. Views
CREATE OR REPLACE VIEW public.ops_open_forensic_reports AS
SELECT r.*, c.title as cert_title, c.slug as cert_slug
FROM ops_forensic_reports r
JOIN course_packages cp ON cp.id = r.package_id
JOIN certifications c ON c.id = cp.certification_id
WHERE r.status = 'open'
ORDER BY
  CASE r.healability
    WHEN 'hard_blocked' THEN 1
    WHEN 'manual_review' THEN 2
    WHEN 'auto_healable' THEN 3
    ELSE 4
  END,
  r.created_at DESC;

CREATE OR REPLACE VIEW public.ops_auto_healable_reports AS
SELECT r.id, r.package_id, r.root_cause_class, r.summary, r.recommended_actions,
  c.title as cert_title, r.created_at
FROM ops_forensic_reports r
JOIN course_packages cp ON cp.id = r.package_id
JOIN certifications c ON c.id = cp.certification_id
WHERE r.status = 'open' AND r.healability = 'auto_healable' AND r.auto_heal_allowed = true
ORDER BY r.created_at;

CREATE OR REPLACE VIEW public.ops_hard_blocked_reports AS
SELECT r.id, r.package_id, r.root_cause_class, r.root_cause_confidence,
  r.summary, r.governance_state, c.title as cert_title, r.created_at
FROM ops_forensic_reports r
JOIN course_packages cp ON cp.id = r.package_id
JOIN certifications c ON c.id = cp.certification_id
WHERE r.status = 'open' AND r.healability = 'hard_blocked'
ORDER BY r.created_at;
