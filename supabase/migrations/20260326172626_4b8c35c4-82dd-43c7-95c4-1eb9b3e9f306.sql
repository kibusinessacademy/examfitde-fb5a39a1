-- ============================================================
-- P0 Pipeline Hardening: 3 Guards
-- ============================================================

-- GUARD 1: Stale Blocker Auto-Clear
CREATE OR REPLACE FUNCTION fn_auto_clear_stale_blocker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE all_functional_done boolean;
BEGIN
  IF NEW.status NOT IN ('blocked', 'quality_gate_failed') THEN RETURN NEW; END IF;
  IF NEW.integrity_passed IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.council_approved IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.integrity_report IS NULL THEN RETURN NEW; END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = NEW.id AND ps.is_functional = true
      AND ps.status NOT IN ('done', 'skipped')
  ) INTO all_functional_done;
  IF NOT all_functional_done THEN RETURN NEW; END IF;

  NEW.status := 'published';
  NEW.blocked_reason := NULL;
  NEW.stuck_reason := NULL;
  NEW.last_error := NULL;
  NEW.updated_at := now();

  INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
  VALUES ('STALE_BLOCKER_CLEARED',
    format('Package %s auto-unblocked: all gates passed.', NEW.id),
    'ops', 'info', 'package', NEW.id,
    jsonb_build_object('old_status', OLD.status, 'old_blocked_reason', OLD.blocked_reason,
      'action', 'auto_clear_stale_blocker'));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_clear_stale_blocker ON course_packages;
CREATE TRIGGER trg_auto_clear_stale_blocker
  BEFORE UPDATE ON course_packages FOR EACH ROW
  WHEN (NEW.status IN ('blocked', 'quality_gate_failed'))
  EXECUTE FUNCTION fn_auto_clear_stale_blocker();

