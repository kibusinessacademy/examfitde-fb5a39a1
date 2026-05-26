
DO $$ BEGIN
  CREATE TYPE public.setup_wizard_status AS ENUM
    ('not_started','in_progress','connected','error','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.enterprise_setup_wizard_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  wizard_key text NOT NULL,
  status public.setup_wizard_status NOT NULL DEFAULT 'not_started',
  current_step int NOT NULL DEFAULT 0,
  total_steps int NOT NULL DEFAULT 1,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, wizard_key)
);
CREATE INDEX IF NOT EXISTS idx_eswst_org ON public.enterprise_setup_wizard_state(org_id);
CREATE INDEX IF NOT EXISTS idx_eswst_status ON public.enterprise_setup_wizard_state(status);
ALTER TABLE public.enterprise_setup_wizard_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.enterprise_setup_wizard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  wizard_key text NOT NULL,
  event_type text NOT NULL,
  from_step int,
  to_step int,
  from_status public.setup_wizard_status,
  to_status public.setup_wizard_status,
  payload jsonb DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eswse_org_wizard ON public.enterprise_setup_wizard_events(org_id, wizard_key, created_at DESC);
ALTER TABLE public.enterprise_setup_wizard_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_eswst_updated_at ON public.enterprise_setup_wizard_state;
CREATE TRIGGER trg_eswst_updated_at
BEFORE UPDATE ON public.enterprise_setup_wizard_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "wizards_state_read_org_managers" ON public.enterprise_setup_wizard_state;
CREATE POLICY "wizards_state_read_org_managers"
ON public.enterprise_setup_wizard_state FOR SELECT TO authenticated
USING (public.fn_is_org_manager(org_id) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "wizards_events_read_org_managers" ON public.enterprise_setup_wizard_events;
CREATE POLICY "wizards_events_read_org_managers"
ON public.enterprise_setup_wizard_events FOR SELECT TO authenticated
USING (public.fn_is_org_manager(org_id) OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.setup_wizard_list_for_org(_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (public.fn_is_org_manager(_org_id) OR public.has_role(auth.uid(),'admin')) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED','org_id',_org_id,'states','[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'wizard_key', wizard_key, 'status', status,
    'current_step', current_step, 'total_steps', total_steps,
    'config', config, 'last_error', last_error,
    'started_at', started_at, 'completed_at', completed_at,
    'updated_at', updated_at
  ) ORDER BY updated_at DESC), '[]'::jsonb) INTO v_rows
  FROM public.enterprise_setup_wizard_state WHERE org_id = _org_id;
  RETURN jsonb_build_object('reason','OK','org_id',_org_id,'states',v_rows,'generated_at',now());
END $$;
REVOKE ALL ON FUNCTION public.setup_wizard_list_for_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setup_wizard_list_for_org(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.setup_wizard_upsert_state(
  _org_id uuid, _wizard_key text, _status public.setup_wizard_status,
  _current_step int, _total_steps int,
  _config jsonb DEFAULT '{}'::jsonb, _last_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prev public.enterprise_setup_wizard_state%ROWTYPE;
  v_row public.enterprise_setup_wizard_state%ROWTYPE;
BEGIN
  IF NOT (public.fn_is_org_manager(_org_id) OR public.has_role(auth.uid(),'admin')) THEN
    RETURN jsonb_build_object('reason','NOT_AUTHORIZED');
  END IF;
  IF _wizard_key IS NULL OR length(trim(_wizard_key)) = 0 THEN
    RETURN jsonb_build_object('reason','INVALID_WIZARD_KEY');
  END IF;

  SELECT * INTO v_prev FROM public.enterprise_setup_wizard_state
   WHERE org_id = _org_id AND wizard_key = _wizard_key;

  INSERT INTO public.enterprise_setup_wizard_state
    (org_id, wizard_key, status, current_step, total_steps, config, last_error,
     started_at, completed_at, updated_by)
  VALUES (
    _org_id, _wizard_key, _status,
    GREATEST(_current_step, 0), GREATEST(_total_steps, 1),
    COALESCE(_config,'{}'::jsonb), _last_error,
    CASE WHEN _status <> 'not_started' THEN COALESCE(v_prev.started_at, now()) ELSE NULL END,
    CASE WHEN _status = 'connected' THEN now() ELSE NULL END,
    auth.uid()
  )
  ON CONFLICT (org_id, wizard_key) DO UPDATE
    SET status = EXCLUDED.status,
        current_step = EXCLUDED.current_step,
        total_steps = EXCLUDED.total_steps,
        config = EXCLUDED.config,
        last_error = EXCLUDED.last_error,
        started_at = COALESCE(public.enterprise_setup_wizard_state.started_at, EXCLUDED.started_at),
        completed_at = CASE WHEN EXCLUDED.status = 'connected' THEN now()
                            ELSE public.enterprise_setup_wizard_state.completed_at END,
        updated_by = auth.uid(),
        updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.enterprise_setup_wizard_events
    (org_id, wizard_key, event_type, from_step, to_step, from_status, to_status, payload, actor_id)
  VALUES (
    _org_id, _wizard_key,
    CASE WHEN v_prev.id IS NULL THEN 'wizard_started'
         WHEN _status = 'connected' THEN 'wizard_completed'
         WHEN _status = 'error' THEN 'wizard_errored'
         ELSE 'wizard_advanced' END,
    v_prev.current_step, v_row.current_step,
    v_prev.status, v_row.status,
    jsonb_build_object('last_error', _last_error), auth.uid()
  );

  BEGIN
    PERFORM public.fn_emit_audit(
      'setup_wizard_state_change',
      jsonb_build_object(
        'org_id', _org_id, 'wizard_key', _wizard_key,
        'to_status', _status, 'to_step', _current_step,
        'total_steps', _total_steps
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('reason','OK',
    'state', jsonb_build_object(
      'wizard_key', v_row.wizard_key, 'status', v_row.status,
      'current_step', v_row.current_step, 'total_steps', v_row.total_steps,
      'config', v_row.config, 'last_error', v_row.last_error,
      'started_at', v_row.started_at, 'completed_at', v_row.completed_at));
END $$;
REVOKE ALL ON FUNCTION public.setup_wizard_upsert_state(uuid,text,public.setup_wizard_status,int,int,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setup_wizard_upsert_state(uuid,text,public.setup_wizard_status,int,int,jsonb,text) TO authenticated;

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('setup_wizard_state_change',
        ARRAY['org_id','wizard_key','to_status','to_step','total_steps'],
        'premium_ux_setup_wizards')
ON CONFLICT (action_type) DO NOTHING;
