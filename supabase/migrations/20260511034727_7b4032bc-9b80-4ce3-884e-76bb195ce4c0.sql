
-- ============================================================
-- Welle 5 Foundation: Growth Quality Auto-Improvement
-- Central architecture only. Module workers plug in later.
-- ============================================================

-- 1) MODULE REGISTRY
CREATE TABLE IF NOT EXISTS public.growth_repair_modules (
  subscore text PRIMARY KEY,
  job_type text NOT NULL,
  generator_kind text NOT NULL CHECK (generator_kind IN ('deterministic','ai_generative','audit_only')),
  requires_council boolean NOT NULL DEFAULT false,
  requires_pre_post_score boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.growth_repair_modules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_repair_modules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.growth_repair_modules TO service_role;

-- Seed 8 modules (all disabled, opt-in per modul)
INSERT INTO public.growth_repair_modules (subscore, job_type, generator_kind, requires_council, requires_pre_post_score, description) VALUES
  ('blog_quality',   'growth_repair_blog_quality',   'ai_generative', true,  true,  'AI rewrites blog body when quality score < threshold'),
  ('seo_meta',       'growth_repair_seo_meta',       'ai_generative', true,  true,  'AI regenerates title/description/og-tags'),
  ('internal_links', 'growth_repair_internal_links', 'deterministic', false, true,  'Topic-cluster sync inserts missing internal links'),
  ('cta',            'growth_quality_repair_cta',    'audit_only',    false, true,  'Audits CTA presence (no generation yet)'),
  ('funnel_events',  'growth_quality_repair_funnel_audit','audit_only', false, true, 'Audits 6 mandatory funnel events'),
  ('email_sequence', 'growth_repair_email_sequence', 'ai_generative', true,  true,  'AI rewrites email-sequence steps'),
  ('distribution',   'growth_repair_distribution',   'deterministic', false, true,  'Generates missing distribution-asset rows'),
  ('og_image',       'growth_repair_og_image',       'deterministic', false, true,  'Re-runs OG-image generator with brand-template')
ON CONFLICT (subscore) DO NOTHING;

-- 2) RUN-LOG
CREATE TABLE IF NOT EXISTS public.growth_repair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  subscore text NOT NULL REFERENCES public.growth_repair_modules(subscore) ON UPDATE CASCADE,
  job_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','running','gate_pre','generating','gate_post','council','completed','failed','rolled_back')),
  pre_score numeric,
  post_score numeric,
  score_delta numeric GENERATED ALWAYS AS (post_score - pre_score) STORED,
  council_verdict text,
  council_score numeric,
  artifact_ref jsonb,
  rollback_info jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_repair_runs_pkg_subscore_created
  ON public.growth_repair_runs (package_id, subscore, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_growth_repair_runs_status_created
  ON public.growth_repair_runs (status, created_at DESC);

ALTER TABLE public.growth_repair_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_repair_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.growth_repair_runs TO service_role;

-- 3) START RUN (Pre-Score Snapshot)
CREATE OR REPLACE FUNCTION public.fn_growth_repair_start_run(
  p_package_id uuid,
  p_subscore text,
  p_job_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_module growth_repair_modules%ROWTYPE;
  v_run_id uuid;
  v_pre numeric;
  v_scores jsonb;
BEGIN
  SELECT * INTO v_module FROM public.growth_repair_modules WHERE subscore = p_subscore;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_subscore: %', p_subscore; END IF;
  IF NOT v_module.enabled THEN RAISE EXCEPTION 'module_disabled: %', p_subscore; END IF;

  IF v_module.requires_pre_post_score THEN
    BEGIN
      v_scores := public.fn_compute_growth_quality_score(p_package_id);
      v_pre := COALESCE((v_scores ->> ('score_'||p_subscore))::numeric,
                        (v_scores ->> p_subscore)::numeric);
    EXCEPTION WHEN OTHERS THEN
      v_pre := NULL;
    END;
  END IF;

  INSERT INTO public.growth_repair_runs (package_id, subscore, job_id, status, pre_score, started_at)
  VALUES (p_package_id, p_subscore, p_job_id, 'running', v_pre, now())
  RETURNING id INTO v_run_id;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_repair_run_started', p_package_id, 'package', 'started',
    format('subscore=%s pre=%s', p_subscore, COALESCE(v_pre::text,'null')),
    jsonb_build_object('run_id', v_run_id, 'subscore', p_subscore, 'pre_score', v_pre));

  RETURN v_run_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_growth_repair_start_run(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_growth_repair_start_run(uuid,text,uuid) TO service_role;

-- 4) COMPLETE RUN (Pre/Post + Council Quality-Gate)
CREATE OR REPLACE FUNCTION public.fn_growth_repair_complete_run(
  p_run_id uuid,
  p_artifact_ref jsonb DEFAULT NULL,
  p_council_verdict text DEFAULT NULL,
  p_council_score numeric DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run growth_repair_runs%ROWTYPE;
  v_module growth_repair_modules%ROWTYPE;
  v_post numeric;
  v_scores jsonb;
  v_gate_pass boolean := true;
  v_gate_reasons text[] := ARRAY[]::text[];
  v_final_status text;
BEGIN
  SELECT * INTO v_run FROM public.growth_repair_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'run_not_found'; END IF;
  IF v_run.status NOT IN ('running','generating','gate_post','council') THEN
    RAISE EXCEPTION 'invalid_state: %', v_run.status;
  END IF;

  SELECT * INTO v_module FROM public.growth_repair_modules WHERE subscore = v_run.subscore;

  -- Hard error path
  IF p_error IS NOT NULL THEN
    UPDATE public.growth_repair_runs
       SET status='failed', error=p_error, completed_at=now(), artifact_ref=p_artifact_ref
     WHERE id=p_run_id;
    INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('growth_repair_run_completed', v_run.package_id, 'package', 'failed',
      format('subscore=%s err=%s', v_run.subscore, left(p_error,200)),
      jsonb_build_object('run_id', p_run_id, 'subscore', v_run.subscore));
    RETURN jsonb_build_object('status','failed','reason',p_error);
  END IF;

  -- Post-Score
  IF v_module.requires_pre_post_score THEN
    BEGIN
      v_scores := public.fn_compute_growth_quality_score(v_run.package_id);
      v_post := COALESCE((v_scores ->> ('score_'||v_run.subscore))::numeric,
                         (v_scores ->> v_run.subscore)::numeric);
    EXCEPTION WHEN OTHERS THEN v_post := NULL; END;

    IF v_post IS NULL OR v_run.pre_score IS NULL THEN
      v_gate_reasons := array_append(v_gate_reasons,'score_unavailable');
    ELSIF v_post < v_run.pre_score THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,
        format('score_regression %s→%s', v_run.pre_score, v_post));
    END IF;
  END IF;

  -- Council Gate (Bronze ≥75)
  IF v_module.requires_council THEN
    IF p_council_verdict IS NULL OR p_council_score IS NULL THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,'council_missing');
    ELSIF p_council_score < 75 THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,
        format('council_below_bronze %s', p_council_score));
    ELSIF p_council_verdict NOT IN ('PASS','REVIEW_REQUIRED') THEN
      v_gate_pass := false;
      v_gate_reasons := array_append(v_gate_reasons,
        format('council_verdict %s', p_council_verdict));
    END IF;
  END IF;

  v_final_status := CASE WHEN v_gate_pass THEN 'completed' ELSE 'rolled_back' END;

  UPDATE public.growth_repair_runs
     SET status = v_final_status,
         post_score = v_post,
         council_verdict = p_council_verdict,
         council_score = p_council_score,
         artifact_ref = p_artifact_ref,
         rollback_info = CASE WHEN v_gate_pass THEN NULL
                              ELSE jsonb_build_object('reasons', v_gate_reasons, 'at', now()) END,
         completed_at = now()
   WHERE id = p_run_id;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_repair_run_completed', v_run.package_id, 'package', v_final_status,
    format('subscore=%s pre=%s post=%s council=%s/%s',
      v_run.subscore, v_run.pre_score, v_post, p_council_verdict, p_council_score),
    jsonb_build_object(
      'run_id', p_run_id,
      'subscore', v_run.subscore,
      'pre_score', v_run.pre_score,
      'post_score', v_post,
      'gate_pass', v_gate_pass,
      'gate_reasons', v_gate_reasons,
      'council_verdict', p_council_verdict,
      'council_score', p_council_score
    ));

  RETURN jsonb_build_object(
    'status', v_final_status,
    'pre_score', v_run.pre_score,
    'post_score', v_post,
    'gate_pass', v_gate_pass,
    'gate_reasons', v_gate_reasons
  );
