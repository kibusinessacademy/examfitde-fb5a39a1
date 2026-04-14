
-- ═══════════════════════════════════════════════════════════════
-- PART 1: SSOT table — track_step_applicability
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.track_step_applicability (
  track public.product_track NOT NULL,
  step_key text NOT NULL,
  should_run boolean NOT NULL DEFAULT true,
  condition text, -- NULL = unconditional, 'cert_oral_exam' = dynamic check
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track, step_key)
);

ALTER TABLE public.track_step_applicability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "track_step_applicability_read_all"
  ON public.track_step_applicability FOR SELECT
  USING (true);

COMMENT ON TABLE public.track_step_applicability IS
  'SSOT for which pipeline steps are applicable per track. All skip decisions derive from this table.';

-- ═══════════════════════════════════════════════════════════════
-- PART 2: Populate SSOT data
-- Derived from contentProfiles.ts + resolveHasOralExam()
-- ═══════════════════════════════════════════════════════════════

-- All 29 canonical steps × 4 tracks = 116 rows
-- Default: should_run = true
-- We only INSERT the skip exceptions (should_run = false)

-- Helper: insert all steps as should_run=true for all tracks
INSERT INTO track_step_applicability (track, step_key, should_run)
SELECT t.track, s.step_key, true
FROM (VALUES
  ('AUSBILDUNG_VOLL'::product_track),
  ('EXAM_FIRST'::product_track),
  ('EXAM_FIRST_PLUS'::product_track),
  ('STUDIUM'::product_track)
) AS t(track)
CROSS JOIN (VALUES
  ('scaffold_learning_course'), ('generate_glossary'), ('fanout_learning_content'),
  ('generate_learning_content'), ('finalize_learning_content'), ('validate_learning_content'),
  ('auto_seed_exam_blueprints'), ('validate_blueprints'),
  ('generate_blueprint_variants'), ('validate_blueprint_variants'), ('promote_blueprint_variants'),
  ('generate_exam_pool'), ('validate_exam_pool'), ('repair_exam_pool_quality'),
  ('build_ai_tutor_index'), ('validate_tutor_index'),
  ('generate_oral_exam'), ('validate_oral_exam'),
  ('generate_lesson_minichecks'), ('validate_lesson_minichecks'),
  ('generate_handbook'), ('validate_handbook'),
  ('enqueue_handbook_expand'), ('expand_handbook'), ('validate_handbook_depth'),
  ('elite_harden'),
  ('run_integrity_check'), ('quality_council'), ('auto_publish')
) AS s(step_key)
ON CONFLICT (track, step_key) DO NOTHING;

-- ── AUSBILDUNG_VOLL: skip elite_harden ──
UPDATE track_step_applicability
SET should_run = false
WHERE track = 'AUSBILDUNG_VOLL' AND step_key = 'elite_harden';

-- ── EXAM_FIRST: skip learning chain + glossary + minichecks + handbook + handbook_expand ──
UPDATE track_step_applicability
SET should_run = false
WHERE track = 'EXAM_FIRST' AND step_key IN (
  'scaffold_learning_course', 'generate_glossary', 'fanout_learning_content',
  'generate_learning_content', 'finalize_learning_content', 'validate_learning_content',
  'generate_lesson_minichecks', 'validate_lesson_minichecks',
  'generate_handbook', 'validate_handbook',
  'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
);

-- ── EXAM_FIRST_PLUS: skip learning chain + glossary + minichecks + handbook_expand ──
UPDATE track_step_applicability
SET should_run = false
WHERE track = 'EXAM_FIRST_PLUS' AND step_key IN (
  'scaffold_learning_course', 'generate_glossary', 'fanout_learning_content',
  'generate_learning_content', 'finalize_learning_content', 'validate_learning_content',
  'generate_lesson_minichecks', 'validate_lesson_minichecks',
  'enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth'
);

-- ── EXAM_FIRST_PLUS: oral exam is cert-conditional (default: skip) ──
UPDATE track_step_applicability
SET should_run = false, condition = 'cert_oral_exam'
WHERE track = 'EXAM_FIRST_PLUS' AND step_key IN (
  'generate_oral_exam', 'validate_oral_exam'
);

