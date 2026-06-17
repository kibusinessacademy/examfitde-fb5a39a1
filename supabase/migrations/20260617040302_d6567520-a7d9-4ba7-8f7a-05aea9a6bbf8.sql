-- Bundle B: Self-Heal Resilience — Handbook Tail Repair + Publish Guard Repair

-- =====================================================================
-- 1) Repair Policy Registry (declarative classification -> repair action)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.selfheal_repair_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('handbook_tail','publish_guard')),
  cause_code text NOT NULL,
  repair_action text NOT NULL,
  repair_job_name text,
  description text,
  max_repair_attempts int NOT NULL DEFAULT 2,
  cooldown_seconds int NOT NULL DEFAULT 600,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope, cause_code)
);

GRANT SELECT ON public.selfheal_repair_policies TO authenticated;
GRANT ALL ON public.selfheal_repair_policies TO service_role;
ALTER TABLE public.selfheal_repair_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read selfheal_repair_policies"
  ON public.selfheal_repair_policies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service role manages selfheal_repair_policies"
  ON public.selfheal_repair_policies FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Seed handbook tail policies
INSERT INTO public.selfheal_repair_policies (scope, cause_code, repair_action, repair_job_name, description) VALUES
  ('handbook_tail','depth_too_shallow','expand_sections','package_enqueue_handbook_expand','Handbook depth below threshold — expand existing sections'),
  ('handbook_tail','missing_sections','regenerate_skeleton','package_generate_handbook','Required sections missing — regenerate skeleton then re-expand'),
  ('handbook_tail','thin_competency_coverage','expand_sections','package_enqueue_handbook_expand','Competency coverage below floor — expand related sections'),
  ('handbook_tail','expand_job_stale','requeue_expand','package_enqueue_handbook_expand','Expand fan-out is stale — requeue expand jobs'),
  ('handbook_tail','expand_job_failed','requeue_expand','package_enqueue_handbook_expand','Expand jobs failed — clean failures and requeue')
ON CONFLICT (scope, cause_code) DO UPDATE
  SET repair_action = EXCLUDED.repair_action,
      repair_job_name = EXCLUDED.repair_job_name,
      description = EXCLUDED.description,
      updated_at = now();

-- Seed publish guard policies (codes mirror auto_publish guard P0001 reasons)
INSERT INTO public.selfheal_repair_policies (scope, cause_code, repair_action, repair_job_name, description) VALUES
  ('publish_guard','missing_price','ensure_price','pricing_ensure_default','Package has no active price tier — ensure default tier'),
  ('publish_guard','missing_artifacts','rebuild_artifacts','package_artifacts_rebuild','Required artifacts missing — rebuild'),
  ('publish_guard','quality_gate_blocked','requeue_quality_gate','package_quality_gate_recheck','Quality gate blocked — recheck after remediation'),
  ('publish_guard','seo_page_missing','generate_seo_page','package_seo_pillar_ensure','SEO pillar page missing — generate'),
  ('publish_guard','license_config_missing','ensure_license_config','license_config_ensure','License config missing — ensure defaults'),
  ('publish_guard','stripe_price_missing','sync_stripe_price','stripe_price_sync','Stripe price not synced — re-sync')
ON CONFLICT (scope, cause_code) DO UPDATE
  SET repair_action = EXCLUDED.repair_action,
      repair_job_name = EXCLUDED.repair_job_name,
      description = EXCLUDED.description,
      updated_at = now();

-- =====================================================================
-- 2) Repair Ledger (audit + retry budget per package+scope)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.selfheal_repair_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('handbook_tail','publish_guard')),
  cause_code text NOT NULL,
  repair_action text NOT NULL,
  repair_job_id uuid,
  attempt_no int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'enqueued' CHECK (status IN ('enqueued','succeeded','failed','quarantined','skipped_cooldown','skipped_budget')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  decided_by text NOT NULL DEFAULT 'selfheal-engine',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_selfheal_ledger_pkg_scope
  ON public.selfheal_repair_ledger(package_id, scope, created_at DESC);

GRANT SELECT ON public.selfheal_repair_ledger TO authenticated;
GRANT ALL ON public.selfheal_repair_ledger TO service_role;
ALTER TABLE public.selfheal_repair_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read selfheal_repair_ledger"
  ON public.selfheal_repair_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service role manages selfheal_repair_ledger"
  ON public.selfheal_repair_ledger FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =====================================================================
-- 3) Retry budget per package+scope (hard cap)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.selfheal_retry_budget (
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('handbook_tail','publish_guard')),
  consumed int NOT NULL DEFAULT 0,
  max_budget int NOT NULL DEFAULT 5,
  last_repair_at timestamptz,
  PRIMARY KEY (package_id, scope)
);

GRANT SELECT ON public.selfheal_retry_budget TO authenticated;
GRANT ALL ON public.selfheal_retry_budget TO service_role;
ALTER TABLE public.selfheal_retry_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read selfheal_retry_budget"
  ON public.selfheal_retry_budget FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service role manages selfheal_retry_budget"
  ON public.selfheal_retry_budget FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- =====================================================================