-- GUARD 2: Integrity Staleness Detection
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='course_packages' AND column_name='exam_pool_state_hash') THEN
    ALTER TABLE course_packages ADD COLUMN exam_pool_state_hash text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_compute_exam_pool_hash(p_curriculum_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(string_agg(
    eq.id::text || ':' || eq.status || ':' || COALESCE(eq.difficulty::text, '_'),
    ',' ORDER BY eq.id
  ))
  FROM exam_questions eq
  WHERE eq.curriculum_id = p_curriculum_id AND eq.status = 'approved';
$$;

CREATE OR REPLACE FUNCTION fn_detect_integrity_staleness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pkg record; new_hash text; cid uuid;
BEGIN
  cid := COALESCE(NEW.curriculum_id, OLD.curriculum_id);
  new_hash := fn_compute_exam_pool_hash(cid);
  FOR pkg IN
    SELECT cp.id, cp.exam_pool_state_hash
    FROM course_packages cp
    WHERE cp.curriculum_id = cid
      AND cp.status IN ('building', 'blocked', 'quality_gate_failed')
      AND cp.integrity_passed = true
      AND cp.exam_pool_state_hash IS NOT NULL
      AND cp.exam_pool_state_hash IS DISTINCT FROM new_hash
  LOOP
    UPDATE course_packages SET integrity_passed = false, exam_pool_state_hash = new_hash, updated_at = now() WHERE id = pkg.id;
    UPDATE package_steps SET status = 'queued', last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('staleness_requeue_at', now()::text, 'reason', 'exam_pool_state_drift')
    WHERE package_id = pkg.id AND step_key = 'run_integrity_check' AND status = 'done';
    INSERT INTO admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
    VALUES ('INTEGRITY_STALENESS_DETECTED',
      format('Package %s integrity invalidated: exam pool hash changed.', pkg.id),
      'ops', 'warn', 'package', pkg.id,
      jsonb_build_object('old_hash', pkg.exam_pool_state_hash, 'new_hash', new_hash));
  END LOOP;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_detect_integrity_staleness ON exam_questions;
CREATE TRIGGER trg_detect_integrity_staleness
  AFTER INSERT OR UPDATE OF status, difficulty, cognitive_level OR DELETE
  ON exam_questions FOR EACH STATEMENT
  EXECUTE FUNCTION fn_detect_integrity_staleness();

-- GUARD 3: Job Type Registry Enforcement
CREATE TABLE IF NOT EXISTS ops_job_type_registry (
  job_type text PRIMARY KEY,
  pool text NOT NULL DEFAULT 'core',
  registered_at timestamptz NOT NULL DEFAULT now(),
  description text
);

INSERT INTO ops_job_type_registry (job_type, pool) VALUES
  ('package_fanout_learning_content','core'),('package_generate_learning_content','content'),
  ('lesson_generate_content_shard','content'),('package_finalize_learning_content','core'),
  ('package_generate_handbook','content'),('package_generate_glossary','content'),
  ('package_generate_oral_exam','content'),('package_generate_lesson_minichecks','content'),
  ('mass_enrich_competencies_v2','content'),('pool_fill_lf_gaps','content'),
  ('pool_fill_bloom_gaps','content'),('package_exam_rebalance','core'),
  ('lesson_generate_content','content'),('lesson_generate_competency_bundle','content'),
  ('package_generate_exam_pool','content'),('pipeline_tick','core'),('stuck_scan','core'),
  ('package_scaffold_learning_course','core'),('package_validate_blueprints','core'),
  ('package_validate_exam_pool','core'),('package_validate_learning_content','core'),
  ('package_validate_oral_exam','core'),('package_validate_tutor_index','core'),
  ('package_validate_lesson_minichecks','core'),('package_validate_handbook','core'),
  ('package_enqueue_handbook_expand','core'),('handbook_expand_section','content'),
  ('package_validate_handbook_depth','core'),('package_auto_seed_exam_blueprints','core'),
  ('package_build_ai_tutor_index','core'),('package_elite_harden','core'),
  ('package_run_integrity_check','core'),('package_quality_council','core'),
  ('package_auto_publish','core'),('extract_curriculum','core'),
  ('generate_curriculum_content','core'),('setup_course_package','core'),
  ('generate_course','core'),('generate_course_batch','core'),
  ('seed_exam_questions','core'),('enrich_exam_solutions','core'),
  ('upgrade_minichecks_v1','core'),('quality_gate_precheck','core'),
  ('curriculum_smoke','core'),('qc_worker_full','core'),('quality_gate_7','core'),
  ('seo_foundation','core'),('seo_audit','core'),('seo_internal_links','core'),
  ('seo_sitemap_refresh','core'),('seo_generate','core'),('seo_qc_check','core'),
  ('seo_publish','core'),('seo_content_batch','core'),('publish_product','core'),
  ('repair_lessons','core'),('improve_lesson','core'),('validate_content','core'),
  ('upgrade_ihk','core'),('auto_gap_close','core'),('generate_image','core'),
  ('daily_test_run','core'),('generate_questions','core'),
  ('auto_map_topics_to_blueprint','core'),('blooms_classify','core'),
  ('package_curriculum_ingest','core'),('ingest_curriculum_document','core'),
  ('generate_handbook','core'),('heal_poison_lessons','core'),
  ('rework_trap_retrofit','core'),('package_queue_next','core'),
  ('assessment_blueprint_propose','core'),('assessment_blueprint_critique','core'),
  ('assessment_blueprint_verdict','core'),('assessment_blueprint_approve','core'),
  ('assessment_questions_generate','core'),('assessment_questions_critique','core'),
  ('assessment_questions_verdict','core'),('assessment_questions_approve','core'),
  ('assessment_minicheck_assemble','core'),('assessment_minicheck_critique','core'),
  ('assessment_minicheck_verdict','core'),('assessment_minicheck_approve','core'),
  ('course_finalize','core'),('post_validation','core'),
  ('council_run_step','core'),('council_propose_step','core'),
  ('council_critique_step','core'),('council_revise_step','core'),
  ('council_vote_and_verdict','core'),('council_publish_step','core'),
  ('council_recompute_course_ready','core'),
  ('tech_scan_rls','core'),('tech_scan_edge','core'),('tech_scan_queue','core'),
  ('tech_propose_patch','core'),('tech_validate_patch','core'),('tech_full_pipeline','core'),
  ('marketing_seed_assets','core'),('marketing_propose','core'),('marketing_critique','core'),
  ('marketing_revise','core'),('marketing_verdict','core'),('marketing_publish','core'),
  ('marketing_full_pipeline','core'),
  ('tutor_seed_assets','core'),('tutor_council_run_asset','core'),
  ('tutor_backfill_assets_for_course','core'),('tutor_validate_runtime_templates','core'),
  ('tutor_oral_exam_propose','core'),('tutor_oral_exam_critique','core'),
  ('tutor_oral_exam_verdict','core'),('tutor_feedback_propose','core'),
  ('tutor_feedback_critique','core'),('tutor_feedback_verdict','core'),
  ('compliance_scan','core'),('compliance_scan_pii','core'),('compliance_scan_rls','core'),
  ('compliance_scan_retention','core'),('compliance_scan_ai_act','core'),
  ('compliance_scan_azav','core'),('compliance_recompute_block','core'),
  ('compliance_remediate','core'),('compliance_report','core'),('compliance_export_pdf','core'),
  ('growth_run','core'),('growth_actions_api','core'),
  ('finance_reconcile','core'),('finance_export_csv','core'),('finance_export_datev','core'),
  ('qa_smoke','core'),('qa_runtime_smoke','core'),('qa_h5p_smoke','core'),('qa_error_budget','core'),
  ('claim_license_secure','core'),('security_gate_check','core'),('security_botnet_gate','core'),
  ('blueprint_generate_variants','content')
ON CONFLICT (job_type) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_guard_job_type_registry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ops_job_type_registry WHERE job_type = NEW.job_type) THEN
    INSERT INTO admin_notifications (title, body, category, severity, entity_type, metadata)
    VALUES ('UNKNOWN_JOB_TYPE_REJECTED',
      format('Job type "%s" rejected at DB level.', NEW.job_type),
      'ops', 'error', 'job',
      jsonb_build_object('job_type', NEW.job_type, 'source', 'trg_guard_job_type_registry'));
    RAISE EXCEPTION 'UNKNOWN_JOB_TYPE_REGISTRY: "%" not registered. Add to ops_job_type_registry + _shared/job-map.ts.', NEW.job_type;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_job_type_registry ON job_queue;
CREATE TRIGGER trg_guard_job_type_registry
  BEFORE INSERT ON job_queue FOR EACH ROW
  EXECUTE FUNCTION fn_guard_job_type_registry();

-- Audit
INSERT INTO admin_actions (action, scope, payload)
VALUES ('p0_pipeline_hardening', 'system',
  jsonb_build_object('guard_1','trg_auto_clear_stale_blocker','guard_2','trg_detect_integrity_staleness','guard_3','trg_guard_job_type_registry'));