-- ── STUDIUM: skip oral exam + elite_harden ──
UPDATE track_step_applicability
SET should_run = false
WHERE track = 'STUDIUM' AND step_key IN (
  'generate_oral_exam', 'validate_oral_exam',
  'elite_harden'
);

-- ═══════════════════════════════════════════════════════════════
-- PART 3: Rewrite fn_heal_track_step_drift to use SSOT table
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_heal_track_step_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_healed int := 0;
  v_unskipped int := 0;
  v_jobs_cancelled int := 0;
  v_errors_cleared int := 0;
  v_stuck_cleared int := 0;
  v_governance_cleared int := 0;
  v_details jsonb := '[]'::jsonb;
  v_rec record;
  v_effective_should_run boolean;
BEGIN
  -- ═══ LAYER 1: Skip steps that should NOT run (SSOT-driven) ═══
  FOR v_rec IN
    SELECT ps.id AS step_id, ps.package_id, ps.step_key, ps.status AS old_status,
           cp.track, ps.job_id, tsa.condition, cp.certification_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    JOIN track_step_applicability tsa
      ON tsa.track = cp.track AND tsa.step_key = ps.step_key
    WHERE ps.status NOT IN ('skipped', 'done')
      AND cp.status NOT IN ('archived', 'cancelled')
      AND tsa.should_run = false
  LOOP
    -- Handle conditional rules (e.g., cert_oral_exam)
    v_effective_should_run := false;
    IF v_rec.condition = 'cert_oral_exam' AND v_rec.certification_id IS NOT NULL THEN
      SELECT cert.oral_exam_enabled INTO v_effective_should_run
      FROM certifications cert
      WHERE cert.id = v_rec.certification_id;
      v_effective_should_run := COALESCE(v_effective_should_run, false);
    END IF;

    -- If condition overrides to should_run, skip this step
    IF v_effective_should_run THEN
      CONTINUE;
    END IF;

    UPDATE package_steps
    SET status = 'skipped',
        finished_at = now(),
        updated_at = now(),
        last_error = 'auto-healer: step not applicable for track ' || v_rec.track::text,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'skip_reason', 'track_ssot_not_applicable',
          'skipped_by', 'fn_heal_track_step_drift',
          'skipped_at', now()::text,
          'track', v_rec.track::text
        )
    WHERE id = v_rec.step_id;
    v_healed := v_healed + 1;

    -- Cancel linked job if any
    IF v_rec.job_id IS NOT NULL THEN
      UPDATE job_queue
      SET status = 'cancelled',
          completed_at = now(), updated_at = now(),
          locked_at = NULL, locked_by = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'cancel_reason', 'track_ssot_not_applicable',
            'transition_source', 'fn_heal_track_step_drift',
            'transition_prev_status', status,
            'transition_at', now()::text,
            'track', v_rec.track::text,
            'step_key', v_rec.step_key
          )
      WHERE id = v_rec.job_id
        AND status IN ('pending', 'queued', 'failed', 'processing');
      IF FOUND THEN
        v_jobs_cancelled := v_jobs_cancelled + 1;
      END IF;
    END IF;

    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
      'track', v_rec.track::text, 'old_status', v_rec.old_status, 'action', 'skip_not_applicable'
    );
  END LOOP;

  -- ═══ LAYER 1b: Un-skip steps that SHOULD run (reverse drift) ═══
  FOR v_rec IN
    SELECT ps.id AS step_id, ps.package_id, ps.step_key, ps.status AS old_status,
           cp.track, tsa.condition, cp.certification_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    JOIN track_step_applicability tsa
      ON tsa.track = cp.track AND tsa.step_key = ps.step_key
    WHERE ps.status = 'skipped'
      AND cp.status NOT IN ('archived', 'cancelled')
      AND tsa.should_run = true
  LOOP
    UPDATE package_steps
    SET status = 'queued',
        finished_at = NULL,
        updated_at = now(),
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'unskip_reason', 'track_ssot_should_run',
          'unskipped_by', 'fn_heal_track_step_drift',
          'unskipped_at', now()::text,
          'track', v_rec.track::text
        )
    WHERE id = v_rec.step_id;
    v_unskipped := v_unskipped + 1;

    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
      'track', v_rec.track::text, 'old_status', v_rec.old_status, 'action', 'unskip_should_run'
    );
  END LOOP;

  -- ═══ LAYER 1c: Cancel orphaned jobs for should_run=false steps ═══
  FOR v_rec IN
    SELECT jq.id AS job_id, jq.package_id, jq.job_type, jq.status AS old_status, cp.track
    FROM job_queue jq
    JOIN course_packages cp ON cp.id = jq.package_id
    JOIN track_step_applicability tsa
      ON tsa.track = cp.track
      AND tsa.step_key = replace(
        replace(jq.job_type, 'package_', ''),
        'lesson_generate_content', 'generate_learning_content'
      )
    WHERE jq.status IN ('pending', 'processing', 'queued')
      AND cp.status NOT IN ('archived', 'cancelled')
      AND tsa.should_run = false
      AND tsa.condition IS NULL -- skip unconditional only
  LOOP
    UPDATE job_queue
    SET status = 'cancelled',
        completed_at = now(), updated_at = now(),
        locked_at = NULL, locked_by = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'cancel_reason', 'track_ssot_not_applicable',
          'transition_source', 'fn_heal_track_step_drift',
          'transition_prev_status', v_rec.old_status,
          'transition_at', now()::text,
          'track', v_rec.track::text,
          'job_type', v_rec.job_type
        )
    WHERE id = v_rec.job_id;
    v_jobs_cancelled := v_jobs_cancelled + 1;
    v_details := v_details || jsonb_build_object(
      'job_id', v_rec.job_id, 'job_type', v_rec.job_type,
      'package_id', v_rec.package_id, 'track', v_rec.track::text, 'action', 'cancel_orphan_job'
    );
  END LOOP;

  -- ═══ LAYER 2: Reset STALE_LOCK steps ═══
  FOR v_rec IN
    SELECT ps.id AS step_id, ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status NOT IN ('done', 'skipped')
      AND ps.last_error ILIKE '%STALE_LOCK%'
  LOOP
    UPDATE package_steps
    SET status = 'queued', last_error = NULL, attempts = 0,
        started_at = NULL, finished_at = NULL, job_id = NULL, meta = '{}'::jsonb
    WHERE id = v_rec.step_id;
    v_healed := v_healed + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'action', 'reset_stale_lock'
    );
  END LOOP;

  -- ═══ LAYER 3: Clear stale prereq errors on queued steps ═══
  FOR v_rec IN
    SELECT ps.id AS step_id, ps.package_id, ps.step_key, ps.last_error
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND ps.last_error IS NOT NULL
      AND (
        ps.last_error ILIKE '%WAITING_FOR_VARIANT_PREBUILD%'
        OR ps.last_error ILIKE '%PREREQ_NOT_DONE%'
        OR ps.last_error ILIKE '%prereq not ready%'
        OR ps.last_error ILIKE '%Artifact missing:%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM package_steps upstream
        WHERE upstream.package_id = ps.package_id
          AND upstream.step_key IN (
            'generate_blueprint_variants', 'promote_blueprint_variants',
            'validate_blueprint_variants', 'auto_seed_exam_blueprints'
          )
          AND upstream.status NOT IN ('done', 'skipped')
      )
  LOOP
    UPDATE package_steps SET last_error = NULL, updated_at = now() WHERE id = v_rec.step_id;
    v_errors_cleared := v_errors_cleared + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
      'action', 'clear_stale_prereq_error', 'old_error', left(v_rec.last_error, 100)
    );
  END LOOP;

  -- ═══ LAYER 4: Clear stale stuck_reason on healthy packages ═══
  FOR v_rec IN
    SELECT cp.id AS package_id, cp.stuck_reason
    FROM course_packages cp
    WHERE cp.status = 'building'
      AND cp.stuck_reason IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status = 'failed'
      )
      AND EXISTS (
        SELECT 1 FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('pending', 'processing')
      )
  LOOP
    UPDATE course_packages
    SET stuck_reason = NULL, gate_class = NULL, updated_at = now()
    WHERE id = v_rec.package_id;
    v_stuck_cleared := v_stuck_cleared + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'action', 'clear_stale_stuck_reason',
      'old_reason', left(v_rec.stuck_reason, 100)
    );
  END LOOP;

  -- ═══ LAYER 5: Governance-Drift — clear last_error on done steps ═══
  FOR v_rec IN
    SELECT ps.id AS step_id, ps.package_id, ps.step_key, ps.last_error
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'done'
      AND ps.last_error IS NOT NULL
      AND cp.status NOT IN ('archived', 'cancelled')
  LOOP
    UPDATE package_steps SET last_error = NULL, updated_at = now() WHERE id = v_rec.step_id;
    v_governance_cleared := v_governance_cleared + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id, 'step_key', v_rec.step_key,
      'action', 'governance_drift_clear', 'old_error', left(v_rec.last_error, 100)
    );
  END LOOP;

  -- Audit log
  IF (v_healed + v_unskipped + v_errors_cleared + v_stuck_cleared + v_governance_cleared) > 0 THEN
    INSERT INTO admin_actions (action, scope, payload)
    VALUES ('track_drift_heal_ssot', 'system', jsonb_build_object(
      'healed_steps', v_healed, 'unskipped_steps', v_unskipped,
      'cancelled_jobs', v_jobs_cancelled,
      'errors_cleared', v_errors_cleared, 'stuck_cleared', v_stuck_cleared,
      'governance_cleared', v_governance_cleared,
      'details', v_details
    ));

    IF (v_healed + v_unskipped + v_errors_cleared + v_stuck_cleared + v_governance_cleared) > 5 THEN
      INSERT INTO admin_notifications (title, body, category, severity, metadata)
      VALUES (
        'Track-Drift SSOT Healer: ' || (v_healed + v_unskipped + v_errors_cleared + v_stuck_cleared + v_governance_cleared) || ' Korrekturen',
        v_healed || ' Steps geskippt, ' || v_unskipped || ' Steps un-skipped, ' ||
        v_errors_cleared || ' stale Fehler bereinigt, ' ||
        v_stuck_cleared || ' stuck_reasons gelöscht, ' || v_governance_cleared || ' Governance-Drifts bereinigt.',
        'ops', 'warning',
        jsonb_build_object('healed', v_healed, 'unskipped', v_unskipped,
          'cancelled_jobs', v_jobs_cancelled,
          'errors_cleared', v_errors_cleared, 'stuck_cleared', v_stuck_cleared,
          'governance_cleared', v_governance_cleared)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'healed_steps', v_healed, 'unskipped_steps', v_unskipped,
    'cancelled_jobs', v_jobs_cancelled,
    'errors_cleared', v_errors_cleared, 'stuck_cleared', v_stuck_cleared,
    'governance_cleared', v_governance_cleared, 'details', v_details
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- PART 4: Immediate false-skip healing
-- Un-skip steps that should_run=true but are currently skipped
-- ═══════════════════════════════════════════════════════════════

-- 4a: Tutor Index — should run for ALL tracks
UPDATE package_steps ps
SET status = 'queued',
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'unskip_reason', 'ssot_migration_should_run',
      'unskipped_by', 'migration_ssot_heal',
      'unskipped_at', now()::text,
      'prev_status', 'skipped'
    )
