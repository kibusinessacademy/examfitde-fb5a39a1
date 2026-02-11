
-- Council 9: QA / Production Hardening Gates (Phases 1-4)

DO $$ BEGIN
  CREATE TYPE public.qa_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.qa_status AS ENUM ('open','resolved','accepted_risk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.qa_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('smoke','release','nightly')),
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qa_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qa_run_id uuid NULL REFERENCES public.qa_runs(id) ON DELETE SET NULL,
  area text NOT NULL CHECK (area IN ('routing','ssot','rls','payments','jobs','h5p','seo','pwa','perf','errors','data_integrity','observability')),
  severity public.qa_severity NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.qa_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(area, title)
);

CREATE INDEX IF NOT EXISTS idx_qa_findings_status ON public.qa_findings(status, severity, area);

CREATE TABLE IF NOT EXISTS public.qa_gate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL CHECK (area IN ('routing','ssot','rls','payments','jobs','h5p','seo','pwa','perf','errors','data_integrity','observability')),
  min_severity public.qa_severity NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(area)
);

ALTER TABLE public.qa_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_gate_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_qa_runs ON public.qa_runs;
CREATE POLICY deny_all_qa_runs ON public.qa_runs FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_runs ON public.qa_runs;
CREATE POLICY admin_all_qa_runs ON public.qa_runs FOR ALL USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS deny_all_qa_findings ON public.qa_findings;
CREATE POLICY deny_all_qa_findings ON public.qa_findings FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_findings ON public.qa_findings;
CREATE POLICY admin_all_qa_findings ON public.qa_findings FOR ALL USING (public.is_admin_user(auth.uid()));

DROP POLICY IF EXISTS deny_all_qa_gate_rules ON public.qa_gate_rules;
CREATE POLICY deny_all_qa_gate_rules ON public.qa_gate_rules FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_gate_rules ON public.qa_gate_rules;
CREATE POLICY admin_all_qa_gate_rules ON public.qa_gate_rules FOR ALL USING (public.is_admin_user(auth.uid()));

INSERT INTO public.qa_gate_rules(area, min_severity, enabled) VALUES
  ('payments','high',true),('rls','high',true),('ssot','high',true),('jobs','high',true),
  ('data_integrity','high',true),('errors','critical',true),('routing','critical',true),
  ('h5p','high',true),('observability','high',true),('seo','critical',true),('pwa','critical',true),('perf','high',true)
ON CONFLICT (area) DO NOTHING;

CREATE OR REPLACE FUNCTION public.qa_severity_rank(p public.qa_severity)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_qa_finding(
  p_area text, p_severity public.qa_severity, p_title text, p_description text,
  p_evidence jsonb, p_qa_run_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.qa_findings(area, severity, title, description, evidence_json, status, updated_at, qa_run_id)
  VALUES (p_area, p_severity, p_title, p_description, COALESCE(p_evidence,'{}'::jsonb), 'open', now(), p_qa_run_id)
  ON CONFLICT (area, title) DO UPDATE SET
    severity = EXCLUDED.severity, description = EXCLUDED.description, evidence_json = EXCLUDED.evidence_json,
    qa_run_id = COALESCE(EXCLUDED.qa_run_id, public.qa_findings.qa_run_id), updated_at = now(),
    status = CASE WHEN public.qa_findings.status IN ('resolved','accepted_risk') THEN public.qa_findings.status ELSE 'open' END
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Phase 2: Route Registry + Budgets
CREATE TABLE IF NOT EXISTS public.qa_route_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, url_path text NOT NULL, expected_status int NOT NULL DEFAULT 200,
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(url_path)
);
ALTER TABLE public.qa_route_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_qa_route_registry ON public.qa_route_registry;
CREATE POLICY deny_all_qa_route_registry ON public.qa_route_registry FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_route_registry ON public.qa_route_registry;
CREATE POLICY admin_all_qa_route_registry ON public.qa_route_registry FOR ALL USING (public.is_admin_user(auth.uid()));

INSERT INTO public.qa_route_registry(name, url_path, expected_status, enabled) VALUES
  ('Home','/',200,true),('Login','/login',200,true),('Shop','/shop',200,true),
  ('Learner Dashboard','/learner',200,true),('Admin Dashboard','/admin/dashboard',200,true)
