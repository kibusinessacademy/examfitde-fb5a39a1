
-- ============================================================
-- RED TEAM FIX: Revoke anonymous/authenticated access to 33 ops/admin views
-- These views expose internal pipeline, package, and operations data
-- Only service_role (used by Edge Functions) should access them
-- ============================================================

-- Admin views
REVOKE SELECT ON public.v_admin_packages_ssot FROM anon, authenticated;
REVOKE SELECT ON public.v_admin_visible_course_packages FROM anon, authenticated;

-- Ops views
REVOKE SELECT ON public.ops_pipeline_map FROM anon, authenticated;
REVOKE SELECT ON public.ops_telemetry_integrity FROM anon, authenticated;
REVOKE SELECT ON public.ops_telemetry_lineage FROM anon, authenticated;
REVOKE SELECT ON public.ops_package_effective_state_v1 FROM anon, authenticated;
REVOKE SELECT ON public.ops_package_baseline_v1 FROM anon, authenticated;
REVOKE SELECT ON public.ops_package_content_depth FROM anon, authenticated;
REVOKE SELECT ON public.ops_package_downstream_missing FROM anon, authenticated;
REVOKE SELECT ON public.ops_package_qc_matrix FROM anon, authenticated;
REVOKE SELECT ON public.ops_package_step_readiness FROM anon, authenticated;
REVOKE SELECT ON public.ops_missing_step_backbone FROM anon, authenticated;
REVOKE SELECT ON public.ops_legacy_package_audit FROM anon, authenticated;
REVOKE SELECT ON public.ops_recovery_impact FROM anon, authenticated;
REVOKE SELECT ON public.ops_artifact_build_progress FROM anon, authenticated;
REVOKE SELECT ON public.ops_learner_visible_readiness FROM anon, authenticated;

-- Pipeline views
REVOKE SELECT ON public.v_building_package_eta FROM anon, authenticated;
REVOKE SELECT ON public.v_ops_auto_publish_blockers FROM anon, authenticated;
REVOKE SELECT ON public.v_ops_invalid_course_titles FROM anon, authenticated;
REVOKE SELECT ON public.v_ops_package_progress_guard FROM anon, authenticated;
REVOKE SELECT ON public.v_ops_reentry_misses FROM anon, authenticated;
REVOKE SELECT ON public.v_ops_shadow_zombies FROM anon, authenticated;
REVOKE SELECT ON public.v_package_build_priority FROM anon, authenticated;
REVOKE SELECT ON public.v_package_publish_readiness FROM anon, authenticated;
REVOKE SELECT ON public.v_pipeline_content_integrity FROM anon, authenticated;
REVOKE SELECT ON public.v_pipeline_repair_classification FROM anon, authenticated;
REVOKE SELECT ON public.v_pipeline_stalled_packages FROM anon, authenticated;
REVOKE SELECT ON public.v_pipeline_step_funnel FROM anon, authenticated;
REVOKE SELECT ON public.v_scheduler_fairness FROM anon, authenticated;

-- Batch/LLM views
REVOKE SELECT ON public.v_llm_batch_overview FROM anon, authenticated;
REVOKE SELECT ON public.v_ops_batch_recovery_backlog FROM anon, authenticated;

-- Course display views - keep for authenticated learners who need course info
-- v_course_display_ssot and v_latest_course_package are used by learner UI
-- We grant authenticated SELECT but revoke anon
REVOKE SELECT ON public.v_course_display_ssot FROM anon;
REVOKE SELECT ON public.v_latest_course_package FROM anon;

-- ============================================================
-- RED TEAM FIX: Harden exam_attempts against anon writes
-- Add RLS policies to prevent anonymous score manipulation (RT-034)
-- ============================================================

-- exam_attempts: only the session owner can read, no direct updates allowed
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exam_attempts' AND policyname = 'Users can read own attempts'
  ) THEN
    CREATE POLICY "Users can read own attempts"
      ON public.exam_attempts FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Block all writes from non-service roles (scores are computed server-side)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exam_attempts' AND policyname = 'No direct updates to attempts'
  ) THEN
    CREATE POLICY "No direct updates to attempts"
      ON public.exam_attempts FOR UPDATE TO authenticated
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exam_attempts' AND policyname = 'No anon access to attempts'
  ) THEN
    CREATE POLICY "No anon access to attempts"
      ON public.exam_attempts FOR ALL TO anon
      USING (false);
  END IF;
END $$;

-- ============================================================
-- Harden other tables that returned 204 on anon PATCH
-- These have RLS enabled but need explicit deny policies
-- ============================================================

-- council_sessions: admin only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'council_sessions' AND policyname = 'No anon access to council_sessions'
  ) THEN
    CREATE POLICY "No anon access to council_sessions"
      ON public.council_sessions FOR ALL TO anon
      USING (false);
  END IF;
END $$;

-- lessons: protected by guard_lesson_content_writes trigger, add RLS deny for anon
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lessons' AND policyname = 'No anon write to lessons'
  ) THEN
    CREATE POLICY "No anon write to lessons"
      ON public.lessons FOR UPDATE TO anon
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lessons' AND policyname = 'No anon delete lessons'
  ) THEN
    CREATE POLICY "No anon delete lessons"
      ON public.lessons FOR DELETE TO anon
      USING (false);
  END IF;
END $$;

-- admin_actions: append-only, no deletes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_actions' AND policyname = 'No delete on admin_actions'
  ) THEN
    CREATE POLICY "No delete on admin_actions"
      ON public.admin_actions FOR DELETE TO authenticated
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_actions' AND policyname = 'No update on admin_actions'
  ) THEN
    CREATE POLICY "No update on admin_actions"
      ON public.admin_actions FOR UPDATE TO authenticated
      USING (false);
  END IF;
END $$;

-- auto_heal_log: append-only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'auto_heal_log' AND policyname = 'No delete on auto_heal_log'
  ) THEN
    CREATE POLICY "No delete on auto_heal_log"
      ON public.auto_heal_log FOR DELETE TO authenticated
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'auto_heal_log' AND policyname = 'No update on auto_heal_log'
  ) THEN
    CREATE POLICY "No update on auto_heal_log"
      ON public.auto_heal_log FOR UPDATE TO authenticated
      USING (false);
  END IF;
END $$;

-- package_steps: no anon access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'package_steps' AND policyname = 'No anon access to package_steps'
  ) THEN
    CREATE POLICY "No anon access to package_steps"
      ON public.package_steps FOR ALL TO anon
      USING (false);
  END IF;
END $$;

-- course_packages: no anon writes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'course_packages' AND policyname = 'No anon write to course_packages'
  ) THEN
    CREATE POLICY "No anon write to course_packages"
      ON public.course_packages FOR UPDATE TO anon
      USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'course_packages' AND policyname = 'No anon delete course_packages'
  ) THEN
    CREATE POLICY "No anon delete course_packages"
      ON public.course_packages FOR DELETE TO anon
      USING (false);
  END IF;
END $$;