-- 4) RPC: reserve repair slot (cooldown + budget check) → returns OK or reason
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_selfheal_reserve_slot(
  p_package_id uuid,
  p_scope text,
  p_cause_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy public.selfheal_repair_policies%ROWTYPE;
  v_budget public.selfheal_retry_budget%ROWTYPE;
  v_recent_attempts int;
  v_last_at timestamptz;
BEGIN
  SELECT * INTO v_policy
    FROM public.selfheal_repair_policies
   WHERE scope = p_scope AND cause_code = p_cause_code AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_policy');
  END IF;

  -- Ensure budget row
  INSERT INTO public.selfheal_retry_budget (package_id, scope, max_budget)
  VALUES (p_package_id, p_scope, GREATEST(5, v_policy.max_repair_attempts * 3))
  ON CONFLICT (package_id, scope) DO NOTHING;

  SELECT * INTO v_budget
    FROM public.selfheal_retry_budget
   WHERE package_id = p_package_id AND scope = p_scope
   FOR UPDATE;

  IF v_budget.consumed >= v_budget.max_budget THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'budget_exhausted',
                              'consumed', v_budget.consumed, 'max', v_budget.max_budget);
  END IF;

  -- Cooldown check on (package, scope, cause)
  SELECT MAX(created_at) INTO v_last_at
    FROM public.selfheal_repair_ledger
   WHERE package_id = p_package_id AND scope = p_scope AND cause_code = p_cause_code
     AND status IN ('enqueued','succeeded');

  IF v_last_at IS NOT NULL AND v_last_at > now() - make_interval(secs => v_policy.cooldown_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown',
                              'last_at', v_last_at, 'cooldown_seconds', v_policy.cooldown_seconds);
  END IF;

  -- Attempt-cap per cause
  SELECT COUNT(*) INTO v_recent_attempts
    FROM public.selfheal_repair_ledger
   WHERE package_id = p_package_id AND scope = p_scope AND cause_code = p_cause_code
     AND created_at > now() - interval '24 hours';

  IF v_recent_attempts >= v_policy.max_repair_attempts THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'max_attempts_per_cause',
                              'attempts', v_recent_attempts, 'max', v_policy.max_repair_attempts);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'policy', row_to_json(v_policy),
    'attempt_no', v_recent_attempts + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_selfheal_reserve_slot(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_selfheal_reserve_slot(uuid,text,text) TO service_role;

-- =====================================================================
-- 5) RPC: commit ledger entry + bump budget (called after enqueue)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_selfheal_commit_repair(
  p_package_id uuid,
  p_scope text,
  p_cause_code text,
  p_repair_action text,
  p_repair_job_id uuid,
  p_attempt_no int,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.selfheal_repair_ledger
    (package_id, scope, cause_code, repair_action, repair_job_id, attempt_no, evidence, status)
  VALUES
    (p_package_id, p_scope, p_cause_code, p_repair_action, p_repair_job_id, p_attempt_no, p_evidence, 'enqueued')
  RETURNING id INTO v_id;

  UPDATE public.selfheal_retry_budget
     SET consumed = consumed + 1,
         last_repair_at = now()
   WHERE package_id = p_package_id AND scope = p_scope;

  -- Audit hook (best-effort)
  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_kind, target_id, payload, status)
    VALUES ('selfheal_repair_enqueued', 'package', p_package_id::text,
            jsonb_build_object('scope', p_scope, 'cause', p_cause_code,
                               'action', p_repair_action, 'attempt', p_attempt_no,
                               'ledger_id', v_id), 'ok');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_selfheal_commit_repair(uuid,text,text,text,uuid,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_selfheal_commit_repair(uuid,text,text,text,uuid,int,jsonb) TO service_role;

-- =====================================================================
-- 6) Admin view: current self-heal posture
-- =====================================================================
CREATE OR REPLACE VIEW public.v_admin_selfheal_status AS
SELECT
  l.package_id,
  cp.title AS package_title,
  l.scope,
  l.cause_code,
  l.repair_action,
  l.status,
  l.attempt_no,
  l.created_at,
  b.consumed AS budget_consumed,
  b.max_budget,
  b.last_repair_at
FROM public.selfheal_repair_ledger l
LEFT JOIN public.course_packages cp ON cp.id = l.package_id
LEFT JOIN public.selfheal_retry_budget b ON b.package_id = l.package_id AND b.scope = l.scope
ORDER BY l.created_at DESC;

GRANT SELECT ON public.v_admin_selfheal_status TO authenticated;

-- update_at trigger for policies
DROP TRIGGER IF EXISTS trg_selfheal_policies_updated ON public.selfheal_repair_policies;
CREATE TRIGGER trg_selfheal_policies_updated
  BEFORE UPDATE ON public.selfheal_repair_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_selfheal_ledger_updated ON public.selfheal_repair_ledger;
CREATE TRIGGER trg_selfheal_ledger_updated
  BEFORE UPDATE ON public.selfheal_repair_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();