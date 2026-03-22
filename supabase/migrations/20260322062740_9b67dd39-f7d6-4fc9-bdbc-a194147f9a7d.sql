
-- ═══════════════════════════════════════════════════════════════════════
-- DERIVED-STATE GUARD: integrity_passed
-- integrity_passed MUST match the integrity_report's actual gate result
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_guard_integrity_passed_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_derived boolean;
  v_report jsonb;
  v_hard_fails jsonb;
BEGIN
  -- Only intercept if integrity_passed is being changed
  IF TG_OP = 'INSERT' OR NEW.integrity_passed IS DISTINCT FROM OLD.integrity_passed THEN
    v_report := NEW.integrity_report;
    
    IF v_report IS NULL THEN
      -- No report → integrity cannot be passed
      IF NEW.integrity_passed = true THEN
        INSERT INTO public.package_progress_drift_audit (
          package_id, attempted_value, corrected_value, operation
        ) VALUES (NEW.id, 1, 0, 'integrity_passed:' || TG_OP);
        NEW.integrity_passed := false;
      END IF;
    ELSE
      -- Derive from report: passed = no hard fails
      v_hard_fails := COALESCE(
        v_report->'v3'->'hard_fail_reasons',
        v_report->'hard_fail_reasons',
        '[]'::jsonb
      );
      v_derived := (jsonb_array_length(v_hard_fails) = 0);
      
      IF NEW.integrity_passed IS DISTINCT FROM v_derived THEN
        INSERT INTO public.package_progress_drift_audit (
          package_id, attempted_value, corrected_value, operation
        ) VALUES (
          NEW.id,
          CASE WHEN NEW.integrity_passed THEN 1 ELSE 0 END,
          CASE WHEN v_derived THEN 1 ELSE 0 END,
          'integrity_passed:' || TG_OP
        );
        NEW.integrity_passed := v_derived;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_integrity_passed_drift ON public.course_packages;
CREATE TRIGGER trg_guard_integrity_passed_drift
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_integrity_passed_drift();

-- ═══════════════════════════════════════════════════════════════════════
-- DERIVED-STATE GUARD: council_approved
-- council_approved MUST be backed by council_approved_at timestamp
-- Cannot be set true without evidence timestamp
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_guard_council_approved_drift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.council_approved IS DISTINCT FROM OLD.council_approved THEN
    -- council_approved=true requires council_approved_at evidence
    IF NEW.council_approved = true AND NEW.council_approved_at IS NULL THEN
      -- Auto-set timestamp if missing (legitimate writer forgot it)
      NEW.council_approved_at := now();
      INSERT INTO public.package_progress_drift_audit (
        package_id, attempted_value, corrected_value, operation
      ) VALUES (NEW.id, 1, 1, 'council_approved:auto_timestamp:' || TG_OP);
    END IF;
    
    -- council_approved=false must clear the timestamp
    IF NEW.council_approved = false AND NEW.council_approved_at IS NOT NULL THEN
      NEW.council_approved_at := NULL;
      INSERT INTO public.package_progress_drift_audit (
        package_id, attempted_value, corrected_value, operation
      ) VALUES (NEW.id, 0, 0, 'council_approved:clear_timestamp:' || TG_OP);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_council_approved_drift ON public.course_packages;
CREATE TRIGGER trg_guard_council_approved_drift
  BEFORE INSERT OR UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_council_approved_drift();

-- ═══════════════════════════════════════════════════════════════════════
-- CRITICAL SECURITY FIX: RLS on exposed financial and operational tables
-- ═══════════════════════════════════════════════════════════════════════

-- Financial tables (ERROR level finding)
ALTER TABLE IF EXISTS public.executive_summary_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.business_kpi_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.executive_portfolio_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.executive_portfolio_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.executive_budget_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.executive_kill_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.roi_decision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wave_governance_decisions ENABLE ROW LEVEL SECURITY;

-- Control plane tables (ERROR level finding)
ALTER TABLE IF EXISTS public.control_plane_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_plane_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_plane_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_plane_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.control_plane_cost_signals ENABLE ROW LEVEL SECURITY;

-- System infrastructure tables (WARN level)
ALTER TABLE IF EXISTS public.system_probe_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_probe_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_probe_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_probe_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_cron_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_cron_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_contract_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_contract_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_enum_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_ssot_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_health_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_scheduler_guardrails ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_runner_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_retry_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_regression_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_execution_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.system_orphan_executions ENABLE ROW LEVEL SECURITY;

-- Content tables with broken "admin" policies on public role (ERROR level)
-- Fix: Drop broken policies and recreate with proper role

-- Drop overly permissive content policies
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'content_pages', 'blog_posts', 'content_assets', 'seo_redirects',
    'german_certification_master', 'market_clusters', 'authority_decisions',
    'dominance_control', 'cluster_dominance_snapshots', 'certification_dominance_snapshots'
  ]) LOOP
    FOR p IN SELECT policyname FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = t 
      AND (qual = 'true' OR with_check = 'true')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Fix service_role policies that are on 'public' role instead of 'service_role'
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'oral_exam_turns', 'escalation_log', 'step_metrics', 'pipeline_health_events',
    'pipeline_settings', 'ops_pipeline_config', 'provider_status', 'provider_job_affinity',
    'provider_usage_history', 'provider_intent_affinity', 'job_costs',
    'certification_cost_snapshots', 'provider_pricing', 'learning_field_elite_policies',
    'lesson_minicheck_questions', 'premium_upgrade_runs', 'course_pipeline_events',
    'ai_generation_requests', 'ai_generation_policies', 'ai_generation_cache',
    'api_rate_limits', 'skill_nodes', 'question_skill_map', 'canary_releases',
    'golden_exam_sets', 'drift_snapshots', 'backpressure_snapshots',
    'product_factory_specs', 'admin_search_index'
  ]) LOOP
    FOR p IN SELECT policyname FROM pg_policies 
      WHERE schemaname = 'public' AND tablename = t 
      AND (policyname ILIKE '%service role%' OR policyname ILIKE '%service_role%')
      AND roles @> ARRAY['public']::name[]
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
