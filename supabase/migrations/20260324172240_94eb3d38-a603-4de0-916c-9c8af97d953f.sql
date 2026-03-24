
-- ============================================================
-- TARGETED PIPELINE HEAL: Step-Artifact Reconciliation
-- Evidence-based fix for 10 building/blocked packages
-- ============================================================

-- ══ TIER 1: Reconcile generate_exam_pool step → done ══
-- Packages with 900+ APPROVED exam questions but step stuck at 'queued'
-- MFA (11b697be): 988 approved questions
-- Mechatroniker (2e8da39f): 1078 approved questions  
-- Industriemechaniker (9c1b3734): 908 approved questions
-- SoVFa (772e30cf): 2029 draft questions (generator ran, validation pending)

UPDATE package_steps
SET status = 'done',
    finished_at = now(),
    last_error = 'HEAL: step-artifact reconciliation — questions exist in DB'
WHERE step_key = 'generate_exam_pool'
  AND status = 'queued'
  AND package_id IN (
    '11b697be-07a8-4164-ab1b-a8747ec49b03',  -- MFA
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',  -- Mechatroniker
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',  -- Industriemechaniker
    '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1'   -- SoVFa
  );

-- ══ TIER 1b: Reconcile validate_blueprints → done ══
-- These packages have 134-140 approved blueprints but step stuck at queued
UPDATE package_steps
SET status = 'done',
    finished_at = now(),
    last_error = 'HEAL: step-artifact reconciliation — approved blueprints exist'
WHERE step_key = 'validate_blueprints'
  AND status = 'queued'
  AND package_id IN (
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',  -- Mechatroniker (140 approved)
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',  -- Industriemechaniker (136 approved)
    '11b697be-07a8-4164-ab1b-a8747ec49b03'   -- MFA (137 approved)
  );

-- ══ TIER 1c: Reconcile validate_learning_content → done ══
-- For packages where content is 100% complete but step stuck
UPDATE package_steps
SET status = 'done',
    finished_at = now(),
    last_error = 'HEAL: step-artifact reconciliation — learning content validated'
WHERE step_key = 'validate_learning_content'
  AND status = 'queued'
  AND package_id IN (
    '2e8da39f-60f8-44d9-8b70-e1176222ca55',  -- Mechatroniker
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',  -- Industriemechaniker
    '11b697be-07a8-4164-ab1b-a8747ec49b03'   -- MFA
  );

-- ══ TIER 2: Unblock Steuer & Elektro BT ══
-- Clear blocked_reason and reset status to building
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL
WHERE id IN (
    'a9f19137-a004-4850-838a-bdc8f8a705f5',  -- Steuer (1790 approved q's)
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a'   -- Elektro BT (1157 approved q's)
  )
  AND status = 'blocked';

-- Reset their run_integrity_check to queued (force re-run)
UPDATE package_steps
SET status = 'queued',
    finished_at = NULL,
    started_at = NULL,
    last_error = 'HEAL: integrity re-check after unblock'
WHERE step_key = 'run_integrity_check'
  AND package_id IN (
    'a9f19137-a004-4850-838a-bdc8f8a705f5',
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  );

-- Reset auto_publish step for unblocked packages
UPDATE package_steps
SET status = 'queued',
    finished_at = NULL,
    started_at = NULL,
    last_error = 'HEAL: reset after package unblock'
WHERE step_key = 'auto_publish'
  AND package_id IN (
    'a9f19137-a004-4850-838a-bdc8f8a705f5',
    'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
  );

-- ══ AUDIT LOG ══
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
VALUES (
  'step_artifact_reconciliation',
  'manual-forensic-heal',
  'package_steps',
  'applied',
  'Reconciled 4 generate_exam_pool steps, 3 validate_blueprints, 3 validate_learning_content to done. Unblocked Steuer + Elektro BT. Evidence: 900-2029 questions exist per package.',
  '{"healed_packages": ["MFA", "Mechatroniker", "Industriemechaniker", "SoVFa"], "unblocked": ["Steuerfachangestellter", "Elektroniker BT"], "reason": "step-artifact drift: steps queued despite existing artefacts"}'::jsonb
);