FROM course_packages cp
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND ps.step_key IN ('build_ai_tutor_index', 'validate_tutor_index')
  AND ps.status = 'skipped';

-- 4b: Oral Exam — should run for EXAM_FIRST (static true)
UPDATE package_steps ps
SET status = 'queued',
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'unskip_reason', 'ssot_migration_should_run',
      'unskipped_by', 'migration_ssot_heal',
      'unskipped_at', now()::text,
      'prev_status', 'skipped'
    )
FROM course_packages cp
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND cp.track = 'EXAM_FIRST'
  AND ps.step_key IN ('generate_oral_exam', 'validate_oral_exam')
  AND ps.status = 'skipped';

-- 4c: Oral Exam — EXAM_FIRST_PLUS only if cert.oral_exam_enabled = true
UPDATE package_steps ps
SET status = 'queued',
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'unskip_reason', 'ssot_migration_cert_oral_enabled',
      'unskipped_by', 'migration_ssot_heal',
      'unskipped_at', now()::text,
      'prev_status', 'skipped'
    )
FROM course_packages cp
JOIN certifications cert ON cert.id = cp.certification_id
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND cp.track = 'EXAM_FIRST_PLUS'
  AND cert.oral_exam_enabled = true
  AND ps.step_key IN ('generate_oral_exam', 'validate_oral_exam')
  AND ps.status = 'skipped';