ON CONFLICT (url_path) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.qa_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
  value_num numeric NULL, value_text text NULL, enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qa_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_qa_budgets ON public.qa_budgets;
CREATE POLICY deny_all_qa_budgets ON public.qa_budgets FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_budgets ON public.qa_budgets;
CREATE POLICY admin_all_qa_budgets ON public.qa_budgets FOR ALL USING (public.is_admin_user(auth.uid()));

INSERT INTO public.qa_budgets(key, value_num, enabled) VALUES
  ('route_latency_p95_ms',1500,true),('edge_latency_p95_ms',1200,true),
  ('job_fail_rate_max',0.10,true),('pending_backlog_max',200,true)
ON CONFLICT (key) DO NOTHING;

-- Phase 3: Auto-Resolve + Error Budget + H5P Smoke
CREATE OR REPLACE FUNCTION public.resolve_qa_finding_if_exists(p_area text, p_title text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.qa_findings SET status = 'resolved', updated_at = now() WHERE area = p_area AND title = p_title AND status = 'open';
END $$;

CREATE OR REPLACE FUNCTION public.get_job_fail_rate(p_last_n int DEFAULT 200)
RETURNS TABLE (last_n int, failed int, total int, fail_rate numeric)
LANGUAGE sql SECURITY DEFINER AS $$
  WITH s AS (SELECT status FROM public.job_queue ORDER BY created_at DESC LIMIT p_last_n)
  SELECT p_last_n, COUNT(*) FILTER (WHERE status='failed')::int, COUNT(*)::int,
    CASE WHEN COUNT(*)=0 THEN 0 ELSE (COUNT(*) FILTER (WHERE status='failed')::numeric / COUNT(*)::numeric) END FROM s;
$$;

CREATE OR REPLACE FUNCTION public.get_edge_error_rate_24h()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_exists boolean; v_total bigint; v_err bigint;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='edge_function_logs') INTO v_exists;
  IF NOT v_exists THEN RETURN jsonb_build_object('available',false,'reason','public.edge_function_logs not found'); END IF;
  EXECUTE $q$ SELECT COUNT(*), COUNT(*) FILTER (WHERE level='error') FROM public.edge_function_logs WHERE created_at >= now() - interval '24 hours' $q$ INTO v_total, v_err;
  RETURN jsonb_build_object('available',true,'total',COALESCE(v_total,0),'errors',COALESCE(v_err,0),
    'error_rate',CASE WHEN COALESCE(v_total,0)=0 THEN 0 ELSE (v_err::numeric/v_total::numeric) END);
END $$;

CREATE OR REPLACE VIEW public.v_qa_open_findings AS
SELECT id, qa_run_id, area, severity, title, status, updated_at, created_at
FROM public.qa_findings WHERE status = 'open' ORDER BY public.qa_severity_rank(severity) DESC, updated_at DESC;

CREATE OR REPLACE VIEW public.v_qa_last_runs AS
SELECT id, run_type, created_at, summary_json FROM public.qa_runs ORDER BY created_at DESC LIMIT 20;

CREATE TABLE IF NOT EXISTS public.qa_h5p_smoke_writes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qa_h5p_smoke_writes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_qa_h5p_smoke_writes ON public.qa_h5p_smoke_writes;
CREATE POLICY deny_all_qa_h5p_smoke_writes ON public.qa_h5p_smoke_writes FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_h5p_smoke_writes ON public.qa_h5p_smoke_writes;
CREATE POLICY admin_all_qa_h5p_smoke_writes ON public.qa_h5p_smoke_writes FOR ALL USING (public.is_admin_user(auth.uid()));

