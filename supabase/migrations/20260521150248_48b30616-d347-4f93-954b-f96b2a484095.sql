
CREATE TABLE IF NOT EXISTS public.runtime_safe_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  target_layer text NOT NULL CHECK (target_layer IN ('eval','policy','sequencing','observability','intervention','meta')),
  requires_reason boolean NOT NULL DEFAULT true,
  requires_evidence boolean NOT NULL DEFAULT false,
  requires_snapshot boolean NOT NULL DEFAULT false,
  is_destructive boolean NOT NULL DEFAULT false,
  allowed_roles text[] NOT NULL DEFAULT ARRAY['admin']::text[],
  dispatch_handler text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.runtime_action_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text NOT NULL REFERENCES public.runtime_safe_actions(action_key) ON UPDATE CASCADE,
  actor_uid uuid,
  reason text,
  severity text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','rolled_back','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  rollback_ref uuid,
  outcome jsonb,
  error text,
  duration_ms integer,
  dispatched_via text NOT NULL DEFAULT 'admin_ui',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_runtime_action_results_action_created ON public.runtime_action_results (action_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_action_results_status_created ON public.runtime_action_results (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.runtime_action_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES public.runtime_action_results(id) ON DELETE CASCADE,
  evidence_kind text NOT NULL,
  ref_table text,
  ref_id uuid,
  summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runtime_action_evidence_result ON public.runtime_action_evidence (result_id, created_at);

ALTER TABLE public.runtime_safe_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runtime_action_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runtime_action_evidence ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rsa_admin_read" ON public.runtime_safe_actions FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "rar_admin_read" ON public.runtime_action_results FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "rae_admin_read" ON public.runtime_action_evidence FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.runtime_safe_actions
  (action_key, label, description, severity, target_layer, requires_reason, requires_evidence, requires_snapshot, is_destructive, dispatch_handler)
VALUES
  ('re_run_eval_window','Re-run Eval Window','Erzwingt erneuten ai-eval-worker Lauf.','low','eval',true,false,false,false,'ai_eval_worker.rerun'),
  ('rollback_policy','Rollback Policy','Setzt Policy auf letzte stabile Version zurück.','high','policy',true,true,true,true,'policy.rollback'),
  ('freeze_policy','Freeze Policy','Stoppt adaptive Mutationen temporär.','high','policy',true,true,true,true,'policy.freeze'),
  ('disable_dataset','Disable Eval Dataset','Isoliert fehlerhaftes ai_eval_dataset.','medium','eval',true,true,false,true,'eval.disable_dataset'),
  ('recompute_sequence','Recompute Sequence','Berechnet Lernsequenz neu.','low','sequencing',true,false,false,false,'sequencing.recompute'),
  ('silence_alert','Silence Alert','Mutet bekannte Regression temporär.','medium','observability',true,true,false,false,'observability.silence'),
  ('trigger_intervention_recheck','Trigger Intervention Recheck','Re-evaluiert Outcomes.','low','intervention',true,false,false,false,'intervention.recheck'),
  ('open_evidence_chain','Open Evidence Chain','Aggregiert Mutation+Audit-Historie.','low','meta',false,false,false,false,'meta.evidence_chain')
ON CONFLICT (action_key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='ops_audit_contract') THEN
    INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
    VALUES
      ('runtime_safe_action_dispatched', ARRAY['action_key','actor','reason','result_id'], 'safe_actions_v1'),
      ('runtime_safe_action_completed',  ARRAY['action_key','result_id','duration_ms'],    'safe_actions_v1'),
      ('runtime_safe_action_failed',     ARRAY['action_key','result_id','error'],          'safe_actions_v1')
    ON CONFLICT (action_type) DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_runtime_safe_actions()
RETURNS TABLE (
  action_key text, label text, description text, severity text, target_layer text,
  requires_reason boolean, requires_evidence boolean, requires_snapshot boolean,
  is_destructive boolean, dispatch_handler text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.action_key, a.label, a.description, a.severity, a.target_layer,
         a.requires_reason, a.requires_evidence, a.requires_snapshot,
         a.is_destructive, a.dispatch_handler
  FROM public.runtime_safe_actions a
  WHERE a.is_enabled = true
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY a.target_layer, a.severity DESC, a.action_key;
$$;
REVOKE ALL ON FUNCTION public.admin_list_runtime_safe_actions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_runtime_safe_actions() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_runtime_action_results(_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid, action_key text, actor_uid uuid, reason text, severity text, status text,
  outcome jsonb, error text, duration_ms integer, dispatched_via text,
  created_at timestamptz, completed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id, r.action_key, r.actor_uid, r.reason, r.severity, r.status,
         r.outcome, r.error, r.duration_ms, r.dispatched_via, r.created_at, r.completed_at
  FROM public.runtime_action_results r
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY r.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 50), 500));
$$;
REVOKE ALL ON FUNCTION public.admin_get_runtime_action_results(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_runtime_action_results(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_dispatch_runtime_safe_action(
  _action_key text, _reason text, _payload jsonb DEFAULT '{}'::jsonb, _severity text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action public.runtime_safe_actions%ROWTYPE;
  v_actor uuid := auth.uid();
  v_result_id uuid;
  v_sev text;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT * INTO v_action FROM public.runtime_safe_actions WHERE action_key = _action_key AND is_enabled = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_or_disabled_action: %', _action_key;
  END IF;
  IF v_action.requires_reason AND (COALESCE(btrim(_reason), '') = '' OR length(btrim(_reason)) < 8) THEN
    RAISE EXCEPTION 'reason_required_min_8_chars';
  END IF;
  v_sev := COALESCE(_severity, v_action.severity);

  INSERT INTO public.runtime_action_results
    (action_key, actor_uid, reason, severity, status, payload, dispatched_via)
  VALUES
    (_action_key, v_actor, _reason, v_sev, 'pending', COALESCE(_payload, '{}'::jsonb), 'admin_ui')
  RETURNING id INTO v_result_id;

  BEGIN
    PERFORM public.fn_emit_audit(
      'runtime_safe_action_dispatched',
      jsonb_build_object(
        'action_key', _action_key, 'actor', v_actor, 'reason', _reason,
        'result_id', v_result_id, 'severity', v_sev,
        'handler', v_action.dispatch_handler, 'is_destructive', v_action.is_destructive
      )
    );
  EXCEPTION WHEN undefined_function THEN
    INSERT INTO public.auto_heal_log (action_type, result_status, target_type, metadata)
    VALUES ('runtime_safe_action_dispatched', 'pending', 'system',
      jsonb_build_object('action_key', _action_key, 'actor', v_actor, 'result_id', v_result_id, 'reason', _reason));
  WHEN OTHERS THEN NULL;
  END;

  RETURN v_result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_dispatch_runtime_safe_action(text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_runtime_safe_action(text, text, jsonb, text) TO authenticated;