-- 4d: MiniChecks — should run for STUDIUM
UPDATE package_steps ps
SET status = 'queued',
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'unskip_reason', 'ssot_migration_should_run',
      'unskipped_by', 'migration_ssot_heal',
      'unskipped_at', now()::text,
      'prev_status', 'skipped'
    )
FROM course_packages cp
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND cp.track = 'STUDIUM'
  AND ps.step_key IN ('generate_lesson_minichecks', 'validate_lesson_minichecks')
  AND ps.status = 'skipped';

-- 4e: Handbook Expand — should run for STUDIUM
UPDATE package_steps ps
SET status = 'queued',
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'unskip_reason', 'ssot_migration_should_run',
      'unskipped_by', 'migration_ssot_heal',
      'unskipped_at', now()::text,
      'prev_status', 'skipped'
    )
FROM course_packages cp
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND cp.track = 'STUDIUM'
  AND ps.step_key IN ('enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth')
  AND ps.status = 'skipped';

-- 4f: repair_exam_pool_quality — should run for AUSBILDUNG_VOLL (3 false skips)
UPDATE package_steps ps
SET status = 'queued',
    finished_at = NULL,
    updated_at = now(),
    last_error = NULL,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'unskip_reason', 'ssot_migration_should_run',
      'unskipped_by', 'migration_ssot_heal',
      'unskipped_at', now()::text,
      'prev_status', 'skipped'
    )