-- Phase 4: Release Train + Risk Acceptance + Publish Unlock
CREATE TABLE IF NOT EXISTS public.qa_risk_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.qa_findings(id) ON DELETE CASCADE,
  accepted_by uuid NULL, reason text NOT NULL, expires_at timestamptz NULL,
  revoked_at timestamptz NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(finding_id)
);
ALTER TABLE public.qa_risk_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_qa_risk_acceptances ON public.qa_risk_acceptances;
CREATE POLICY deny_all_qa_risk_acceptances ON public.qa_risk_acceptances FOR ALL USING (false);
DROP POLICY IF EXISTS admin_all_qa_risk_acceptances ON public.qa_risk_acceptances;
CREATE POLICY admin_all_qa_risk_acceptances ON public.qa_risk_acceptances FOR ALL USING (public.is_admin_user(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_qa_risk_acceptances_finding ON public.qa_risk_acceptances(finding_id);

-- Gate: excludes valid risk acceptances
CREATE OR REPLACE FUNCTION public.compute_qa_release_gate()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_reasons jsonb;
BEGIN
  v_reasons := (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('area',r.area,'min_severity',r.min_severity,'open_findings',f.cnt)),'[]'::jsonb)
    FROM public.qa_gate_rules r
    JOIN LATERAL (
      SELECT COUNT(*) cnt FROM public.qa_findings q
      WHERE q.status='open' AND q.area=r.area
        AND public.qa_severity_rank(q.severity) >= public.qa_severity_rank(r.min_severity)
        AND NOT EXISTS (SELECT 1 FROM public.qa_risk_acceptances ra WHERE ra.finding_id=q.id AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>now()))
    ) f ON true WHERE r.enabled=true AND f.cnt>0
  );
  RETURN jsonb_build_object('blocked',(jsonb_array_length(v_reasons)>0),'reasons',v_reasons);
END $$;

CREATE OR REPLACE FUNCTION public.assert_qa_release_ok()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_gate jsonb;
BEGIN
  v_gate := public.compute_qa_release_gate();
  IF COALESCE((v_gate->>'blocked')::boolean,false) THEN RAISE EXCEPTION 'QA release gate blocked. Details: %', v_gate::text; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.accept_qa_risk(p_finding_id uuid, p_reason text, p_expires_days int DEFAULT 7)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid; v_expires timestamptz;
BEGIN
  v_expires := CASE WHEN p_expires_days > 0 THEN now() + make_interval(days => p_expires_days) ELSE NULL END;
  INSERT INTO public.qa_risk_acceptances(finding_id, accepted_by, reason, expires_at)
  VALUES (p_finding_id, auth.uid(), p_reason, v_expires)
  ON CONFLICT (finding_id) DO UPDATE SET accepted_by=EXCLUDED.accepted_by, reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at, revoked_at=NULL, created_at=now()
  RETURNING id INTO v_id;
  UPDATE public.qa_findings SET status='accepted_risk', updated_at=now() WHERE id=p_finding_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_qa_risk(p_finding_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.qa_risk_acceptances SET revoked_at=now() WHERE finding_id=p_finding_id AND revoked_at IS NULL;
  UPDATE public.qa_findings SET status='open', updated_at=now() WHERE id=p_finding_id AND status='accepted_risk';
END $$;

CREATE OR REPLACE FUNCTION public.assert_publish_unlock()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_qa jsonb;
BEGIN
  v_qa := public.compute_qa_release_gate();
  IF COALESCE((v_qa->>'blocked')::boolean,false) THEN RAISE EXCEPTION 'PUBLISH_BLOCKED: QA gate blocked. %', v_qa::text; END IF;
  BEGIN PERFORM public.assert_compliance_release_ok(); EXCEPTION WHEN undefined_function THEN NULL; WHEN OTHERS THEN RAISE; END;
END $$;

CREATE OR REPLACE VIEW public.v_qa_risk_acceptances AS
SELECT ra.id, ra.finding_id, ra.reason, ra.expires_at, ra.revoked_at, ra.created_at AS accepted_at,
  f.area, f.severity, f.title AS finding_title, f.status AS finding_status,
  CASE WHEN ra.revoked_at IS NOT NULL THEN 'revoked' WHEN ra.expires_at IS NOT NULL AND ra.expires_at<=now() THEN 'expired' ELSE 'active' END AS acceptance_status
FROM public.qa_risk_acceptances ra JOIN public.qa_findings f ON f.id=ra.finding_id ORDER BY ra.created_at DESC;