END;
$$;
REVOKE ALL ON FUNCTION public.fn_growth_repair_complete_run(uuid,jsonb,text,numeric,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_growth_repair_complete_run(uuid,jsonb,text,numeric,text) TO service_role;

-- 5) MANUAL ROLLBACK
CREATE OR REPLACE FUNCTION public.fn_growth_repair_rollback(
  p_run_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_pkg uuid; BEGIN
  UPDATE public.growth_repair_runs
     SET status='rolled_back',
         rollback_info = COALESCE(rollback_info,'{}'::jsonb) ||
                         jsonb_build_object('manual_reason', p_reason, 'rolled_back_at', now()),
         completed_at = COALESCE(completed_at, now())
   WHERE id = p_run_id
   RETURNING package_id INTO v_pkg;
  IF v_pkg IS NULL THEN RAISE EXCEPTION 'run_not_found'; END IF;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_repair_run_rolled_back', v_pkg, 'package', 'rolled_back',
    left(p_reason,200), jsonb_build_object('run_id', p_run_id, 'reason', p_reason));

  RETURN jsonb_build_object('rolled_back', true);
END; $$;
REVOKE ALL ON FUNCTION public.fn_growth_repair_rollback(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_growth_repair_rollback(uuid,text) TO service_role;

-- 6) ADMIN RPCs
CREATE OR REPLACE FUNCTION public.admin_get_growth_repair_modules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'subscore', subscore,
      'job_type', job_type,
      'generator_kind', generator_kind,
      'requires_council', requires_council,
      'requires_pre_post_score', requires_pre_post_score,
      'enabled', enabled,
      'description', description,
      'updated_at', updated_at
    ) ORDER BY subscore)
    FROM public.growth_repair_modules
  ), '[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_growth_repair_modules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_repair_modules() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_growth_repair_module_enabled(
  p_subscore text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  UPDATE public.growth_repair_modules
     SET enabled = p_enabled, updated_at = now()
   WHERE subscore = p_subscore;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_subscore: %', p_subscore; END IF;

  INSERT INTO public.auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('growth_repair_module_toggle', NULL, 'system', CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
    p_subscore, jsonb_build_object('subscore', p_subscore, 'enabled', p_enabled, 'admin_uid', auth.uid()));

  RETURN jsonb_build_object('subscore', p_subscore, 'enabled', p_enabled);
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_growth_repair_module_enabled(text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_growth_repair_module_enabled(text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_growth_repair_runs(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC)
    FROM (
      SELECT id, package_id, subscore, status, pre_score, post_score, score_delta,
             council_verdict, council_score, error, created_at, completed_at
      FROM public.growth_repair_runs
      ORDER BY created_at DESC
      LIMIT GREATEST(1, LEAST(p_limit, 200))
    ) r
  ), '[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.admin_get_growth_repair_runs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_growth_repair_runs(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_rollback_growth_repair_run(
  p_run_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin_only'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  RETURN public.fn_growth_repair_rollback(p_run_id, p_reason);
END; $$;
REVOKE ALL ON FUNCTION public.admin_rollback_growth_repair_run(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rollback_growth_repair_run(uuid,text) TO authenticated;