FROM course_packages cp
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND cp.track = 'AUSBILDUNG_VOLL'
  AND ps.step_key = 'repair_exam_pool_quality'
  AND ps.status = 'skipped';

-- ═══════════════════════════════════════════════════════════════
-- PART 5: Immediate false-run healing
-- Skip steps that should_run=false but are currently queued
-- ═══════════════════════════════════════════════════════════════

-- 5a: Handbook Expand — should NOT run for EXAM_FIRST_PLUS
UPDATE package_steps ps
SET status = 'skipped',
    finished_at = now(),
    updated_at = now(),
    last_error = 'ssot-migration: handbook_expand not applicable for EXAM_FIRST_PLUS',
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'skip_reason', 'ssot_migration_not_applicable',
      'skipped_by', 'migration_ssot_heal',
      'skipped_at', now()::text,
      'track', 'EXAM_FIRST_PLUS'
    )
FROM course_packages cp
WHERE cp.id = ps.package_id
  AND cp.status NOT IN ('archived', 'cancelled')
  AND cp.track = 'EXAM_FIRST_PLUS'
  AND ps.step_key IN ('enqueue_handbook_expand', 'expand_handbook', 'validate_handbook_depth')
  AND ps.status NOT IN ('skipped', 'done');

-- 5b: Cancel any active jobs for handbook_expand on EXAM_FIRST_PLUS
UPDATE job_queue jq
SET status = 'cancelled',
    completed_at = now(), updated_at = now(),
    locked_at = NULL, locked_by = NULL,
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'ssot_migration_not_applicable',
      'transition_source', 'migration_ssot_heal',
      'transition_prev_status', jq.status,
      'transition_at', now()::text
    )
FROM course_packages cp
WHERE cp.id = jq.package_id
  AND cp.track = 'EXAM_FIRST_PLUS'
  AND jq.job_type IN ('package_enqueue_handbook_expand', 'handbook_expand_section', 'package_validate_handbook_depth')
  AND jq.status IN ('pending', 'processing', 'queued', 'batch_pending');
